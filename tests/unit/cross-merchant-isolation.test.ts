import { describe, it, expect, beforeEach } from "vitest";
import { SessionStore, UserSession } from "../../src/auth/session-store.js";
import { RecurringTokenStore, RecurringToken } from "../../src/payment/token-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { AuthGuard } from "../../src/auth/auth-guard.js";
import { OAuth2Handler } from "../../src/auth/oauth2-handler.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

describe("Cross-Merchant Session and Token Isolation", () => {
  let sharedStore: InMemoryStore;

  const proshopManifest: IntegrationManifest = {
    merchant: {
      name: "ProShop Electronics",
      description: "Electronics store",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "http://localhost:5000",
    },
    auth: {
      type: "oauth2_authorization_code",
      oauth2_user: {
        authorization_url: "http://localhost:5000/oauth/authorize",
        token_url: "http://localhost:5000/oauth/token",
        userinfo_url: "http://localhost:5000/oauth/userinfo",
        client_id: "proshop_client",
        client_secret: "proshop_secret",
        redirect_uri: "http://localhost:3002/auth/callback",
      },
      protected_operations: ["create_checkout", "confirm_order"],
      public_operations: ["search", "get_product"],
    },
    operations: {
      search: { method: "GET", path: "/api/products" },
      get_product: { method: "GET", path: "/api/products/:product_id" },
      create_checkout: { method: "POST", path: "/api/orders" },
      confirm_order: { method: "POST", path: "/api/orders/:order_id/pay" },
    },
    field_mappings: {
      checkout: {
        checkout_id: "$.id",
        total: { amount: "$.total", currency: "$.currency" },
      },
      product: {
        product_id: "$.id",
        title: "$.title",
        price: { amount: "$.price", currency: "$.currency" },
      },
      order: {
        order_id: "$.id",
        status: "$.status",
      },
    },
    payment: {
      provider: "stripe",
      supported_methods: ["card"],
    },
  };

  const skateshopManifest: IntegrationManifest = {
    merchant: {
      name: "Skateshop",
      description: "Skateshop store",
      commerce_domain: "retail",
      currency: "USD",
      base_url: "http://localhost:3000",
    },
    auth: {
      type: "oauth2_authorization_code",
      oauth2_user: {
        authorization_url: "https://select-racer-6737.clerk.accounts.dev/oauth/authorize",
        token_url: "https://select-racer-6737.clerk.accounts.dev/oauth/token",
        userinfo_url: "https://select-racer-6737.clerk.accounts.dev/oauth/userinfo",
        client_id: "clerk_client",
        client_secret: "clerk_secret",
        redirect_uri: "http://localhost:3002/auth/callback",
      },
      protected_operations: ["create_checkout", "confirm_order"],
      public_operations: ["search", "get_product"],
    },
    operations: {
      search: { method: "GET", path: "/api/products" },
      get_product: { method: "GET", path: "/api/products/:product_id" },
      create_checkout: { method: "POST", path: "/api/checkout" },
      confirm_order: { method: "POST", path: "/api/orders" },
    },
    field_mappings: {
      checkout: {
        checkout_id: "$.id",
        total: { amount: "$.total", currency: "$.currency" },
      },
      product: {
        product_id: "$.id",
        title: "$.title",
        price: { amount: "$.price", currency: "$.currency" },
      },
      order: {
        order_id: "$.id",
        status: "$.status",
      },
    },
    payment: {
      provider: "stripe",
      supported_methods: ["card"],
    },
  };

  beforeEach(() => {
    sharedStore = new InMemoryStore();
  });

  it("should NOT allow Skateshop to access or use a Proshop session", () => {
    const proshopSessionStore = new SessionStore(sharedStore, 3600, "proshop-electronics");
    const skateshopSessionStore = new SessionStore(sharedStore, 3600, "skateshop");

    // Authenticate a user on Proshop
    const proPending = proshopSessionStore.createPendingSession("state_pro_1");
    const proSession = proshopSessionStore.completeSession(
      proPending.session_id,
      { access_token: "proshop_access_token_jwt" },
      { user_id: "user_pro_123", user_email: "alice@proshop.example" }
    );

    expect(proSession.merchant_id).toBe("proshop-electronics");
    expect(proshopSessionStore.getSession(proSession.session_id)).not.toBeNull();
    expect(proshopSessionStore.getActiveSession()?.session_id).toBe(proSession.session_id);

    // Verify Skateshop cannot access this session by ID
    expect(skateshopSessionStore.getSession(proSession.session_id)).toBeNull();

    // Verify Skateshop getActiveSession() does NOT inherit Proshop session
    expect(skateshopSessionStore.getActiveSession()).toBeNull();

    // Verify Skateshop lookups by email or user ID return null
    expect(skateshopSessionStore.findByEmail("alice@proshop.example")).toBeNull();
    expect(skateshopSessionStore.findByUserId("user_pro_123")).toBeNull();
    expect(skateshopSessionStore.getAllSessions()).toHaveLength(0);
  });

  it("should NOT allow Skateshop to access or use a Proshop recurring payment token", () => {
    const proshopTokenStore = new RecurringTokenStore(sharedStore, "proshop-electronics");
    const skateshopTokenStore = new RecurringTokenStore(sharedStore, "skateshop");

    // Save recurring card token on Proshop
    proshopTokenStore.save({
      customer_id: "cus_alice_123",
      token_id: "pm_card_visa_proshop",
      method: "card",
      email: "alice@example.com",
      created_at: new Date().toISOString(),
    });

    expect(proshopTokenStore.get("cus_alice_123")?.token_id).toBe("pm_card_visa_proshop");
    expect(proshopTokenStore.listAll()).toHaveLength(1);

    // Verify Skateshop cannot see or use Proshop's payment token
    expect(skateshopTokenStore.get("cus_alice_123")).toBeUndefined();
    expect(skateshopTokenStore.getByTokenId("pm_card_visa_proshop")).toBeUndefined();
    expect(skateshopTokenStore.getByEmail("alice@example.com")).toBeUndefined();
    expect(skateshopTokenStore.listAll()).toHaveLength(0);
  });

  it("should require authentication on Skateshop AuthGuard even when Proshop is authenticated", async () => {
    const proshopSessionStore = new SessionStore(sharedStore, 3600, "proshop-electronics");
    const skateshopSessionStore = new SessionStore(sharedStore, 3600, "skateshop");

    // Authenticate on Proshop
    const proPending = proshopSessionStore.createPendingSession("state_pro_2");
    const proSession = proshopSessionStore.completeSession(
      proPending.session_id,
      { access_token: "proshop_jwt_token" },
      { user_id: "user_pro_456" }
    );

    const skateshopOAuth = new OAuth2Handler(skateshopManifest.auth!.oauth2_user!, skateshopSessionStore);
    const skateshopAuthGuard = new AuthGuard(skateshopManifest, skateshopOAuth, skateshopSessionStore);

    // 1. Skateshop check without session_id (must NOT inherit Proshop's active session)
    const resultNoId = await skateshopAuthGuard.check("create_checkout");
    expect(resultNoId.authorized).toBe(false);
    expect(resultNoId.auth_required_response?.status).toBe("auth_required");
    expect(resultNoId.auth_required_response?.authorization_url).toContain("clerk.accounts.dev");

    // 2. Skateshop check with foreign Proshop session_id (must be rejected)
    const resultForeignId = await skateshopAuthGuard.check("create_checkout", proSession.session_id);
    expect(resultForeignId.authorized).toBe(false);
    expect(resultForeignId.auth_required_response?.status).toBe("auth_required");
  });

  it("should independently track active sessions when both merchants are authenticated", () => {
    const proshopSessionStore = new SessionStore(sharedStore, 3600, "proshop-electronics");
    const skateshopSessionStore = new SessionStore(sharedStore, 3600, "skateshop");

    // Authenticate Proshop
    const proPending = proshopSessionStore.createPendingSession("state_p");
    const proSession = proshopSessionStore.completeSession(
      proPending.session_id,
      { access_token: "pro_token" },
      { user_id: "pro_user" }
    );

    // Authenticate Skateshop
    const skatePending = skateshopSessionStore.createPendingSession("state_s");
    const skateSession = skateshopSessionStore.completeSession(
      skatePending.session_id,
      { access_token: "skate_token" },
      { user_id: "skate_user" }
    );

    // Each store retrieves its own active session
    expect(proshopSessionStore.getActiveSession()?.user_id).toBe("pro_user");
    expect(skateshopSessionStore.getActiveSession()?.user_id).toBe("skate_user");

    // Cross-access is blocked
    expect(proshopSessionStore.getSession(skateSession.session_id)).toBeNull();
    expect(skateshopSessionStore.getSession(proSession.session_id)).toBeNull();
  });
});
