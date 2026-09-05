import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTransactionTools } from "../../src/tools/transaction.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { StripeAdapter } from "../../src/payment/stripe.js";
import { RecurringTokenStore } from "../../src/payment/token-store.js";
import { MandateStore } from "../../src/authz/mandate-store.js";
import { SessionStore } from "../../src/auth/session-store.js";
import { AuthGuard } from "../../src/auth/auth-guard.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { TransactionState } from "../../src/types/index.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { AuditLedger } from "../../src/audit/ledger.js";

describe("Shipping Address Resolution in Autonomous & Polled Purchases", () => {
  let server: McpServer;
  let txnManager: TransactionManager;
  let store: InMemoryStore;
  let connector: ConnectorRuntime;
  let paymentAdapter: StripeAdapter;
  let tokenStore: RecurringTokenStore;
  let mandateStore: MandateStore;
  let sessionStore: SessionStore;
  let authGuard: AuthGuard;
  let tools: Map<string, any>;

  const sampleShippingAddress = {
    line1: "123 Elm Street, Apt 4B",
    city: "Metropolis",
    postal_code: "10001",
    country: "US",
  };

  const manifest: IntegrationManifest = {
    merchant: {
      id: "proshop_shipping_test",
      name: "ProShop Electronics",
      description: "Demo electronics store",
      homepage: "http://localhost:5000",
      domains: ["retail"],
      protocol_version: "2.0.0",
      signing: { key_id: "key_1", algorithm: "HMAC-SHA256" },
    },
    catalog: {
      endpoints: {
        search: { path: "/api/products", method: "GET" },
        product: { path: "/api/products/{id}", method: "GET" },
      },
      mapping: {
        item_id: "$._id",
        title: "$.name",
        price: "$.price",
        currency: "USD",
        availability: "$.countInStock",
      },
    },
    transaction: {
      endpoints: {
        create_order: { path: "/api/orders", method: "POST" },
        get_order: { path: "/api/orders/{id}", method: "GET" },
      },
    },
    payment: {
      provider: "stripe",
      stripe_secret_key_env: "STRIPE_SECRET_KEY",
      allowed_methods: { methods: ["card"] },
    } as any,
    auth: {
      oauth2_user: {
        authorization_url: "http://localhost:5000/oauth/authorize",
        token_url: "http://localhost:5000/oauth/token",
        client_id_env: "CLIENT_ID",
        client_secret_env: "CLIENT_SECRET",
        scope: "read write",
        redirect_uri: "http://localhost:3002/auth/callback",
        session_ttl_seconds: 86400,
        protected_operations: [],
      },
    },
  };

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" });
    tools = new Map();
    (server as any).tool = (name: string, desc: string, schema: any, handler: any) => {
      tools.set(name, { name, desc, schema, handler });
    };

    store = new InMemoryStore();
    const auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger, store);
    connector = new ConnectorRuntime(manifest);
    (connector as any).getManifest = () => manifest;

    connector.getProduct = async (id: string) => ({
      offer_id: id,
      title: "Wireless Headphones",
      price: { amount: 15000, currency: "USD" },
      availability: "in_stock" as const,
      attributes: { brand: "Sony" },
    });

    connector.createCheckout = async (sku: string, _qty: number) => {
      const price = { amount: 15000, currency: "USD" };
      return {
        checkout_id: `chk_${Date.now()}`,
        sku,
        unit_price: price,
        total: price,
        available: true,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };
    };

    connector.confirmOrder = async (checkoutId: string) => ({
      order_id: `ORD_${checkoutId}`,
      status: "confirmed" as const,
      confirmed_at: new Date().toISOString(),
    });

    connector.chargeToken = async (checkoutId: string) => ({
      order_id: `ORD_AUTONOMOUS_${checkoutId}`,
      status: "confirmed" as const,
      confirmed_at: new Date().toISOString(),
    });

    mandateStore = new MandateStore(store, "secret_key_123", "mandate");
    const policyEngine = new PolicyEngine(undefined, undefined, undefined, store, mandateStore);
    paymentAdapter = new StripeAdapter("mock_key", undefined, true);
    tokenStore = new RecurringTokenStore();
    sessionStore = new SessionStore(store, 86400);
    authGuard = new AuthGuard(manifest, null, sessionStore);

    registerTransactionTools(
      server,
      connector,
      txnManager,
      policyEngine,
      paymentAdapter,
      auditLedger,
      mandateStore,
      authGuard,
      tokenStore
    );
  });

  it("should return shipping_address in prepare_purchase response during instant autonomous checkout", async () => {
    // 1. Establish session with verified shipping address
    sessionStore.completeSession(
      "sess_buyer_123",
      { access_token: "tok_access_buyer" },
      {
        user_id: "usr_buyer_99",
        user_name: "John Doe",
        user_email: "john@example.com",
        customer_id: "cust_stripe_123",
        shipping_address: sampleShippingAddress,
      }
    );

    // 2. Save recurring token
    tokenStore.save({
      customer_id: "cust_stripe_123",
      token_id: "tok_rec_card_123",
      method: "card",
      email: "john@example.com",
      created_at: new Date().toISOString(),
    });

    // 3. Create Intent Mandate authorizing purchases up to $500
    const { authorization_reference } = await mandateStore.createIntentMandate({
      user_ref: "john@example.com",
      constraints: {
        max_amount: 50000,
        currency: "USD",
        authorized_domains: ["retail"],
        authorized_merchants: ["ProShop Electronics"],
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
    });

    // 4. Autonomous purchase via prepare_purchase
    const prepareTool = tools.get("prepare_purchase");
    const res = await prepareTool.handler({
      product_id: "SONY-WH1000XM5",
      quantity: 1,
      selection_reason: "Autonomous purchase within user mandate",
      recurring_token: "tok_rec_card_123",
      customer_id: "cust_stripe_123",
      authorization_reference,
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);

    expect(payload.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(payload.order).toBeDefined();
    expect(payload.order.order_id).toBeDefined();
    expect(payload.order.status).toBe("confirmed");

    // Verify shipping address is returned in order and root payload
    expect(payload.order.shipping_address).toEqual(sampleShippingAddress);
    expect(payload.shipping_address).toEqual(sampleShippingAddress);
  });

  it("should return shipping_address in get_transaction_status response once payment is confirmed", async () => {
    // 1. Establish session with shipping address
    sessionStore.completeSession(
      "sess_buyer_manual",
      { access_token: "tok_manual_buyer" },
      {
        user_id: "usr_manual_456",
        user_name: "Jane Smith",
        user_email: "jane@example.com",
        customer_id: "cust_stripe_manual",
        shipping_address: sampleShippingAddress,
      }
    );

    // 2. Initiate prepare_purchase (manual payment path)
    const prepareTool = tools.get("prepare_purchase");
    const prepRes = await prepareTool.handler({
      product_id: "SONY-WH1000XM5",
      quantity: 1,
      selection_reason: "Manual purchase test",
    });

    const prepPayload = JSON.parse(prepRes.content[0].text);
    const txnId = prepPayload.transaction_id;
    const txn = txnManager.get(txnId);

    // Verify txn itself recorded the shipping address from session
    expect(txn.shipping_address).toEqual(sampleShippingAddress);

    // 3. Simulate payment completion
    paymentAdapter.simulatePaymentSuccess(
      "pay_sim_999",
      { amount: 15000, currency: "USD" },
      txn.payment?.stripe_checkout_session_id || txn.payment?.stripe_payment_intent_id
    );

    // 4. Agent polls get_transaction_status
    const statusTool = tools.get("get_transaction_status");
    const statusRes = await statusTool.handler({
      transaction_id: txnId,
    });

    const statusPayload = JSON.parse(statusRes.content[0].text);
    expect(statusPayload.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(statusPayload.order).toBeDefined();
    expect(statusPayload.order.shipping_address).toEqual(sampleShippingAddress);
    expect(statusPayload.shipping_address).toEqual(sampleShippingAddress);
  });

  it("should support explicit customer_data shippingAddress override in prepare_purchase", async () => {
    sessionStore.completeSession(
      "sess_office_delivery",
      { access_token: "tok_office" },
      {
        user_id: "usr_office_123",
        user_name: "Bruce Wayne",
        user_email: "bruce@example.com",
        customer_id: "cust_stripe_office",
        shipping_address: sampleShippingAddress,
      }
    );

    const customAddress = {
      line1: "789 Work Blvd, Suite 100",
      city: "Gotham",
      postal_code: "90210",
      country: "US",
    };

    const prepareTool = tools.get("prepare_purchase");
    const prepRes = await prepareTool.handler({
      product_id: "SONY-WH1000XM5",
      quantity: 1,
      selection_reason: "Office delivery test",
      customer_data: {
        shippingAddress: customAddress,
      },
    });

    const prepPayload = JSON.parse(prepRes.content[0].text);
    const txnId = prepPayload.transaction_id;
    const txn = txnManager.get(txnId);

    expect(txn.shipping_address).toEqual(customAddress);

    // Simulate completion
    paymentAdapter.simulatePaymentSuccess(
      "pay_sim_office",
      { amount: 15000, currency: "USD" },
      txn.payment?.stripe_checkout_session_id || txn.payment?.stripe_payment_intent_id
    );

    const statusTool = tools.get("get_transaction_status");
    const statusRes = await statusTool.handler({ transaction_id: txnId });
    const statusPayload = JSON.parse(statusRes.content[0].text);

    expect(statusPayload.order.shipping_address).toEqual(customAddress);
    expect(statusPayload.shipping_address).toEqual(customAddress);
  });
});
