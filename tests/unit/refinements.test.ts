import { describe, it, expect, vi, beforeEach } from "vitest";
import { RefinementExtractor } from "../../src/connector/refinements.js";
import { RefinementConfig, IntegrationManifest } from "../../src/types/manifest.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { registerRefinementTools, searchStates } from "../../src/tools/refinement.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuditEventType } from "../../src/types/index.js";

describe("RefinementExtractor", () => {
  const extractor = new RefinementExtractor();

  it("should extract refinements in static mode", async () => {
    const config: RefinementConfig = {
      mode: "static",
      static_filters: [
        {
          key: "genre",
          label: "Genre",
          type: "enum",
          options: [
            { value: "fiction", label: "Fiction", count: 12 },
            { value: "science", label: "Science", count: 8 },
          ],
        },
        {
          key: "price",
          label: "Price Range",
          type: "range",
          min: 100,
          max: 5000,
        },
      ],
    };

    const refinements = await extractor.extract(config, {}, []);
    expect(refinements).toHaveLength(2);
    expect(refinements[0].key).toBe("genre");
    expect(refinements[0].label).toBe("Genre");
    expect(refinements[0].type).toBe("enum");
    expect(refinements[0].options).toHaveLength(2);
    expect(refinements[0].options?.[0]).toEqual({ value: "fiction", label: "Fiction", count: 12 });
    expect(refinements[1].key).toBe("price");
    expect(refinements[1].min).toBe(100);
    expect(refinements[1].max).toBe(5000);
  });

  it("should extract dynamic refinements in search_response mode", async () => {
    const config: RefinementConfig = {
      mode: "search_response",
      refinements_path: "$.facets",
      refinement_schema: {
        key_path: "$.id",
        label_path: "$.displayName",
        type_path: "$.type",
        options_path: "$.bins",
        option_value_path: "$.value",
        option_label_path: "$.label",
        option_count_path: "$.count",
      },
    };

    const rawSearchResponse = {
      items: [{ id: "1", title: "Phone" }],
      facets: [
        {
          id: "brand",
          displayName: "Brand",
          type: "enum",
          bins: [
            { value: "apple", label: "Apple", count: 15 },
            { value: "samsung", label: "Samsung", count: 20 },
          ],
        },
        {
          id: "ram",
          displayName: "RAM Size",
          type: "enum",
          bins: [
            { value: "8gb", label: "8 GB", count: 10 },
            { value: "16gb", label: "16 GB", count: 25 },
          ],
        },
      ],
    };

    const refinements = await extractor.extract(config, rawSearchResponse, []);
    expect(refinements).toHaveLength(2);
    expect(refinements[0].key).toBe("brand");
    expect(refinements[0].label).toBe("Brand");
    expect(refinements[0].options).toHaveLength(2);
    expect(refinements[0].options?.[0]).toEqual({ value: "apple", label: "Apple", count: 15 });
    expect(refinements[1].key).toBe("ram");
    expect(refinements[1].options?.[1]).toEqual({ value: "16gb", label: "16 GB", count: 25 });
  });

  it("should extract refinements in separate_endpoint mode", async () => {
    const config: RefinementConfig = {
      mode: "separate_endpoint",
      refinements_path: "$.refinements",
      refinement_schema: {
        key_path: "$.facet_key",
        label_path: "$.facet_name",
        options_path: "$.values",
        option_value_path: "$.val",
        option_label_path: "$.display",
        option_count_path: "$.doc_count",
      },
      facet_operation: {
        method: "GET",
        path: "/api/facets",
      },
    };

    const mockExecutor = vi.fn().mockResolvedValue({
      refinements: [
        {
          facet_key: "color",
          facet_name: "Color",
          values: [
            { val: "black", display: "Black", doc_count: 50 },
            { val: "silver", display: "Silver", doc_count: 30 },
          ],
        },
      ],
    });

    const searchParams = { query: "laptop", page: 1 };
    const refinements = await extractor.extract(config, {}, [], mockExecutor, searchParams);

    expect(mockExecutor).toHaveBeenCalledTimes(1);
    expect(refinements).toHaveLength(1);
    expect(refinements[0].key).toBe("color");
    expect(refinements[0].options?.[0]).toEqual({ value: "black", label: "Black", count: 50 });
  });

  it("should derive facets from product attributes in derived mode", async () => {
    const config: RefinementConfig = {
      mode: "derived",
      derive_from_attributes: ["brand", "category"],
    };

    const products = [
      { id: "1", brand: "Lenovo", category: "laptop" },
      { id: "2", brand: "Dell", category: "laptop" },
      { id: "3", brand: "Lenovo", category: "tablet" },
      { id: "4", brand: "Apple", category: "phone" },
      { id: "5", brand: "Dell", category: "laptop" },
    ];

    const refinements = await extractor.extract(config, {}, products);
    expect(refinements).toHaveLength(2);

    const brandRefinement = refinements.find((r) => r.key === "brand");
    expect(brandRefinement).toBeDefined();
    expect(brandRefinement?.options).toEqual(
      expect.arrayContaining([
        { value: "Lenovo", label: "Lenovo", count: 2 },
        { value: "Dell", label: "Dell", count: 2 },
        { value: "Apple", label: "Apple", count: 1 },
      ])
    );

    const categoryRefinement = refinements.find((r) => r.key === "category");
    expect(categoryRefinement).toBeDefined();
    expect(categoryRefinement?.options).toEqual(
      expect.arrayContaining([
        { value: "laptop", label: "Laptop", count: 3 },
        { value: "tablet", label: "Tablet", count: 1 },
        { value: "phone", label: "Phone", count: 1 },
      ])
    );
  });
});

describe("refine_search Tool", () => {
  let server: McpServer;
  let connector: ConnectorRuntime;
  let auditLedger: AuditLedger;

  const mockManifest: IntegrationManifest = {
    merchant: {
      name: "TestStore",
      description: "Test",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "http://localhost:5000",
    },
    operations: {
      search: {
        method: "POST",
        path: "/search",
        request_mapping: {
          q: { from: "$.query" },
          filters: { from: "$.filters" },
        },
        response_path: "$.items",
      },
      get_product: { method: "GET", path: "/products/:product_id" },
      create_checkout: { method: "POST", path: "/checkout" },
      get_checkout: { method: "GET", path: "/checkout/:checkout_id" },
      confirm_order: { method: "POST", path: "/orders" },
      get_order_status: { method: "GET", path: "/orders/:order_id" },
    },
    refinements: {
      mode: "derived",
      derive_from_attributes: ["brand"],
    },
    field_mappings: {
      offer: {
        offer_id: { from: "$.id" },
        title: { from: "$.title" },
        description: { from: "$.desc" },
        "price.amount": { from: "$.price" },
        "price.currency": { from: null, transform: { type: "default", value: "INR" } },
        availability: { from: null, transform: { type: "default", value: "in_stock" } },
        "attributes.brand": { from: "$.brand" },
      },
      checkout: {
        checkout_id: { from: "$.id" },
        "total.amount": { from: "$.total" },
        "total.currency": { from: null, transform: { type: "default", value: "INR" } },
        available: { from: null, transform: { type: "default", value: true } },
      },
      order: {
        order_id: { from: "$.id" },
        status: { from: "$.status" },
      },
    },
    payment: {
      provider: "razorpay",
      razorpay_key_id_env: "RAZORPAY_KEY_ID",
      razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
    },
  };

  beforeEach(() => {
    searchStates.clear();
    auditLedger = new AuditLedger();
    connector = new ConnectorRuntime(mockManifest);
    server = new McpServer({ name: "TestMCP", version: "1.0.0" });
    registerDiscoveryTools(server, connector, mockManifest, auditLedger);
    registerRefinementTools(server, connector, auditLedger);
  });

  it("should refine an existing search session and merge filter criteria", async () => {
    // Seed an initial search state
    searchStates.set("srch_init_123", {
      query: "laptop",
      filters: { category: "ultrabook" },
      page: 1,
      createdAt: new Date().toISOString(),
    });

    const searchSpy = vi.spyOn(connector, "search").mockResolvedValue({
      search_id: "srch_refined_456",
      offers: [
        {
          offer_id: "L1",
          title: "Lenovo Slim",
          description: "i7",
          price: { amount: 6000000, currency: "INR" },
          availability: "in_stock",
          attributes: { brand: "Lenovo" },
        },
      ],
      total_results: 1,
      refinements: [
        {
          key: "brand",
          label: "Brand",
          type: "enum",
          options: [{ value: "Lenovo", label: "Lenovo", count: 1 }],
        },
      ],
      sort_options: [],
      page_info: { page: 1, page_size: 1, has_more: false },
    });

    // Invoke refine_search tool handler directly through MCP server
    const tool = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: [{ text: string }] }> }> })._registeredTools["refine_search"];
    expect(tool).toBeDefined();

    const response = await tool.handler({
      search_id: "srch_init_123",
      filters: { brand: "lenovo" },
    });

    // Check connector was called with MERGED filters
    expect(searchSpy).toHaveBeenCalledWith({
      query: "laptop",
      filters: { category: "ultrabook", brand: "lenovo" },
      page: 1,
      sort: undefined,
    });

    const parsedResponse = JSON.parse(response.content[0].text);
    expect(parsedResponse.search_id).toBe("srch_refined_456");
    expect(parsedResponse.offers).toHaveLength(1);

    // Verify new search state is stored for subsequent chained refinements
    expect(searchStates.has("srch_refined_456")).toBe(true);
    expect(searchStates.get("srch_refined_456")?.filters).toEqual({
      category: "ultrabook",
      brand: "lenovo",
    });

    // Verify audit event
    const events = auditLedger.getTransactionAudit("srch_refined_456");
    const refineEvent = events.find((e) => e.event_type === AuditEventType.SEARCH_REFINED);
    expect(refineEvent).toBeDefined();
    expect(refineEvent?.request?.previous_search_id).toBe("srch_init_123");
  });

  it("should return error when refining a non-existent or expired search_id", async () => {
    const tool = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ isError?: boolean; content: [{ text: string }] }> }> })._registeredTools["refine_search"];

    const response = await tool.handler({
      search_id: "srch_non_existent",
      filters: { brand: "dell" },
    });

    expect(response.isError).toBe(true);
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.error).toContain("Search session \"srch_non_existent\" not found or expired");
  });
});
