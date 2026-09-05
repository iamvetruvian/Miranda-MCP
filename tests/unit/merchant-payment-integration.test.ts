import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { registerTransactionTools } from "../../src/tools/transaction.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { StripeAdapter } from "../../src/payment/stripe.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { RecurringTokenStore } from "../../src/payment/token-store.js";
import { MandateStore } from "../../src/authz/mandate-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { SessionStore } from "../../src/auth/session-store.js";
import { OAuth2Handler } from "../../src/auth/oauth2-handler.js";
import { AuthGuard } from "../../src/auth/auth-guard.js";
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

describe("Merchant Payment Architecture & Manifest Integration", () => {
  let connector: ConnectorRuntime;
  let txnManager: TransactionManager;
  let policyEngine: PolicyEngine;
  let paymentAdapter: StripeAdapter;
  let auditLedger: AuditLedger;
  let tokenStore: RecurringTokenStore;
  let mandateStore: MandateStore;
  let sessionStore: SessionStore;
  let persistenceStore: InMemoryStore;
  let tools: Map<string, { description: string; schema: any; handler: Function }>;

  const manifest: IntegrationManifest = {
    merchant: {
      name: "ProShop",
      description: "Electronics Store",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "https://api.proshop.local",
    },
    auth: {
      type: "oauth2_authorization_code",
      oauth2_user: {
        authorization_url: "https://api.proshop.local/oauth/authorize",
        token_url: "https://api.proshop.local/oauth/token",
        userinfo_url: "https://api.proshop.local/oauth/userinfo",
        client_id: "test_client",
        client_secret: "test_secret",
        redirect_uri: "http://localhost:3002/auth/callback",
        shipping_address_path: "$.shippingAddress",
        shipping_addresses_path: "$.addresses",
      },
      protected_operations: ["create_checkout", "confirm_order"],
      public_operations: ["search", "get_product"],
    },
    operations: {
      search: { method: "GET", path: "/products" },
      get_product: { method: "GET", path: "/products/:product_id" },
      create_checkout: { method: "POST", path: "/checkout" },
      confirm_order: { method: "POST", path: "/orders" },
      get_order_status: { method: "GET", path: "/orders/:order_id" },
      custom: {
        create_payment_link: {
          method: "POST",
          path: "/orders/:checkout_id/pay-link",
          description: "Merchant hosted payment link",
        },
        charge_token: {
          method: "POST",
          path: "/orders/:checkout_id/charge",
          description: "Merchant S2S token charge",
        },
      },
    },
    field_mappings: {
      offer: {
        offer_id: { from: "$.id" },
        title: { from: "$.name" },
        price: {
          amount: { from: "$.price_paise" },
          currency: { from: "$.curr" },
        },
        availability: { from: "$.status" },
      },
      checkout: {
        checkout_id: { from: "$.id" },
        total: {
          amount: { from: "$.total_paise" },
          currency: { from: "$.curr" },
        },
        available: { from: "$.in_stock" },
        payment_url: { from: "$.payment_url" },
      },
      order: {
        order_id: { from: "$.id" },
        status: { from: "$.state" },
      },
    },
  };

  beforeEach(() => {
    persistenceStore = new InMemoryStore();
    persistenceStore = new InMemoryStore();
    sessionStore = new SessionStore(persistenceStore);
    connector = new ConnectorRuntime(manifest);
    auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger);
    mandateStore = new MandateStore(persistenceStore, "test_signing_secret_12345", "mandate");
    policyEngine = new PolicyEngine(undefined, undefined, undefined, persistenceStore, mandateStore);
    paymentAdapter = new StripeAdapter("sk_test_merchant", "pk_test_merchant", true);
    tokenStore = new RecurringTokenStore();
    const oauthHandler = new OAuth2Handler(manifest.auth!.oauth2_user!, sessionStore);
    const authGuard = new AuthGuard(manifest, oauthHandler, sessionStore);

    const mock = createMockServer();
    tools = mock.tools;

    registerTransactionTools(
      mock.server,
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

  describe("1. Merchant-Generated Payment Link Forwarding", () => {
    it("should forward merchant-generated payment URL directly to user for manual checkout", async () => {
      // Mock connector to return checkout with merchant's hosted payment URL
      vi.spyOn(connector, "getProduct").mockResolvedValue({
        offer_id: "PHONE-1",
        title: "Pro Smartphone",
        description: "Smartphone",
        price: { amount: 5000000, currency: "INR" },
        availability: "in_stock",
        attributes: {},
      });

      const merchantHostedUrl = "https://checkout.stripe.com/c/pay/cs_live_merchant_link_12345";

      vi.spyOn(connector, "createCheckout").mockResolvedValue({
        checkout_id: "chk_merchant_999",
        sku: "PHONE-1",
        title: "Pro Smartphone",
        unit_price: { amount: 5000000, currency: "INR" },
        total: { amount: 5000000, currency: "INR" },
        available: true,
        payment_url: merchantHostedUrl,
        raw_merchant_data: {},
      });

      sessionStore.createPendingSession("sess_buyer_1");
      sessionStore.completeSession(
        "sess_buyer_1",
        { access_token: "merchant_token_buyer" },
        {
          user_id: "usr_buyer_1",
          user_name: "Buyer User",
          user_email: "buyer@example.com",
        }
      );

      const prepareTool = tools.get("prepare_purchase")!;
      const res = await prepareTool.handler({
        product_id: "PHONE-1",
        quantity: 1,
        selection_reason: "User wants to buy with merchant payment link",
        customer_email: "buyer@example.com",
      });

      expect(res.isError).toBeFalsy();
      const payload = JSON.parse(res.content[0].text);

      expect(payload.state).toBe(TransactionState.PAYMENT_PENDING);
      expect(payload.payment.status).toBe("user_action_required");
      // Must forward the merchant's exact hosted link directly to the customer!
      expect(payload.payment.payment_url).toBe(merchantHostedUrl);
    });
  });

  describe("2. S2S Autonomous Payment on Merchant Checkout", () => {
    it("should execute S2S charge against merchant backend when recurring token exists", async () => {
      vi.spyOn(connector, "getProduct").mockResolvedValue({
        offer_id: "HEADPHONES-1",
        title: "Wireless Headphones",
        description: "Noise cancelling headphones",
        price: { amount: 1500000, currency: "INR" },
        availability: "in_stock",
        attributes: {},
      });

      vi.spyOn(connector, "createCheckout").mockResolvedValue({
        checkout_id: "chk_headphones_456",
        sku: "HEADPHONES-1",
        title: "Wireless Headphones",
        unit_price: { amount: 1500000, currency: "INR" },
        total: { amount: 1500000, currency: "INR" },
        available: true,
        payment_url: "https://api.proshop.local/pay/chk_headphones_456",
        raw_merchant_data: {},
      });

      const chargeTokenSpy = vi.spyOn(connector, "chargeToken").mockResolvedValue({
        order_id: "ord_merchant_success_789",
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      });

      // Save token in RecurringTokenStore bound to user_id
      tokenStore.save({
        customer_id: "cus_merchant_cust_1",
        user_id: "usr_buyer_alice",
        token_id: "pm_card_vault_token_4242",
        method: "card",
        email: "alice@example.com",
        created_at: new Date().toISOString(),
      });

      // Active authenticated session
      sessionStore.createPendingSession("sess_alice_123");
      sessionStore.completeSession(
        "sess_alice_123",
        { access_token: "merchant_oauth_token_abc" },
        {
          user_id: "usr_buyer_alice",
          user_name: "Alice User",
          user_email: "alice@example.com",
          customer_id: "cus_merchant_cust_1",
        }
      );

      // Create AP2 mandate for autonomous debit
      const { authorization_reference } = await mandateStore.createIntentMandate({
        user_ref: "usr_buyer_alice",
        constraints: {
          max_amount: 5000000,
          currency: "INR",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      });

      const prepareTool = tools.get("prepare_purchase")!;
      const res = await prepareTool.handler({
        product_id: "HEADPHONES-1",
        quantity: 1,
        selection_reason: "Autonomous reorder",
        authorization_reference,
      });

      expect(res.isError).toBeFalsy();
      const payload = JSON.parse(res.content[0].text);

      expect(payload.state).toBe(TransactionState.ORDER_CONFIRMED);
      expect(payload.payment.status).toBe("payment_completed");
      expect(payload.order.order_id).toBe("ord_merchant_success_789");

      // Verify connector.chargeToken was called with merchant checkout_id and card token
      expect(chargeTokenSpy).toHaveBeenCalledWith(
        "chk_headphones_456",
        "pm_card_vault_token_4242",
        { amount: 1500000, currency: "INR" },
        "merchant_oauth_token_abc"
      );
    });
  });

  describe("3. OAuth Shipping Address Extraction & Forwarding", () => {
    it("should extract shipping address from OAuth userinfo and forward to merchant createCheckout", async () => {
      const oauthHandler = new OAuth2Handler(manifest.auth!.oauth2_user!, sessionStore);

      const userInfoData = {
        sub: "usr_bob_777",
        name: "Bob Builder",
        email: "bob@example.com",
        shippingAddress: {
          line1: "42 Galaxy Way",
          city: "Bengaluru",
          postal_code: "560001",
          country: "IN",
        },
      };

      const extracted = (oauthHandler as any).extractUserInfo(userInfoData);
      expect(extracted.shipping_address).toBeDefined();
      expect(extracted.shipping_address.line1).toBe("42 Galaxy Way");
      expect(extracted.shipping_address.city).toBe("Bengaluru");

      // Save into active session
      sessionStore.createPendingSession("sess_bob_1");
      sessionStore.completeSession(
        "sess_bob_1",
        { access_token: "bob_token" },
        extracted
      );

      const active = sessionStore.getActiveSession();
      expect(active?.shipping_address?.line1).toBe("42 Galaxy Way");

      // Now run prepare_purchase and ensure shipping address is passed to createCheckout
      vi.spyOn(connector, "getProduct").mockResolvedValue({
        offer_id: "TABLET-1",
        title: "Pro Tablet",
        description: "Tablet",
        price: { amount: 3000000, currency: "INR" },
        availability: "in_stock",
        attributes: {},
      });

      const createCheckoutSpy = vi.spyOn(connector, "createCheckout").mockResolvedValue({
        checkout_id: "chk_bob_tab",
        sku: "TABLET-1",
        title: "Pro Tablet",
        unit_price: { amount: 3000000, currency: "INR" },
        total: { amount: 3000000, currency: "INR" },
        available: true,
        payment_url: "https://proshop.local/checkout/chk_bob_tab",
        raw_merchant_data: {},
      });

      const prepareTool = tools.get("prepare_purchase")!;
      await prepareTool.handler({
        product_id: "TABLET-1",
        quantity: 1,
        selection_reason: "Purchase tablet",
      });

      expect(createCheckoutSpy).toHaveBeenCalled();
      const customerDataArg = createCheckoutSpy.mock.calls[0][3] as Record<string, unknown>;
      expect(customerDataArg).toBeDefined();
      expect(customerDataArg.city).toBe("Bengaluru");
      expect(customerDataArg.postalCode).toBe("560001");
      expect(customerDataArg.address).toBe("42 Galaxy Way");
    });
  });

  describe("4. Card Token Binding & Lookup by user_id", () => {
    it("should store token with user_id and allow lookup via getByUserId", () => {
      tokenStore.save({
        customer_id: "cus_vault_123",
        user_id: "usr_carol_456",
        token_id: "pm_tok_carol_card",
        method: "card",
        email: "carol@example.com",
        created_at: new Date().toISOString(),
      });

      const resolved = tokenStore.getByUserId("usr_carol_456");
      expect(resolved).toBeDefined();
      expect(resolved?.token_id).toBe("pm_tok_carol_card");
      expect(resolved?.customer_id).toBe("cus_vault_123");
    });
  });
});
