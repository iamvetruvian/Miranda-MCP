/**
 * Intent & Discovery Expansion Unit Tests
 * Tests browse_categories tool, autocomplete tool, manifest-driven sort_options,
 * and enriched get_merchant_info metadata.
 */

import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

function createMockServer() {
  const tools = new Map<string, { description: string; schema: any; handler: Function }>();
  const server = {
    tool: (name: string, description: string, schema: any, handler: Function) => {
      tools.set(name, { description, schema, handler });
    },
  } as unknown as McpServer;

  return { server, tools };
}

describe("Component 3: Intent & Discovery Expansion", () => {
  it("should execute browse_categories and return category tree hierarchy", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "FashionHub",
        description: "Apparel store",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.fashionhub.local",
      },
      intent: {
        primary_mode: "browse",
        category_tree: {
          operation: { method: "GET", path: "/categories" },
          categories_path: "$.data.categories",
          category_mapping: {
            id_path: "$.cat_id",
            name_path: "$.display_name",
            product_count_path: "$.item_count",
          },
          usable_as_filter: true,
          filter_key: "department",
        },
      },
      operations: {
        search: { method: "GET", path: "/search" },
        get_product: { method: "GET", path: "/items/:product_id" },
        create_checkout: { method: "POST", path: "/cart" },
        confirm_order: { method: "POST", path: "/orders" },
        get_order_status: { method: "GET", path: "/orders/:order_id" },
      },
      field_mappings: {
        offer: {
          offer_id: { from: "$.id" },
          title: { from: "$.name" },
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
    vi.spyOn(connector, "executeOperationFromConfig").mockResolvedValue({
      data: {
        categories: [
          { cat_id: "men", display_name: "Men's Apparel", item_count: 140 },
          { cat_id: "women", display_name: "Women's Apparel", item_count: 220 },
        ],
      },
    });

    const auditLedger = new AuditLedger();
    const { server, tools } = createMockServer();
    registerDiscoveryTools(server, connector, manifest, auditLedger);

    const browseTool = tools.get("browse_categories")!;
    expect(browseTool).toBeDefined();

    const response = await browseTool.handler({});
    expect(response.isError).toBeUndefined();

    const payload = JSON.parse(response.content[0].text);
    expect(payload.categories.length).toBe(2);
    expect(payload.categories[0]).toEqual({
      id: "men",
      name: "Men's Apparel",
      product_count: 140,
    });
    expect(payload.filter_key).toBe("department");
  });

  it("should return friendly error when browse_categories is called on a merchant without category_tree", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "SimpleStore",
        description: "Simple store",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.simplestore.local",
      },
      operations: {
        search: { method: "GET", path: "/search" },
        get_product: { method: "GET", path: "/items/:product_id" },
        create_checkout: { method: "POST", path: "/cart" },
        confirm_order: { method: "POST", path: "/orders" },
        get_order_status: { method: "GET", path: "/orders/:order_id" },
      },
      field_mappings: {
        offer: { offer_id: { from: "$.id" }, title: { from: "$.name" }, "price.amount": { from: "$.price" } },
        checkout: { checkout_id: { from: "$.id" }, "total.amount": { from: "$.total" } },
        order: { order_id: { from: "$.id" }, status: { from: "$.status" } },
      },
    };

    const connector = new ConnectorRuntime(manifest);
    const auditLedger = new AuditLedger();
    const { server, tools } = createMockServer();
    registerDiscoveryTools(server, connector, manifest, auditLedger);

    const browseTool = tools.get("browse_categories")!;
    const response = await browseTool.handler({});
    expect(response.isError).toBe(true);
    const payload = JSON.parse(response.content[0].text);
    expect(payload.error).toContain("does not support category browsing");
    expect(payload.suggestion).toContain("search_products");
  });

  it("should execute autocomplete when min_chars met and return typeahead suggestions", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "AutoStore",
        description: "Store with typeahead",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.autostore.local",
      },
      intent: {
        autocomplete: {
          operation: { method: "GET", path: "/suggest" },
          min_chars: 3,
          suggestions_path: "$.results",
          suggestion_mapping: {
            text_path: "$.keyword",
            type_path: "$.scope",
          },
        },
      },
      operations: {
        search: { method: "GET", path: "/search" },
        get_product: { method: "GET", path: "/items/:product_id" },
        create_checkout: { method: "POST", path: "/cart" },
        confirm_order: { method: "POST", path: "/orders" },
        get_order_status: { method: "GET", path: "/orders/:order_id" },
      },
      field_mappings: {
        offer: { offer_id: { from: "$.id" }, title: { from: "$.name" }, "price.amount": { from: "$.price" } },
        checkout: { checkout_id: { from: "$.id" }, "total.amount": { from: "$.total" } },
        order: { order_id: { from: "$.id" }, status: { from: "$.status" } },
      },
    };

    const connector = new ConnectorRuntime(manifest);
    vi.spyOn(connector, "executeOperationFromConfig").mockResolvedValue({
      results: [
        { keyword: "macbook air m3", scope: "product" },
        { keyword: "macbook pro 14", scope: "product" },
      ],
    });

    const auditLedger = new AuditLedger();
    const { server, tools } = createMockServer();
    registerDiscoveryTools(server, connector, manifest, auditLedger);

    const autocompleteTool = tools.get("autocomplete")!;

    // Below min_chars
    const shortRes = await autocompleteTool.handler({ query: "ma" });
    expect(JSON.parse(shortRes.content[0].text).suggestions).toEqual([]);

    // At/above min_chars
    const fullRes = await autocompleteTool.handler({ query: "mac" });
    const payload = JSON.parse(fullRes.content[0].text);
    expect(payload.suggestions.length).toBe(2);
    expect(payload.suggestions[0]).toEqual({ text: "macbook air m3", type: "product" });
  });

  it("should expose intent_mode, sort_options, and attribute_catalog in get_merchant_info", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "FullDiscoveryStore",
        description: "Full store",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.fulldiscovery.local",
      },
      intent: {
        primary_mode: "location_first",
        constraints: { requires_pincode: true },
      },
      sort_options: {
        sort_param: "order_by",
        options: [
          { key: "cheapest", label: "Lowest Price", merchant_value: "price_asc" },
          { key: "popular", label: "Most Popular", merchant_value: "pop_desc" },
        ],
      },
      attribute_catalog: {
        attributes: [
          { key: "brand", label: "Brand", type: "enum", filterable: true, sortable: false, enum_values: ["Apple", "Dell"] },
        ],
      },
      operations: {
        search: { method: "GET", path: "/search" },
        get_product: { method: "GET", path: "/items/:product_id" },
        create_checkout: { method: "POST", path: "/cart" },
        confirm_order: { method: "POST", path: "/orders" },
        get_order_status: { method: "GET", path: "/orders/:order_id" },
      },
      field_mappings: {
        offer: { offer_id: { from: "$.id" }, title: { from: "$.name" }, "price.amount": { from: "$.price" } },
        checkout: { checkout_id: { from: "$.id" }, "total.amount": { from: "$.total" } },
        order: { order_id: { from: "$.id" }, status: { from: "$.status" } },
      },
    };

    const connector = new ConnectorRuntime(manifest);
    const auditLedger = new AuditLedger();
    const { server, tools } = createMockServer();
    registerDiscoveryTools(server, connector, manifest, auditLedger);

    const infoTool = tools.get("get_merchant_info")!;
    const response = await infoTool.handler({});
    const payload = JSON.parse(response.content[0].text);

    expect(payload.intent_mode).toBe("location_first");
    expect(payload.sort_options).toEqual([
      { key: "cheapest", label: "Lowest Price" },
      { key: "popular", label: "Most Popular" },
    ]);
    expect(payload.attribute_catalog.length).toBe(1);
    expect(payload.attribute_catalog[0].key).toBe("brand");
    expect(payload.constraints).toEqual({ requires_pincode: true });
  });
});
