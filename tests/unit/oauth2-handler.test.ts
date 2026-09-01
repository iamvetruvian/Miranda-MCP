/**
 * OAuth2Handler Unit Tests
 * Tests login initiation (PKCE, state, auth URL), token exchange, token refresh,
 * userinfo extraction, and auto-refresh resolution.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { OAuth2Handler } from "../../src/auth/oauth2-handler.js";
import { SessionStore } from "../../src/auth/session-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { OAuth2UserFlowConfig } from "../../src/types/manifest.js";

describe("OAuth2Handler", () => {
  let sessionStore: SessionStore;
  let handler: OAuth2Handler;
  const originalFetch = global.fetch;

  const mockConfig: OAuth2UserFlowConfig = {
    authorization_url: "https://merchant.example.com/oauth/authorize",
    token_url: "https://merchant.example.com/oauth/token",
    client_id_env: "TEST_OAUTH_CLIENT_ID",
    client_secret_env: "TEST_OAUTH_CLIENT_SECRET",
    scopes: ["read", "write"],
    access_token_path: "$.access_token",
    refresh_token_path: "$.refresh_token",
    expires_in_path: "$.expires_in",
    user_id_path: "$.user.id",
    user_name_path: "$.user.name",
    use_pkce: true,
    session_ttl_seconds: 2592000, // 30 days
  };

  beforeEach(() => {
    process.env.TEST_OAUTH_CLIENT_ID = "client_123";
    process.env.TEST_OAUTH_CLIENT_SECRET = "secret_abc";

    const store = new InMemoryStore();
    sessionStore = new SessionStore(store);
    handler = new OAuth2Handler(
      mockConfig,
      sessionStore,
      "http://localhost:3000/auth/callback"
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should generate a valid authorization URL with PKCE parameters", () => {
    const { authorization_url, session_id, state } = handler.initiateLogin();

    expect(session_id).toMatch(/^sess_/);
    expect(state).toBeTruthy();

    const url = new URL(authorization_url);
    expect(url.origin + url.pathname).toBe("https://merchant.example.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client_123");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
    expect(url.searchParams.get("scope")).toBe("read write");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    // Pending session must exist with PKCE verifier
    const pending = sessionStore.findByState(state);
    expect(pending?.session_id).toBe(session_id);
    expect(pending?.pkce_verifier).toBeTruthy();
  });

  it("should exchange code for tokens and complete session on callback", async () => {
    const { state, session_id } = handler.initiateLogin();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "jwt_access_token_123",
        refresh_token: "jwt_refresh_token_456",
        expires_in: 3600,
        user: {
          id: "usr_99",
          name: "Bob Builder",
        },
      }),
    } as any);

    const completed = await handler.handleCallback("auth_code_xyz", state);

    expect(completed.session_id).toBe(session_id);
    expect(completed.status).toBe("authenticated");
    expect(completed.access_token).toBe("jwt_access_token_123");
    expect(completed.refresh_token).toBe("jwt_refresh_token_456");
    expect(completed.user_id).toBe("usr_99");
    expect(completed.user_name).toBe("Bob Builder");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://merchant.example.com/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      })
    );
  });

  it("should throw an error on invalid or expired state during callback", async () => {
    await expect(handler.handleCallback("auth_code", "invalid_state")).rejects.toThrow(
      "Invalid or expired OAuth2 state parameter"
    );
  });

  it("should refresh expired access token using refresh token", async () => {
    const { state, session_id } = handler.initiateLogin();

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "initial_access_token",
        refresh_token: "initial_refresh_token",
        expires_in: 1, // 1 second
      }),
    } as any);

    await handler.handleCallback("auth_code", state);

    // Mock refresh endpoint response
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "refreshed_access_token_777",
        refresh_token: "new_refresh_token_888",
        expires_in: 3600,
      }),
    } as any);

    const newToken = await handler.refreshAccessToken(session_id);
    expect(newToken).toBe("refreshed_access_token_777");

    const session = sessionStore.getSession(session_id);
    expect(session?.access_token).toBe("refreshed_access_token_777");
    expect(session?.refresh_token).toBe("new_refresh_token_888");
  });

  it("should auto-refresh when resolving expired tokens via resolveValidToken", async () => {
    const { state, session_id } = handler.initiateLogin();

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "expired_token",
        refresh_token: "valid_refresh_token",
        expires_in: -10, // already expired
      }),
    } as any);

    await handler.handleCallback("auth_code", state);

    // Mock auto-refresh response
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "auto_refreshed_token",
        expires_in: 3600,
      }),
    } as any);

    const validToken = await handler.resolveValidToken(session_id);
    expect(validToken).toBe("auto_refreshed_token");
  });
});
