/**
 * Marketplace Gateway Unit Tests
 * Tests federated multi-merchant discovery, failure isolation, offer tagging,
 * and credential-isolated proxying.
 */

import { describe, it, expect, vi } from "vitest";
import { MarketplaceGateway } from "../../src/marketplace/gateway.js";
import { MarketplaceConfig } from "../../src/marketplace/types.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

const sampleMarketplaceConfig: MarketplaceConfig = {
  name: "TestMarketplace",
  description: "Federated marketplace gateway",
  merchants: [
    {
      merchant_id: "tech_store",
      name: "TechStore",
      description: "Electronics Store",
      commerce_domain: "retail",
      currency: "INR",
      endpoint: "http://localhost:4001",
      enabled: true,
    },
    {
      merchant_id: "book_store",
      name: "BookStore",
      description: "Books and novels",
      commerce_domain: "retail",
      currency: "INR",
      endpoint: "http://localhost:4002",
      enabled: true,
    },
    {
      merchant_id: "disabled_store",
      name: "DisabledStore",
      description: "Inactive store",
      commerce_domain: "retail",
      currency: "INR",
      endpoint: "http://localhost:4003",
      enabled: false,
    },
  ],
};

function createMockConnector(merchantName: string, items: any[]) {
  const manifest: IntegrationManifest = {
    merchant: {
      name: merchantName,
      description: `${merchantName} description`,
      commerce_domain: "retail",
      currency: "INR",
      base_url: "http://localhost:4000",
    },
    operations: {
      search: { method: "GET", path: "/items" },
      get_product: { method: "GET", path: "/items/:product_id" },
      create_checkout: { method: "POST", path: "/checkout" },
      confirm_order: { method: "POST", path: "/orders" },
      get_order_status: { method: "GET", path: "/orders/:order_id" },
    },
    field_mappings: {
      offer: {
        offer_id: { from: "$.id" },
        title: { from: "$.title" },
        "price.amount": { from: "$.price" },
      },
      checkout: {
        checkout_id: { from: "$.id" },
        "total.amount": { from: "$.total" },
      },
      order: {
        order_id: { from: "$.id" },
        status: { from: "$.status" },
      },
    },
  };

  const connector = new ConnectorRuntime(manifest);

  vi.spyOn(connector, "search").mockResolvedValue({
    search_id: "srch_mock",
    offers: items.map((i) => ({
      offer_id: i.id,
      title: i.title,
      description: i.desc ?? "",
      price: { amount: i.price, currency: "INR" },
      availability: "in_stock",
      attributes: i.attributes ?? {},
    })),
    total_results: items.length,
    refinements: [
      {
        key: "category",
        label: "Category",
        options: [{ value: "electronics", label: "Electronics", count: items.length }],
      },
    ],
    page_info: { page: 1, page_size: 20, has_more: false },
  });

  vi.spyOn(connector, "getProduct").mockImplementation(async (id) => {
    const item = items.find((i) => i.id === id) ?? items[0];
    return {
      offer_id: item.id,
      title: item.title,
      description: "",
      price: { amount: item.price, currency: "INR" },
      availability: "in_stock",
      attributes: {},
    };
  });

  vi.spyOn(connector, "createCheckout").mockImplementation(async (productId, quantity) => {
    return {
      checkout_id: `chk_${productId}_${Date.now()}`,
      sku: productId,
      unit_price: { amount: 10000, currency: "INR" },
      total: { amount: 10000 * quantity, currency: "INR" },
      available: true,
    };
  });

  return connector;
}

describe("MarketplaceGateway", () => {
  it("should list active enabled merchants only", () => {
    const gateway = new MarketplaceGateway(sampleMarketplaceConfig);
    const active = gateway.listMerchants();
    expect(active.length).toBe(2);
    expect(active.some((m) => m.merchant_id === "disabled_store")).toBe(false);
  });

  it("should fan out search across merchants in parallel, tag offers, and namespace refinements", async () => {
    const gateway = new MarketplaceGateway(sampleMarketplaceConfig);

    const techConnector = createMockConnector("TechStore", [
      { id: "tech_1", title: "Laptop Pro", price: 8000000 },
      { id: "tech_2", title: "Wireless Mouse", price: 200000 },
    ]);
    const bookConnector = createMockConnector("BookStore", [
      { id: "book_1", title: "Sci-Fi Novel", price: 50000 },
    ]);

    gateway.registerConnector("tech_store", techConnector);
    gateway.registerConnector("book_store", bookConnector);

    const result = await gateway.search({ query: "deals", sort: "price_asc" });

    expect(result.total_results).toBe(3);
    expect(result.offers.length).toBe(3);
    expect(result.merchants_queried).toEqual(["tech_store", "book_store"]);

    // Price asc sorting
    expect(result.offers[0].offer_id).toBe("book_1");
    expect(result.offers[0].merchant_id).toBe("book_store");
    expect(result.offers[0].merchant_name).toBe("BookStore");

    expect(result.offers[1].offer_id).toBe("tech_2");
    expect(result.offers[1].merchant_id).toBe("tech_store");

    expect(result.offers[2].offer_id).toBe("tech_1");
    expect(result.offers[2].merchant_id).toBe("tech_store");

    // Namespaced refinements
    expect(result.refinements.some((r) => r.key === "tech_store:category")).toBe(true);
    expect(result.refinements.some((r) => r.key === "book_store:category")).toBe(true);
  });

  it("should isolate merchant search failure and still return results from healthy merchants", async () => {
    const gateway = new MarketplaceGateway(sampleMarketplaceConfig);

    const techConnector = createMockConnector("TechStore", [
      { id: "tech_1", title: "Laptop Pro", price: 8000000 },
    ]);
    const bookConnector = createMockConnector("BookStore", []);
    vi.spyOn(bookConnector, "search").mockRejectedValue(new Error("Database connection timed out"));

    gateway.registerConnector("tech_store", techConnector);
    gateway.registerConnector("book_store", bookConnector);

    const result = await gateway.search({ query: "deals" });

    expect(result.total_results).toBe(1);
    expect(result.offers[0].offer_id).toBe("tech_1");
    expect(result.merchants_failed).toEqual(["book_store"]);
  });

  it("should route checkout creation directly to the selected merchant connector", async () => {
    const gateway = new MarketplaceGateway(sampleMarketplaceConfig);
    const techConnector = createMockConnector("TechStore", [
      { id: "tech_1", title: "Laptop Pro", price: 8000000 },
    ]);
    gateway.registerConnector("tech_store", techConnector);

    const checkout = await gateway.createCheckout("tech_store", "tech_1", 2);
    expect(checkout.merchant_id).toBe("tech_store");
    expect(checkout.merchant_name).toBe("TechStore");
    expect(checkout.sku).toBe("tech_1");
    expect(checkout.total.amount).toBe(20000);
  });

  it("should throw clear error if target merchant is not connected", async () => {
    const gateway = new MarketplaceGateway(sampleMarketplaceConfig);
    await expect(gateway.getProduct("unknown_store", "sku_1")).rejects.toThrow(
      /is not connected to this marketplace gateway/
    );
  });
});
