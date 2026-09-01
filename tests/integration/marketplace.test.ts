/**
 * Marketplace Gateway Integration Tests
 * Tests live multi-merchant discovery and purchase execution across
 * TechBazaar, PageTurner, and TicketVerse.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import { startTechBazaarServer } from "../../demo/merchants/electronics-store/server.js";
import { startBookstoreServer } from "../../demo/merchants/bookstore/server.js";
import { createTicketingApp } from "../../demo/merchants/ticketing/server.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { MarketplaceGateway } from "../../src/marketplace/gateway.js";
import { MarketplaceConfig } from "../../src/marketplace/types.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

describe("Marketplace Gateway Live Integration", () => {
  let techServer: http.Server;
  let bookServer: http.Server;
  let ticketServer: http.Server;
  let gateway: MarketplaceGateway;

  const TECH_PORT = 4101;
  const BOOK_PORT = 4102;
  const TICKET_PORT = 4103;

  beforeAll(async () => {
    techServer = startTechBazaarServer(TECH_PORT);
    bookServer = startBookstoreServer(BOOK_PORT);
    ticketServer = createTicketingApp().listen(TICKET_PORT);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Load manifests and rewrite base_urls to test ports
    const techManifest: IntegrationManifest = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "demo/merchants/electronics-store/merchant-config.json"), "utf-8")
    );
    techManifest.merchant.base_url = `http://localhost:${TECH_PORT}`;

    const bookManifest: IntegrationManifest = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "demo/merchants/bookstore/merchant-config.json"), "utf-8")
    );
    bookManifest.merchant.base_url = `http://localhost:${BOOK_PORT}`;

    const ticketManifest: IntegrationManifest = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "demo/merchants/ticketing/merchant-config.json"), "utf-8")
    );
    ticketManifest.merchant.base_url = `http://localhost:${TICKET_PORT}`;

    const mktConfig: MarketplaceConfig = {
      name: "LiveOmniMarketplace",
      description: "Live multi-merchant test marketplace",
      merchants: [
        {
          merchant_id: "techbazaar",
          name: "TechBazaar",
          description: "Electronics Store",
          commerce_domain: "retail",
          currency: "INR",
          endpoint: `http://localhost:${TECH_PORT}`,
          enabled: true,
        },
        {
          merchant_id: "pageturner",
          name: "PageTurner",
          description: "Bookstore",
          commerce_domain: "retail",
          currency: "INR",
          endpoint: `http://localhost:${BOOK_PORT}`,
          enabled: true,
        },
        {
          merchant_id: "ticketverse",
          name: "TicketVerse",
          description: "Multiplex Ticketing",
          commerce_domain: "ticketing",
          currency: "INR",
          endpoint: `http://localhost:${TICKET_PORT}`,
          enabled: true,
        },
      ],
    };

    gateway = new MarketplaceGateway(mktConfig);
    gateway.registerConnector("techbazaar", new ConnectorRuntime(techManifest));
    gateway.registerConnector("pageturner", new ConnectorRuntime(bookManifest));
    gateway.registerConnector("ticketverse", new ConnectorRuntime(ticketManifest));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => techServer.close(() => resolve()));
    await new Promise<void>((resolve) => bookServer.close(() => resolve()));
    await new Promise<void>((resolve) => ticketServer.close(() => resolve()));
  });

  it("should list all 3 live demo merchants", () => {
    const merchants = gateway.listMerchants();
    expect(merchants.length).toBe(3);
    expect(merchants.map((m) => m.merchant_id).sort()).toEqual(["pageturner", "techbazaar", "ticketverse"]);
  });

  it("should perform federated search across all 3 merchants and aggregate offers", async () => {
    const result = await gateway.search({ query: "", pageSize: 50 });

    expect(result.merchants_queried.length).toBe(3);
    expect(result.offers.length).toBeGreaterThanOrEqual(3);

    const merchantIdsInResults = new Set(result.offers.map((o) => o.merchant_id));
    expect(merchantIdsInResults.has("techbazaar")).toBe(true);
    expect(merchantIdsInResults.has("pageturner")).toBe(true);
    expect(merchantIdsInResults.has("ticketverse")).toBe(true);
  });

  it("should sort aggregated offers by price ascending across merchants", async () => {
    const result = await gateway.search({ query: "", sort: "price_asc", pageSize: 50 });

    for (let i = 1; i < result.offers.length; i++) {
      expect(result.offers[i].price.amount).toBeGreaterThanOrEqual(result.offers[i - 1].price.amount);
    }
  });

  it("should create checkout directly on PageTurner through the gateway façade", async () => {
    const bookSearch = await gateway.search({ query: "Pragmatic Programmer", merchant_id: "pageturner" });
    expect(bookSearch.offers.length).toBeGreaterThan(0);

    const target = bookSearch.offers[0];
    const checkout = await gateway.createCheckout("pageturner", target.offer_id, 1);

    expect(checkout.merchant_id).toBe("pageturner");
    expect(checkout.checkout_id).toBeDefined();
    expect(checkout.available).toBe(true);
    expect(checkout.total.amount).toBeGreaterThan(0);
  });
});
