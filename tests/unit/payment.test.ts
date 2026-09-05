import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";
import { StripeAdapter } from "../../src/payment/stripe.js";
import {
  verifyWebhookSignature,
  processWebhookEvent,
  createWebhookApp,
} from "../../src/payment/webhook.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { TransactionState, AuditEventType } from "../../src/types/index.js";

describe("StripeAdapter", () => {
  let adapter: StripeAdapter;

  beforeEach(() => {
    // Uses simulation mode for unit tests
    adapter = new StripeAdapter("mock_key_id", "mock_publishable_key", true);
  });

  it("should be in simulation mode when initialized with mock keys", () => {
    expect(adapter.isSimulationMode()).toBe(true);
  });

  it("should create a payment order with amount in paise and receipt reference", async () => {
    const result = await adapter.createOrder({
      amount: { amount: 6499900, currency: "INR" },
      receipt: "txn_order_001",
    });

    expect(result.order_id).toMatch(/^(pi|order)_sim_/);
    expect(result.status).toBe("created");
    expect(result.amount).toEqual({ amount: 6499900, currency: "INR" });
  });

  it("should create a hosted payment link with short_url", async () => {
    const result = await adapter.createPaymentLink({
      amount: { amount: 6499900, currency: "INR" },
      description: "Lenovo IdeaPad Slim 5 Purchase",
      reference_id: "txn_order_001",
    });

    expect(result.payment_link_id).toMatch(/^cs_sim_/);
    expect(result.short_url).toContain("http://localhost:");
    expect(result.amount).toEqual({ amount: 6499900, currency: "INR" });
  });

  it("should generate checkout session params in simulation mode", async () => {
    expect(adapter.publishableKey).toBe("mock_publishable_key");

    const session = await adapter.createCheckoutSession({
      order_id: "order_sim_12345",
      amount: { amount: 7499900, currency: "INR" },
      merchant_name: "TechBazaar",
      description: "Purchase: Samsung Galaxy S24",
      prefill: {
        email: "buyer@example.com",
      },
    });

    expect(session.publishable_key).toBe("mock_publishable_key");
    expect(session.payment_intent_id).toBe("order_sim_12345");
    expect(session.amount).toEqual({ amount: 7499900, currency: "INR" });
    expect(session.currency).toBe("INR");
    expect(session.merchant_name).toBe("TechBazaar");
    expect(session.description).toBe("Purchase: Samsung Galaxy S24");
    expect(session.prefill?.email).toBe("buyer@example.com");
  });

  it("should fetch payment status and capture payments", async () => {
    const status = await adapter.getPaymentStatus("pay_sim_999");
    expect(status.payment_id).toBe("pay_sim_999");
    expect(status.status).toBe("captured");

    const capture = await adapter.capturePayment("pay_sim_999", { amount: 10000, currency: "INR" });
    expect(capture.status).toBe("captured");
  });

  it("should create a customer entity in simulation mode", async () => {
    const result = await adapter.createCustomer({
      name: "Autonomous Buyer",
      email: "agent@example.com",
      contact: "+919876543210",
    });

    expect(result.customer_id).toMatch(/^(cus|cust)_sim_/);
  });

  it("should charge a recurring token autonomously in simulation mode", async () => {
    const chargeResult = await adapter.chargeRecurringToken({
      customer_id: "cust_sim_12345",
      token_id: "token_sim_abc",
      amount: { amount: 4999900, currency: "INR" },
      order_id: "order_sim_98765",
      email: "buyer@example.com",
      contact: "+919876543210",
      description: "Autonomous phone purchase",
    });

    expect(chargeResult.payment_id).toMatch(/^(pi_off|pay_rec)_sim_/);
    expect(chargeResult.status).toBe("captured");
    expect(chargeResult.amount).toEqual({ amount: 4999900, currency: "INR" });

    // Verify tracked payment status
    const status = await adapter.getPaymentStatus(chargeResult.payment_id);
    expect(status.status).toBe("captured");
    expect(status.order_id).toBe("order_sim_98765");
  });

  it("should fetch customer tokens and support simulated tokens", async () => {
    const customer = await adapter.createCustomer({
      email: "test@example.com",
      contact: "+919988776655",
    });

    const tokens = await adapter.fetchCustomerTokens(customer.customer_id);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].token_id).toMatch(/^token_sim_/);
    expect(tokens[0].method).toBe("card");

    // Test explicit simulated token injection
    adapter.simulateCustomerToken("cust_custom_test", {
      token_id: "token_custom_card_999",
      method: "card",
      max_amount: 5000000,
    });

    const customTokens = await adapter.fetchCustomerTokens("cust_custom_test");
    expect(customTokens).toHaveLength(1);
    expect(customTokens[0].token_id).toBe("token_custom_card_999");
    expect(customTokens[0].method).toBe("card");
    expect(customTokens[0].max_amount).toBe(5000000);
  });

  it("should fail chargeRecurringToken when simulateRecurringFailure is toggled on", async () => {
    adapter.setSimulateRecurringFailure(true, "Simulated bank downtime");

    await expect(
      adapter.chargeRecurringToken({
        customer_id: "cust_fail_test",
        token_id: "token_fail_test",
        amount: { amount: 10000, currency: "INR" },
        order_id: "order_fail_test",
        email: "fail@example.com",
        contact: "+919876543210",
      })
    ).rejects.toThrow("Simulated bank downtime");

    // Toggle back off -> succeeds
    adapter.setSimulateRecurringFailure(false);
    const successRes = await adapter.chargeRecurringToken({
      customer_id: "cust_fail_test",
      token_id: "token_fail_test",
      amount: { amount: 10000, currency: "INR" },
      order_id: "order_fail_test",
      email: "fail@example.com",
      contact: "+919876543210",
    });
    expect(successRes.status).toBe("captured");
  });
});

describe("Webhook Signature Verification", () => {
  const secret = "super_secret_webhook_key_123";
  const body = JSON.stringify({ event: "payment_link.paid", payload: { payment: { id: "pay_123" } } });

  it("should verify valid HMAC-SHA256 signature", () => {
    const signature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    const isValid = verifyWebhookSignature(body, signature, secret);
    expect(isValid).toBe(true);
  });

  it("should reject tampered payload or incorrect signature", () => {
    const validSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    const tamperedBody = body.replace("payment_link.paid", "order.paid");
    expect(verifyWebhookSignature(tamperedBody, validSignature, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "incorrect_signature_hex", secret)).toBe(false);
  });
});

describe("Webhook Processing Lifecycle", () => {
  let auditLedger: AuditLedger;
  let txnManager: TransactionManager;

  beforeEach(() => {
    auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger);
  });

  it("should process payment_link.paid event and advance state from PAYMENT_PENDING to PAYMENT_AUTHORIZED", () => {
    // 1. Create transaction in PAYMENT_PENDING state
    const txn = txnManager.create({
      product_id: "TECH-LAP-001",
      quantity: 1,
      selection_reason: "Best laptop",
    });

    txnManager.bindCheckout(txn.transaction_id, {
      checkout_id: "chk_001",
      sku: "TECH-LAP-001",
      unit_price: { amount: 6499900, currency: "INR" },
      total: { amount: 6499900, currency: "INR" },
      available: true,
    });
    txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "checkout");
    txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_PENDING, "link_created");

    // 2. Prepare mock webhook payload from Razorpay
    const webhookPayload = {
      event: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            id: "plink_test_123",
            reference_id: txn.transaction_id, // Our transaction ID
            payment_id: "pay_rzp_live_998877",
            amount: 6499900,
          },
        },
        payment: {
          entity: {
            id: "pay_rzp_live_998877",
            amount: 6499900,
            currency: "INR",
            status: "captured",
          },
        },
      },
    };

    // 3. Process webhook
    const result = processWebhookEvent(webhookPayload, txnManager, auditLedger);

    expect(result.status).toBe("processed");
    expect(result.transaction_id).toBe(txn.transaction_id);
    expect(result.payment_id).toBe("pay_rzp_live_998877");

    // 4. Verify transaction state updated
    const updatedTxn = txnManager.get(txn.transaction_id);
    expect(updatedTxn.state).toBe(TransactionState.PAYMENT_AUTHORIZED);
    expect(updatedTxn.payment?.stripe_payment_intent_id || (updatedTxn.payment as any)?.razorpay_payment_id).toBe("pay_rzp_live_998877");
    expect(updatedTxn.payment?.payment_status).toBe("captured");

    // 5. Verify audit events recorded
    const auditEvents = auditLedger.getTransactionAudit(txn.transaction_id);
    expect(auditEvents.some((e) => e.event_type === AuditEventType.PAYMENT_WEBHOOK_RECEIVED)).toBe(true);
    expect(auditEvents.some((e) => e.event_type === AuditEventType.PAYMENT_CAPTURED)).toBe(true);
    expect(auditLedger.verifyChain(txn.transaction_id).valid).toBe(true);
  });

  it("should reject webhook referencing non-existent transaction", () => {
    const webhookPayload = {
      event: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            reference_id: "txn_does_not_exist_404",
          },
        },
      },
    };

    const result = processWebhookEvent(webhookPayload, txnManager, auditLedger);
    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("does not exist in transaction store");
  });

  it("should ignore webhooks without reference_id", () => {
    const webhookPayload = {
      event: "dummy.unrelated_event",
      payload: {},
    };

    const result = processWebhookEvent(webhookPayload, txnManager, auditLedger);
    expect(result.status).toBe("ignored");
  });
});

describe("Webhook HTTP Gateway (createWebhookApp)", () => {
  let auditLedger: AuditLedger;
  let txnManager: TransactionManager;
  const webhookSecret = "test_webhook_secret_key_xyz";

  beforeEach(() => {
    auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger);
  });

  async function postWebhook(
    app: ReturnType<typeof createWebhookApp>,
    body: string,
    signature?: string
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (signature) {
        headers["x-razorpay-signature"] = signature;
      }

      const res = await fetch(`http://localhost:${port}/webhooks/razorpay`, {
        method: "POST",
        headers,
        body,
      });

      const data = await res.json();
      return { status: res.status, data };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("should return 401 and log WEBHOOK_SIGNATURE_MISSING when signature header is missing", async () => {
    const app = createWebhookApp(txnManager, auditLedger, webhookSecret);
    const body = JSON.stringify({ event: "payment_link.paid" });

    const res = await postWebhook(app, body);
    expect(res.status).toBe(401);
    expect(res.data.error).toContain("Missing X-Razorpay-Signature header");

    const events = auditLedger.getAllEvents();
    expect(events.some((e) => e.event_type === AuditEventType.WEBHOOK_SIGNATURE_MISSING)).toBe(true);
  });

  it("should return 401 and log WEBHOOK_SIGNATURE_INVALID when signature is invalid", async () => {
    const app = createWebhookApp(txnManager, auditLedger, webhookSecret);
    const body = JSON.stringify({ event: "payment_link.paid" });

    const res = await postWebhook(app, body, "invalid_signature_hex_12345");
    expect(res.status).toBe(401);
    expect(res.data.error).toContain("Invalid webhook signature");

    const events = auditLedger.getAllEvents();
    expect(events.some((e) => e.event_type === AuditEventType.WEBHOOK_SIGNATURE_INVALID)).toBe(true);
  });

  it("should return 200 and log WEBHOOK_SIGNATURE_VERIFIED when signature is valid", async () => {
    const app = createWebhookApp(txnManager, auditLedger, webhookSecret);

    // Setup active transaction
    const txn = txnManager.create({
      product_id: "TECH-101",
      quantity: 1,
      selection_reason: "Best laptop",
    });
    txnManager.bindCheckout(txn.transaction_id, {
      checkout_id: "chk_101",
      sku: "TECH-101",
      unit_price: { amount: 5000000, currency: "INR" },
      total: { amount: 5000000, currency: "INR" },
      available: true,
    });
    txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "checkout_created");
    txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_PENDING, "payment_initiated");

    const payloadObj = {
      event: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            reference_id: txn.transaction_id,
            payment_id: "pay_verified_123",
          },
        },
        payment: {
          entity: {
            id: "pay_verified_123",
            amount: 5000000,
            currency: "INR",
          },
        },
      },
    };

    const body = JSON.stringify(payloadObj);
    const validSignature = crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");

    const res = await postWebhook(app, body, validSignature);
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("processed");

    const events = auditLedger.getAllEvents();
    expect(events.some((e) => e.event_type === AuditEventType.WEBHOOK_SIGNATURE_VERIFIED)).toBe(true);
    expect(txnManager.get(txn.transaction_id).state).toBe(TransactionState.PAYMENT_AUTHORIZED);
  });
});

