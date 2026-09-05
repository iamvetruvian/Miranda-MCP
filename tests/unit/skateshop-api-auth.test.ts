import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";

// Mock @/env.js
vi.mock("@/env.js", () => ({
  env: {
    CLERK_SECRET_KEY: "sk_test_mock",
  },
}));

import { authenticateApiRequest } from "../../demo/merchants/skateshop/src/lib/api-auth.js";

describe("Skateshop API Authentication Enforcement", () => {
  const options = {
    verifyTokenFn: async (token: string) => {
      if (token === "valid_clerk_jwt_token") {
        return { sub: "user_clerk_123" };
      }
      throw new Error("Unable to find a signing key in JWKS that matches the kid");
    },
  };

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      if (String(url).includes("oauth/userinfo")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: "invalid_token" }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null when request has no Authorization header and no Clerk session", async () => {
    const req = new Request("http://localhost:3000/api/checkout", {
      method: "POST",
    });

    const authCtx = await authenticateApiRequest(req, options);
    expect(authCtx).toBeNull();
  });

  it("should reject foreign Proshop JWT tokens", async () => {
    const proshopToken = jwt.sign(
      { sub: "user_proshop_777", email: "alice@proshop.example" },
      "proshop_secret"
    );

    const req = new Request("http://localhost:3000/api/checkout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${proshopToken}`,
      },
    });

    const authCtx = await authenticateApiRequest(req, options);
    expect(authCtx).toBeNull();
  });

  it("should accept valid Clerk session token", async () => {
    const req = new Request("http://localhost:3000/api/checkout", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid_clerk_jwt_token",
      },
    });

    const authCtx = await authenticateApiRequest(req, options);
    expect(authCtx).not.toBeNull();
    expect(authCtx?.userId).toBe("user_clerk_123");
  });

  it("should authenticate via Clerk OAuth2 userinfo endpoint when token is an OAuth access token", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      if (init?.headers?.Authorization === "Bearer clerk_oauth_access_token") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sub: "user_oauth_clerk_999", email: "skater@example.com" }),
        } as any;
      }
      return { ok: false, status: 401, json: async () => ({}) } as any;
    });

    const req = new Request("http://localhost:3000/api/checkout", {
      method: "POST",
      headers: {
        Authorization: "Bearer clerk_oauth_access_token",
      },
    });

    const authCtx = await authenticateApiRequest(req, options);
    expect(authCtx).not.toBeNull();
    expect(authCtx?.userId).toBe("user_oauth_clerk_999");
  });
});
