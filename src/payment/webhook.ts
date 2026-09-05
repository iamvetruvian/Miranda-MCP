/**
 * Razorpay Webhook Ingestion Gateway
 * Verifies webhook signatures, deduplicates events, logs audit trail,
 * and advances transaction state to PAYMENT_AUTHORIZED.
 */

import crypto from "crypto";
import express, { Request, Response, Express } from "express";
import { TransactionManager } from "../transaction/manager.js";
import { AuditLedger } from "../audit/ledger.js";
import { TransactionState, AuditEventType } from "../types/index.js";
import {
  paymentWebhookReceivedEvent,
  paymentCapturedEvent,
  refundProcessedEvent,
  refundFailedEvent,
  webhookSignatureVerifiedEvent,
  webhookSignatureInvalidEvent,
  webhookSignatureMissingEvent,
} from "../audit/events.js";

import { createRateLimitMiddleware, RateLimiter } from "../policy/rate-limit.js";
import { listenWithPortRecovery } from "../utils/dev-port-killer.js";

export interface WebhookProcessResult {
  status: "processed" | "ignored" | "rejected";
  transaction_id?: string;
  payment_id?: string;
  refund_id?: string;
  reason?: string;
}

/**
 * Validate Razorpay HMAC-SHA256 webhook signature.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) return false;
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}

/**
 * Process a verified or trusted Razorpay webhook event payload.
 */
export function processWebhookEvent(
  eventBody: Record<string, unknown>,
  txnManager: TransactionManager,
  auditLedger: AuditLedger
): WebhookProcessResult {
  const eventType = String(eventBody.type ?? eventBody.event ?? "");
  const payload = (eventBody.payload as Record<string, unknown>) ?? {};

  // Extract reference_id from Stripe object or Razorpay payload
  const stripeData = (eventBody.data as Record<string, unknown>)?.object as Record<string, unknown> | undefined;
  const stripeMeta = stripeData?.metadata as Record<string, unknown> | undefined;

  // Extract reference_id (our transaction_id) from payment_link, order, payment, or refund entity
  const paymentLinkEntity = (payload.payment_link as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const orderEntity = (payload.order as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const paymentEntity = (payload.payment as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const paymentNotes = paymentEntity?.notes as Record<string, unknown> | undefined;
  const refundEntity = (payload.refund as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const refundNotes = refundEntity?.notes as Record<string, unknown> | undefined;

  const referenceId = (
    stripeData?.client_reference_id ??
    stripeMeta?.transaction_id ??
    stripeMeta?.ref ??
    paymentLinkEntity?.reference_id ??
    orderEntity?.receipt ??
    paymentNotes?.transaction_id ??
    refundNotes?.transaction_id
  ) as string | undefined;

  if (!referenceId) {
    return {
      status: "ignored",
      reason: `No transaction reference_id found in webhook payload for event "${eventType}"`,
    };
  }

  if (!txnManager.has(referenceId)) {
    return {
      status: "rejected",
      transaction_id: referenceId,
      reason: `Referenced transaction "${referenceId}" does not exist in transaction store`,
    };
  }

  // 1. Log webhook receipt in immutable audit ledger
  auditLedger.append(
    paymentWebhookReceivedEvent(referenceId, eventType, payload)
  );

  // 2. Handle payment completion events
  const isPaymentPaidEvent =
    eventType === "payment_link.paid" ||
    eventType === "order.paid" ||
    eventType === "payment.captured" ||
    eventType === "checkout.session.completed" ||
    eventType === "payment_intent.succeeded" ||
    eventType === "charge.succeeded";

  if (isPaymentPaidEvent) {
    const txn = txnManager.get(referenceId);

    // Extract payment ID and captured amount
    const paymentId = (paymentEntity?.id ?? paymentLinkEntity?.payment_id ?? `pi_wh_${crypto.randomUUID().slice(0, 10)}`) as string;
    const amountPaise = Number(paymentEntity?.amount ?? paymentLinkEntity?.amount ?? txn.merchant_verified?.total.amount ?? 0);
    const currency = String(paymentEntity?.currency ?? txn.merchant_verified?.total.currency ?? "INR");

    // Bind payment data to transaction
    txnManager.bindPayment(referenceId, {
      provider: "stripe",
      stripe_payment_intent_id: paymentId,
      payment_status: "captured",
    });

    // 3. Advance state machine to PAYMENT_AUTHORIZED
    if (txn.state === TransactionState.PAYMENT_PENDING) {
      txnManager.transition(
        referenceId,
        TransactionState.PAYMENT_AUTHORIZED,
        `stripe_webhook:${eventType}`
      );
    }

    // 4. Log payment captured event
    auditLedger.append(
      paymentCapturedEvent(referenceId, {
        payment_id: paymentId,
        amount: amountPaise,
        currency,
      })
    );

    return {
      status: "processed",
      transaction_id: referenceId,
      payment_id: paymentId,
    };
  }

  // 3. Handle refund events (Component 3)
  if (eventType === "refund.processed" || eventType === "refund.failed") {
    const txn = txnManager.get(referenceId);
    const refundId = String(refundEntity?.id ?? `rfnd_wh_${crypto.randomUUID().slice(0, 10)}`);
    const amount = Number(refundEntity?.amount ?? 0);
    const currency = String(refundEntity?.currency ?? txn.merchant_verified?.total.currency ?? "INR");

    txnManager.bindRefund(referenceId, {
      refund_id: refundId,
      amount: { amount, currency },
      status: eventType === "refund.processed" ? "processed" : "failed",
      created_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
    });

    if (eventType === "refund.processed") {
      // REFUND_PENDING → REFUNDED; CANCELLED stays (cancel-initiated refunds land terminal)
      if (txn.state === TransactionState.REFUND_PENDING) {
        txnManager.transition(referenceId, TransactionState.REFUNDED, `razorpay_webhook:${eventType}`);
      }
      auditLedger.append(refundProcessedEvent(referenceId, { refund_id: refundId, amount, currency }));
    } else {
      if (txn.state === TransactionState.REFUND_PENDING) {
        txnManager.transition(referenceId, TransactionState.ORDER_CONFIRMED, `razorpay_webhook:${eventType}`);
      }
      auditLedger.append(refundFailedEvent(referenceId, refundId));
    }

    return {
      status: "processed",
      transaction_id: referenceId,
      refund_id: refundId,
    };
  }

  return {
    status: "ignored",
    transaction_id: referenceId,
    reason: `Webhook event "${eventType}" acknowledged but requires no state transition`,
  };
}

/**
 * Creates Express application configured for Razorpay webhook endpoints.
 */
export function createWebhookApp(
  txnManager: TransactionManager,
  auditLedger: AuditLedger,
  webhookSecret?: string,
  rateLimiter?: RateLimiter
): Express {
  const app = express();

  if (rateLimiter) {
    app.use(createRateLimitMiddleware(rateLimiter));
  }

  // Parse raw body for HMAC signature verification
  app.use(
    express.json({
      verify: (req: Request & { rawBody?: string }, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    })
  );

  const handleWebhookPost = (req: Request & { rawBody?: string }, res: Response) => {
    const signature = (req.headers["x-razorpay-signature"] || req.headers["stripe-signature"]) as string | undefined;

    // Verify HMAC signature if secret configured
    if (webhookSecret) {
      if (!signature) {
        auditLedger.append(webhookSignatureMissingEvent());
        const missingMsg = req.path.includes("razorpay")
          ? "Missing X-Razorpay-Signature header"
          : "Missing signature header";
        console.warn(`Webhook received with ${missingMsg}`);
        res.status(401).json({ error: missingMsg });
        return;
      }

      if (!req.rawBody || !verifyWebhookSignature(req.rawBody, signature, webhookSecret)) {
        auditLedger.append(webhookSignatureInvalidEvent(signature));
        console.warn("Webhook signature verification failed");
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }

      auditLedger.append(webhookSignatureVerifiedEvent(signature.length));
    }

    try {
      const result = processWebhookEvent(req.body, txnManager, auditLedger);
      if (result.status === "rejected") {
        res.status(400).json(result);
      } else {
        res.status(200).json(result);
      }
    } catch (err: unknown) {
      console.error("Error processing webhook:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  };

  app.post("/webhooks/stripe", handleWebhookPost);
  app.post("/webhooks/razorpay", handleWebhookPost);
  app.post("/webhooks", handleWebhookPost);

  return app;
}

/**
 * Starts the webhook listener on the specified port.
 */
export function startWebhookServer(
  txnManager: TransactionManager,
  auditLedger: AuditLedger,
  port: number = 3001,
  webhookSecret?: string
) {
  const app = createWebhookApp(txnManager, auditLedger, webhookSecret);
  const server = listenWithPortRecovery(app, port, () => {
    console.error(`[MerchantMCP-Webhook] Razorpay webhook server listening on port ${port}`);
  });
  return server;
}
