/**
 * Marketplace MCP Server
 * Exposes federated multi-merchant discovery and targeted purchase tools over Model Context Protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MarketplaceGateway } from "./gateway.js";
import { reasoningSchema, withReasoning } from "../tools/reasoning.js";

export function createMarketplaceMcpServer(gateway: MarketplaceGateway): McpServer {
  const server = new McpServer({
    name: "MarketplaceGateway — Multi-Merchant Commerce Façade",
    version: "0.1.0",
  });

  // 1. List active merchants
  server.tool(
    "list_merchants",
    "List all available merchants connected to the marketplace gateway with their supported domains and currencies.",
    {
      reasoning: reasoningSchema,
    },
    async (params) => {
      const merchants = gateway.listMerchants();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(withReasoning({ merchants }, params?.reasoning), null, 2),
          },
        ],
      };
    }
  );

  // 2. Federated Search
  server.tool(
    "search_marketplace",
    "Perform a federated search across all connected merchants simultaneously. Returns aggregated offers tagged with merchant_id and unified dynamic refinements.",
    {
      query: z.string().describe("Search keywords, product names, or attributes"),
      merchant_id: z.string().optional().describe("Optional filter to search only a specific merchant"),
      filters: z.record(z.unknown()).optional().describe("Dynamic facet filters (e.g. brand, genre)"),
      page: z.number().int().positive().optional().describe("Page number for pagination (default: 1)"),
      page_size: z.number().int().positive().optional().describe("Page size (default: 20)"),
      sort: z.enum(["price_asc", "price_desc", "relevance"]).optional().describe("Sort ordering"),
      reasoning: reasoningSchema,
    },
    async (params) => {
      const result = await gateway.search({
        query: params.query,
        merchant_id: params.merchant_id,
        filters: params.filters,
        page: params.page,
        pageSize: params.page_size,
        sort: params.sort,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(withReasoning(result as any, params.reasoning), null, 2),
          },
        ],
      };
    }
  );

  // 3. Get Product Details
  server.tool(
    "get_marketplace_product",
    "Retrieve authoritative product/offer details directly from the merchant.",
    {
      merchant_id: z.string().describe("Merchant identifier (e.g. techbazaar, pageturner)"),
      product_id: z.string().describe("Merchant-specific SKU or product ID"),
      reasoning: reasoningSchema,
    },
    async (params) => {
      const product = await gateway.getProduct(params.merchant_id, params.product_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(withReasoning(product as any, params.reasoning), null, 2),
          },
        ],
      };
    }
  );

  // 4. Create Checkout
  server.tool(
    "create_marketplace_checkout",
    "Create an authoritative checkout session on the specific merchant's backend.",
    {
      merchant_id: z.string().describe("Merchant identifier"),
      product_id: z.string().describe("Product SKU or offer ID"),
      quantity: z.number().int().positive().default(1).describe("Quantity to purchase"),
      variant: z.record(z.string()).optional().describe("Optional variant attributes"),
      reasoning: reasoningSchema,
    },
    async (params) => {
      const checkout = await gateway.createCheckout(
        params.merchant_id,
        params.product_id,
        params.quantity,
        params.variant
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(withReasoning(checkout as any, params.reasoning), null, 2),
          },
        ],
      };
    }
  );

  // 5. Get Order Status
  server.tool(
    "get_marketplace_order_status",
    "Poll real-time order confirmation and tracking status from the merchant.",
    {
      merchant_id: z.string().describe("Merchant identifier"),
      order_id: z.string().describe("Merchant order number"),
      reasoning: reasoningSchema,
    },
    async (params) => {
      const order = await gateway.getOrderStatus(params.merchant_id, params.order_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(withReasoning(order as any, params.reasoning), null, 2),
          },
        ],
      };
    }
  );

  // 6. Cancel Order
  server.tool(
    "cancel_marketplace_order",
    "Cancel an order on the target merchant platform.",
    {
      merchant_id: z.string().describe("Merchant identifier"),
      order_id: z.string().describe("Merchant order number"),
      reason: z.string().optional().describe("Cancellation reason"),
      reasoning: reasoningSchema,
    },
    async (params) => {
      const result = await gateway.cancelOrder(params.merchant_id, params.order_id, params.reason);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(withReasoning(result as any, params.reasoning), null, 2),
          },
        ],
      };
    }
  );

  return server;
}
