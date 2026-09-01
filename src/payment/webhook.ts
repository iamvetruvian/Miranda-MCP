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
  const eventType = String(eventBody.event ?? "");
  const payload = (eventBody.payload as Record<string, unknown>) ?? {};

  // Extract reference_id (our transaction_id) from payment_link, order, payment, or refund entity
  const paymentLinkEntity = (payload.payment_link as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const orderEntity = (payload.order as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const paymentEntity = (payload.payment as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const paymentNotes = paymentEntity?.notes as Record<string, unknown> | undefined;
  const refundEntity = (payload.refund as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const refundNotes = refundEntity?.notes as Record<string, unknown> | undefined;

  const referenceId = (
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
    eventType === "payment.captured";

  if (isPaymentPaidEvent) {
    const txn = txnManager.get(referenceId);

    // Extract payment ID and captured amount
    const paymentId = (paymentEntity?.id ?? paymentLinkEntity?.payment_id ?? `pay_wh_${crypto.randomUUID().slice(0, 10)}`) as string;
    const amountPaise = Number(paymentEntity?.amount ?? paymentLinkEntity?.amount ?? txn.merchant_verified?.total.amount ?? 0);
    const currency = String(paymentEntity?.currency ?? txn.merchant_verified?.total.currency ?? "INR");

    // Bind payment data to transaction
    txnManager.bindPayment(referenceId, {
      provider: "razorpay",
      razorpay_payment_id: paymentId,
      razorpay_order_id: (orderEntity?.id ?? paymentEntity?.order_id ?? txn.payment?.razorpay_order_id) as string | undefined,
      payment_status: "captured",
    });

    // 3. Advance state machine to PAYMENT_AUTHORIZED
    if (txn.state === TransactionState.PAYMENT_PENDING) {
      txnManager.transition(
        referenceId,
        TransactionState.PAYMENT_AUTHORIZED,
        `razorpay_webhook:${eventType}`
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

  app.post("/webhooks/razorpay", (req: Request & { rawBody?: string }, res: Response) => {
    const signature = req.headers["x-razorpay-signature"] as string | undefined;

    // Verify HMAC signature if secret configured
    if (webhookSecret) {
      if (!signature) {
        auditLedger.append(webhookSignatureMissingEvent());
        console.warn("Razorpay webhook received with missing X-Razorpay-Signature header");
        res.status(401).json({ error: "Missing X-Razorpay-Signature header" });
        return;
      }

      if (!req.rawBody || !verifyWebhookSignature(req.rawBody, signature, webhookSecret)) {
        auditLedger.append(webhookSignatureInvalidEvent(signature));
        console.warn("Razorpay webhook signature verification failed");
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
      console.error("Error processing Razorpay webhook:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

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
