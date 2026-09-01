import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  truncateRefinementOptions,
  DEFAULT_MAX_OPTIONS_IN_SEARCH,
} from "../../src/connector/refinements.js";
import { Refinement, AuditEventType } from "../../src/types/index.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import {
  registerRefinementTools,
  searchStates,
  pruneSearchStates,
  SEARCH_STATE_TTL_MS,
  MAX_SEARCH_STATES,
} from "../../src/tools/refinement.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("truncateRefinementOptions Helper", () => {
  it("should not truncate when option count is less than or equal to default max", () => {
    const refinements: Refinement[] = [
      {
        key: "brand",
        label: "Brand",
        type: "enum",
        options: [
          { value: "apple", label: "Apple", count: 10 },
          { value: "dell", label: "Dell", count: 5 },
        ],
      },
    ];

    const truncated = truncateRefinementOptions(refinements);
    expect(truncated[0].options).toHaveLength(2);
    expect(truncated[0].option_count).toBe(2);
    expect(truncated[0].has_more).toBe(false);
  });

  it("should truncate when option count exceeds default max and sort by count descending", () => {
    const manyOptions = Array.from({ length: 30 }, (_, i) => ({
      value: `brand_${i}`,
      label: `Brand ${i}`,
      count: i + 1, // 1 to 30
    }));

    const refinements: Refinement[] = [
      {
        key: "brand",
        label: "Brand",
        type: "enum",
        options: manyOptions,
      },
    ];

    const truncated = truncateRefinementOptions(refinements);
    expect(truncated[0].options).toHaveLength(DEFAULT_MAX_OPTIONS_IN_SEARCH); // 20
    expect(truncated[0].option_count).toBe(30);
    expect(truncated[0].has_more).toBe(true);
    // Should be sorted by count descending by default (highest count 30 first)
    expect(truncated[0].options?.[0].value).toBe("brand_29");
    expect(truncated[0].options?.[0].count).toBe(30);
  });

  it("should respect custom max_options_in_search configuration", () => {
    const options = Array.from({ length: 10 }, (_, i) => ({
      value: `val_${i}`,
      label: `Label ${i}`,
      count: i * 5,
    }));

    const refinements: Refinement[] = [
      {
        key: "category",
        label: "Category",
        type: "enum",
        options,
      },
    ];

    const truncated = truncateRefinementOptions(refinements, {
      max_options_in_search: 5,
    });
    expect(truncated[0].options).toHaveLength(5);
    expect(truncated[0].option_count).toBe(10);
    expect(truncated[0].has_more).toBe(true);
  });

  it("should preserve native ordering when sort_by is 'native'", () => {
    const options = [
      { value: "a", label: "Alpha", count: 2 },
      { value: "b", label: "Beta", count: 100 },
      { value: "c", label: "Gamma", count: 50 },
      { value: "d", label: "Delta", count: 1 },
    ];

    const refinements: Refinement[] = [
      {
        key: "greek",
        label: "Greek",
        type: "enum",
        options,
      },
    ];

    const truncated = truncateRefinementOptions(refinements, {
      max_options_in_search: 2,
      sort_by: "native",
    });
    expect(truncated[0].options).toHaveLength(2);
    expect(truncated[0].options?.[0].value).toBe("a");
    expect(truncated[0].options?.[1].value).toBe("b");
    expect(truncated[0].option_count).toBe(4);
    expect(truncated[0].has_more).toBe(true);
  });

  it("should handle refinements without options safely", () => {
    const refinements: Refinement[] = [
      {
        key: "price",
        label: "Price Range",
        type: "range",
        min: 100,
        max: 5000,
      },
    ];

    const truncated = truncateRefinementOptions(refinements);
    expect(truncated[0].options).toBeUndefined();
    expect(truncated[0].option_count).toBe(0);
    expect(truncated[0].has_more).toBe(false);
  });
});

describe("get_refinement_options MCP Tool", () => {
  let server: McpServer;
  let connector: ConnectorRuntime;
  let auditLedger: AuditLedger;

  const mockManifest: IntegrationManifest = {
    merchant: {
      name: "TechStore",
      description: "Electronics Store",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "http://localhost:5000",
    },
    operations: {
      search: {
        method: "POST",
        path: "/search",
        request_mapping: { q: { from: "$.query" } },
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
      option_pagination: {
        max_options_in_search: 3,
      },
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
        sku: { from: "$.sku" },
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

  const sampleBrands = [
    { value: "apple", label: "Apple", count: 15 },
    { value: "acer", label: "Acer", count: 12 },
    { value: "asus", label: "Asus", count: 10 },
    { value: "dell", label: "Dell", count: 8 },
    { value: "lenovo", label: "Lenovo", count: 7 },
    { value: "samsung", label: "Samsung", count: 5 },
    { value: "sandisk", label: "SanDisk", count: 4 },
    { value: "sony", label: "Sony", count: 3 },
  ];

  beforeEach(() => {
    searchStates.clear();
    auditLedger = new AuditLedger();
    connector = new ConnectorRuntime(mockManifest);
    server = new McpServer({ name: "TestMCP", version: "1.0.0" });
    registerDiscoveryTools(server, connector, mockManifest, auditLedger);
    registerRefinementTools(server, connector, auditLedger);
  });

  const getToolHandler = (name: string) => {
    const registered = (
      server as unknown as {
        _registeredTools: Record<
          string,
          { handler: (args: unknown) => Promise<{ isError?: boolean; content: [{ text: string }] }> }
        >;
      }
    )._registeredTools[name];
    return registered?.handler;
  };

  it("should paginate full refinement options MCP-side when cached in search state", async () => {
    searchStates.set("srch_test_100", {
      query: "laptop",
      filters: {},
      page: 1,
      createdAt: new Date().toISOString(),
      refinements: [
        {
          key: "brand",
          label: "Brand",
          type: "enum",
          options: sampleBrands,
          option_count: sampleBrands.length,
          has_more: true,
        },
      ],
    });

    const handler = getToolHandler("get_refinement_options");
    expect(handler).toBeDefined();

    // Page 1 with page_size 3
    const res1 = await handler({
      search_id: "srch_test_100",
      refinement_key: "brand",
      page: 1,
      page_size: 3,
    });

    expect(res1.isError).toBeFalsy();
    const data1 = JSON.parse(res1.content[0].text);
    expect(data1.source).toBe("mcp");
    expect(data1.refinement_key).toBe("brand");
    expect(data1.total_options).toBe(8);
    expect(data1.page).toBe(1);
    expect(data1.page_size).toBe(3);
    expect(data1.has_more).toBe(true);
    expect(data1.options).toHaveLength(3);
    expect(data1.options[0].value).toBe("apple");

    // Page 3 with page_size 3 (last page with remaining 2 items)
    const res3 = await handler({
      search_id: "srch_test_100",
      refinement_key: "brand",
      page: 3,
      page_size: 3,
    });

    const data3 = JSON.parse(res3.content[0].text);
    expect(data3.page).toBe(3);
    expect(data3.has_more).toBe(false);
    expect(data3.options).toHaveLength(2);
    expect(data3.options[0].value).toBe("sandisk");
    expect(data3.options[1].value).toBe("sony");
  });

  it("should filter options by case-insensitive query substring", async () => {
    searchStates.set("srch_test_101", {
      query: "electronics",
      filters: {},
      page: 1,
      createdAt: new Date().toISOString(),
      refinements: [
        {
          key: "brand",
          label: "Brand",
          type: "enum",
          options: sampleBrands,
          option_count: sampleBrands.length,
          has_more: true,
        },
      ],
    });

    const handler = getToolHandler("get_refinement_options");
    const res = await handler({
      search_id: "srch_test_101",
      refinement_key: "brand",
      query: "sa", // Should match "samsung" and "sandisk"
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.source).toBe("mcp");
    expect(data.total_options).toBe(2);
    expect(data.options.map((o: { value: string }) => o.value)).toEqual(["samsung", "sandisk"]);
  });

  it("should emit REFINEMENT_OPTIONS_QUERIED audit event", async () => {
    searchStates.set("srch_test_102", {
      query: "phone",
      filters: {},
      page: 1,
      createdAt: new Date().toISOString(),
      refinements: [
        {
          key: "brand",
          label: "Brand",
          type: "enum",
          options: sampleBrands,
        },
      ],
    });

    const handler = getToolHandler("get_refinement_options");
    await handler({
      search_id: "srch_test_102",
      refinement_key: "brand",
      query: "sony",
    });

    const events = auditLedger.getTransactionAudit("srch_test_102");
    const optEvent = events.find(
      (e) => e.event_type === AuditEventType.REFINEMENT_OPTIONS_QUERIED
    );
    expect(optEvent).toBeDefined();
    expect(optEvent?.request?.refinement_key).toBe("brand");
    expect(optEvent?.request?.query).toBe("sony");
    expect(optEvent?.response?.returned_count).toBe(1);
  });

  it("should return error when search session is not found or expired", async () => {
    const handler = getToolHandler("get_refinement_options");
    const res = await handler({
      search_id: "non_existent_search",
      refinement_key: "brand",
    });

    expect(res.isError).toBe(true);
    const err = JSON.parse(res.content[0].text);
    expect(err.error).toContain('Search session "non_existent_search" not found or expired');
  });

  it("should return error when refinement key is not found in search session", async () => {
    searchStates.set("srch_test_103", {
      query: "laptop",
      filters: {},
      page: 1,
      createdAt: new Date().toISOString(),
      refinements: [
        {
          key: "brand",
          label: "Brand",
          type: "enum",
          options: sampleBrands,
        },
      ],
    });

    const handler = getToolHandler("get_refinement_options");
    const res = await handler({
      search_id: "srch_test_103",
      refinement_key: "non_existent_facet",
    });

    expect(res.isError).toBe(true);
    const err = JSON.parse(res.content[0].text);
    expect(err.error).toContain('Refinement "non_existent_facet" not part of search srch_test_103');
  });

  it("should delegate to merchant endpoint when separate_endpoint and option_query_support are configured", async () => {
    const separateManifest: IntegrationManifest = {
      ...mockManifest,
      refinements: {
        mode: "separate_endpoint",
        facet_operation: {
          method: "GET",
          path: "/api/facets",
          request_mapping: {
            brand_q: { from: "$.__option_query" },
          },
        },
        refinement_schema: {
          key_path: "$.id",
          label_path: "$.name",
          options_path: "$.options",
          option_value_path: "$.val",
          option_label_path: "$.lbl",
        },
        option_pagination: {
          option_query_support: {
            query_param: "brand_q",
            page_param: "page",
            page_size_param: "limit",
          },
        },
      },
    };

    const separateConnector = new ConnectorRuntime(separateManifest);
    const delegateSpy = vi.spyOn(separateConnector, "searchRefinementOptions").mockResolvedValue({
      key: "brand",
      label: "Brand",
      type: "enum",
      options: [
        { value: "server_apple", label: "Server Apple", count: 42 },
        { value: "server_asus", label: "Server Asus", count: 18 },
      ],
    });

    const separateServer = new McpServer({ name: "SeparateMCP", version: "1.0.0" });
    registerDiscoveryTools(separateServer, separateConnector, separateManifest, auditLedger);
    registerRefinementTools(separateServer, separateConnector, auditLedger);

    searchStates.set("srch_delegated_01", {
      query: "laptop",
      filters: {},
      page: 1,
      createdAt: new Date().toISOString(),
      refinements: [
        {
          key: "brand",
          label: "Brand",
          type: "enum",
          options: [],
        },
      ],
    });

    const separateHandler = (
      separateServer as unknown as {
        _registeredTools: Record<
          string,
          { handler: (args: unknown) => Promise<{ isError?: boolean; content: [{ text: string }] }> }
        >;
      }
    )._registeredTools["get_refinement_options"].handler;

    const res = await separateHandler({
      search_id: "srch_delegated_01",
      refinement_key: "brand",
      query: "server",
    });

    expect(delegateSpy).toHaveBeenCalled();
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.source).toBe("merchant");
    expect(data.options).toHaveLength(2);
    expect(data.options[0].value).toBe("server_apple");
  });
});

describe("Search State TTL and Capacity Eviction (pruneSearchStates)", () => {
  beforeEach(() => {
    searchStates.clear();
  });

  it("should prune search states older than SEARCH_STATE_TTL_MS (30 mins)", () => {
    const now = Date.now();
    // Fresh state (5 mins ago)
    searchStates.set("fresh_01", {
      query: "laptop",
      filters: {},
      page: 1,
      createdAt: new Date(now - 5 * 60 * 1000).toISOString(),
      refinements: [],
    });
    // Expired state (35 mins ago)
    searchStates.set("expired_01", {
      query: "phone",
      filters: {},
      page: 1,
      createdAt: new Date(now - (SEARCH_STATE_TTL_MS + 5 * 60 * 1000)).toISOString(),
      refinements: [],
    });

    expect(searchStates.size).toBe(2);
    const pruned = pruneSearchStates();
    expect(pruned).toBe(1);
    expect(searchStates.has("fresh_01")).toBe(true);
    expect(searchStates.has("expired_01")).toBe(false);
  });

  it("should prune oldest entries when exceeding MAX_SEARCH_STATES", () => {
    const now = Date.now();
    for (let i = 0; i < MAX_SEARCH_STATES + 10; i++) {
      searchStates.set(`state_${i}`, {
        query: `query_${i}`,
        filters: {},
        page: 1,
        createdAt: new Date(now + i * 1000).toISOString(), // state_0 is oldest
        refinements: [],
      });
    }

    expect(searchStates.size).toBe(MAX_SEARCH_STATES + 10);
    const pruned = pruneSearchStates();
    expect(pruned).toBe(10);
    expect(searchStates.size).toBe(MAX_SEARCH_STATES);
    // state_0 through state_9 should have been pruned
    expect(searchStates.has("state_0")).toBe(false);
    expect(searchStates.has("state_9")).toBe(false);
    expect(searchStates.has("state_10")).toBe(true);
  });
});
