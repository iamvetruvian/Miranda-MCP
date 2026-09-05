import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { registerTransactionTools } from "../../src/tools/transaction.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { StripeAdapter } from "../../src/payment/stripe.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { RecurringTokenStore } from "../../src/payment/token-store.js";
import { SessionStore } from "../../src/auth/session-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { startAuthCallbackServer, AuthCallbackServerResult } from "../../src/auth/callback-server.js";
import { TransactionState } from "../../src/types/index.js";

function createMockServer() {
  const tools = new Map<string, { description: string; schema: any; handler: Function }>();
  const server = {
    tool: (name: string, description: string, schema: any, handler: Function) => {
      tools.set(name, { description, schema, handler });
    },
  } as unknown as McpServer;

  return { server, tools };
}

describe("Stripe Checkout & Card Vault Callback Gateway", () => {
  let connector: ConnectorRuntime;
  let txnManager: TransactionManager;
  let policyEngine: PolicyEngine;
  let paymentAdapter: StripeAdapter;
  let auditLedger: AuditLedger;
  let tokenStore: RecurringTokenStore;
  let sessionStore: SessionStore;
  let tools: Map<string, { description: string; schema: any; handler: Function }>;
  let serverInstance: AuthCallbackServerResult;
  const TEST_PORT = 4129;

  const manifest: IntegrationManifest = {
    merchant: {
      name: "StripeVaultStore",
      description: "Autonomous Electronics Store",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "https://api.stripevault.local",
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
      provider: "stripe",
      stripe_secret_key_env: "STRIPE_SECRET_KEY",
    },
  };

  beforeEach(async () => {
    connector = new ConnectorRuntime(manifest);
    auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger);
    policyEngine = new PolicyEngine([]);
    paymentAdapter = new StripeAdapter("sk_test_mock", "pk_test_mock", true);
    paymentAdapter.setCallbackPort(TEST_PORT);
    tokenStore = new RecurringTokenStore();
    sessionStore = new SessionStore(new InMemoryStore());

    const mock = createMockServer();
    tools = mock.tools;

    vi.spyOn(connector, "getProduct").mockResolvedValue({
      offer_id: "PROD-IPHONE",
      title: "iPhone 13 Pro",
      description: "Smartphone 256GB",
      price: { amount: 6899900, currency: "INR" },
      availability: "in_stock",
      attributes: {},
    });

    vi.spyOn(connector, "createCheckout").mockResolvedValue({
      checkout_id: "chk_test_999",
      sku: "PROD-IPHONE",
      unit_price: { amount: 6899900, currency: "INR" },
      total: { amount: 6899900, currency: "INR" },
      expires_at: new Date(Date.now() + 1800000).toISOString(),
    });

    vi.spyOn(connector, "confirmOrder").mockResolvedValue({
      order_id: "ORD-CONFIRMED-999",
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
    });

    registerTransactionTools(
      mock.server,
      connector,
      txnManager,
      policyEngine,
      paymentAdapter,
      auditLedger,
      undefined,
      undefined,
      tokenStore
    );

    serverInstance = startAuthCallbackServer(null as any, manifest, TEST_PORT, {
      txnManager,
      connector,
      auditLedger,
      paymentAdapter,
      recurringTokenStore: tokenStore,
      sessionStore,
    });
  });

  afterEach(async () => {
    await serverInstance.close();
  });

  it("should return card_vault_setup_url pointing to Stripe setup session in prepare_purchase", async () => {
    const prepareTool = tools.get("prepare_purchase")!;
    const res = await prepareTool.handler({
      product_id: "PROD-IPHONE",
      quantity: 1,
      customer_email: "buyer@example.com",
      customer_name: "Autonomous Buyer",
      selection_reason: "Best phone",
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);

    expect(payload.payment.card_vault_setup_url).toBeDefined();
    expect(payload.payment.card_vault_setup_url).toContain(`http://localhost:${TEST_PORT}/stripe-setup?session_id=`);
    expect(payload.payment.one_time_payment_url).toContain(`http://localhost:${TEST_PORT}/stripe-checkout?session_id=`);
    expect(payload.payment.methods.card_vault).toBeDefined();
    expect(payload.payment.methods.one_time).toBeDefined();
  });

  it("should handle /checkout/callback successfully and transition transaction to ORDER_CONFIRMED", async () => {
    const prepareTool = tools.get("prepare_purchase")!;
    const res = await prepareTool.handler({
      product_id: "PROD-IPHONE",
      quantity: 1,
      customer_email: "buyer@example.com",
      selection_reason: "Best phone",
    });
    const payload = JSON.parse(res.content[0].text);
    const txnId = payload.transaction_id;

    // Simulate user completing checkout and Stripe redirecting to /checkout/callback
    const callbackRes = await fetch(
      `http://localhost:${TEST_PORT}/checkout/callback?session_id=cs_sim_test_123&ref=${txnId}`
    );
    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toContain("Payment Successful!");
    expect(html).toContain("ORD-CONFIRMED-999");

    const txn = txnManager.get(txnId);
    expect(txn.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(txn.merchant_order?.order_id).toBe("ORD-CONFIRMED-999");
  });

  it("should handle /setup/callback, vault card into RecurringTokenStore, execute S2S payment and confirm order", async () => {
    const prepareTool = tools.get("prepare_purchase")!;
    const res = await prepareTool.handler({
      product_id: "PROD-IPHONE",
      quantity: 1,
      customer_email: "vault_buyer@example.com",
      selection_reason: "Best phone",
    });
    const payload = JSON.parse(res.content[0].text);
    const txnId = payload.transaction_id;

    // Simulate user setting up card in Stripe Setup and redirecting to /setup/callback
    const callbackRes = await fetch(
      `http://localhost:${TEST_PORT}/setup/callback?session_id=cs_setup_sim_456&txn_id=${txnId}&customer_id=cus_vault_buyer`
    );
    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toContain("Card Securely Vaulted!");
    expect(html).toContain("ORD-CONFIRMED-999");

    // Token was vaulted
    expect(tokenStore.has("cus_vault_buyer")).toBe(true);
    const vaulted = tokenStore.get("cus_vault_buyer")!;
    expect(vaulted.token_id).toMatch(/^pm_sim_/);

    // Transaction was completed via S2S
    const txn = txnManager.get(txnId);
    expect(txn.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(txn.payment?.payment_method).toBe("recurring_token");
    expect(txn.payment?.stripe_payment_intent_id).toMatch(/^pi_off_sim_/);
  });

  it("should render clean cancellation pages on /checkout/cancel and /setup/cancel", async () => {
    const cancelCheckout = await fetch(`http://localhost:${TEST_PORT}/checkout/cancel?ref=txn_123`);
    expect(cancelCheckout.status).toBe(200);
    const html1 = await cancelCheckout.text();
    expect(html1).toContain("Payment Cancelled");

    const cancelSetup = await fetch(`http://localhost:${TEST_PORT}/setup/cancel?txn_id=txn_123`);
    expect(cancelSetup.status).toBe(200);
    const html2 = await cancelSetup.text();
    expect(html2).toContain("Card Setup Cancelled");
  });

  it("should handle /pay and /setup resilient gateway endpoints properly", async () => {
    const payRes = await fetch(`http://127.0.0.1:${TEST_PORT}/pay?session_id=cs_sim_test&amount=5000`);
    expect(payRes.status).toBe(200);
    expect(payRes.url).toContain("/stripe-checkout?session_id=cs_sim_test");

    const setupRes = await fetch(`http://127.0.0.1:${TEST_PORT}/setup?session_id=cs_setup_sim_test`);
    expect(setupRes.status).toBe(200);
    expect(setupRes.url).toContain("/stripe-setup?session_id=cs_setup_sim_test");

    (paymentAdapter as any).sessionUrls.set("cs_real_123", "https://checkout.stripe.com/c/pay/cs_real_123#fidnandh_test_hash");
    (paymentAdapter as any).isSimulated = false;

    const realPayRes = await fetch(`http://127.0.0.1:${TEST_PORT}/pay?session_id=cs_real_123`);
    expect(realPayRes.status).toBe(200);
    const payHtml = await realPayRes.text();
    expect(payHtml).toContain("Redirecting to Stripe Checkout");
    expect(payHtml).toContain("https://checkout.stripe.com/c/pay/cs_real_123#fidnandh_test_hash");
    expect(payHtml).toContain("window.location.replace");

    const realSetupRes = await fetch(`http://127.0.0.1:${TEST_PORT}/setup?session_id=cs_real_123`);
    expect(realSetupRes.status).toBe(200);
    const setupHtml = await realSetupRes.text();
    expect(setupHtml).toContain("Redirecting to Stripe PCI Vault");
    expect(setupHtml).toContain("https://checkout.stripe.com/c/pay/cs_real_123#fidnandh_test_hash");
    expect(setupHtml).toContain("window.location.replace");

    (paymentAdapter as any).isSimulated = true;
  });
});
