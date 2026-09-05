import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMerchantMcpServer } from "../../src/server.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { AuditExporter, OTelLogRecord } from "../../src/audit/exporter.js";

const testManifest: IntegrationManifest = {
  merchant: {
    name: "TechStore",
    description: "Electronics Store",
    commerce_domain: "retail",
    currency: "INR",
    base_url: "https://api.techstore.local",
  },
  auth: { type: "none" },
  operations: {
    search: {
      method: "POST",
      path: "/api/search",
      response_path: "$.products",
    },
    get_product: {
      method: "GET",
      path: "/api/products/:product_id",
    },
    create_checkout: {
      method: "POST",
      path: "/api/checkout",
    },
    get_checkout: {
      method: "GET",
      path: "/api/checkout/:checkout_id",
    },
    confirm_order: {
      method: "POST",
      path: "/api/orders",
    },
    get_order_status: {
      method: "GET",
      path: "/api/orders/:order_id",
    },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.sku" },
      title: { from: "$.name" },
      "price.amount": { from: "$.price" },
      "price.currency": { from: null, transform: { type: "default", value: "INR" } },
      availability: { from: null, transform: { type: "default", value: "in_stock" } },
    },
    checkout: {
      checkout_id: { from: "$.id" },
      "total.amount": { from: "$.total" },
      "total.currency": { from: null, transform: { type: "default", value: "INR" } },
      available: { from: null, transform: { type: "default", value: true } },
    },
    order: {
      order_id: { from: "$.order_id" },
      status: { from: "$.status" },
    },
  },
  payment: {
    provider: "stripe",
    stripe_secret_key_env: "STRIPE_SECRET_KEY",
  },
};

describe("Tool Reasoning Parameter & Telemetry", () => {
  let instance: ReturnType<typeof createMerchantMcpServer>;

  beforeEach(() => {
    instance = createMerchantMcpServer(testManifest, undefined, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have reasoning schema in tool definitions", () => {
    const tools = (instance.server as any)._registeredTools;

    expect(tools["search_products"]).toBeDefined();
    expect(tools["get_product"]).toBeDefined();
    expect(tools["create_mandate"]).toBeDefined();
    expect(tools["check_auth_status"]).toBeDefined();
    expect(tools["get_transaction_status"]).toBeDefined();

    // prepare_purchase keeps selection_reason and does not force a separate reasoning parameter
    expect(tools["prepare_purchase"].inputSchema.shape.selection_reason).toBeDefined();
    expect(tools["prepare_purchase"].inputSchema.shape.reasoning).toBeUndefined();

    // Other tools have reasoning parameter
    expect(tools["search_products"].inputSchema.shape.reasoning).toBeDefined();
    expect(tools["get_product"].inputSchema.shape.reasoning).toBeDefined();
    expect(tools["create_mandate"].inputSchema.shape.reasoning).toBeDefined();
    expect(tools["check_auth_status"].inputSchema.shape.reasoning).toBeDefined();
    expect(tools["get_transaction_status"].inputSchema.shape.reasoning).toBeDefined();
  });

  it("should accept reasoning in search_products and return reasoning in output", async () => {
    vi.spyOn(instance.connector, "search").mockResolvedValue({
      search_id: "srch_100",
      query: "headphone",
      total_results: 1,
      page: 1,
      page_size: 20,
      offers: [
        {
          offer_id: "sku_hp_1",
          title: "Noise Cancelling Headphones",
          price: { amount: 8999, currency: "INR" },
          availability: "in_stock",
        },
      ],
      refinements: [],
    });

    const searchTool = (instance.server as any)._registeredTools["search_products"];
    const reasoningText = "User requested affordable noise cancelling headphones for remote work";

    const res = await searchTool.handler({
      query: "headphone",
      reasoning: reasoningText,
    });

    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.reasoning).toBe(reasoningText);
    expect(parsed.offers).toHaveLength(1);

    // Verify audit event captured reasoning
    const events = instance.auditLedger.getAllEvents();
    const invokedEvent = events.find((e) => e.actor.component === "search_products");
    expect(invokedEvent).toBeDefined();
    expect(invokedEvent?.request?.params).toMatchObject({
      reasoning: reasoningText,
    });
  });

  it("should accept reasoning in get_product and return reasoning in output", async () => {
    vi.spyOn(instance.connector, "getProduct").mockResolvedValue({
      offer_id: "sku_hp_1",
      title: "Noise Cancelling Headphones",
      price: { amount: 8999, currency: "INR" },
      availability: "in_stock",
    });

    const getProductTool = (instance.server as any)._registeredTools["get_product"];
    const reasoningText = "Checking specs of selected headphones before buying";

    const res = await getProductTool.handler({
      product_id: "sku_hp_1",
      reasoning: reasoningText,
    });

    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.reasoning).toBe(reasoningText);
    expect(parsed.offer_id).toBe("sku_hp_1");
  });

  it("should accept reasoning in create_mandate and return reasoning in output", async () => {
    const mandateTool = (instance.server as any)._registeredTools["create_mandate"];
    const reasoningText = "Pre-authorizing daily shopping budget of 10000 INR";

    const res = await mandateTool.handler({
      user_ref: "user_buyer_1",
      max_amount: 1000000,
      currency: "INR",
      reasoning: reasoningText,
    });

    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.reasoning).toBe(reasoningText);
    expect(parsed.authorization_reference).toBeDefined();
  });

  it("should return selection_reason as reasoning in prepare_purchase output", async () => {
    vi.spyOn(instance.connector, "getProduct").mockResolvedValue({
      offer_id: "sku_hp_1",
      title: "Noise Cancelling Headphones",
      price: { amount: 8999, currency: "INR" },
      availability: "in_stock",
    });

    vi.spyOn(instance.connector, "createCheckout").mockResolvedValue({
      checkout_id: "chk_hp_1",
      sku: "sku_hp_1",
      title: "Noise Cancelling Headphones",
      unit_price: { amount: 8999, currency: "INR" },
      total: { amount: 8999, currency: "INR" },
      available: true,
    });

    // Attach exporter before invoking tool so events are recorded and streamed
    const exported: OTelLogRecord[] = [];
    const exporter = new AuditExporter({
      customTransport: (logs) => {
        exported.push(...logs);
      },
    });
    exporter.attach(instance.auditLedger);

    const prepareTool = (instance.server as any)._registeredTools["prepare_purchase"];
    const selectionReason = "Selected top-rated model within user's price limit";

    const res = await prepareTool.handler({
      product_id: "sku_hp_1",
      quantity: 1,
      selection_reason: selectionReason,
    });

    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.reasoning).toBe(selectionReason);
    expect(parsed.transaction_id).toBeDefined();

    await exporter.flush();

    // Check that telemetry exported merchantmcp.reasoning and merchantmcp.amount
    const txnLogs = exported.filter(
      (r) => r.attributes["merchantmcp.transaction_id"] === parsed.transaction_id
    );
    expect(txnLogs.length).toBeGreaterThan(0);

    for (const log of txnLogs) {
      expect(log.attributes["merchantmcp.reasoning"]).toBe(selectionReason);
    }

    const checkoutLog = txnLogs.find(
      (r) => r.attributes["merchantmcp.event_type"] === "CHECKOUT_CREATED"
    );
    expect(checkoutLog).toBeDefined();
    expect(checkoutLog!.attributes["merchantmcp.amount"]).toBe(8999);
    expect(checkoutLog!.attributes["merchantmcp.currency"]).toBe("INR");

    exporter.stop();
  });
});
