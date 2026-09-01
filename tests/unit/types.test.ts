import { describe, it, expect } from "vitest";
import { TransactionState, AuditEventType } from "../../src/types/index.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

describe("Phase-1 Core Types Verification", () => {
  it("should have correct TransactionState lifecycle states", () => {
    expect(TransactionState.CREATED).toBe("CREATED");
    expect(TransactionState.CHECKOUT_CREATED).toBe("CHECKOUT_CREATED");
    expect(TransactionState.PAYMENT_PENDING).toBe("PAYMENT_PENDING");
    expect(TransactionState.PAYMENT_AUTHORIZED).toBe("PAYMENT_AUTHORIZED");
    expect(TransactionState.ORDER_CONFIRMED).toBe("ORDER_CONFIRMED");
    expect(TransactionState.FAILED).toBe("FAILED");
    expect(TransactionState.CANCELLED).toBe("CANCELLED");
  });

  it("should have all expected AuditEventType entries", () => {
    expect(AuditEventType.MCP_TOOL_INVOKED).toBe("MCP_TOOL_INVOKED");
    expect(AuditEventType.POLICY_EVALUATED).toBe("POLICY_EVALUATED");
    expect(AuditEventType.PAYMENT_CAPTURED).toBe("PAYMENT_CAPTURED");
    expect(AuditEventType.ORDER_CONFIRMED).toBe("ORDER_CONFIRMED");
  });

  it("should allow creating a valid sample manifest structure", () => {
    const sampleManifest: IntegrationManifest = {
      merchant: {
        name: "TestStore",
        description: "Test electronics store",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "http://localhost:4001",
      },
      auth: { type: "none" },
      operations: {
        search: { method: "POST", path: "/api/search" },
        get_product: { method: "GET", path: "/api/products/:product_id" },
        create_checkout: { method: "POST", path: "/api/checkout" },
        get_checkout: { method: "GET", path: "/api/checkout/:checkout_id" },
        confirm_order: { method: "POST", path: "/api/orders" },
        get_order_status: { method: "GET", path: "/api/orders/:order_id" },
      },
      filters: [
        { key: "category", label: "Category", type: "enum", options: [{ value: "laptop", label: "Laptop" }] },
      ],
      field_mappings: {
        offer: {
          offer_id: { from: "$.sku" },
          title: { from: "$.name" },
          "price.amount": { from: "$.price", transform: { type: "multiply", value: 100 } },
        },
        checkout: {
          checkout_id: { from: "$.id" },
        },
        order: {
          order_id: { from: "$.order_id" },
        },
      },
      payment: {
        provider: "razorpay",
        razorpay_key_id_env: "RAZORPAY_KEY_ID",
        razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
      },
    };

    expect(sampleManifest.merchant.name).toBe("TestStore");
    expect(sampleManifest.operations.search.method).toBe("POST");
  });
});
