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

describe("Phase 3: Token Capture During First Payment", () => {
  let connector: ConnectorRuntime;
  let txnManager: TransactionManager;
  let policyEngine: PolicyEngine;
  let paymentAdapter: RazorpayAdapter;
  let auditLedger: AuditLedger;
  let tokenStore: RecurringTokenStore;
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
    connector = new ConnectorRuntime(manifest);
    auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger);
    policyEngine = new PolicyEngine();
    paymentAdapter = new RazorpayAdapter("mock_key", "mock_secret", true);
    tokenStore = new RecurringTokenStore();

    // Mock product lookup and checkout creation
    vi.spyOn(connector, "getProduct").mockResolvedValue({
      offer_id: "TECH-101",
      title: "Noise Cancelling Headphones",
      description: "Over-ear bluetooth headphones",
      price: { amount: 1500000, currency: "INR" },
      availability: "in_stock",
      attributes: {},
    });

    vi.spyOn(connector, "createCheckout").mockResolvedValue({
      checkout_id: "chk_headphone_001",
      sku: "TECH-101",
      unit_price: { amount: 1500000, currency: "INR" },
      total: { amount: 1500000, currency: "INR" },
      available: true,
    });

    vi.spyOn(connector, "confirmOrder").mockResolvedValue({
      order_id: "ORD-HEADPHONE-999",
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
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
      undefined,
      undefined,
      tokenStore
    );
  });

  it("should create customer entity and attach to payment when customer details provided in prepare_purchase", async () => {
    const prepareTool = tools.get("prepare_purchase");
    expect(prepareTool).toBeDefined();

    const res = await prepareTool!.handler({
      product_id: "TECH-101",
      quantity: 1,
      selection_reason: "Best sound quality",
      customer_email: "first_buyer@example.com",
      customer_contact: "+919876543210",
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.state).toBe(TransactionState.PAYMENT_PENDING);
    expect(payload.payment.status).toBe("user_action_required");
    expect(payload.payment.payment_url).toContain("https://rzp.io/i/sim_");

    const txn = txnManager.get(payload.transaction_id);
    expect(txn.customer_id).toMatch(/^cust_sim_/);
    expect(txn.payment?.customer_id).toBe(txn.customer_id);
    expect(txn.payment?.customer_email).toBe("first_buyer@example.com");
    expect(txn.payment?.customer_contact).toBe("+919876543210");
  });

  it("should capture recurring token upon payment completion during status polling", async () => {
    const prepareTool = tools.get("prepare_purchase");
    const statusTool = tools.get("get_transaction_status");

    // 1. Initial purchase initiation
    const prepareRes = await prepareTool!.handler({
      product_id: "TECH-101",
      quantity: 1,
      selection_reason: "First-time purchase",
      customer_email: "auto_user@example.com",
      customer_contact: "+919123456789",
    });

    const preparePayload = JSON.parse(prepareRes.content[0].text);
    const txnId = preparePayload.transaction_id;
    const txn = txnManager.get(txnId);
    const customerId = txn.customer_id!;

    // 2. Simulate user completing payment via hosted payment link
    const paymentId = "pay_sim_completed_001";
    paymentAdapter.simulatePaymentSuccess(
      paymentId,
      { amount: 1500000, currency: "INR" },
      txn.payment?.razorpay_order_id
    );

    // 3. Agent polls transaction status
    const statusRes = await statusTool!.handler({ transaction_id: txnId });
    const statusPayload = JSON.parse(statusRes.content[0].text);

    expect(statusPayload.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(statusPayload.order.order_id).toBe("ORD-HEADPHONE-999");
    expect(statusPayload.autonomous_payment_available).toBe(true);
    expect(statusPayload.recurring_token).toMatch(/^token_sim_/);
    expect(statusPayload.customer_id).toBe(customerId);
    expect(statusPayload.message).toContain("Token registered. Future purchases at this merchant can be completed autonomously");

    // 4. Verify token was saved in RecurringTokenStore
    expect(tokenStore.has(customerId)).toBe(true);
    const savedToken = tokenStore.get(customerId);
    expect(savedToken?.token_id).toBe(statusPayload.recurring_token);
    expect(savedToken?.method).toBe("upi");

    // 5. Verify RECURRING_TOKEN_CAPTURED event in audit trail
    const auditEvents = auditLedger.getTransactionAudit(txnId);
    const captureEvent = auditEvents.find((e) => e.event_type === AuditEventType.RECURRING_TOKEN_CAPTURED);
    expect(captureEvent).toBeDefined();
    expect((captureEvent?.response as any)?.customer_id).toBe(customerId);
    // Audit ledger redacts sensitive token fields
    expect((captureEvent?.response as any)?.token_id).toBe("[REDACTED]");

    // 6. Verify polling again does not create duplicate capture events
    const secondStatusRes = await statusTool!.handler({ transaction_id: txnId });
    const secondPayload = JSON.parse(secondStatusRes.content[0].text);
    expect(secondPayload.autonomous_payment_available).toBe(true);

    const reAuditEvents = auditLedger.getTransactionAudit(txnId);
    const captureCount = reAuditEvents.filter((e) => e.event_type === AuditEventType.RECURRING_TOKEN_CAPTURED).length;
    expect(captureCount).toBe(1);
  });
});
