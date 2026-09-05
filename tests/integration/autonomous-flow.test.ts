import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMerchantMcpServer, ServerInstance } from "../../src/server.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { AuditEventType, TransactionState } from "../../src/types/index.js";

const manifest: IntegrationManifest = {
  manifest_version: "2.0.0",
  merchant: {
    name: "MegaMart Electronics",
    id: "megamart",
    domain: "retail",
    base_url: "https://api.megamart.local",
    currency: "INR",
  },
  operations: {
    search: {
      method: "GET",
      path: "/products",
      params: { query: { in: "query", name: "q", required: true, type: "string" } },
    },
    get_product: {
      method: "GET",
      path: "/products/:product_id",
      params: { product_id: { in: "path", required: true, type: "string" } },
    },
    create_checkout: {
      method: "POST",
      path: "/checkout",
      params: {},
    },
    confirm_order: {
      method: "POST",
      path: "/orders",
      params: {},
    },
    get_order_status: {
      method: "GET",
      path: "/orders/:order_id",
      params: { order_id: { in: "path", required: true, type: "string" } },
    },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.id" },
      title: { from: "$.title" },
      description: { from: "$.desc" },
      price: { amount: { from: "$.price" }, currency: "INR" },
      availability: { from: "$.stock", transform: { type: "enum", enum_map: { true: "in_stock", false: "out_of_stock" } } },
    },
    checkout: {
      checkout_id: { from: "$.chk_id" },
      sku: { from: "$.sku" },
      total: { amount: { from: "$.total_amount" }, currency: "INR" },
      available: { from: "$.in_stock" },
    },
    order: {
      order_id: { from: "$.ord_id" },
      status: { from: "$.status" },
    },
  },
  payment: {
    provider: "stripe",
    stripe_secret_key_env: "STRIPE_SECRET_KEY",
  },
};

describe("End-to-End Autonomous Agent Payments via Razorpay Recurring Tokens", () => {
  let serverInstance: ServerInstance;
  let store: InMemoryStore;
  let capturedToken: string | undefined;
  let customerId: string | undefined;

  beforeEach(() => {
    store = new InMemoryStore();
    serverInstance = createMerchantMcpServer(manifest, {
      store,
      forceSimulation: true,
      mandateSigningSecret: "integration_test_secret_key_123",
      authMode: "mandate",
    });

    const { connector } = serverInstance;

    // Mock connector endpoints
    vi.spyOn(connector, "search").mockResolvedValue({
      items: [
        {
          offer_id: "SMART-WATCH-01",
          title: "Apex Smart Watch",
          description: "Fitness tracker with heart rate sensor",
          price: { amount: 499900, currency: "INR" },
          availability: "in_stock",
          attributes: {},
        },
        {
          offer_id: "EARBUDS-02",
          title: "Sonic Wireless Earbuds",
          description: "Active noise cancelling earbuds",
          price: { amount: 299900, currency: "INR" },
          availability: "in_stock",
          attributes: {},
        },
        {
          offer_id: "FLAGSHIP-PHONE-03",
          title: "Titan Pro Smartphone",
          description: "Flagship phone 256GB",
          price: { amount: 7999900, currency: "INR" },
          availability: "in_stock",
          attributes: {},
        },
      ],
      query: "electronics",
      page: 1,
      page_size: 10,
    });

    vi.spyOn(connector, "getProduct").mockImplementation(async (id: string) => {
      const prices: Record<string, number> = {
        "SMART-WATCH-01": 499900,
        "EARBUDS-02": 299900,
        "FLAGSHIP-PHONE-03": 7999900,
      };
      return {
        offer_id: id,
        title: id,
        description: `Product details for ${id}`,
        price: { amount: prices[id] || 100000, currency: "INR" },
        availability: "in_stock",
        attributes: {},
      };
    });

    vi.spyOn(connector, "createCheckout").mockImplementation(async (id: string, qty: number) => {
      const prices: Record<string, number> = {
        "SMART-WATCH-01": 499900,
        "EARBUDS-02": 299900,
        "FLAGSHIP-PHONE-03": 7999900,
      };
      const unit = prices[id] || 100000;
      const total = unit * (qty || 1);
      return {
        checkout_id: `chk_${id}_${Date.now()}`,
        sku: id,
        unit_price: { amount: unit, currency: "INR" },
        total: { amount: total, currency: "INR" },
        available: true,
      };
    });

    vi.spyOn(connector, "confirmOrder").mockImplementation(async (checkoutId: string) => {
      return {
        order_id: `ORD_${checkoutId.slice(0, 15)}`,
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FLOW 1: First Purchase (Manual Payment Link -> Token Captured)
  // ════════════════════════════════════════════════════════════════════════════
  it("Flow 1: Should execute manual first purchase and automatically capture recurring token on completion", async () => {
    const { server, paymentAdapter, txnManager, auditLedger, recurringTokenStore } = serverInstance;

    // Access registered tools through internal server handlers
    const registeredTools = (server as any)._registeredTools;
    const prepareTool = registeredTools["prepare_purchase"];
    const statusTool = registeredTools["get_transaction_status"];

    expect(prepareTool).toBeDefined();
    expect(statusTool).toBeDefined();

    // 1. First purchase initiation with customer contact details
    const prepareRes = await prepareTool.handler({
      product_id: "SMART-WATCH-01",
      quantity: 1,
      selection_reason: "User requested best rated smartwatch",
      customer_email: "buyer_first@example.com",
      customer_contact: "+919876543210",
    });

    const preparePayload = JSON.parse(prepareRes.content[0].text);
    expect(preparePayload.state).toBe(TransactionState.PAYMENT_PENDING);
    expect(preparePayload.payment.status).toBe("user_action_required");
    expect(preparePayload.payment.payment_url).toBeDefined();
    expect(preparePayload.payment.one_time_payment_url).toBeDefined();
    expect(preparePayload.payment.autopay_mandate_url).toBeDefined();
    expect(preparePayload.payment.methods.one_time).toBeDefined();
    expect(preparePayload.payment.methods.autopay_mandate).toBeDefined();
    expect(preparePayload.payment.message).toContain("Present BOTH payment options clearly to the user");

    const txnId = preparePayload.transaction_id;
    const txn = txnManager.get(txnId);
    expect(txn.customer_id).toBeDefined();
    customerId = txn.customer_id;

    // 2. User completes payment via payment link on Razorpay
    paymentAdapter.simulatePaymentSuccess(
      "pay_manual_first_999",
      { amount: 499900, currency: "INR" },
      txn.payment?.stripe_checkout_session_id || txn.payment?.stripe_payment_intent_id
    );

    // 3. Agent polls transaction status
    const statusRes = await statusTool.handler({ transaction_id: txnId });
    const statusPayload = JSON.parse(statusRes.content[0].text);

    expect(statusPayload.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(statusPayload.order.order_id).toBeDefined();
    expect(statusPayload.autonomous_payment_available).toBe(true);
    expect(statusPayload.recurring_token).toBeDefined();
    expect(statusPayload.customer_id).toBe(customerId);
    expect(statusPayload.message).toContain("Token registered");

    capturedToken = statusPayload.recurring_token;

    // 4. Verify token was persisted in RecurringTokenStore
    expect(recurringTokenStore.has(customerId!)).toBe(true);
    const tokenRecord = recurringTokenStore.get(customerId!);
    expect(tokenRecord?.token_id).toBe(capturedToken);

    // 5. Verify RECURRING_TOKEN_CAPTURED in audit ledger
    const auditEvents = auditLedger.getTransactionAudit(txnId);
    const tokenEvent = auditEvents.find((e) => e.event_type === AuditEventType.RECURRING_TOKEN_CAPTURED);
    expect(tokenEvent).toBeDefined();
    expect((tokenEvent?.response as any)?.customer_id).toBe(customerId);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FLOW 2: Subsequent Purchase (Path 2: Instant Autonomous Checkout via Token)
  // ════════════════════════════════════════════════════════════════════════════
  it("Flow 2: Should execute instant autonomous purchase using captured token + AP2 Intent Mandate (zero human interaction)", async () => {
    const { server, mandateStore, auditLedger, recurringTokenStore } = serverInstance;
    const registeredTools = (server as any)._registeredTools;
    const prepareTool = registeredTools["prepare_purchase"];

    // Ensure we have a token from Flow 1
    const testCustomerId = customerId || "cust_sim_test_buyer";
    const testTokenId = capturedToken || "token_sim_test_buyer";
    recurringTokenStore.save({
      customer_id: testCustomerId,
      token_id: testTokenId,
      method: "upi",
      max_amount: 5000000,
      email: "buyer_first@example.com",
      contact: "+919876543210",
      created_at: new Date().toISOString(),
    });

    // 1. User issues an AP2 Intent Mandate (₹10,000 budget for earbuds)
    const { authorization_reference } = await mandateStore.createIntentMandate({
      user_ref: "buyer_first@example.com",
      constraints: {
        max_amount: 1000000, // ₹10,000
        currency: "INR",
        authorized_domains: ["retail"],
        authorized_merchants: ["MegaMart Electronics"],
        expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
    });

    // 2. Buyer agent purchases earbuds autonomously
    const res = await prepareTool.handler({
      product_id: "EARBUDS-02",
      quantity: 1,
      selection_reason: "Best ANC earbuds under ₹10,000 mandate",
      recurring_token: testTokenId,
      customer_id: testCustomerId,
      authorization_reference,
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);

    // 3. Instant ORDER_CONFIRMED without payment link
    expect(payload.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(payload.payment.status).toBe("payment_completed");
    expect(payload.payment.payment_method).toBe("recurring_token");
    expect(payload.payment.payment_id).toMatch(/^(pi_off|pay_rec)_sim_/);
    expect(payload.payment.message).toContain("Payment completed autonomously");
    expect(payload.order.order_id).toBeDefined();
    expect(payload.order.status).toBe("confirmed");

    // 4. Audit ledger records RECURRING_PAYMENT_CHARGED event
    const auditEvents = auditLedger.getTransactionAudit(payload.transaction_id);
    const chargeEvent = auditEvents.find((e) => e.event_type === AuditEventType.RECURRING_PAYMENT_CHARGED);
    expect(chargeEvent).toBeDefined();
    expect((chargeEvent?.response as any)?.customer_id).toBe(testCustomerId);
    expect((chargeEvent?.response as any)?.amount).toBe(299900);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FLOW 3: Mandate Bounds Check (Policy Denial when budget exceeded)
  // ════════════════════════════════════════════════════════════════════════════
  it("Flow 3: Should block autonomous checkout when purchase amount exceeds Intent Mandate limit", async () => {
    const { server, mandateStore, recurringTokenStore } = serverInstance;
    const registeredTools = (server as any)._registeredTools;
    const prepareTool = registeredTools["prepare_purchase"];

    const testCustomerId = "cust_sim_budget_test";
    const testTokenId = "token_sim_budget_test";
    recurringTokenStore.save({
      customer_id: testCustomerId,
      token_id: testTokenId,
      method: "upi",
      max_amount: 5000000,
      email: "budget_test@example.com",
      created_at: new Date().toISOString(),
    });

    // Mandate only allows up to ₹50,000
    const { authorization_reference } = await mandateStore.createIntentMandate({
      user_ref: "budget_test@example.com",
      constraints: {
        max_amount: 5000000, // ₹50,000
        currency: "INR",
        expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
    });

    // Attempt to buy phone costing ₹79,999
    const res = await prepareTool.handler({
      product_id: "FLAGSHIP-PHONE-03",
      quantity: 1,
      selection_reason: "Attempt expensive purchase",
      recurring_token: testTokenId,
      customer_id: testCustomerId,
      authorization_reference,
    });

    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.error).toContain("Mandate authorization denied");
  });
});
