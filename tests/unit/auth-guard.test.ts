/**
 * AuthGuard Unit Tests
 * Tests operation protection classification, session resolution,
 * automatic token refresh integration, and auth_required responses.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { AuthGuard } from "../../src/auth/auth-guard.js";
import { OAuth2Handler } from "../../src/auth/oauth2-handler.js";
import { SessionStore } from "../../src/auth/session-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

describe("AuthGuard", () => {
  let sessionStore: SessionStore;
  let oauth2Handler: OAuth2Handler;
  let guard: AuthGuard;
  const originalFetch = global.fetch;

  const mockManifest: IntegrationManifest = {
    merchant: {
      name: "ProShop",
      description: "Electronics Store",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "http://localhost:5000",
    },
    auth: {
      type: "oauth2_authorization_code",
      oauth2_user: {
        authorization_url: "http://localhost:5000/oauth/authorize",
        token_url: "http://localhost:5000/oauth/token",
        client_id_env: "TEST_CLIENT_ID",
        client_secret_env: "TEST_CLIENT_SECRET",
        session_ttl_seconds: 2592000,
      },
      protected_operations: ["create_checkout", "confirm_order", "custom.create_review"],
      public_operations: ["search", "get_product"],
    },
    operations: {
      search: { method: "GET", path: "/api/products" },
      get_product: { method: "GET", path: "/api/products/:product_id" },
      create_checkout: { method: "POST", path: "/api/orders" },
      get_checkout: { method: "GET", path: "/api/orders/:checkout_id" },
      confirm_order: { method: "PUT", path: "/api/orders/:checkout_id/pay" },
      get_order_status: { method: "GET", path: "/api/orders/:order_id" },
      custom: {
        create_review: {
          method: "POST",
          path: "/api/products/:id/reviews",
          description: "Post review",
          mutating: true,
        },
      },
    },
    field_mappings: {
      offer: { offer_id: { from: "$._id" } },
      checkout: { checkout_id: { from: "$._id" } },
      order: { order_id: { from: "$._id" } },
    },
    payment: {
      provider: "razorpay",
      razorpay_key_id_env: "RAZORPAY_KEY_ID",
      razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
    },
  };

  beforeEach(() => {
    process.env.TEST_CLIENT_ID = "cid_123";
    process.env.TEST_CLIENT_SECRET = "sec_456";

    const store = new InMemoryStore();
    sessionStore = new SessionStore(store);
    oauth2Handler = new OAuth2Handler(
      mockManifest.auth!.oauth2_user!,
      sessionStore,
      "http://localhost:3000/auth/callback"
    );
    guard = new AuthGuard(mockManifest, oauth2Handler, sessionStore);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should allow public operations through without authentication", async () => {
    const result = await guard.check("search");
    expect(result.authorized).toBe(true);
    expect(result.access_token).toBeUndefined();
    expect(result.auth_required_response).toBeUndefined();
  });

  it("should return auth_required with authorization URL for unauthenticated protected calls", async () => {
    const result = await guard.check("create_checkout");
    expect(result.authorized).toBe(false);
    expect(result.auth_required_response).toBeDefined();
    expect(result.auth_required_response?.status).toBe("auth_required");
    expect(result.auth_required_response?.authorization_url).toContain("http://localhost:5000/oauth/authorize");
    expect(result.auth_required_response?.session_id).toMatch(/^sess_/);
    expect(result.auth_required_response?.message).toContain("ProShop");
  });

  it("should authorize protected operations when valid session_id is provided", async () => {
    const pending = sessionStore.createPendingSession("state_1");
    sessionStore.completeSession(pending.session_id, {
      access_token: "valid_jwt_token_999",
      expires_in: 3600,
    });

    const result = await guard.check("create_checkout", pending.session_id);
    expect(result.authorized).toBe(true);
    expect(result.access_token).toBe("valid_jwt_token_999");
    expect(result.session_id).toBe(pending.session_id);
  });

  it("should automatically use the active session when session_id is omitted", async () => {
    const pending = sessionStore.createPendingSession("state_active");
    sessionStore.completeSession(pending.session_id, {
      access_token: "active_user_jwt_token",
      expires_in: 3600,
    });

    const result = await guard.check("confirm_order");
    expect(result.authorized).toBe(true);
    expect(result.access_token).toBe("active_user_jwt_token");
    expect(result.session_id).toBe(pending.session_id);
  });

  it("should trigger auto-refresh when access token is expired", async () => {
    const pending = sessionStore.createPendingSession("state_ref");
    sessionStore.completeSession(pending.session_id, {
      access_token: "expired_token",
      refresh_token: "valid_refresh_token",
      expires_in: -10, // expired
    });

    // Mock token refresh response
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "newly_refreshed_jwt",
        expires_in: 3600,
      }),
    } as any);

    const result = await guard.check("create_checkout", pending.session_id);
    expect(result.authorized).toBe(true);
    expect(result.access_token).toBe("newly_refreshed_jwt");
  });

  it("should infer protection correctly based on default heuristics when explicit lists are omitted", () => {
    const inferredManifest: IntegrationManifest = {
      ...mockManifest,
      auth: {
        type: "oauth2_authorization_code",
        oauth2_user: mockManifest.auth!.oauth2_user,
        // No protected_operations or public_operations declared
      },
    };

    const inferredGuard = new AuthGuard(inferredManifest, oauth2Handler, sessionStore);

    expect(inferredGuard.isProtected("create_checkout")).toBe(true);
    expect(inferredGuard.isProtected("confirm_order")).toBe(true);
    expect(inferredGuard.isProtected("cancel_order")).toBe(true);
    expect(inferredGuard.isProtected("search")).toBe(false);
    expect(inferredGuard.isProtected("get_product")).toBe(false);
  });

  it("should treat all operations as public if oauth2_user is not configured", () => {
    const noOauthManifest: IntegrationManifest = {
      ...mockManifest,
      auth: {
        type: "bearer",
        token_env_var: "STATIC_TOKEN",
      },
    };

    const noOauthGuard = new AuthGuard(noOauthManifest, null, sessionStore);
    expect(noOauthGuard.isProtected("create_checkout")).toBe(false);
    expect(noOauthGuard.isProtected("search")).toBe(false);
  });
});
