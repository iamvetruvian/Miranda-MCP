import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AmountBoundsGate,
  RefundBoundsGate,
  TransactionStateGate,
  IdempotencyGate,
} from "../../src/policy/gates.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { RazorpayAdapter } from "../../src/payment/razorpay.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { createMerchantMcpServer } from "../../src/server.js";
import { processWebhookEvent } from "../../src/payment/webhook.js";
import { generateDecisionReceipt } from "../../src/audit/receipt.js";
import {
  Transaction,
  TransactionState,
  AuditEventType,
} from "../../src/types/index.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

const testManifest: IntegrationManifest = {
  merchant: {
    name: "ElectroWorld",
    description: "Gadgets Store",
    commerce_domain: "retail",
    currency: "INR",
    base_url: "http://localhost:5050",
  },
  operations: {
    search: { method: "POST", path: "/search" },
    get_product: { method: "GET", path: "/products/:product_id" },
    create_checkout: { method: "POST", path: "/checkout" },
    get_checkout: { method: "GET", path: "/checkout/:checkout_id" },
    confirm_order: { method: "POST", path: "/orders" },
    get_order_status: { method: "GET", path: "/orders/:order_id" },
    cancel_order: { method: "POST", path: "/orders/:order_id/cancel" },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.id" },
      title: { from: "$.title" },
      "price.amount": { from: "$.price" },
      "price.currency": { from: null, transform: { type: "default", value: "INR" } },
      availability: { from: null, transform: { type: "default", value: "in_stock" } },
    },
    checkout: {
      checkout_id: { from: "$.id" },
      sku: { from: "$.sku" },
      "total.amount": { from: "$.total" },
      "total.currency": { from: null, transform: { type: "default", value: "INR" } },
      available: { from: null, transform: { type: "default", value: true } },
    },
    order: {
      order_id: { from: "$.order_id" },
      status: { from: "$.status" },
    },
  },
  payment: {
    provider: "razorpay",
    razorpay_key_id_env: "RAZORPAY_KEY_ID",
    razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
  },
};

function createMockCapturedTransaction(overrides?: Partial<Transaction>): Transaction {
  return {
    transaction_id: "txn_test_refund_123",
    state: TransactionState.ORDER_CONFIRMED,
    created_at: new Date().toISOString(),
    agent_claim: {
      product_id: "PROD-001",
      title: "Noise Cancelling Headphones",
      quantity: 1,
      selection_reason: "High quality audio test",
    },
    merchant_verified: {
      checkout_id: "chk_001",
      sku: "PROD-001",
      title: "Noise Cancelling Headphones",
      unit_price: { amount: 1500000, currency: "INR" },
      total: { amount: 1500000, currency: "INR" },
      available: true,
    },
    payment: {
      provider: "razorpay",
      razorpay_payment_id: "pay_test_999",
      razorpay_order_id: "order_test_999",
      payment_status: "captured",
      refunded_amount: 0,
      refunds: [],
    },
    merchant_order: {
      order_id: "ORD-999",
      status: "CONFIRMED",
      confirmed_at: new Date().toISOString(),
    },
    audit_event_ids: [],
    ...overrides,
  };
}

describe("Component 3: Full Refund & Cancel Lifecycle", () => {
  let auditLedger: AuditLedger;
  let txnManager: TransactionManager;
  let policyEngine: PolicyEngine;
  let paymentAdapter: RazorpayAdapter;

  beforeEach(() => {
    auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger);
    policyEngine = new PolicyEngine();
    paymentAdapter = new RazorpayAdapter("mock_key", "mock_secret", true);
  });

  describe("RefundBoundsGate Policy Gate", () => {
    const gate = new RefundBoundsGate();

    it("should PASS on valid full refund of remaining captured payment", () => {
      const txn = createMockCapturedTransaction();
      const res = gate.check(txn, "REQUEST_REFUND");
      expect(res.result).toBe("PASS");
      expect(res.detail).toContain("within refundable remainder");
    });

    it("should PASS on valid partial refund within remaining captured amount", () => {
      const txn = createMockCapturedTransaction();
      const res = gate.check(txn, "REQUEST_REFUND", { requested_amount: 500000 });
      expect(res.result).toBe("PASS");
      expect(res.detail).toContain("500000 sub-units within refundable remainder 1500000");
    });

    it("should FAIL when requested refund amount exceeds refundable remainder", () => {
      const txn = createMockCapturedTransaction({
        payment: {
          provider: "razorpay",
          razorpay_payment_id: "pay_test_999",
          payment_status: "captured",
          refunded_amount: 1000000, // 10,000 already refunded out of 15,000
          refunds: [],
        },
      });
      const res = gate.check(txn, "REQUEST_REFUND", { requested_amount: 600000 }); // remaining is only 500000
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain("Refund of 600000 sub-units out of bounds");
    });

    it("should FAIL when payment is not in captured status", () => {
      const txn = createMockCapturedTransaction({
        payment: {
          provider: "razorpay",
          razorpay_payment_id: "pay_test_999",
          payment_status: "authorized",
          refunded_amount: 0,
        },
      });
      const res = gate.check(txn, "REQUEST_REFUND");
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain('only captured payments are refundable');
    });

    it("should FAIL when requested amount is non-positive", () => {
      const txn = createMockCapturedTransaction();
      const res = gate.check(txn, "REQUEST_REFUND", { requested_amount: 0 });
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain("out of bounds");
    });

    it("should FAIL when requested currency does not match captured currency", () => {
      const txn = createMockCapturedTransaction();
      const res = gate.check(txn, "REQUEST_REFUND", {
        requested_amount: 500000,
        requested_currency: "USD",
      });
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain("Refund currency (USD) must match captured payment currency (INR)");
    });
  });

  describe("TransactionStateGate on Refund & Cancel Actions", () => {
    const stateGate = new TransactionStateGate();

    it("should allow CANCEL in pre-payment and post-confirmation states", () => {
      const createdTxn = createMockCapturedTransaction({ state: TransactionState.CREATED });
      expect(stateGate.check(createdTxn, "CANCEL").result).toBe("PASS");

      const checkoutTxn = createMockCapturedTransaction({ state: TransactionState.CHECKOUT_CREATED });
      expect(stateGate.check(checkoutTxn, "CANCEL").result).toBe("PASS");

      const confirmedTxn = createMockCapturedTransaction({ state: TransactionState.ORDER_CONFIRMED });
      expect(stateGate.check(confirmedTxn, "CANCEL").result).toBe("PASS");
    });

    it("should allow REQUEST_REFUND only in ORDER_CONFIRMED state", () => {
      const confirmedTxn = createMockCapturedTransaction({ state: TransactionState.ORDER_CONFIRMED });
      expect(stateGate.check(confirmedTxn, "REQUEST_REFUND").result).toBe("PASS");

      const createdTxn = createMockCapturedTransaction({ state: TransactionState.CREATED });
      expect(stateGate.check(createdTxn, "REQUEST_REFUND").result).toBe("FAIL");
    });
  });

  describe("cancel_transaction MCP Tool", () => {
    it("should perform pure state cancellation for pre-payment transaction", async () => {
      const instance = createMerchantMcpServer(testManifest, undefined, true);
      const { txnManager, server } = instance;

      const txn = txnManager.create({
        product_id: "PROD-001",
        quantity: 1,
        selection_reason: "Pre-payment cancel test",
      });

      const cancelHandler = (
        server as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: unknown) => Promise<{ content: [{ text: string }] }> }
          >;
        }
      )._registeredTools["cancel_transaction"].handler;

      const res = await cancelHandler({
        transaction_id: txn.transaction_id,
        reason: "Customer changed mind before paying",
      });

      const data = JSON.parse(res.content[0].text);
      expect(data.state).toBe(TransactionState.CANCELLED);
      expect(data.refunded_amount).toBe(0);
      expect(data.message).toContain("cancelled before payment authorization");

      const updated = txnManager.get(txn.transaction_id);
      expect(updated.state).toBe(TransactionState.CANCELLED);
    });

    it("should initiate refund and call merchant cancelOrder for confirmed captured order", async () => {
      const instance = createMerchantMcpServer(testManifest, undefined, true);
      const { txnManager, server, connector } = instance;

      const cancelOrderSpy = vi
        .spyOn(connector, "cancelOrder")
        .mockResolvedValue({ order_id: "ORD-999", status: "CANCELLED" });

      const txn = txnManager.create({
        product_id: "PROD-001",
        quantity: 1,
        selection_reason: "Post-confirmation cancel test",
      });

      txnManager.bindCheckout(txn.transaction_id, {
        checkout_id: "chk_999",
        sku: "PROD-001",
        title: "Headphones",
        unit_price: { amount: 100000, currency: "INR" },
        total: { amount: 100000, currency: "INR" },
        available: true,
      });
      txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "test");
      txnManager.bindPayment(txn.transaction_id, {
        provider: "razorpay",
        razorpay_payment_id: "pay_sim_123",
        payment_status: "captured",
      });
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_PENDING, "test");
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_AUTHORIZED, "test");
      txnManager.bindOrder(txn.transaction_id, {
        order_id: "ORD-999",
        status: "CONFIRMED",
      });
      txnManager.transition(txn.transaction_id, TransactionState.ORDER_CONFIRMED, "test");

      const cancelHandler = (
        server as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: unknown) => Promise<{ content: [{ text: string }] }> }
          >;
        }
      )._registeredTools["cancel_transaction"].handler;

      const res = await cancelHandler({
        transaction_id: txn.transaction_id,
        reason: "Customer requested post-order return",
      });

      const data = JSON.parse(res.content[0].text);
      expect(data.state).toBe(TransactionState.REFUNDED);
      expect(data.refunded_amount).toBe(100000);
      expect(data.refunds.length).toBe(1);
      expect(cancelOrderSpy).toHaveBeenCalledWith("ORD-999", "Customer requested post-order return");
    });
  });

  describe("request_refund MCP Tool", () => {
    it("should successfully execute full refund on captured order", async () => {
      const instance = createMerchantMcpServer(testManifest, undefined, true);
      const { txnManager, server } = instance;

      const txn = txnManager.create({
        product_id: "PROD-001",
        quantity: 1,
        selection_reason: "Refund tool test",
      });

      txnManager.bindCheckout(txn.transaction_id, {
        checkout_id: "chk_777",
        sku: "PROD-001",
        title: "Gadget",
        unit_price: { amount: 500000, currency: "INR" },
        total: { amount: 500000, currency: "INR" },
        available: true,
      });
      txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "test");
      txnManager.bindPayment(txn.transaction_id, {
        provider: "razorpay",
        razorpay_payment_id: "pay_sim_777",
        payment_status: "captured",
      });
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_PENDING, "test");
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_AUTHORIZED, "test");
      txnManager.bindOrder(txn.transaction_id, {
        order_id: "ORD-777",
        status: "CONFIRMED",
      });
      txnManager.transition(txn.transaction_id, TransactionState.ORDER_CONFIRMED, "test");

      const refundHandler = (
        server as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: unknown) => Promise<{ content: [{ text: string }] }> }
          >;
        }
      )._registeredTools["request_refund"].handler;

      const res = await refundHandler({
        transaction_id: txn.transaction_id,
        reason: "Defective item return",
      });

      const data = JSON.parse(res.content[0].text);
      expect(data.state).toBe(TransactionState.REFUNDED);
      expect(data.refunded_amount).toBe(500000);
      expect(data.refund.status).toBe("processed");
    });
  });

  describe("Webhook Refund Reconciliation", () => {
    it("should process refund.processed webhook and transition REFUND_PENDING to REFUNDED", () => {
      const txn = txnManager.create({
        product_id: "PROD-001",
        quantity: 1,
        selection_reason: "Webhook test",
      });

      txnManager.bindCheckout(txn.transaction_id, {
        checkout_id: "chk_888",
        sku: "PROD-001",
        unit_price: { amount: 200000, currency: "INR" },
        total: { amount: 200000, currency: "INR" },
        available: true,
      });
      txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "test");
      txnManager.bindPayment(txn.transaction_id, {
        provider: "razorpay",
        razorpay_payment_id: "pay_wh_888",
        payment_status: "captured",
      });
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_PENDING, "test");
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_AUTHORIZED, "test");
      txnManager.transition(txn.transaction_id, TransactionState.ORDER_CONFIRMED, "test");
      txnManager.transition(txn.transaction_id, TransactionState.REFUND_PENDING, "refund_requested");

      const webhookPayload = {
        event: "refund.processed",
        payload: {
          refund: {
            entity: {
              id: "rfnd_wh_12345",
              amount: 200000,
              currency: "INR",
              notes: {
                transaction_id: txn.transaction_id,
              },
            },
          },
        },
      };

      const result = processWebhookEvent(webhookPayload, txnManager, auditLedger);
      expect(result.status).toBe("processed");
      expect(result.transaction_id).toBe(txn.transaction_id);

      const updated = txnManager.get(txn.transaction_id);
      expect(updated.state).toBe(TransactionState.REFUNDED);
      expect(updated.payment?.refunded_amount).toBe(200000);
      expect(updated.payment?.refunds?.[0].refund_id).toBe("rfnd_wh_12345");
    });

    it("should process refund.failed webhook and revert REFUND_PENDING to ORDER_CONFIRMED", () => {
      const txn = txnManager.create({
        product_id: "PROD-001",
        quantity: 1,
        selection_reason: "Failed webhook test",
      });

      txnManager.bindCheckout(txn.transaction_id, {
        checkout_id: "chk_889",
        sku: "PROD-001",
        unit_price: { amount: 200000, currency: "INR" },
        total: { amount: 200000, currency: "INR" },
        available: true,
      });
      txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "test");
      txnManager.bindPayment(txn.transaction_id, {
        provider: "razorpay",
        razorpay_payment_id: "pay_wh_889",
        payment_status: "captured",
      });
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_PENDING, "test");
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_AUTHORIZED, "test");
      txnManager.transition(txn.transaction_id, TransactionState.ORDER_CONFIRMED, "test");
      txnManager.transition(txn.transaction_id, TransactionState.REFUND_PENDING, "refund_requested");

      const webhookPayload = {
        event: "refund.failed",
        payload: {
          refund: {
            entity: {
              id: "rfnd_wh_fail_999",
              amount: 200000,
              currency: "INR",
              notes: {
                transaction_id: txn.transaction_id,
              },
            },
          },
        },
      };

      const result = processWebhookEvent(webhookPayload, txnManager, auditLedger);
      expect(result.status).toBe("processed");

      const updated = txnManager.get(txn.transaction_id);
      expect(updated.state).toBe(TransactionState.ORDER_CONFIRMED);
      expect(updated.payment?.refunds?.[0].status).toBe("failed");
    });

    it("should be idempotent and not double-count refunded_amount on webhook retry", () => {
      const txn = txnManager.create({
        product_id: "PROD-001",
        quantity: 1,
        selection_reason: "Idempotency webhook test",
      });

      txnManager.bindCheckout(txn.transaction_id, {
        checkout_id: "chk_890",
        sku: "PROD-001",
        unit_price: { amount: 200000, currency: "INR" },
        total: { amount: 200000, currency: "INR" },
        available: true,
      });
      txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "test");
      txnManager.bindPayment(txn.transaction_id, {
        provider: "razorpay",
        razorpay_payment_id: "pay_wh_890",
        payment_status: "captured",
      });
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_PENDING, "test");
      txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_AUTHORIZED, "test");
      txnManager.transition(txn.transaction_id, TransactionState.ORDER_CONFIRMED, "test");
      txnManager.transition(txn.transaction_id, TransactionState.REFUND_PENDING, "refund_requested");

      const webhookPayload = {
        event: "refund.processed",
        payload: {
          refund: {
            entity: {
              id: "rfnd_wh_dedupe_111",
              amount: 200000,
              currency: "INR",
              notes: {
                transaction_id: txn.transaction_id,
              },
            },
          },
        },
      };

      // First webhook delivery
      processWebhookEvent(webhookPayload, txnManager, auditLedger);
      expect(txnManager.get(txn.transaction_id).payment?.refunded_amount).toBe(200000);

      // Duplicate retry delivery
      processWebhookEvent(webhookPayload, txnManager, auditLedger);
      expect(txnManager.get(txn.transaction_id).payment?.refunded_amount).toBe(200000);
      expect(txnManager.get(txn.transaction_id).payment?.refunds?.length).toBe(1);
    });
  });

  describe("Decision Receipt with Refunds Section", () => {
    it("should render refund section and net settled amount when refunds are present", () => {
      const txn = createMockCapturedTransaction({
        state: TransactionState.REFUNDED,
        payment: {
          provider: "razorpay",
          razorpay_payment_id: "pay_receipt_123",
          payment_status: "captured",
          refunded_amount: 1500000,
          refunds: [
            {
              refund_id: "rfnd_rec_001",
              amount: { amount: 1500000, currency: "INR" },
              status: "processed",
              reason: "Customer return",
              created_at: new Date().toISOString(),
            },
          ],
        },
      });

      const receipt = generateDecisionReceipt(txn, [], true);
      expect(receipt).toContain("REFUND ORCHESTRATION (Razorpay Rails)");
      expect(receipt).toContain("Total Refunded   : ₹15,000.00");
      expect(receipt).toContain("Net Settled      : ₹0.00");
      expect(receipt).toContain("rfnd_rec_001");
      expect(receipt).toContain("Status         : REFUNDED");
    });
  });
});
