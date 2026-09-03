/**
 * Auth Tools & Tool Layer Integration Unit Tests
 * Tests check_auth_status, request_login, logout, and auth-guarded tool invocations.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuthTools } from "../../src/tools/auth.js";
import { registerTransactionTools } from "../../src/tools/transaction.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { SessionStore } from "../../src/auth/session-store.js";
import { OAuth2Handler } from "../../src/auth/oauth2-handler.js";
import { AuthGuard } from "../../src/auth/auth-guard.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { RazorpayAdapter } from "../../src/payment/razorpay.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

describe("Auth Tools & Tool Layer Integration", () => {
  const sampleManifest: IntegrationManifest = {
    merchant: {
      name: "OAuth2 Shop",
      description: "Demo Store with OAuth2",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "https://api.oauth2shop.com",
    },
    auth: {
      type: "oauth2_authorization_code",
      header: "Authorization",
      token_prefix: "Bearer",
      oauth2_user: {
        authorization_url: "https://api.oauth2shop.com/oauth/authorize",
        token_url: "https://api.oauth2shop.com/oauth/token",
        client_id: "mcp_client_001",
        redirect_uri: "http://localhost:3000/auth/callback",
        scopes: ["read:profile", "write:orders"],
        pkce: true,
        session_ttl_seconds: 86400,
      },
      protected_operations: ["create_checkout", "confirm_order"],
      public_operations: ["search", "get_product"],
    },
    operations: {
      search: {
        method: "GET",
        path: "/api/products",
        response_path: "$.items",
      },
      get_product: {
        method: "GET",
        path: "/api/products/:product_id",
      },
      create_checkout: {
        method: "POST",
        path: "/api/checkout",
        request_mapping: {
          item_sku: { from: "$.product_id" },
          item_qty: { from: "$.quantity" },
        },
      },
      confirm_order: {
        method: "POST",
        path: "/api/orders",
      },
    },
    field_mappings: {
      offer: {
        offer_id: { from: "$.id" },
        title: { from: "$.name" },
        "price.amount": { from: "$.price" },
        "price.currency": { from: null, transform: { type: "default", value: "INR" } },
        availability: { from: null, transform: { type: "default", value: "in_stock" } },
      },
      checkout: {
        checkout_id: { from: "$.cart_token" },
        "total.amount": { from: "$.grand_total" },
        "total.currency": { from: null, transform: { type: "default", value: "INR" } },
        available: { from: null, transform: { type: "default", value: true } },
      },
      order: {
        order_id: { from: "$.order_number" },
        status: { from: "$.status" },
      },
    },
    payment: {
      provider: "razorpay",
      razorpay_key_id_env: "RAZORPAY_KEY_ID",
      razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
    },
  };

  let sessionStore: SessionStore;
  let oauth2Handler: OAuth2Handler;
  let authGuard: AuthGuard;
  let server: McpServer;
  let connector: ConnectorRuntime;
  let txnManager: TransactionManager;
  let policyEngine: PolicyEngine;
  let paymentAdapter: RazorpayAdapter;
  let auditLedger: AuditLedger;

  beforeEach(() => {
    const memoryStore = new InMemoryStore();
    sessionStore = new SessionStore(memoryStore);
    oauth2Handler = new OAuth2Handler(sampleManifest.auth.oauth2_user!, sessionStore);
    authGuard = new AuthGuard(sampleManifest, oauth2Handler, sessionStore);

    server = new McpServer({ name: "test-server", version: "1.0.0" });
    connector = new ConnectorRuntime(sampleManifest);
    auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger, memoryStore);
    policyEngine = new PolicyEngine([], 50000);
    paymentAdapter = new RazorpayAdapter("rzp_test_123", "rzp_secret_456", true);

    registerAuthTools(server, sessionStore, authGuard, sampleManifest, oauth2Handler, auditLedger);
    registerTransactionTools(
      server,
      connector,
      txnManager,
      policyEngine,
      paymentAdapter,
      auditLedger,
      undefined,
      authGuard
    );
    registerDiscoveryTools(server, connector, sampleManifest, auditLedger, authGuard);
  });

  it("check_auth_status should return authorization_url when user is unauthenticated", async () => {
    // Access registered tool via server._tools or invoke tool handler
    const tool = (server as any)._registeredTools["check_auth_status"];
    expect(tool).toBeDefined();

    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.authenticated).toBe(false);
    expect(parsed.authorization_url).toContain("https://api.oauth2shop.com/oauth/authorize");
    expect(parsed.session_id).toMatch(/^sess_/);
    expect(parsed.instructions_for_agent).toContain("Do NOT attempt to visit, open, or automate this authorization_url yourself");
  });

  it("check_auth_status should return authenticated info when active session exists", async () => {
    sessionStore.createPendingSession("test_sess_001", "pkce_verifier");
    sessionStore.completeSession(
      "test_sess_001",
      { access_token: "valid_access_token", expires_in: 3600 },
      { user_id: "user_42", user_name: "Alice Developer" }
    );

    const tool = (server as any)._registeredTools["check_auth_status"];
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.authenticated).toBe(true);
    expect(parsed.session_id).toBe("test_sess_001");
    expect(parsed.user_id).toBe("user_42");
    expect(parsed.user_name).toBe("Alice Developer");
  });

  it("request_login should generate a new session and authorization URL", async () => {
    const tool = (server as any)._registeredTools["request_login"];
    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe("login_initiated");
    expect(parsed.authorization_url).toContain("https://api.oauth2shop.com/oauth/authorize");
    expect(parsed.session_id).toMatch(/^sess_/);
    expect(parsed.instructions_for_agent).toContain("Do NOT attempt to visit, open, or automate this authorization_url yourself");

    const pendingSession = sessionStore.getSession(parsed.session_id);
    expect(pendingSession?.status).toBe("pending");
  });

  it("logout should invalidate the active user session", async () => {
    sessionStore.createPendingSession("sess_to_logout", "pkce_verifier");
    sessionStore.completeSession("sess_to_logout", { access_token: "token_abc" });

    const tool = (server as any)._registeredTools["logout"];
    const result = await tool.handler({ session_id: "sess_to_logout" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe("logged_out");
    expect(sessionStore.getSession("sess_to_logout")).toBeNull();
  });

  it("prepare_purchase should return auth_required when unauthenticated on a protected operation", async () => {
    const tool = (server as any)._registeredTools["prepare_purchase"];
    const result = await tool.handler({
      product_id: "PROD-101",
      quantity: 1,
      selection_reason: "User requested purchase",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("auth_required");
    expect(parsed.authorization_url).toContain("https://api.oauth2shop.com/oauth/authorize");
    expect(parsed.session_id).toMatch(/^sess_/);
  });

  it("prepare_purchase should proceed with authenticated session", async () => {
    sessionStore.createPendingSession("sess_authed", "pkce_verifier");
    sessionStore.completeSession("sess_authed", { access_token: "valid_token_jwt" });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/products/PROD-101")) {
        return {
          ok: true,
          json: async () => ({ id: "PROD-101", name: "Wireless Headphones", price: 2999 }),
        } as Response;
      }
      if (urlStr.includes("/api/checkout")) {
        return {
          ok: true,
          json: async () => ({ cart_token: "cart_live_999", grand_total: 2999 }),
        } as Response;
      }
      return { ok: false } as Response;
    });

    const tool = (server as any)._registeredTools["prepare_purchase"];
    const result = await tool.handler({
      product_id: "PROD-101",
      quantity: 1,
      selection_reason: "User requested purchase",
      session_id: "sess_authed",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.state).toBe("PAYMENT_PENDING");
    expect(parsed.checkout.checkout_id).toBe("cart_live_999");
    expect(parsed.payment.methods.payment_link.url).toBeDefined();
  });
});
