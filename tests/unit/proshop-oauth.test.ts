import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import oauthRoutes from "../../demo/merchants/proshop-v2/backend/routes/oauthRoutes.js";
import User from "../../demo/merchants/proshop-v2/backend/models/userModel.js";

describe("ProShop Native OAuth2 Authorization Server (RFC 6749 & RFC 7636)", () => {
  let app: express.Express;
  const JWT_SECRET = "test_proshop_secret_123";

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use("/oauth", oauthRoutes);

    vi.restoreAllMocks();
  });

  it("GET /oauth/authorize should render authorization page for unauthenticated user", async () => {
    const server = app.listen(0);
    const port = (server.address() as any).port;

    const res = await fetch(
      `http://localhost:${port}/oauth/authorize?response_type=code&client_id=client_1&redirect_uri=http://localhost:3000/callback&state=xyz`
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ProShop");
    expect(html).toContain("Authorize Application Access");
    expect(html).toContain("Log In & Authorize");

    await new Promise((resolve) => server.close(resolve));
  });

  it("POST /oauth/authorize should authenticate user and redirect with authorization code", async () => {
    // Mock user lookup
    vi.spyOn(User, "findOne").mockResolvedValue({
      _id: "user_proshop_42",
      name: "John Doe",
      email: "john@email.com",
      matchPassword: async (pwd: string) => pwd === "123456",
    } as any);

    const server = app.listen(0);
    const port = (server.address() as any).port;

    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const formData = new URLSearchParams();
    formData.append("email", "john@email.com");
    formData.append("password", "123456");
    formData.append("redirect_uri", "http://localhost:3000/callback");
    formData.append("state", "state_999");
    formData.append("code_challenge", challenge);
    formData.append("code_challenge_method", "S256");

    const res = await fetch(`http://localhost:${port}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeDefined();

    const redirectUrl = new URL(location!);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe("http://localhost:3000/callback");
    expect(redirectUrl.searchParams.get("state")).toBe("state_999");
    const code = redirectUrl.searchParams.get("code");
    expect(code).toBeDefined();

    await new Promise((resolve) => server.close(resolve));
  });

  it("POST /oauth/token should exchange code with valid PKCE verifier for access & refresh tokens", async () => {
    vi.spyOn(User, "findOne").mockResolvedValue({
      _id: "user_proshop_42",
      name: "John Doe",
      email: "john@email.com",
      matchPassword: async (pwd: string) => pwd === "123456",
    } as any);

    vi.spyOn(User, "findById").mockResolvedValue({
      _id: "user_proshop_42",
      name: "John Doe",
      email: "john@email.com",
      isAdmin: false,
    } as any);

    const server = app.listen(0);
    const port = (server.address() as any).port;

    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    // 1. Authorize to get code
    const formData = new URLSearchParams();
    formData.append("email", "john@email.com");
    formData.append("password", "123456");
    formData.append("redirect_uri", "http://localhost:3000/callback");
    formData.append("code_challenge", challenge);
    formData.append("code_challenge_method", "S256");

    const authRes = await fetch(`http://localhost:${port}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
      redirect: "manual",
    });

    const redirectUrl = new URL(authRes.headers.get("location")!);
    const code = redirectUrl.searchParams.get("code")!;

    // 2. Exchange code with wrong verifier -> should fail
    const badTokenRes = await fetch(`http://localhost:${port}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: "http://localhost:3000/callback",
        code_verifier: "wrong_verifier",
      }),
    });
    expect(badTokenRes.status).toBe(400);

    // Note: since code is deleted upon attempt or single-use, re-authorize
    const reAuthRes = await fetch(`http://localhost:${port}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
      redirect: "manual",
    });
    const newCode = new URL(reAuthRes.headers.get("location")!).searchParams.get("code")!;

    // 3. Exchange code with correct PKCE verifier
    const tokenRes = await fetch(`http://localhost:${port}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: newCode,
        redirect_uri: "http://localhost:3000/callback",
        code_verifier: verifier,
      }),
    });

    expect(tokenRes.status).toBe(200);
    const tokenData = await tokenRes.json();
    expect(tokenData.access_token).toBeDefined();
    expect(tokenData.token_type).toBe("Bearer");
    expect(tokenData.expires_in).toBe(2592000); // 30 days
    expect(tokenData.refresh_token).toBeDefined();

    // 4. Verify decoded JWT contains userId
    const decoded = jwt.verify(tokenData.access_token, JWT_SECRET) as any;
    expect(decoded.userId).toBe("user_proshop_42");

    await new Promise((resolve) => server.close(resolve));
  });

  it("POST /oauth/token should allow token refresh via grant_type=refresh_token", async () => {
    vi.spyOn(User, "findOne").mockResolvedValue({
      _id: "user_proshop_42",
      name: "John Doe",
      email: "john@email.com",
      matchPassword: async (pwd: string) => pwd === "123456",
    } as any);

    vi.spyOn(User, "findById").mockResolvedValue({
      _id: "user_proshop_42",
      name: "John Doe",
      email: "john@email.com",
      isAdmin: false,
    } as any);

    const server = app.listen(0);
    const port = (server.address() as any).port;

    // 1. Authorize and exchange to get refresh token
    const formData = new URLSearchParams();
    formData.append("email", "john@email.com");
    formData.append("password", "123456");
    formData.append("redirect_uri", "http://localhost:3000/callback");

    const authRes = await fetch(`http://localhost:${port}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
      redirect: "manual",
    });

    const code = new URL(authRes.headers.get("location")!).searchParams.get("code")!;
    const tokenRes = await fetch(`http://localhost:${port}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: "http://localhost:3000/callback",
      }),
    });
    const { refresh_token } = await tokenRes.json();

    // 2. Refresh token
    const refreshRes = await fetch(`http://localhost:${port}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token,
      }),
    });

    expect(refreshRes.status).toBe(200);
    const refreshData = await refreshRes.json();
    expect(refreshData.access_token).toBeDefined();
    expect(refreshData.token_type).toBe("Bearer");

    await new Promise((resolve) => server.close(resolve));
  });
});
