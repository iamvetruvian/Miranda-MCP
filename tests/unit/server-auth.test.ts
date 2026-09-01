import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMerchantMcpServer } from "../../src/server.js";
import { startHostedMerchantMcpServer, SseServerResult } from "../../src/server-sse.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { UserSession } from "../../src/auth/session-store.js";

const sampleManifest: IntegrationManifest = {
  manifest_version: "2.0.0",
  merchant: {
    name: "OAuth2 Test Merchant",
    id: "oauth2_merchant",
    domain: "retail",
    base_url: "https://api.oauth2merchant.com",
    currency: "INR",
  },
  auth: {
    type: "oauth2_authorization_code",
    header: "Authorization",
    token_prefix: "Bearer",
    oauth2_user: {
      authorization_url: "https://auth.oauth2merchant.com/oauth/authorize",
      token_url: "https://auth.oauth2merchant.com/oauth/token",
      userinfo_url: "https://auth.oauth2merchant.com/oauth/userinfo",
      client_id: "test_client_id_123",
      client_secret: "test_client_secret_456",
      redirect_uri: "http://localhost:3099/auth/callback",
      scope: ["read_profile", "orders"],
      session_ttl_seconds: 86400,
    },
    protected_operations: ["create_checkout", "confirm_order"],
    public_operations: ["search", "get_product"],
  },
  operations: {
    search: {
      method: "GET",
      path: "/api/products",
      params: { query: { in: "query", name: "q", required: true, type: "string" } },
    },
    get_product: {
      method: "GET",
      path: "/api/products/{id}",
      params: { id: { in: "path", required: true, type: "string" } },
    },
    create_checkout: {
      method: "POST",
      path: "/api/checkout",
      params: {},
    },
    confirm_order: {
      method: "POST",
      path: "/api/orders",
      params: {},
    },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.id" },
      title: { from: "$.name" },
      price: { amount: { from: "$.price" }, currency: "INR" },
      availability: { from: "in_stock" },
    },
    checkout: {
      checkout_id: { from: "$.cart_token" },
      total: { amount: { from: "$.grand_total" }, currency: "INR" },
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

describe("Component 7: Server Integration & SSE Auth Endpoints", () => {
  let sseServer: SseServerResult | null = null;
  const PORT = 3099;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (sseServer) {
      await sseServer.close();
      sseServer = null;
    }
  });

  describe("createMerchantMcpServer auth instantiation & hydration", () => {
    it("should instantiate sessionStore, oauth2Handler, and authGuard", () => {
      const serverInstance = createMerchantMcpServer(sampleManifest, {
        store: new InMemoryStore(),
        forceSimulation: true,
      });

      expect(serverInstance.sessionStore).toBeDefined();
      expect(serverInstance.oauth2Handler).toBeDefined();
      expect(serverInstance.authGuard).toBeDefined();
    });

    it("should hydrate persisted sessions on boot", async () => {
      const store = new InMemoryStore();
      const existingSession: UserSession = {
        session_id: "persisted_sess_100",
        access_token: "persisted_jwt_token",
        user_id: "usr_99",
        user_name: "John Persisted",
        authenticated_at: Date.now() - 1000,
        session_expires_at: Date.now() + 86400 * 1000,
        status: "authenticated",
      };
      await store.saveSession(existingSession);

      const serverInstance = createMerchantMcpServer(sampleManifest, {
        store,
        forceSimulation: true,
      });

      const hydrated = serverInstance.sessionStore.getSession("persisted_sess_100");
      expect(hydrated).not.toBeNull();
      expect(hydrated?.user_name).toBe("John Persisted");
      expect(hydrated?.access_token).toBe("persisted_jwt_token");
    });
  });

  describe("Hosted SSE Server OAuth2 Endpoints", () => {
    beforeEach(async () => {
      const store = new InMemoryStore();
      sseServer = startHostedMerchantMcpServer(sampleManifest, {
        port: PORT,
        store,
        disableWebhookServer: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it("GET /auth/status should return authenticated: false when no session is active", async () => {
      const res = await fetch(`http://localhost:${PORT}/auth/status`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authenticated).toBe(false);
    });

    it("GET /auth/status should return session info when session exists", async () => {
      sseServer!.sessionStore.createPendingSession("sess_active_123", "verifier_abc");
      sseServer!.sessionStore.completeSession(
        "sess_active_123",
        { access_token: "token_xyz", expires_in: 3600 },
        { user_id: "u123", user_name: "Alice Active" }
      );

      const res = await fetch(`http://localhost:${PORT}/auth/status?session_id=sess_active_123`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authenticated).toBe(true);
      expect(data.session_id).toBe("sess_active_123");
      expect(data.user_name).toBe("Alice Active");
    });

    it("GET /auth/callback should return 400 when missing parameters", async () => {
      const res = await fetch(`http://localhost:${PORT}/auth/callback`);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain("Invalid Request");
    });

    it("GET /auth/callback should return 400 error page when provider sends error", async () => {
      const res = await fetch(
        `http://localhost:${PORT}/auth/callback?error=access_denied&error_description=The%20user%20denied%20consent.`
      );
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain("Authentication Cancelled or Failed");
      expect(text).toContain("The user denied consent.");
    });

    it("GET /auth/callback should successfully exchange code and render success page", async () => {
      // 1. Initiate login
      const login = sseServer!.oauth2Handler!.initiateLogin();

      // 2. Mock token endpoint and userinfo endpoint
      const originalFetch = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.startsWith(`http://localhost:${PORT}`)) {
          return originalFetch(url, init);
        }
        if (urlStr.includes("/oauth/token")) {
          return {
            ok: true,
            json: async () => ({
              access_token: "exchanged_jwt_token",
              token_type: "Bearer",
              expires_in: 7200,
              refresh_token: "refresh_xyz",
            }),
          } as Response;
        }
        if (urlStr.includes("/oauth/userinfo")) {
          return {
            ok: true,
            json: async () => ({
              id: "usr_oauth_777",
              name: "Bob Successful",
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      // 3. Request callback
      const res = await fetch(
        `http://localhost:${PORT}/auth/callback?code=mock_auth_code_999&state=${encodeURIComponent(login.state)}`
      );

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Logged in Successfully");
      expect(text).toContain("Bob Successful");

      // 4. Verify session is completed in sessionStore
      const session = sseServer!.sessionStore.getSession(login.session_id);
      expect(session).not.toBeNull();
      expect(session?.status).toBe("authenticated");
      expect(session?.access_token).toBe("exchanged_jwt_token");
      expect(session?.user_name).toBe("Bob Successful");
    });
  });
});

