/**
 * Authentication Provider Unit Tests
 * Tests api_key, bearer, basic, custom_header, and HMAC request signing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { AuthProvider } from "../../src/connector/auth-provider.js";
import { AuthConfig } from "../../src/types/manifest.js";

describe("AuthProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return unchanged headers when auth is none or undefined", async () => {
    const provider = new AuthProvider({ type: "none" });
    const headers = await provider.applyAuth({ "Content-Type": "application/json" });
    expect(headers).toEqual({ "Content-Type": "application/json" });
  });

  it("should apply api_key header with custom header name and token prefix", async () => {
    process.env["TEST_API_KEY"] = "secret_key_123";
    const config: AuthConfig = {
      type: "api_key",
      header: "X-Merchant-Key",
      token_env_var: "TEST_API_KEY",
      token_prefix: "Key",
    };
    const provider = new AuthProvider(config);
    const headers = await provider.applyAuth({});
    expect(headers["X-Merchant-Key"]).toBe("Key secret_key_123");
  });

  it("should apply bearer authorization header", async () => {
    process.env["TEST_BEARER_TOKEN"] = "jwt.token.abc";
    const config: AuthConfig = {
      type: "bearer",
      token_env_var: "TEST_BEARER_TOKEN",
    };
    const provider = new AuthProvider(config);
    const headers = await provider.applyAuth({});
    expect(headers["Authorization"]).toBe("Bearer jwt.token.abc");
  });

  it("should apply base64 basic authorization header", async () => {
    process.env["TEST_BASIC_AUTH"] = "user:password";
    const config: AuthConfig = {
      type: "basic",
      token_env_var: "TEST_BASIC_AUTH",
    };
    const provider = new AuthProvider(config);
    const headers = await provider.applyAuth({});
    const expected = `Basic ${Buffer.from("user:password").toString("base64")}`;
    expect(headers["Authorization"]).toBe(expected);
  });

  it("should compute HMAC-SHA256 signature across method, path, and body", async () => {
    process.env["HMAC_SECRET"] = "super_secret_hmac_key";
    const config: AuthConfig = {
      type: "hmac_request_signing",
      hmac: {
        algorithm: "sha256",
        secret_env: "HMAC_SECRET",
        signature_components: ["method", "path", "body"],
        signature_header: "X-Signature",
      },
    };

    const provider = new AuthProvider(config);
    const context = {
      method: "POST",
      path: "/api/checkout",
      body: { item: "sku_1", quantity: 2 },
    };

    const headers = await provider.applyAuth({}, context);
    expect(headers["X-Signature"]).toBeDefined();

    // Verify signature independently
    const expectedPayload = `POST\n/api/checkout\n${JSON.stringify(context.body)}`;
    const hmac = crypto.createHmac("sha256", "super_secret_hmac_key");
    hmac.update(expectedPayload);
    const expectedSig = hmac.digest("hex");

    expect(headers["X-Signature"]).toBe(expectedSig);
  });

  it("should apply operation overrides when specified for an operation name", async () => {
    process.env["DEFAULT_KEY"] = "default_123";
    process.env["SPECIAL_KEY"] = "special_456";

    const config: AuthConfig = {
      type: "api_key",
      header: "X-Default-Key",
      token_env_var: "DEFAULT_KEY",
      operation_overrides: {
        confirm_order: {
          header: "X-Special-Key",
          token_env_var: "SPECIAL_KEY",
        },
      },
    };

    const provider = new AuthProvider(config);

    const normalHeaders = await provider.applyAuth({}, { method: "GET", path: "/items", operationName: "search" });
    expect(normalHeaders["X-Default-Key"]).toBe("default_123");

    const overriddenHeaders = await provider.applyAuth({}, { method: "POST", path: "/orders", operationName: "confirm_order" });
    expect(overriddenHeaders["X-Special-Key"]).toBe("special_456");
  });

  it("should apply session-scoped token with applyAuthWithSessionToken", async () => {
    const config: AuthConfig = {
      type: "oauth2_authorization_code",
      header: "Authorization",
      token_prefix: "Bearer",
    };
    const provider = new AuthProvider(config);

    const headers = await provider.applyAuthWithSessionToken({}, "session_jwt_abc123");
    expect(headers["Authorization"]).toBe("Bearer session_jwt_abc123");
  });

  it("should support custom header and prefix with applyAuthWithSessionToken", async () => {
    const config: AuthConfig = {
      type: "oauth2_authorization_code",
      header: "X-User-Token",
      token_prefix: "Token",
    };
    const provider = new AuthProvider(config);

    const headers = await provider.applyAuthWithSessionToken({ Accept: "application/json" }, "my_token_xyz");
    expect(headers["X-User-Token"]).toBe("Token my_token_xyz");
    expect(headers["Accept"]).toBe("application/json");
  });
});
