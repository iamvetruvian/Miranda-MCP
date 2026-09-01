/**
 * UCP Protocol Alignment Unit Tests
 * Verifies buildUcpProfile, TO_UCP_CHECKOUT_STATUS mappings,
 * actions envelope projections, and UcpNativeConnector passthrough.
 */

import { describe, it, expect } from "vitest";
import { buildUcpProfile } from "../../src/ucp/profile.js";
import { TO_UCP_CHECKOUT_STATUS, projectUcpEnvelope } from "../../src/ucp/mapping.js";
import { deriveCapabilityMatrix } from "../../src/connector/capabilities.js";
import { UcpNativeConnector } from "../../src/connector/ucp-native.js";
import { Transaction, TransactionState } from "../../src/types/index.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

const sampleRetailManifest: IntegrationManifest = {
  merchant: {
    name: "TechBazaar",
    description: "Consumer Electronics",
    commerce_domain: "retail",
    currency: "INR",
    base_url: "https://api.techbazaar.local",
  },
  operations: {
    search: { method: "GET", path: "/products" },
    get_product: { method: "GET", path: "/products/:product_id" },
    create_checkout: { method: "POST", path: "/checkout" },
    get_checkout: { method: "GET", path: "/checkout/:checkout_id" },
    confirm_order: { method: "POST", path: "/orders" },
    get_order_status: { method: "GET", path: "/orders/:order_id" },
    cancel_order: { method: "POST", path: "/orders/:order_id/cancel" },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.id" },
      title: { from: "$.name" },
      description: { from: "$.desc" },
      "price.amount": { from: "$.price" },
      "price.currency": { from: null, transform: { type: "default", value: "INR" } },
      availability: { from: "$.stock", transform: { type: "enum", enum_map: { available: "in_stock" } } },
      attributes: { from: "$.specs" },
    },
    checkout: {
      checkout_id: { from: "$.chk_id" },
      sku: { from: "$.sku" },
      "total.amount": { from: "$.total_amount" },
      "total.currency": { from: null, transform: { type: "default", value: "INR" } },
      available: { from: "$.is_avail" },
    },
    order: {
      order_id: { from: "$.ord_id" },
      status: { from: "$.order_status" },
    },
  },
  refinements: {
    brand: { field: "brand", type: "enum" },
    price: { field: "price", type: "range" },
  },
  payment: {
    provider: "razorpay",
    razorpay_key_id_env: "TB_KEY_ID",
    razorpay_key_secret_env: "TB_KEY_SECRET",
  },
};

const sampleTicketingManifest: IntegrationManifest = {
  merchant: {
    name: "TicketVerse",
    description: "Cinema Ticketing",
    commerce_domain: "ticketing",
    currency: "INR",
    base_url: "https://api.ticketverse.local",
  },
  discovery_schema: [
    { name: "city", type: "string", required: true, description: "City name" },
    { name: "date", type: "date", required: true, description: "Show date" },
  ],
  operations: {
    search: { method: "GET", path: "/showtimes" },
    get_product: { method: "GET", path: "/showtimes/:product_id" },
    create_checkout: { method: "POST", path: "/seats/hold" },
    get_checkout: { method: "GET", path: "/seats/hold/:checkout_id" },
    confirm_order: { method: "POST", path: "/bookings" },
    get_order_status: { method: "GET", path: "/bookings/:order_id" },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.id" },
      title: { from: "$.movie" },
      description: { from: "$.cinema" },
      "price.amount": { from: "$.price" },
      "price.currency": { from: null, transform: { type: "default", value: "INR" } },
      availability: { from: "$.available", transform: { type: "boolean_to_enum", in_stock_value: true } },
      attributes: { from: "$.details" },
    },
    checkout: {
      checkout_id: { from: "$.hold_id" },
      sku: { from: "$.show_id" },
      "total.amount": { from: "$.amount" },
      "total.currency": { from: null, transform: { type: "default", value: "INR" } },
      available: { from: "$.held" },
    },
    order: {
      order_id: { from: "$.pnr" },
      status: { from: "$.status" },
    },
  },
  payment: {
    provider: "razorpay",
    razorpay_key_id_env: "TV_KEY_ID",
    razorpay_key_secret_env: "TV_KEY_SECRET",
  },
};

describe("UCP Protocol Profile Projection (buildUcpProfile)", () => {
  it("should project full retail capability matrix into standard UCP profile", () => {
    const matrix = deriveCapabilityMatrix(sampleRetailManifest);
    const ucp = buildUcpProfile(matrix, sampleRetailManifest);

    expect(ucp.ucp_version).toBe("2026-01-11");
    expect(ucp.profile.merchant.name).toBe("TechBazaar");
    expect(ucp.profile.merchant.commerce_domain).toBe("retail");
    expect(ucp.profile.integration_level).toBe("fully_manageable");

    const caps = ucp.profile.capabilities;
    const checkoutCap = caps.find((c) => c.capability === "shopping.checkout");
    const catalogCap = caps.find((c) => c.capability === "shopping.catalog");
    const cancelCap = caps.find((c) => c.capability === "shopping.order.cancel");
    const refundCap = caps.find((c) => c.capability === "payment.refunds");

    expect(checkoutCap?.status).toBe("supported");
    expect(catalogCap?.status).toBe("supported");
    expect(catalogCap?.note).toContain("retail-style");
    expect(cancelCap?.status).toBe("supported");
    expect(refundCap?.status).toBe("supported");

    expect(ucp.profile.extensions.refinements).toBe("com.merchantmcp.refinements.v1");
    expect(ucp.profile.extensions.mandates).toBe("com.merchantmcp.mandates.v1");
  });

  it("should project ticketing discovery schema note in UCP profile", () => {
    const matrix = deriveCapabilityMatrix(sampleTicketingManifest);
    const ucp = buildUcpProfile(matrix, sampleTicketingManifest);

    expect(ucp.profile.merchant.name).toBe("TicketVerse");
    expect(ucp.profile.merchant.commerce_domain).toBe("ticketing");
    const catalogCap = ucp.profile.capabilities.find((c) => c.capability === "shopping.catalog");
    expect(catalogCap?.note).toContain("domain discovery via discovery_schema");
  });
});

describe("UCP Lifecycle Status & Actions Envelope", () => {
  it("should map all TransactionStates to exact UCP checkout lifecycle statuses", () => {
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.CREATED]).toBe("incomplete");
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.CHECKOUT_CREATED]).toBe("incomplete");
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.MANDATE_EVALUATED]).toBe("requires_escalation");
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.PAYMENT_PENDING]).toBe("ready_for_complete");
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.PAYMENT_AUTHORIZED]).toBe("complete_in_progress");
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.ORDER_CONFIRMED]).toBe("completed");
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.REFUND_PENDING]).toBe("completed");
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.REFUNDED]).toBe("canceled");
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.FAILED]).toBe("canceled");
    expect(TO_UCP_CHECKOUT_STATUS[TransactionState.CANCELLED]).toBe("canceled");
  });

  it("should project standard UCP envelope for payment pending state", () => {
    const mockTxn: Transaction = {
      transaction_id: "txn_ucp_001",
      state: TransactionState.PAYMENT_PENDING,
      created_at: new Date().toISOString(),
      agent_claim: { product_id: "p1", quantity: 1, selection_reason: "test" },
      audit_event_ids: [],
    };

    const envelope = projectUcpEnvelope(mockTxn);
    expect(envelope.checkout_status).toBe("ready_for_complete");
    expect(envelope.actions).toBeUndefined();
  });

  it("should embed com.merchantmcp.mandates.consent action when state is MANDATE_EVALUATED", () => {
    const mockTxn: Transaction = {
      transaction_id: "txn_ucp_002",
      state: TransactionState.MANDATE_EVALUATED,
      created_at: new Date().toISOString(),
      agent_claim: { product_id: "p1", quantity: 1, selection_reason: "test" },
      audit_event_ids: [],
    };

    const envelope = projectUcpEnvelope(mockTxn, {
      "com.merchantmcp.mandates.consent": [
        {
          id: "chn_test_99",
          config: { consent_url: "https://mcp.local/consent/chn_test_99", expires_at: "2026-12-31" },
        },
      ],
    });

    expect(envelope.checkout_status).toBe("requires_escalation");
    expect(envelope.actions).toBeDefined();
    expect(envelope.actions!["com.merchantmcp.mandates.consent"]).toHaveLength(1);
    expect(envelope.actions!["com.merchantmcp.mandates.consent"][0].id).toBe("chn_test_99");
  });
});

describe("UcpNativeConnector (Tier 0 Passthrough)", () => {
  it("should initialize with custom endpoint or merchant base_url", () => {
    const nativeManifest: IntegrationManifest = {
      ...sampleRetailManifest,
      integration: {
        type: "ucp_native",
        endpoint: "https://ucp.merchant.com/v1",
      },
    } as any;

    const connector = new UcpNativeConnector(nativeManifest);
    expect(connector.getManifest()).toBe(nativeManifest);
  });
});
