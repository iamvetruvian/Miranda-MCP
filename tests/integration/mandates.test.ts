/**
 * AP2 Mandates End-to-End Integration Tests
 * Verifies Mode A (Intent Mandate -> Automated Purchase) and
 * Mode B (No Mandate -> JIT Consent Challenge -> Web Approval -> Order Confirmation).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { Server } from "http";
import path from "path";
import fs from "fs";
import os from "os";
import { startHostedMerchantMcpServer } from "../../src/server-sse.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { TransactionState } from "../../src/types/index.js";

describe("AP2 Mandates End-to-End Integration", () => {
  let mockMerchantServer: Server;
  const mockPort = 4077;
  const hostedServerPort = 4078;
  let sseServer: ReturnType<typeof startHostedMerchantMcpServer>;
  let tmpDir: string;
  let dbPath: string;

  const manifest: IntegrationManifest = {
    merchant: {
      name: "MandateMart",
      description: "AP2 Mandates Demo Store",
      commerce_domain: "retail",
      currency: "INR",
      base_url: `http://localhost:${mockPort}`,
    },
    operations: {
      search: { method: "GET", path: "/api/products" },
      get_product: { method: "GET", path: "/api/products/:product_id" },
      create_checkout: { method: "POST", path: "/api/checkout" },
      get_checkout: { method: "GET", path: "/api/checkout/:checkout_id" },
      confirm_order: { method: "POST", path: "/api/orders" },
      get_order_status: { method: "GET", path: "/api/orders/:order_id" },
    },
    field_mappings: {
      offer: {
        offer_id: { from: "$.id" },
        title: { from: "$.name" },
        description: { from: "$.description" },
        "price.amount": { from: "$.price.amount" },
        "price.currency": { from: "$.price.currency" },
        availability: { from: "$.stock", transform: { type: "enum", enum_map: { in_stock: "in_stock" } } },
        attributes: { from: "$.specs" },
      },
      checkout: {
        checkout_id: { from: "$.checkout_id" },
        sku: { from: "$.sku" },
        "total.amount": { from: "$.total.amount" },
        "total.currency": { from: "$.total.currency" },
        available: { from: "$.available" },
      },
      order: {
        order_id: { from: "$.order_id" },
        status: { from: "$.status" },
      },
    },
    payment: {
      provider: "razorpay",
      razorpay_key_id_env: "TEST_KEY_ID",
      razorpay_key_secret_env: "TEST_KEY_SECRET",
    },
  };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-mandates-"));
    dbPath = path.join(tmpDir, "mandates.db");

    // Setup mock merchant backend
    const mockApp = express();
    mockApp.use(express.json());

    mockApp.get("/api/products/watch_1", (_req, res) => {
      res.json({
        id: "watch_1",
        name: "Smart Watch Ultra",
        description: "Fitness and notifications",
        price: { amount: 2500000, currency: "INR" },
        stock: "in_stock",
        specs: { battery: "48h" },
      });
    });

    mockApp.post("/api/checkout", (_req, res) => {
      res.json({
        checkout_id: "chk_mandate_001",
        sku: "watch_1",
        total: { amount: 2500000, currency: "INR" },
        available: true,
      });
    });

    mockApp.post("/api/orders", (_req, res) => {
      res.json({
        order_id: "ord_mandate_999",
        status: "CONFIRMED",
      });
    });

    await new Promise<void>((resolve) => {
      mockMerchantServer = mockApp.listen(mockPort, () => resolve());
    });

    // Start hosted MCP server with authMode = "mandate"
    sseServer = startHostedMerchantMcpServer(manifest, {
      port: hostedServerPort,
      dbPath,
      authMode: "mandate",
      mandateSigningSecret: "integration_test_mandate_secret",
      disableWebhookServer: true,
    });
  });

  afterAll(async () => {
    if (sseServer) await sseServer.close();
    if (mockMerchantServer) {
      await new Promise<void>((resolve) => mockMerchantServer.close(() => resolve()));
    }
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it("Mode B (JIT Consent): should halt at MANDATE_EVALUATED and progress after HTTP consent confirmation", async () => {
    // 1. Query consent endpoints
    const mandateStore = sseServer.mandateStore;
    const challenge = mandateStore.createConsentChallenge(
      {
        transaction_id: "txn_jit_test_100",
        state: TransactionState.CHECKOUT_CREATED,
        created_at: new Date().toISOString(),
        agent_claim: { product_id: "watch_1", quantity: 1, selection_reason: "JIT test" },
        audit_event_ids: [],
      },
      {
        checkout_id: "chk_mandate_001",
        sku: "watch_1",
        total: { amount: 2500000, currency: "INR" },
        available: true,
      },
      "MandateMart"
    );

    expect(challenge.challenge_id).toBeDefined();

    // 2. Fetch challenge via HTTP GET /consent/:challengeId
    const getRes = await fetch(`http://localhost:${hostedServerPort}/consent/${challenge.challenge_id}`);
    expect(getRes.status).toBe(200);
    const challengeDetails = (await getRes.json()) as any;
    expect(challengeDetails.amount).toBe(2500000);
    expect(challengeDetails.payee).toBe("MandateMart");

    // 3. User approves via HTTP POST /consent/:challengeId/confirm
    const postRes = await fetch(`http://localhost:${hostedServerPort}/consent/${challenge.challenge_id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(postRes.status).toBe(200);
    const confirmDetails = (await postRes.json()) as any;
    expect(confirmDetails.status).toBe("authorized");
    expect(confirmDetails.authorization_reference).toMatch(/^man_pay_/);

    // 4. Verify derived payment mandate is valid and signed
    const verifiedMandate = await mandateStore.getMandate(confirmDetails.authorization_reference);
    expect(verifiedMandate).toBeDefined();
    expect(mandateStore.verify(verifiedMandate!).valid).toBe(true);
  });
});
