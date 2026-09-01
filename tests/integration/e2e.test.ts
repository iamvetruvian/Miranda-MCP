import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import { startTechBazaarServer } from "../../demo/merchants/electronics-store/server.js";
import { startBookstoreServer } from "../../demo/merchants/bookstore/server.js";
import { createMerchantMcpServer } from "../../src/server.js";
import { BuyerAgent } from "../../demo/buyer-agent/agent.js";
import { TransactionState } from "../../src/types/index.js";

describe("End-to-End Buyer Agent Commerce Integration", () => {
  let techServer: http.Server;
  let bookServer: http.Server;
  const E2E_TECH_PORT = 4011;
  const E2E_BOOK_PORT = 4012;

  beforeAll(async () => {
    techServer = startTechBazaarServer(E2E_TECH_PORT);
    bookServer = startBookstoreServer(E2E_BOOK_PORT);
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => techServer.close(() => resolve()));
    await new Promise<void>((resolve) => bookServer.close(() => resolve()));
  });

  it("should discover dynamic facets and refine search iteratively on TechBazaar", async () => {
    const manifestPath = path.resolve(process.cwd(), "demo/merchants/electronics-store/merchant-config.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.merchant.base_url = `http://localhost:${E2E_TECH_PORT}`;

    const instance = createMerchantMcpServer(manifest, undefined, true);

    // Step 1: Initial broad search
    const initial = await instance.connector.search({ query: "laptop" });
    expect(initial.offers.length).toBeGreaterThanOrEqual(3);
    expect(initial.refinements.length).toBeGreaterThanOrEqual(2);

    const brandRefinement = initial.refinements.find((r) => r.key === "brand");
    expect(brandRefinement).toBeDefined();
    expect(brandRefinement?.options?.some((o) => o.value === "Lenovo")).toBe(true);

    // Step 2: Refined search with brand filter
    const refined = await instance.connector.search({
      query: "laptop",
      filters: { brand: "Lenovo" },
    });
    expect(refined.offers.every((o) => o.attributes.brand === "Lenovo")).toBe(true);
    expect(refined.refinements.find((r) => r.key === "brand")?.options).toEqual([
      { value: "Lenovo", label: "Lenovo", count: 2 },
    ]);
  });

  it("should complete an autonomous end-to-end purchase on TechBazaar with valid decision receipt", async () => {
    const manifestPath = path.resolve(process.cwd(), "demo/merchants/electronics-store/merchant-config.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.merchant.base_url = `http://localhost:${E2E_TECH_PORT}`;

    const instance = createMerchantMcpServer(manifest, undefined, true);
    const agent = new BuyerAgent(instance);

    const result = await agent.executePurchase({
      query: "IdeaPad",
      filters: { category: "laptop" },
      selection_reason: "Best matching laptop under budget ceiling",
      autoSimulatePayment: true,
    });

    expect(result.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(result.order_id).toMatch(/^TB-ORD-/);
    expect(result.hash_chain_valid).toBe(true);
    expect(result.decision_receipt).toContain("AI PURCHASE AUDIT RECEIPT");
    expect(result.decision_receipt).toContain("Lenovo IdeaPad");
    expect(result.decision_receipt).toContain("VALID (Verified SHA-256)");
  });

  it("should complete an autonomous end-to-end purchase on PageTurner Books", async () => {
    const manifestPath = path.resolve(process.cwd(), "demo/merchants/bookstore/merchant-config.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.merchant.base_url = `http://localhost:${E2E_BOOK_PORT}`;

    const instance = createMerchantMcpServer(manifest, undefined, true);
    const agent = new BuyerAgent(instance);

    const result = await agent.executePurchase({
      query: "Clean Code",
      selection_reason: "Requested programming literature",
      autoSimulatePayment: true,
    });

    expect(result.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(result.order_id).toMatch(/^PT-BOOK-ORD-/);
    expect(result.hash_chain_valid).toBe(true);
    expect(result.decision_receipt).toContain("Clean Code");
  });

  it("should gracefully handle out of stock items and produce a valid rejection audit record", async () => {
    const manifestPath = path.resolve(process.cwd(), "demo/merchants/electronics-store/merchant-config.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.merchant.base_url = `http://localhost:${E2E_TECH_PORT}`;

    const instance = createMerchantMcpServer(manifest, undefined, true);
    const agent = new BuyerAgent(instance);

    const result = await agent.executePurchase({
      query: "RTX 4090",
      selection_reason: "GPU requested",
      autoSimulatePayment: false,
    });

    expect(result.state).toBe(TransactionState.FAILED);
    expect(result.order_id).toBeUndefined();
    expect(result.hash_chain_valid).toBe(true);

    const auditEvents = instance.auditLedger.getTransactionAudit(result.transaction_id);
    expect(auditEvents.some((e) => e.event_type === "TRANSACTION_FAILED")).toBe(true);
  });
});
