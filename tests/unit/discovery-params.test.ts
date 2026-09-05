import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { registerTransactionTools } from "../../src/tools/transaction.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { StripeAdapter } from "../../src/payment/stripe.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { TransactionState } from "../../src/types/index.js";

const nonRetailManifest: IntegrationManifest = {
  merchant: {
    name: "TicketVerse",
    description: "Cinema Ticketing",
    commerce_domain: "ticketing",
    currency: "INR",
    base_url: "http://localhost:4003",
  },
  discovery: {
    input_schema: [
      { name: "city", type: "string", required: true, description: "City" },
      { name: "date", type: "date", required: true, description: "Date (YYYY-MM-DD)" },
      { name: "language", type: "enum", enum_values: ["English", "Hindi"] },
    ],
  },
  operations: {
    search: {
      method: "POST",
      path: "/api/showtimes/search",
      request_mapping: {
        movie: { from: "$.query" },
        city: { from: "$.parameters.city" },
        show_date: { from: "$.parameters.date" },
      },
      response_path: "$.showtimes",
      total_path: "$.total",
    },
    get_product: { method: "GET", path: "/api/showtimes/:product_id" },
    create_checkout: { method: "POST", path: "/api/bookings" },
    get_checkout: { method: "GET", path: "/api/bookings/:checkout_id" },
    confirm_order: { method: "POST", path: "/api/bookings/:checkout_id/confirm" },
    get_order_status: { method: "GET", path: "/api/bookings/:order_id/status" },
    cancel_order: { method: "POST", path: "/api/bookings/:order_id/cancel" },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.showtime_id" },
      title: { from: "$.movie" },
      "price.amount": { from: "$.price_inr", transform: { type: "multiply", value: 100 } },
      "price.currency": { from: null, transform: { type: "default", value: "INR" } },
      availability: { from: null, transform: { type: "default", value: "in_stock" } },
      expires_at: { from: "$.hold_expires_at" },
    },
    checkout: {
      checkout_id: { from: "$.booking_id" },
      sku: { from: "$.showtime_id" },
      "total.amount": { from: "$.total_inr", transform: { type: "multiply", value: 100 } },
      "total.currency": { from: null, transform: { type: "default", value: "INR" } },
      available: { from: null, transform: { type: "default", value: true } },
    },
    order: {
      order_id: { from: "$.pnr" },
      status: { from: "$.status" },
    },
  },
  payment: {
    provider: "stripe",
    stripe_secret_key_env: "STRIPE_SECRET_KEY",
  },
};

describe("Component 4: Domain-Agnostic Discovery & Ephemeral Offers", () => {
  let server: McpServer;
  let connector: ConnectorRuntime;
  let auditLedger: AuditLedger;
  let txnManager: TransactionManager;
  let policyEngine: PolicyEngine;
  let paymentAdapter: StripeAdapter;

  beforeEach(() => {
    server = new McpServer({ name: "TicketMCP", version: "1.0.0" });
    connector = new ConnectorRuntime(nonRetailManifest);
    auditLedger = new AuditLedger();
    txnManager = new TransactionManager(auditLedger);
    policyEngine = new PolicyEngine();
    paymentAdapter = new StripeAdapter("mock_key", undefined, true);

    registerDiscoveryTools(server, connector, nonRetailManifest, auditLedger);
    registerTransactionTools(server, connector, txnManager, policyEngine, paymentAdapter, auditLedger);
  });

  describe("Required Discovery Parameters Validation", () => {
    it("should reject search_products when required parameters are missing", async () => {
      const searchHandler = (
        server as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: unknown) => Promise<{ isError?: boolean; content: [{ text: string }] }> }
          >;
        }
      )._registeredTools["search_products"].handler;

      const res = await searchHandler({
        query: "Avengers",
        parameters: { city: "Mumbai" }, // missing 'date'
      });

      expect(res.isError).toBe(true);
      const data = JSON.parse(res.content[0].text);
      expect(data.error).toContain("Missing required discovery parameters: date");
      expect(data.discovery_schema).toBeDefined();
      expect(data.discovery_schema.length).toBe(3);
    });

    it("should allow search_products when all required parameters are provided", async () => {
      vi.spyOn(
        connector as unknown as { executeOperationRaw: () => Promise<unknown> },
        "executeOperationRaw"
      ).mockResolvedValue({
        showtimes: [
          {
            showtime_id: "show_123",
            movie: "Avengers",
            price_inr: 500,
            hold_expires_at: new Date(Date.now() + 600000).toISOString(),
          },
        ],
        total: 1,
      });

      const searchHandler = (
        server as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: unknown) => Promise<{ isError?: boolean; content: [{ text: string }] }> }
          >;
        }
      )._registeredTools["search_products"].handler;

      const res = await searchHandler({
        query: "Avengers",
        parameters: { city: "Mumbai", date: "2026-09-01" },
      });

      expect(res.isError).toBeUndefined();
      const data = JSON.parse(res.content[0].text);
      expect(data.offers.length).toBe(1);
      expect(data.offers[0].title).toBe("Avengers");
    });
  });

  describe("Truthful Pagination via total_path", () => {
    it("should calculate total_results and has_more truthfully when total_path is configured", async () => {
      vi.spyOn(
        connector as unknown as { executeOperationRaw: () => Promise<unknown> },
        "executeOperationRaw"
      ).mockResolvedValue({
        showtimes: [
          { showtime_id: "show_1", movie: "Movie 1", price_inr: 300 },
          { showtime_id: "show_2", movie: "Movie 2", price_inr: 400 },
        ],
        total: 25, // Merchant reports 25 total results
      });

      const result = await connector.search({
        query: "Movie",
        page: 1,
        parameters: { city: "Mumbai", date: "2026-09-01" },
      });

      expect(result.total_results).toBe(25);
      expect(result.page_info.page).toBe(1);
      expect(result.page_info.page_size).toBe(2);
      expect(result.page_info.has_more).toBe(true);
    });
  });

  describe("Ephemeral Offer Expiration in prepare_purchase", () => {
    it("should fail gracefully when attempting to purchase an expired offer quote", async () => {
      // Mock getProduct to return an expired offer
      const expiredTimestamp = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      vi.spyOn(connector, "getProduct").mockResolvedValue({
        offer_id: "show_expired_999",
        title: "Late Night IMAX Show",
        description: "Expired fare hold",
        price: { amount: 80000, currency: "INR" },
        availability: "in_stock",
        expires_at: expiredTimestamp,
        attributes: {},
      });

      const prepareHandler = (
        server as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: unknown) => Promise<{ isError?: boolean; content: [{ text: string }] }> }
          >;
        }
      )._registeredTools["prepare_purchase"].handler;

      const res = await prepareHandler({
        product_id: "show_expired_999",
        quantity: 2,
        selection_reason: "Test buying expired showtime",
      });

      expect(res.isError).toBe(true);
      const data = JSON.parse(res.content[0].text);
      expect(data.state).toBe(TransactionState.FAILED);
      expect(data.error).toContain("expired at");
      expect(data.recoverable).toBe(true);
      expect(data.suggestion).toBe("search_products");
    });
  });
});
