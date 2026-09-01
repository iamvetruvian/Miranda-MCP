/**
 * Component 4: Offer Stage Runtime Unit Tests
 * Tests extended Offer types (variants, pricing_info, add_ons, media),
 * ConnectorRuntime.checkAvailability (boolean, stock_count, time_slots, calendar),
 * and the check_availability tool.
 */

import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { OfferSchema } from "../../src/connector/validator.js";
import { Offer } from "../../src/types/index.js";

function createMockServer() {
  const tools = new Map<string, { description: string; schema: any; handler: Function }>();
  const server = {
    tool: (name: string, description: string, schema: any, handler: Function) => {
      tools.set(name, { description, schema, handler });
    },
  } as unknown as McpServer;

  return { server, tools };
}

describe("Component 4: Offer Stage Runtime", () => {
  it("should validate rich Offer schemas with variants, pricing_info, add_ons, and media", () => {
    const offer: Offer = {
      offer_id: "OFF-TSHIRT-001",
      title: "Classic Cotton Tee",
      description: "100% organic cotton t-shirt",
      price: { amount: 129900, currency: "INR" },
      availability: "in_stock",
      attributes: { material: "cotton", brand: "EcoWear" },
      variants: [
        {
          key: "size",
          label: "Size",
          required: true,
          options: [
            { value: "M", label: "Medium", available: true },
            { value: "L", label: "Large", available: false },
          ],
          affects_price: false,
          affects_availability: true,
        },
      ],
      pricing_info: {
        model: "tiered",
        tiers: [
          { min_quantity: 1, max_quantity: 4, per_unit_amount: 129900 },
          { min_quantity: 5, per_unit_amount: 109900 },
        ],
        prices_include_tax: true,
        tax_display: "Inclusive of GST",
      },
      add_ons: [
        {
          id: "GIFT-WRAP",
          name: "Gift Wrap & Greeting Card",
          price: { amount: 15000, currency: "INR" },
          description: "Eco-friendly handmade wrapping",
        },
      ],
      stock_count: 42,
      media: {
        images: ["https://cdn.local/tee-front.jpg", "https://cdn.local/tee-back.jpg"],
        video_url: "https://cdn.local/tee-preview.mp4",
        thumbnail: "https://cdn.local/tee-thumb.jpg",
      },
    };

    const result = OfferSchema.safeParse(offer);
    expect(result.success).toBe(true);
    expect(result.data?.stock_count).toBe(42);
    expect(result.data?.variants?.length).toBe(1);
    expect(result.data?.add_ons?.length).toBe(1);
  });

  it("should check availability for stock_count model", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "RetailStore",
        description: "Retail goods",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.retail.local",
      },
      offer: {
        availability: {
          model: "stock_count",
          check_operation: { method: "GET", path: "/stock/:product_id" },
          stock_count_path: "$.inventory.available_qty",
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
      inventory: { available_qty: 15 },
    });

    const result = await connector.checkAvailability("SKU-100", { size: "XL" });
    expect(result.available).toBe(true);
    expect(result.stock_count).toBe(15);
  });

  it("should check availability for time_slots model", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "CinemaMultiplex",
        description: "Movie tickets",
        commerce_domain: "ticketing",
        currency: "INR",
        base_url: "https://api.cinema.local",
      },
      offer: {
        availability: {
          model: "time_slots",
          check_operation: { method: "GET", path: "/movies/:product_id/shows" },
          slots_response_path: "$.shows",
          slot_mapping: {
            id_path: "$.show_id",
            start_time_path: "$.starts_at",
            end_time_path: "$.ends_at",
            capacity_remaining_path: "$.available_seats",
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
      shows: [
        { show_id: "SH-01", starts_at: "2026-09-01T14:00:00Z", ends_at: "2026-09-01T16:30:00Z", available_seats: 24 },
        { show_id: "SH-02", starts_at: "2026-09-01T18:00:00Z", ends_at: "2026-09-01T20:30:00Z", available_seats: 0 },
      ],
    });

    const result = await connector.checkAvailability("MOV-DUNE-2", undefined, "2026-09-01");
    expect(result.available).toBe(true);
    expect(result.time_slots?.length).toBe(2);
    expect(result.time_slots?.[0].remaining).toBe(24);
  });

  it("should check availability for calendar model", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "ResortBookings",
        description: "Hotel bookings",
        commerce_domain: "hospitality",
        currency: "INR",
        base_url: "https://api.resort.local",
      },
      offer: {
        availability: {
          model: "calendar",
          check_operation: { method: "GET", path: "/rooms/:product_id/calendar" },
          dates_response_path: "$.calendar",
          date_mapping: {
            date_path: "$.day",
            available_path: "$.is_free",
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
      calendar: [
        { day: "2026-10-01", is_free: true },
        { day: "2026-10-02", is_free: false },
      ],
    });

    const result = await connector.checkAvailability("VILLA-01");
    expect(result.available).toBe(true);
  });

  it("should invoke check_availability tool through MCP server and return JSON result", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "QuickStore",
        description: "Fast retail",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.quick.local",
      },
      offer: {
        availability: {
          model: "boolean",
          check_operation: { method: "GET", path: "/check/:product_id" },
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
    vi.spyOn(connector, "executeOperationFromConfig").mockResolvedValue({ in_stock: true });

    const auditLedger = new AuditLedger();
    const { server, tools } = createMockServer();
    registerDiscoveryTools(server, connector, manifest, auditLedger);

    const checkTool = tools.get("check_availability")!;
    expect(checkTool).toBeDefined();

    const res = await checkTool.handler({ product_id: "SKU-999" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.available).toBe(true);
  });
});
