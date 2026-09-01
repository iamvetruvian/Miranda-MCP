/**
 * UCP Protocol Alignment Integration Tests
 * Verifies GET /.well-known/ucp capability advertisement endpoint
 * and UCP envelope projection in hosted server workflows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { Server } from "http";
import path from "path";
import fs from "fs";
import os from "os";
import { startHostedMerchantMcpServer } from "../../src/server-sse.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

describe("UCP Protocol Integration Tests (Hosted Server)", () => {
  let mockMerchantServer: Server;
  const mockPort = 4088;
  const hostedServerPort = 4089;
  let sseServer: ReturnType<typeof startHostedMerchantMcpServer>;
  let tmpDir: string;
  let dbPath: string;

  const manifest: IntegrationManifest = {
    merchant: {
      name: "UcpElectronics",
      description: "UCP Compatible Store",
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
      cancel_order: { method: "POST", path: "/api/orders/:order_id/cancel" },
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
    refinements: {
      brand: { field: "brand", type: "enum" },
    },
    payment: {
      provider: "razorpay",
      razorpay_key_id_env: "TEST_KEY_ID",
      razorpay_key_secret_env: "TEST_KEY_SECRET",
    },
  };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ucp-"));
    dbPath = path.join(tmpDir, "ucp.db");

    const mockApp = express();
    mockApp.use(express.json());

    mockApp.get("/api/products", (_req, res) => {
      res.json([{ id: "item_1", name: "Tablet", price: { amount: 1500000, currency: "INR" }, stock: "in_stock" }]);
    });

    await new Promise<void>((resolve) => {
      mockMerchantServer = mockApp.listen(mockPort, () => resolve());
    });

    sseServer = startHostedMerchantMcpServer(manifest, {
      port: hostedServerPort,
      dbPath,
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

  it("should serve GET /.well-known/ucp returning capability profile matching UCP 2026-01-11 spec", async () => {
    const res = await fetch(`http://localhost:${hostedServerPort}/.well-known/ucp`);
    expect(res.status).toBe(200);

    const profile = (await res.json()) as any;
    expect(profile.ucp_version).toBe("2026-01-11");
    expect(profile.profile.merchant.name).toBe("UcpElectronics");
    expect(profile.profile.merchant.commerce_domain).toBe("retail");
    expect(profile.profile.integration_level).toBe("fully_manageable");

    const caps = profile.profile.capabilities;
    expect(caps.some((c: any) => c.capability === "shopping.checkout" && c.status === "supported")).toBe(true);
    expect(caps.some((c: any) => c.capability === "shopping.order" && c.status === "supported")).toBe(true);
    expect(caps.some((c: any) => c.capability === "payment.refunds" && c.status === "supported")).toBe(true);

    expect(profile.profile.extensions.refinements).toBe("com.merchantmcp.refinements.v1");
    expect(profile.profile.extensions.mandates).toBe("com.merchantmcp.mandates.v1");
  });
});
