import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { registerTransactionTools } from "../../src/tools/transaction.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { RazorpayAdapter } from "../../src/payment/razorpay.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { RecurringTokenStore } from "../../src/payment/token-store.js";
import { MandateStore } from "../../src/authz/mandate-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { AuditEventType, TransactionState } from "../../src/types/index.js";

function createMockServer() {
  const tools = new Map<string, { description: string; schema: any; handler: Function }>();
  const server = {
    tool: (name: string, description: string, schema: any, handler: Function) => {
      tools.set(name, { description, schema, handler });
    },
  } as unknown as McpServer;

  return { server, tools };
}

describe("Phase 4: Autonomous Payment Path (Path 2)", () => {
  let connector: ConnectorRuntime;
  let txnManager: TransactionManager;
  let policyEngine: PolicyEngine;
  let paymentAdapter: RazorpayAdapter;
  let auditLedger: AuditLedger;
  let tokenStore: RecurringTokenStore;
  let mandateStore: MandateStore;
  let persistenceStore: InMemoryStore;
  let tools: Map<string, { description: string; schema: any; handler: Function }>;

  const manifest: IntegrationManifest = {
    merchant: {
      name: "TechBazaar",
      description: "Electronics Store",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "https://api.techbazaar.local",
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

  beforeEach(() => {
    persistenceStore = new InMemoryStore();
    connector = new ConnectorRuntime(manifest);
    auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger);
    mandateStore = new MandateStore(persistenceStore, "test_signing_secret_12345", "mandate");
    policyEngine = new PolicyEngine(undefined, undefined, undefined, persistenceStore, mandateStore);
    paymentAdapter = new RazorpayAdapter("mock_key", "mock_secret", true);
    tokenStore = new RecurringTokenStore();

    // Mock connector
    vi.spyOn(connector, "getProduct").mockResolvedValue({
      offer_id: "AIRPODS-PRO",
      title: "Apple AirPods Pro",
      description: "Wireless earbuds with active noise cancellation",
      price: { amount: 2490000, currency: "INR" },
      availability: "in_stock",
      attributes: {},
    });

    vi.spyOn(connector, "createCheckout").mockResolvedValue({
      checkout_id: "chk_airpods_001",
      sku: "AIRPODS-PRO",
      unit_price: { amount: 2490000, currency: "INR" },
      total: { amount: 2490000, currency: "INR" },
      available: true,
    });

    vi.spyOn(connector, "confirmOrder").mockResolvedValue({
      order_id: "ORD-AIRPODS-777",
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
    });

    // Seed token store with recurring token
    tokenStore.save({
      customer_id: "cust_auto_999",
      token_id: "token_rec_valid_123",
      method: "upi",
      max_amount: 5000000,
      email: "agent_buyer@example.com",
      contact: "+919876543210",
      created_at: new Date().toISOString(),
    });

    const mockServer = createMockServer();
    tools = mockServer.tools;

    registerTransactionTools(
      mockServer.server,
      connector,
      txnManager,
      policyEngine,
      paymentAdapter,
      auditLedger,
      mandateStore,
      undefined,
      tokenStore
    );
  });

  it("should execute autonomous checkout with recurring token and valid intent mandate (Path 2)", async () => {
    // 1. Create pre-authorized Intent Mandate (₹30,000 budget > ₹24,900 price)
    const { authorization_reference } = await mandateStore.createIntentMandate({
      user_ref: "agent_buyer_user_1",
      constraints: {
        max_amount: 3000000,
        currency: "INR",
        authorized_domains: ["retail"],
        authorized_merchants: ["TechBazaar"],
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      },
    });

    const prepareTool = tools.get("prepare_purchase");
    expect(prepareTool).toBeDefined();

    // 2. Call prepare_purchase with token + customer + mandate
    const res = await prepareTool!.handler({
      product_id: "AIRPODS-PRO",
      quantity: 1,
      selection_reason: "Best ANC earbuds under budget",
      recurring_token: "token_rec_valid_123",
      customer_id: "cust_auto_999",
      authorization_reference,
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);

    // 3. Verify instant ORDER_CONFIRMED without payment link
    expect(payload.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(payload.payment.status).toBe("payment_completed");
    expect(payload.payment.payment_method).toBe("recurring_token");
    expect(payload.payment.payment_id).toMatch(/^pay_rec_sim_/);
    expect(payload.order.order_id).toBe("ORD-AIRPODS-777");
    expect(payload.order.status).toBe("confirmed");

    // 4. Verify audit ledger contains RECURRING_PAYMENT_CHARGED event
    const auditEvents = auditLedger.getTransactionAudit(payload.transaction_id);
    const chargeEvent = auditEvents.find((e) => e.event_type === AuditEventType.RECURRING_PAYMENT_CHARGED);
    expect(chargeEvent).toBeDefined();
    expect((chargeEvent?.response as any)?.customer_id).toBe("cust_auto_999");
    expect((chargeEvent?.response as any)?.amount).toBe(2490000);

    // 5. Verify token last_used_at was updated
    const token = tokenStore.get("cust_auto_999");
    expect(token?.last_used_at).toBeDefined();
  });

  it("should deny autonomous checkout when checkout total exceeds mandate ceiling", async () => {
    // 1. Create Intent Mandate with ceiling ₹20,000 (< ₹24,900 price)
    const { authorization_reference } = await mandateStore.createIntentMandate({
      user_ref: "agent_buyer_user_1",
      constraints: {
        max_amount: 2000000,
        currency: "INR",
        authorized_domains: ["retail"],
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      },
    });

    const prepareTool = tools.get("prepare_purchase");

    const res = await prepareTool!.handler({
      product_id: "AIRPODS-PRO",
      quantity: 1,
      selection_reason: "Attempt over budget purchase",
      recurring_token: "token_rec_valid_123",
      customer_id: "cust_auto_999",
      authorization_reference,
    });

    // Should return error due to mandate denial
    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.error).toContain("Mandate authorization denied");
  });

  it("should fall back gracefully to payment link if recurring charge fails", async () => {
    // 1. Create valid mandate
    const { authorization_reference } = await mandateStore.createIntentMandate({
      user_ref: "agent_buyer_user_1",
      constraints: {
        max_amount: 5000000,
        currency: "INR",
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      },
    });

    // 2. Mock chargeRecurringToken to throw a simulated failure (e.g. expired token on bank side)
    vi.spyOn(paymentAdapter, "chargeRecurringToken").mockRejectedValueOnce(
      new Error("Bank mandate expired or revoked by customer")
    );

    const prepareTool = tools.get("prepare_purchase");

    const res = await prepareTool!.handler({
      product_id: "AIRPODS-PRO",
      quantity: 1,
      selection_reason: "Fallback test",
      recurring_token: "token_rec_valid_123",
      customer_id: "cust_auto_999",
      authorization_reference,
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);

    // 3. State should fall back to PAYMENT_PENDING with payment link
    expect(payload.state).toBe(TransactionState.PAYMENT_PENDING);
    expect(payload.payment.status).toBe("user_action_required");
    expect(payload.payment.payment_url).toContain("https://rzp.io/i/sim_");

    // 4. Audit ledger should record RECURRING_PAYMENT_FAILED
    const auditEvents = auditLedger.getTransactionAudit(payload.transaction_id);
    const failEvent = auditEvents.find((e) => e.event_type === AuditEventType.RECURRING_PAYMENT_FAILED);
    expect(failEvent).toBeDefined();
    expect((failEvent?.response as any)?.error).toContain("Bank mandate expired");
  });

  it("should provide both one-time payment link and autopay mandate link on initial purchase without stored token", async () => {
    const prepareTool = tools.get("prepare_purchase");

    const res = await prepareTool!.handler({
      product_id: "AIRPODS-PRO",
      quantity: 1,
      selection_reason: "First time purchase without saved token",
      customer_email: "alice@example.com",
      customer_contact: "9876543210",
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);

    expect(payload.state).toBe(TransactionState.PAYMENT_PENDING);
    expect(payload.payment.status).toBe("user_action_required");
    expect(payload.payment.one_time_payment_url).toBeDefined();
    expect(payload.payment.autopay_mandate_url).toBeDefined();
    expect(payload.payment.methods.one_time).toBeDefined();
    expect(payload.payment.methods.autopay_mandate).toBeDefined();
    expect(payload.payment.instructions_for_agent).toContain("Do NOT attempt to visit, open, or automate these payment links yourself");
    expect(payload.payment.message).toContain("Present BOTH payment options clearly to the user");
  });

  it("should advertise only autonomous consent path when customer has saved recurring token", async () => {
    // 1. Save recurring token for customer in tokenStore
    tokenStore.save({
      customer_id: "cust_bob_777",
      token_id: "token_bob_stored_456",
      method: "upi",
      email: "bob@example.com",
      created_at: new Date().toISOString(),
    });

    const prepareTool = tools.get("prepare_purchase");

    // 2. Bob makes purchase with active customer context
    const res = await prepareTool!.handler({
      product_id: "AIRPODS-PRO",
      quantity: 1,
      selection_reason: "Repeat purchase by Bob",
      customer_email: "bob@example.com",
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);

    // 3. Must require AP2 interactive consent and advertise ONLY the autonomous path
    expect(payload.state).toBe(TransactionState.MANDATE_EVALUATED);
    expect(payload.payment.status).toBe("consent_required");
    expect(payload.payment.consent_url).toBeDefined();
    expect(payload.payment.one_time_payment_url).toBeUndefined();
    expect(payload.payment.autopay_mandate_url).toBeUndefined();
    expect(payload.payment.instructions_for_agent).toContain("Do NOT attempt to visit, open, or automate this consent_url yourself");
    expect(payload.payment.message).toContain("A saved recurring payment token exists for this customer");
  });

  it("should advertise ONLY autonomous consent path even when agent passes NO customer_id or customer_email on second purchase", async () => {
    // 1. Save recurring token for customer in tokenStore
    tokenStore.save({
      customer_id: "cust_active_user_999",
      token_id: "token_user_999",
      method: "card",
      email: "buyer@proshop.local",
      created_at: new Date().toISOString(),
    });

    const prepareTool = tools.get("prepare_purchase");

    // 2. Agent calls prepare_purchase without ANY customer info (exactly like in agentflow3.md)
    const res = await prepareTool!.handler({
      product_id: "AIRPODS-PRO",
      quantity: 1,
      selection_reason: "User asked to buy AirPods after previously purchasing an iPhone",
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);

    // 3. Must automatically detect the stored token and advertise ONLY the autonomous path
    expect(payload.state).toBe(TransactionState.MANDATE_EVALUATED);
    expect(payload.payment.status).toBe("consent_required");
    expect(payload.payment.consent_url).toBeDefined();
    expect(payload.payment.one_time_payment_url).toBeUndefined();
    expect(payload.payment.autopay_mandate_url).toBeUndefined();
    expect(payload.payment.instructions_for_agent).toContain("Do NOT attempt to visit, open, or automate this consent_url yourself");
    expect(payload.payment.message).toContain("A saved recurring payment token exists for this customer");
  });

  it("should charge recurring token autonomously when JIT mandate is authorized via consent approval and status is polled", async () => {
    // 1. Setup recurring token in tokenStore
    tokenStore.save({
      customer_id: "cust_jit_user_777",
      token_id: "token_jit_777",
      method: "card",
      email: "jituser@proshop.local",
      created_at: new Date().toISOString(),
    });

    const prepareTool = tools.get("prepare_purchase");
    const statusTool = tools.get("get_transaction_status");

    // 2. Prepare purchase returns consent_required
    const prepRes = await prepareTool!.handler({
      product_id: "AIRPODS-PRO",
      quantity: 1,
      selection_reason: "JIT consent autonomous test",
      customer_id: "cust_jit_user_777",
    });

    const prepPayload = JSON.parse(prepRes.content[0].text);
    expect(prepPayload.state).toBe(TransactionState.MANDATE_EVALUATED);
    expect(prepPayload.payment.status).toBe("consent_required");
    const challengeId = prepPayload.payment.challenge_id;
    const txnId = prepPayload.transaction_id;

    // 3. User approves mandate on the hosted consent screen
    const confirmResult = await mandateStore.confirmConsentChallenge(challengeId, "ProShop Electronics");
    expect(confirmResult.status).toBe("authorized");

    // Bind authorization reference to transaction (as /consent/:challengeId/confirm does)
    const txn = txnManager.get(txnId);
    txn.authorization_reference = (confirmResult as any).authorization_reference;

    // 4. Agent polls get_transaction_status
    const statusRes = await statusTool!.handler({
      transaction_id: txnId,
    });

    const statusPayload = JSON.parse(statusRes.content[0].text);

    // 5. Must transition directly to ORDER_CONFIRMED with recurring payment captured
    expect(statusPayload.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(statusPayload.payment.payment_method).toBe("recurring_token");
    expect(statusPayload.payment.status).toBe("captured");
    expect(statusPayload.payment.payment_link_url).toBeUndefined();
    expect(statusPayload.order).toBeDefined();
  });
});
