import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { MandateStore } from "../../src/authz/mandate-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { startHostedMerchantMcpServer, SseServerResult } from "../../src/server-sse.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { AuditEventType, TransactionState } from "../../src/types/index.js";

const PORT = 3198;

describe("Phase 5: Consent Rejection & Manual Fallback (Path 3)", () => {
  const manifest: IntegrationManifest = {
    merchant: {
      name: "SuperStore",
      description: "Omnichannel Superstore",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "https://api.superstore.local",
    },
    operations: {
      search: { method: "GET", path: "/products" },
      get_product: { method: "GET", path: "/products/:product_id" },
      create_checkout: { method: "POST", path: "/checkout" },
      confirm_order: { method: "POST", path: "/orders" },
      get_order_status: { method: "GET", path: "/orders/:order_id" },
    },
    field_mappings: {
      offer: { offer_id: { from: "$.id" }, title: { from: "$.name" }, "price.amount": { from: "$.price" } },
      checkout: { checkout_id: { from: "$.id" }, "total.amount": { from: "$.total" } },
      order: { order_id: { from: "$.id" }, status: { from: "$.status" } },
    },
    payment: {
      provider: "razorpay",
      razorpay_key_id_env: "RAZORPAY_KEY_ID",
      razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
    },
  };

  describe("MandateStore rejectConsentChallenge Unit Tests", () => {
    let store: InMemoryStore;
    let mandateStore: MandateStore;

    beforeEach(() => {
      store = new InMemoryStore();
      mandateStore = new MandateStore(store, "test_secret_123", "mandate");
    });

    it("should create, reject, and clean up a consent challenge", async () => {
      const mockTxn = {
        transaction_id: "txn_test_reject_1",
        state: TransactionState.CHECKOUT_CREATED,
        created_at: new Date().toISOString(),
        agent_claim: { product_id: "ITEM-1", quantity: 1, selection_reason: "test" },
        audit_event_ids: [],
      };

      const mockCheckout = {
        checkout_id: "chk_999",
        sku: "ITEM-1",
        unit_price: { amount: 50000, currency: "INR" },
        total: { amount: 50000, currency: "INR" },
        available: true,
      };

      const challenge = mandateStore.createConsentChallenge(mockTxn as any, mockCheckout, "SuperStore");
      expect(challenge.challenge_id).toMatch(/^chn_/);
      expect(mandateStore.getConsentChallenge(challenge.challenge_id)).toBeDefined();

      // Reject challenge
      const result = await mandateStore.rejectConsentChallenge(challenge.challenge_id);
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.transaction_id).toBe("txn_test_reject_1");
      }

      // Re-rejecting should return denied/not found
      const secondResult = await mandateStore.rejectConsentChallenge(challenge.challenge_id);
      expect(secondResult.status).toBe("denied");
    });
  });

  describe("Hosted Server /consent Endpoints (HTTP)", () => {
    let sseServer: SseServerResult | undefined;

    beforeAll(async () => {
      const store = new InMemoryStore();
      sseServer = startHostedMerchantMcpServer(manifest, {
        port: PORT,
        store,
        mandateSigningSecret: "test_secret_123",
        authMode: "mandate",
        forceSimulation: true,
        disableWebhookServer: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    afterAll(async () => {
      if (sseServer?.close) {
        await sseServer.close();
      }
    });

    it("should render interactive HTML consent screen on GET /consent/:challengeId with Accept: text/html", async () => {
      const { mandateStore } = sseServer!;

      const mockTxn = {
        transaction_id: "txn_ui_test",
        state: TransactionState.CHECKOUT_CREATED,
        created_at: new Date().toISOString(),
        agent_claim: { product_id: "ITEM-UI", quantity: 1, selection_reason: "UI test" },
        audit_event_ids: [],
      };

      const mockCheckout = {
        checkout_id: "chk_ui_123",
        sku: "ITEM-UI",
        unit_price: { amount: 99900, currency: "INR" },
        total: { amount: 99900, currency: "INR" },
        available: true,
      };

      const challenge = mandateStore.createConsentChallenge(mockTxn as any, mockCheckout, "SuperStore");

      const res = await fetch(`http://localhost:${PORT}/consent/${challenge.challenge_id}`, {
        headers: { Accept: "text/html" },
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Authorize Payment Mandate");
      expect(text).toContain("Approve Autonomous Mandate");
      expect(text).toContain("Reject Mandate & Pay Manually");
      expect(text).toContain("₹999.00");
    });

    it("should handle POST /consent/:challengeId/reject, emit CONSENT_REJECTED audit event, and fallback to manual payment link", async () => {
      const { mandateStore, txnManager, auditLedger } = sseServer!;

      // 1. Create transaction in MANDATE_EVALUATED state
      const txn = txnManager.create({
        product_id: "ITEM-REJECT",
        quantity: 1,
        selection_reason: "Testing reject fallback",
      });
      const txnId = txn.transaction_id;

      const checkout = {
        checkout_id: "chk_reject_456",
        sku: "ITEM-REJECT",
        title: "Mechanical Keyboard",
        unit_price: { amount: 450000, currency: "INR" },
        total: { amount: 450000, currency: "INR" },
        available: true,
      };

      txnManager.bindCheckout(txnId, checkout);
      txnManager.transition(txnId, TransactionState.CHECKOUT_CREATED, "checkout_created");

      const challenge = mandateStore.createConsentChallenge(txnManager.get(txnId), checkout, "SuperStore");
      txnManager.transition(txnId, TransactionState.MANDATE_EVALUATED, "consent_challenge_issued");

      // 2. Post rejection to /consent/:challengeId/reject
      const res = await fetch(`http://localhost:${PORT}/consent/${challenge.challenge_id}/reject`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("fallback_to_payment_link");
      expect(body.transaction_id).toBe(txnId);
      expect(body.payment_url).toBeDefined();
      expect(body.payment_url.length).toBeGreaterThan(10);

      // 3. Verify transaction state transitioned to PAYMENT_PENDING
      const updatedTxn = txnManager.get(txnId);
      expect(updatedTxn.state).toBe(TransactionState.PAYMENT_PENDING);
      expect(updatedTxn.payment?.payment_method).toBe("payment_link");
      expect(updatedTxn.payment?.payment_link_url).toBe(body.payment_url);
      expect(updatedTxn.payment?.payment_status).toBe("pending");

      // 4. Verify audit ledger has CONSENT_REJECTED event
      const events = auditLedger.getTransactionAudit(txnId);
      const rejectEvent = events.find((e: any) => e.event_type === AuditEventType.CONSENT_REJECTED);
      expect(rejectEvent).toBeDefined();
      expect((rejectEvent?.response as any)?.challenge_id).toBe(challenge.challenge_id);
    });
  });
});
