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

describe("Authoritative Session-Based Customer Identity & Autonomous AP2 Flow", () => {
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

  const manifest: IntegrationManifest = {
    merchant: {
      id: "proshop_session_test",
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
        currency: "INR",
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
      title: id === "IPHONE-13" ? "iPhone 13 Pro 256GB" : "AirPods Wireless Bluetooth",
      price: { amount: id === "IPHONE-13" ? 68999 : 11349, currency: "INR" },
      availability: "in_stock" as const,
      attributes: { brand: "Apple" },
    });

    connector.createCheckout = async (sku: string, _qty: number) => {
      const price = { amount: sku === "IPHONE-13" ? 68999 : 11349, currency: "INR" };
      return {
        checkout_id: `chk_${Date.now()}`,
        sku,
        unit_price: price,
        total: price,
        available: true,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };
    };

    connector.confirmOrder = async (checkoutId: string, paymentId: string) => ({
      order_id: checkoutId,
      status: "confirmed" as const,
      payment_id: paymentId,
      confirmed_at: new Date().toISOString(),
    });

    const policyEngine = new PolicyEngine(undefined, undefined, undefined, store, mandateStore);
    paymentAdapter = new StripeAdapter("mock_key", undefined, true);
    tokenStore = new RecurringTokenStore();
    mandateStore = new MandateStore(store, "secret", "mandate");
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

  it("should automatically resolve customer credentials from active session without agent passing email or customer_id", async () => {
    // 1. User logs in / signs up: active session is established on the MCP server
    const session = sessionStore.completeSession(
      "sess_alice_active",
      { access_token: "tok_access_alice_123" },
      {
        user_id: "alice_99",
        user_name: "Alice Johnson",
        user_email: "alice@example.com",
        user_contact: "+919876543210",
      }
    );

    expect(session.user_email).toBe("alice@example.com");
    expect(sessionStore.getActiveSession()?.session_id).toBe("sess_alice_active");

    const prepareTool = tools.get("prepare_purchase");

    // 2. Agent prepares purchase WITHOUT customer_email, customer_contact, or customer_id
    const res1 = await prepareTool.handler({
      product_id: "IPHONE-13",
      quantity: 1,
      selection_reason: "User asked to buy iPhone 13 Pro",
    });

    expect(res1.isError).toBeFalsy();
    const payload1 = JSON.parse(res1.content[0].text);

    // Transaction state must be PAYMENT_PENDING with dual payment links
    expect(payload1.state).toBe(TransactionState.PAYMENT_PENDING);
    expect(payload1.payment.status).toBe("user_action_required");
    expect(payload1.payment.one_time_payment_url).toBeDefined();
    expect(payload1.payment.autopay_mandate_url).toBeDefined();

    // Verify transaction resolved customer details from session
    const txn1 = txnManager.get(payload1.transaction_id);
    expect(txn1.customer_id).toBeDefined();
    expect(txn1.payment?.customer_email).toBe("alice@example.com");
    expect(txn1.payment?.customer_contact).toBe("+919876543210");

    // 3. Complete payment with autopay mandate authorized
    const statusTool = tools.get("get_transaction_status");

    // Simulate payment capture on the mandate order
    txnManager.bindPayment(payload1.transaction_id, {
      provider: "stripe",
      ...txn1.payment,
      stripe_payment_intent_id: "pay_alice_mandate_456",
      payment_status: "captured",
    });
    txnManager.transition(payload1.transaction_id, TransactionState.PAYMENT_AUTHORIZED, "test_authorized");
    txnManager.transition(payload1.transaction_id, TransactionState.ORDER_CONFIRMED, "test_confirmed");

    // Status check polls and captures token
    const statusRes = await statusTool.handler({ transaction_id: payload1.transaction_id });
    const statusPayload = JSON.parse(statusRes.content[0].text);
    expect(statusPayload.state).toBe(TransactionState.ORDER_CONFIRMED);

    // Verify token was stored in RecurringTokenStore under customer and email
    const storedToken = tokenStore.getByEmail("alice@example.com");
    expect(storedToken).toBeDefined();

    // 4. Second purchase: User asks agent "buy me airpods too"
    // Agent invokes prepare_purchase with ZERO customer info or token info
    const res2 = await prepareTool.handler({
      product_id: "AIRPODS-PRO",
      quantity: 1,
      selection_reason: "User asked to buy AirPods after buying iPhone",
    });

    expect(res2.isError).toBeFalsy();
    const payload2 = JSON.parse(res2.content[0].text);

    // The MCP must automatically find the stored token for this session and present ONLY the AP2 consent challenge!
    expect(payload2.state).toBe(TransactionState.MANDATE_EVALUATED);
    expect(payload2.payment.status).toBe("consent_required");
    expect(payload2.payment.consent_url).toBeDefined();
    expect(payload2.payment.one_time_payment_url).toBeUndefined();
    expect(payload2.payment.autopay_mandate_url).toBeUndefined();
    expect(payload2.payment.instructions_for_agent).toContain("Do NOT attempt to visit, open, or automate this consent_url yourself");
  });
});
