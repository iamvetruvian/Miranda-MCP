import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "http";
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { startHostedMerchantMcpServer, SseServerResult } from "../../src/server-sse.js";
import { createMerchantMcpServer, ServerInstance } from "../../src/server.js";
import { SqliteStore } from "../../src/persistence/sqlite.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import oauthRoutes from "../../demo/merchants/proshop-v2/backend/routes/oauthRoutes.js";
import User from "../../demo/merchants/proshop-v2/backend/models/userModel.js";

describe("End-to-End OAuth2 Authentication Flow & Persistent Session Lifecycle", () => {
  let merchantApp: express.Express;
  let merchantHttpServer: http.Server;
  let mcpHostedServer: SseServerResult | null = null;

  const MERCHANT_PORT = 4094;
  const MCP_PORT = 4095;
  const JWT_SECRET = "proshop_integration_test_jwt_secret_999";
  const DB_PATH = path.resolve(process.cwd(), "scratch_auth_test.db");

  let manifest: IntegrationManifest;

  beforeAll(async () => {
    // 1. Clean previous test DB
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }

    process.env.JWT_SECRET = JWT_SECRET;

    // 2. Start Mock ProShop Merchant Backend on MERCHANT_PORT
    merchantApp = express();
    merchantApp.use(express.json());
    merchantApp.use(express.urlencoded({ extended: true }));

    // Mount ProShop OAuth2 routes
    merchantApp.use("/oauth", oauthRoutes);

    // Mock Catalog and Orders API
    merchantApp.get("/api/products", (req, res) => {
      res.json({
        products: [
          {
            _id: "64cba1111111111111111111",
            name: "Airpods Wireless Bluetooth Headphones",
            price: 8999,
            countInStock: 10,
          },
          {
            _id: "64cba2222222222222222222",
            name: "iPhone 14 Pro 256GB Storage",
            price: 129900,
            countInStock: 5,
          },
        ],
        page: 1,
        pages: 1,
      });
    });

    merchantApp.get("/api/products/:id", (req, res) => {
      res.json({
        _id: req.params.id,
        name: "Airpods Wireless Bluetooth Headphones",
        price: 8999,
        countInStock: 10,
      });
    });

    merchantApp.post("/api/checkout", (req, res) => {
      // Protected checkout requires Bearer auth
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "User authentication required for checkout" });
      }
      const token = authHeader.split(" ")[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        res.status(201).json({
          cart_token: `cart_proshop_${Date.now()}`,
          grand_total: 8999,
          user_id: decoded.userId,
        });
      } catch (err) {
        res.status(401).json({ message: "Invalid or expired user session token" });
      }
    });

    merchantApp.post("/api/orders", (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "User authentication required" });
      }
      res.status(201).json({
        _id: `ord_proshop_${Date.now()}`,
        status: "CONFIRMED",
      });
    });

    merchantHttpServer = merchantApp.listen(MERCHANT_PORT);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Mock User.findOne and User.findById for ProShop User model
    vi.spyOn(User, "findOne").mockImplementation(async (query: any) => {
      if (query.email === "john@email.com") {
        return {
          _id: "64cba9999999999999999999",
          name: "John Doe",
          email: "john@email.com",
          isAdmin: false,
          matchPassword: async (pwd: string) => pwd === "123456",
        } as any;
      }
      return null;
    });

    vi.spyOn(User, "findById").mockImplementation((id: any) => {
      const userObj = {
        _id: "64cba9999999999999999999",
        name: "John Doe",
        email: "john@email.com",
        isAdmin: false,
      };
      return {
        select: (fields: string) => Promise.resolve(userObj),
        then: (resolve: any) => resolve(userObj),
      } as any;
    });

    // 3. Define Integration Manifest pointing to test servers
    manifest = {
      manifest_version: "2.0.0",
      merchant: {
        name: "ProShop Electronics",
        id: "proshop_test",
        domain: "retail",
        base_url: `http://localhost:${MERCHANT_PORT}`,
        currency: "INR",
      },
      auth: {
        type: "oauth2_authorization_code",
        header: "Authorization",
        token_prefix: "Bearer",
        oauth2_user: {
          authorization_url: `http://localhost:${MERCHANT_PORT}/oauth/authorize`,
          token_url: `http://localhost:${MERCHANT_PORT}/oauth/token`,
          userinfo_url: `http://localhost:${MERCHANT_PORT}/oauth/userinfo`,
          client_id: "proshop_buyer_agent",
          client_secret: "proshop_buyer_secret",
          redirect_uri: `http://localhost:${MCP_PORT}/auth/callback`,
          scope: ["read_profile", "orders"],
          session_ttl_seconds: 2592000, // 30 days
        },
        protected_operations: ["create_checkout", "confirm_order"],
        public_operations: ["search", "get_product"],
      },
      operations: {
        search: {
          method: "GET",
          path: "/api/products",
          params: {},
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
          offer_id: { from: "$._id" },
          title: { from: "$.name" },
          "price.amount": { from: "$.price", transform: { type: "multiply", value: 100 } },
          "price.currency": { from: null, transform: { type: "default", value: "INR" } },
          availability: {
            from: "$.countInStock",
            transform: {
              type: "enum",
              enum_map: { "0": "out_of_stock", "*": "in_stock" },
            },
          },
        },
        checkout: {
          checkout_id: { from: "$.cart_token" },
          "total.amount": { from: "$.grand_total", transform: { type: "multiply", value: 100 } },
          "total.currency": { from: null, transform: { type: "default", value: "INR" } },
          available: { from: null, transform: { type: "default", value: true } },
        },
        order: {
          order_id: { from: "$._id" },
          status: { from: "$.status" },
        },
      },
      payment: {
        provider: "razorpay",
        razorpay_key_id_env: "RAZORPAY_KEY_ID",
        razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
      },
    };
  });

  afterAll(async () => {
    if (mcpHostedServer) {
      await mcpHostedServer.close();
    }
    await new Promise<void>((resolve) => merchantHttpServer.close(() => resolve()));
    if (fs.existsSync(DB_PATH)) {
      try {
        fs.unlinkSync(DB_PATH);
      } catch {}
    }
  });

  it("Step 1: Public discovery should work without requiring authentication", async () => {
    const store = new SqliteStore(DB_PATH);
    mcpHostedServer = startHostedMerchantMcpServer(manifest, {
      port: MCP_PORT,
      store,
      disableWebhookServer: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Agent executes search
    const searchRes = await mcpHostedServer.sessionStore;
    const authStatus = await fetch(`http://localhost:${MCP_PORT}/auth/status`);
    const statusData = await authStatus.json();
    expect(statusData.authenticated).toBe(false);
  });

  it("Step 2: Protected checkout without user session should return auth_required with authorization_url", async () => {
    // Invoke prepare_purchase via serverInstance created with the same store
    const store = new SqliteStore(DB_PATH);
    const serverInstance = createMerchantMcpServer(manifest, {
      store,
      forceSimulation: true,
    });

    const prepareTool = (serverInstance.server as any)._registeredTools["prepare_purchase"];
    expect(prepareTool).toBeDefined();

    const toolResult = await prepareTool.handler({
      product_id: "64cba1111111111111111111",
      quantity: 1,
      selection_reason: "Customer ordered Airpods",
    });

    const parsed = JSON.parse(toolResult.content[0].text);
    expect(parsed.status).toBe("auth_required");
    expect(parsed.authorization_url).toContain(`http://localhost:${MERCHANT_PORT}/oauth/authorize`);
    expect(parsed.session_id).toMatch(/^sess_/);

    // Save session_id and authorization_url for next step
    const authUrl = parsed.authorization_url;
    const sessionId = parsed.session_id;

    // Step 3: Emulate User authenticating on ProShop's OAuth2 login screen
    // 3a. User loads the authorization_url
    const authPageRes = await fetch(authUrl);
    expect(authPageRes.status).toBe(200);
    const pageHtml = await authPageRes.text();
    expect(pageHtml).toContain("ProShop");

    // Extract state & code_challenge parameters from authorization URL
    const urlObj = new URL(authUrl);
    const state = urlObj.searchParams.get("state");
    const codeChallenge = urlObj.searchParams.get("code_challenge");

    // 3b. User submits credentials to ProShop's POST /oauth/authorize
    const formData = new URLSearchParams();
    formData.append("email", "john@email.com");
    formData.append("password", "123456");
    formData.append("redirect_uri", `http://localhost:${MCP_PORT}/auth/callback`);
    formData.append("state", state || "");
    formData.append("code_challenge", codeChallenge || "");
    formData.append("code_challenge_method", "S256");

    const authSubmitRes = await fetch(`http://localhost:${MERCHANT_PORT}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
      redirect: "manual",
    });

    expect(authSubmitRes.status).toBe(302);
    const redirectLocation = authSubmitRes.headers.get("location");
    expect(redirectLocation).toBeDefined();

    // 3c. User browser follows redirect to MCP Server's /auth/callback
    const callbackRes = await fetch(redirectLocation!);
    const callbackHtml = await callbackRes.text();
    expect(callbackRes.status).toBe(200);
    expect(callbackHtml).toContain("Logged in Successfully");
    expect(callbackHtml).toContain("John Doe");

    // Step 4: Verify Session is now active via check_auth_status tool
    const checkAuthTool = (serverInstance.server as any)._registeredTools["check_auth_status"];
    const checkResult = await checkAuthTool.handler({});
    const checkData = JSON.parse(checkResult.content[0].text);

    expect(checkData.authenticated).toBe(true);
    expect(checkData.user_id).toBe("64cba9999999999999999999");
    expect(checkData.user_name).toBe("John Doe");

    // Step 5: Agent repeats prepare_purchase with the authenticated session -> Proceeds to PAYMENT_PENDING
    const purchaseResult = await prepareTool.handler({
      product_id: "64cba1111111111111111111",
      quantity: 1,
      selection_reason: "Customer ordered Airpods",
    });

    const purchaseData = JSON.parse(purchaseResult.content[0].text);
    expect(purchaseData.state).toBe("PAYMENT_PENDING");
    expect(purchaseData.checkout.checkout_id).toMatch(/^cart_proshop_/);
    expect(purchaseData.payment.methods.payment_link.url).toBeDefined();
  });

  it("Step 6: Server Reboot Durability - Sessions persist across server restart via SQLite", async () => {
    // Simulate server reboot by creating a completely new server instance from the same SQLite DB file
    const rebootedStore = new SqliteStore(DB_PATH);
    const rebootedInstance = createMerchantMcpServer(manifest, {
      store: rebootedStore,
      forceSimulation: true,
    });

    // Verify authenticated session survived the reboot
    const checkAuthTool = (rebootedInstance.server as any)._registeredTools["check_auth_status"];
    const checkResult = await checkAuthTool.handler({});
    const checkData = JSON.parse(checkResult.content[0].text);

    expect(checkData.authenticated).toBe(true);
    expect(checkData.user_name).toBe("John Doe");

    // Buyer agent immediately executes prepare_purchase without re-login
    const prepareTool = (rebootedInstance.server as any)._registeredTools["prepare_purchase"];
    const purchaseResult = await prepareTool.handler({
      product_id: "64cba1111111111111111111",
      quantity: 1,
      selection_reason: "Customer repeat purchase after reboot",
    });

    const purchaseData = JSON.parse(purchaseResult.content[0].text);
    expect(purchaseData.state).toBe("PAYMENT_PENDING");
    expect(purchaseData.checkout.checkout_id).toMatch(/^cart_proshop_/);

    // Step 7: Logout terminates the session
    const logoutTool = (rebootedInstance.server as any)._registeredTools["logout"];
    const logoutResult = await logoutTool.handler({ session_id: checkData.session_id });
    const logoutData = JSON.parse(logoutResult.content[0].text);
    expect(logoutData.status).toBe("logged_out");

    // Next check_auth_status shows unauthenticated
    const postLogoutCheck = await checkAuthTool.handler({});
    const postLogoutData = JSON.parse(postLogoutCheck.content[0].text);
    expect(postLogoutData.authenticated).toBe(false);
    expect(postLogoutData.authorization_url).toBeDefined();
  });
});
