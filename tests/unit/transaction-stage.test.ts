/**
 * Component 5: Transaction Stage Runtime Unit Tests
 * Tests multi-item carts (addToCart, getCart, checkoutCart), coupons,
 * delivery options, customer data collection, and cart model branching.
 */

import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { registerTransactionTools } from "../../src/tools/transaction.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { RazorpayAdapter } from "../../src/payment/razorpay.js";
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

describe("Component 5: Transaction Stage Runtime", () => {
  it("should add items to multi-item cart and calculate totals", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "GroceryStore",
        description: "Online supermarket",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.grocery.local",
      },
      transaction: {
        cart: {
          model: "multi_item",
          multi_item: {
            create_cart_operation: { method: "POST", path: "/carts" },
            add_item_operation: { method: "POST", path: "/carts/:cart_id/items" },
            get_cart_operation: { method: "GET", path: "/carts/:cart_id" },
            cart_item_mapping: {
              item_id_path: "$.id",
              product_id_path: "$.sku",
              quantity_path: "$.qty",
              unit_price_path: "$.price",
            },
            cart_total_path: "$.summary.grand_total",
            persistent: true,
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

    // Mock cart operations
    vi.spyOn(connector, "executeOperationFromConfig").mockImplementation(async (opConfig, params) => {
      if (opConfig.path === "/carts") {
        return { cart_id: "cart_abc123" };
      }
      if (opConfig.path === "/carts/:cart_id/items") {
        return { success: true };
      }
      if (opConfig.path === "/carts/:cart_id") {
        return {
          id: "cart_abc123",
          items: [
            { id: "item_1", sku: "MILK-001", qty: 2, price: 6000 },
            { id: "item_2", sku: "BREAD-002", qty: 1, price: 4000 },
          ],
          summary: { grand_total: 16000 },
        };
      }
      return {};
    });

    const result = await connector.addToCart(null, "MILK-001", 2);
    expect(result.cart_id).toBe("cart_abc123");
    expect(result.items.length).toBe(2);
    expect(result.items[0].product_id).toBe("MILK-001");
    expect(result.cart_total.amount).toBe(16000);
    expect(result.cart_total.currency).toBe("INR");
  });

  it("should apply discount coupons and return discount amount", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "PromoStore",
        description: "Store with coupons",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.promo.local",
      },
      transaction: {
        coupons: {
          supported: true,
          apply_operation: { method: "POST", path: "/checkouts/:checkout_id/coupons" },
          code_param: "promo_code",
          discount_amount_path: "$.savings.discount_val",
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
      savings: { discount_val: 50000 },
      message: "FLAT500 coupon applied successfully!",
    });

    const result = await connector.applyCoupon("chk_123", "FLAT500");
    expect(result.success).toBe(true);
    expect(result.discount_amount?.amount).toBe(50000);
  });

  it("should get and select delivery options", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "DeliveryStore",
        description: "Store with shipping options",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.delivery.local",
      },
      transaction: {
        delivery: {
          type: "shipping",
          options_available: true,
          shipping_options: {
            operation: { method: "GET", path: "/checkouts/:checkout_id/shipping-rates" },
            options_path: "$.rates",
            option_mapping: {
              id_path: "$.rate_id",
              name_path: "$.carrier",
              price_path: "$.cost",
              estimated_days_path: "$.est_days",
            },
            selection_param: "chosen_rate",
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
      rates: [
        { rate_id: "STD", carrier: "Standard Delivery (3-5 days)", cost: 5000, est_days: 4 },
        { rate_id: "EXP", carrier: "Express Delivery (Next Day)", cost: 15000, est_days: 1 },
      ],
    });

    const rates = await connector.getDeliveryOptions("chk_123");
    expect(rates.length).toBe(2);
    expect(rates[0].id).toBe("STD");
    expect(rates[0].price.amount).toBe(5000);

    const selection = await connector.selectDeliveryOption("chk_123", "EXP");
    expect(selection.success).toBe(true);
    expect(selection.selected_option).toBe("EXP");
  });

  it("should enforce customer data collection in prepare_purchase when required", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "PharmaStore",
        description: "Pharmacy",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.pharma.local",
      },
      transaction: {
        customer_data: {
          required: [
            { field: "email", label: "Email Address", type: "email" },
            { field: "shipping_address", label: "Shipping Address", type: "address" },
          ],
          optional: [
            { field: "phone", label: "Phone Number", type: "phone" },
          ],
          mapping: {
            email: { merchant_param: "cust_email" },
            shipping_address: { merchant_param: "delivery_addr" },
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
    const txnManager = new TransactionManager();
    const policyEngine = new PolicyEngine();
    const paymentAdapter = new RazorpayAdapter();
    const auditLedger = new AuditLedger();

    const { server, tools } = createMockServer();
    registerTransactionTools(server, connector, txnManager, policyEngine, paymentAdapter, auditLedger);

    const prepareTool = tools.get("prepare_purchase")!;

    // Missing customer data
    const resMissing = await prepareTool.handler({
      product_id: "MED-001",
      quantity: 1,
      selection_reason: "Testing customer data requirement",
    });

    const payload = JSON.parse(resMissing.content[0].text);
    expect(payload.status).toBe("customer_data_required");
    expect(payload.required_fields.length).toBe(2);
    expect(payload.required_fields[0].field).toBe("email");
  });

  it("should reject prepare_purchase when merchant uses multi_item cart model", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "CartOnlyStore",
        description: "Multi-item store",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.cartonly.local",
      },
      transaction: {
        cart: { model: "multi_item" },
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
    const txnManager = new TransactionManager();
    const policyEngine = new PolicyEngine();
    const paymentAdapter = new RazorpayAdapter();
    const auditLedger = new AuditLedger();

    const { server, tools } = createMockServer();
    registerTransactionTools(server, connector, txnManager, policyEngine, paymentAdapter, auditLedger);

    const prepareTool = tools.get("prepare_purchase")!;
    const res = await prepareTool.handler({
      product_id: "PROD-001",
      quantity: 1,
      selection_reason: "Trying direct purchase",
    });

    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.error).toContain("multi-item carts");
    expect(payload.suggestion).toBe("add_to_cart");
  });
});
