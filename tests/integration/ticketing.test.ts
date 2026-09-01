import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import { createTicketingApp } from "../../demo/merchants/ticketing/server.js";
import { createMerchantMcpServer } from "../../src/server.js";
import { BuyerAgent } from "../../demo/buyer-agent/agent.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { TransactionState } from "../../src/types/index.js";

describe("TicketVerse Non-Retail Cinema Ticketing E2E Lifecycle", () => {
  let ticketServer: http.Server;
  const TICKET_PORT = 4004;
  let manifest: IntegrationManifest;
  let agent: BuyerAgent;
  let serverInstance: ReturnType<typeof createMerchantMcpServer>;

  beforeAll(async () => {
    ticketServer = createTicketingApp().listen(TICKET_PORT);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const manifestPath = path.resolve(process.cwd(), "demo/merchants/ticketing/merchant-config.json");
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.merchant.base_url = `http://localhost:${TICKET_PORT}`;

    serverInstance = createMerchantMcpServer(manifest, undefined, true);
    agent = new BuyerAgent(serverInstance);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => ticketServer.close(() => resolve()));
  });

  it("should discover merchant info, domain schema, and dynamic facets", async () => {
    const info = await agent.getMerchantInfo();

    expect(info.name).toBe("TicketVerse");
    expect(info.commerce_domain).toBe("ticketing");
    expect(info.currency).toBe("INR");
    expect(info.integration_level).toBe("fully_manageable");
    expect(info.capabilities.refund).toBe(true);
    expect(info.capabilities.cancel).toBe(true);
    expect(info.discovery_schema).toBeDefined();
    expect(info.discovery_schema?.some((s) => s.name === "city" && s.required)).toBe(true);
    expect(info.discovery_schema?.some((s) => s.name === "date" && s.required)).toBe(true);
  });

  it("should execute parameterized discovery and retrieve ephemeral quotes", async () => {
    const searchRes = await agent.search("Avengers", undefined, {
      city: "Mumbai",
      date: "2026-09-01",
    });

    expect(searchRes.offers.length).toBeGreaterThanOrEqual(2);
    expect(searchRes.refinements.length).toBe(2);

    const imax = searchRes.offers.find((o) => o.attributes.format === "IMAX 2D");
    expect(imax).toBeDefined();
    expect(imax?.price.amount).toBe(85000); // 850 INR
    expect(imax?.expires_at).toBeDefined();
  });

  it("should complete booking purchase, confirm order with PNR, and process full refund", async () => {
    // 1. Purchase flow
    const purchase = await agent.executePurchase({
      query: "Avengers",
      parameters: { city: "Mumbai", date: "2026-09-01" },
      filters: { format: "IMAX 2D" },
      selection_reason: "User booked prime IMAX showtime in Mumbai",
      autoSimulatePayment: true,
    });

    expect(purchase.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(purchase.order_id).toMatch(/^TKT-PNR-/);
    expect(purchase.hash_chain_valid).toBe(true);

    // 2. Refund flow
    const refund = await agent.requestRefund(purchase.transaction_id, undefined, "User cancellation");
    expect(refund.state).toBe(TransactionState.REFUNDED);
    expect(refund.refund_id).toMatch(/^rfnd_/);
    expect(refund.refunded_amount).toBe(85000);

    // 3. Verify final audit chain & Decision Receipt
    const txn = serverInstance.txnManager.get(purchase.transaction_id);
    expect(txn.state).toBe(TransactionState.REFUNDED);
    expect(txn.payment?.refunded_amount).toBe(85000);

    const events = serverInstance.auditLedger.getTransactionAudit(purchase.transaction_id);
    expect(events.some((e) => e.event_type === "REFUND_PROCESSED")).toBe(true);

    const chainValid = serverInstance.auditLedger.verifyChain(purchase.transaction_id).valid;
    expect(chainValid).toBe(true);
  });
});
