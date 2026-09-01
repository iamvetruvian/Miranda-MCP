/**
 * Manifest v2 Schema & Diagnostics Unit Tests
 * Verifies Zod validation, static diagnostics, capability gap analysis, and backward compatibility.
 */

import { describe, it, expect } from "vitest";
import { diagnoseManifest } from "../../src/manifest/diagnostics.js";
import { IntegrationManifestSchema } from "../../src/manifest/schema.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

const sampleV2Manifest: IntegrationManifest = {
  merchant: {
    name: "OmniStore",
    description: "Omnichannel Retailer with multi-currency and timezone",
    commerce_domain: "retail",
    currency: "INR",
    base_url: "https://api.omnistore.local",
    supported_currencies: ["INR", "USD", "EUR"],
    timezone: "Asia/Kolkata",
    locale: "en-IN",
  },
  auth: {
    type: "bearer",
    token_env_var: "OMNI_TOKEN",
  },
  http_conventions: {
    content_type: "application/json",
    accept: "application/json",
    retry: {
      max_retries: 3,
      retryable_status_codes: [429, 503],
    },
  },
  pagination: {
    strategy: "page_number",
    page_param: "p",
    page_size_param: "size",
    default_page_size: 25,
  },
  error_mapping: {
    status_code_map: {
      404: { category: "not_found", message: "Item or checkout not found" },
      409: { category: "out_of_stock", message: "Item went out of stock during checkout" },
    },
  },
  operations: {
    search: { method: "GET", path: "/items" },
    get_product: { method: "GET", path: "/items/:product_id" },
    create_checkout: { method: "POST", path: "/checkout" },
    get_checkout: { method: "GET", path: "/checkout/:checkout_id" },
    confirm_order: { method: "POST", path: "/orders" },
    get_order_status: { method: "GET", path: "/orders/:order_id" },
    cancel_order: { method: "POST", path: "/orders/:order_id/cancel" },
    apply_coupon: { method: "POST", path: "/checkout/:checkout_id/coupons" },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.id" },
      title: { from: "$.title" },
      description: { from: "$.desc" },
      "price.amount": { from: "$.price_paise" },
      "price.currency": { from: null, transform: { type: "default", value: "INR" } },
      availability: { from: "$.stock", transform: { type: "enum", enum_map: { true: "in_stock" } } },
      attributes: { from: "$.specs" },
    },
    checkout: {
      checkout_id: { from: "$.id" },
      sku: { from: "$.sku" },
      "total.amount": { from: "$.total" },
      "total.currency": { from: null, transform: { type: "default", value: "INR" } },
      available: { from: "$.in_stock" },
    },
    order: {
      order_id: { from: "$.order_number" },
      status: { from: "$.order_status" },
    },
  },
  sort_options: {
    options: [
      { key: "relevance", label: "Relevance", merchant_value: "rel" },
      { key: "price_asc", label: "Price: Low to High", merchant_value: "price_asc" },
    ],
  },
  attribute_catalog: {
    attributes: [
      { key: "brand", label: "Brand", type: "string", filterable: true },
      { key: "screen_size", label: "Screen Size", type: "number", filterable: true },
    ],
  },
  transaction: {
    coupons: {
      supported: true,
      apply_operation: { method: "POST", path: "/checkout/:checkout_id/coupons" },
      code_param: "code",
    },
  },
  payment: {
    provider: "razorpay",
    razorpay_key_id_env: "OMNI_KEY",
    razorpay_key_secret_env: "OMNI_SECRET",
  },
};

describe("Manifest v2 Schema & Diagnostics", () => {
  it("should validate a complete Manifest v2 successfully", () => {
    const parseResult = IntegrationManifestSchema.safeParse(sampleV2Manifest);
    expect(parseResult.success).toBe(true);
  });

  it("should diagnose a valid manifest with 0 errors and classify as fully_manageable", () => {
    const report = diagnoseManifest(sampleV2Manifest);
    expect(report.validation_passed).toBe(true);
    expect(report.integration_level).toBe("fully_manageable");
    expect(report.issues.filter((i) => i.severity === "error")).toHaveLength(0);

    // Capabilities check
    expect(report.capability_matrix.discovery.supported).toBe(true);
    expect(report.capability_matrix.transaction.supported).toBe(true);
    expect(report.capability_matrix.cancellation.supported).toBe(true);
    expect(report.capability_matrix.coupon_support.supported).toBe(true);
    expect(report.capability_matrix.sort_options.supported).toBe(true);
    expect(report.capability_matrix.attribute_catalog.supported).toBe(true);
  });

  it("should catch schema errors when required fields are missing", () => {
    const invalidManifest = {
      merchant: {
        name: "Broken Store",
        // missing description, commerce_domain, currency, base_url
      },
    };

    const report = diagnoseManifest(invalidManifest);
    expect(report.validation_passed).toBe(false);
    expect(report.issues.some((i) => i.code === "SCHEMA_VALIDATION_ERROR")).toBe(true);
  });

  it("should warn when offer default currency does not match merchant currency", () => {
    const mismatchedManifest: IntegrationManifest = {
      ...sampleV2Manifest,
      merchant: {
        ...sampleV2Manifest.merchant,
        currency: "USD",
      },
    };

    const report = diagnoseManifest(mismatchedManifest);
    const currencyWarning = report.issues.find((i) => i.code === "CURRENCY_MISMATCH");
    expect(currencyWarning).toBeDefined();
    expect(currencyWarning?.severity).toBe("warning");
  });

  it("should report unexposed capabilities with clear suggestions", () => {
    const minimalManifest: IntegrationManifest = {
      merchant: {
        name: "Minimal Store",
        description: "Minimal store description",
        commerce_domain: "retail",
        currency: "INR",
        base_url: "https://api.minimal.local",
      },
      operations: {
        search: { method: "GET", path: "/items" },
        get_product: { method: "GET", path: "/items/:product_id" },
        create_checkout: { method: "POST", path: "/checkout" },
        get_checkout: { method: "GET", path: "/checkout/:checkout_id" },
        confirm_order: { method: "POST", path: "/orders" },
        get_order_status: { method: "GET", path: "/orders/:order_id" },
      },
      field_mappings: {
        offer: {
          offer_id: { from: "$.id" },
          title: { from: "$.name" },
          description: { from: "$.desc" },
          "price.amount": { from: "$.price" },
          "price.currency": { from: null, transform: { type: "default", value: "INR" } },
          availability: { from: "$.stock", transform: { type: "enum", enum_map: { true: "in_stock" } } },
          attributes: { from: "$.attrs" },
        },
        checkout: {
          checkout_id: { from: "$.id" },
          sku: { from: "$.sku" },
          "total.amount": { from: "$.total" },
          "total.currency": { from: null, transform: { type: "default", value: "INR" } },
          available: { from: "$.avail" },
        },
        order: {
          order_id: { from: "$.id" },
          status: { from: "$.status" },
        },
      },
      payment: {
        provider: "razorpay",
        razorpay_key_id_env: "MIN_KEY",
        razorpay_key_secret_env: "MIN_SECRET",
      },
    };

    const report = diagnoseManifest(minimalManifest);
    expect(report.validation_passed).toBe(true);
    expect(report.integration_level).toBe("transactable");

    const unexposed = report.unexposed_capabilities;
    expect(unexposed.some((u) => u.capability === "shopping.order.cancel")).toBe(true);
    expect(unexposed.some((u) => u.capability === "intent.autocomplete")).toBe(true);
    expect(unexposed.some((u) => u.capability === "transaction.multi_item_cart")).toBe(true);
    expect(unexposed.some((u) => u.capability === "transaction.coupons")).toBe(true);
  });

  it("should validate a manifest with OAuth2 user authorization flow and protected operations", () => {
    const oauthManifest: IntegrationManifest = {
      ...sampleV2Manifest,
      auth: {
        type: "oauth2_authorization_code",
        oauth2_user: {
          authorization_url: "https://api.omnistore.local/oauth/authorize",
          token_url: "https://api.omnistore.local/oauth/token",
          client_id_env: "OMNI_OAUTH_CLIENT_ID",
          client_secret_env: "OMNI_OAUTH_CLIENT_SECRET",
          scopes: ["read", "write"],
          access_token_path: "$.access_token",
          refresh_token_path: "$.refresh_token",
          expires_in_path: "$.expires_in",
          user_id_path: "$.user.id",
          user_name_path: "$.user.name",
          use_pkce: true,
          session_ttl_seconds: 2592000,
        },
        protected_operations: ["create_checkout", "confirm_order"],
        public_operations: ["search", "get_product"],
      },
    };

    const parsed = IntegrationManifestSchema.safeParse(oauthManifest);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.auth?.oauth2_user?.authorization_url).toBe("https://api.omnistore.local/oauth/authorize");
    expect(parsed.data?.auth?.protected_operations).toContain("create_checkout");
  });

  it("should fail validation when OAuth2 user flow has invalid URLs or missing required env names", () => {
    const invalidOauthManifest = {
      ...sampleV2Manifest,
      auth: {
        type: "oauth2_authorization_code",
        oauth2_user: {
          authorization_url: "not-a-url",
          token_url: "https://api.omnistore.local/oauth/token",
          client_id_env: "",
          client_secret_env: "OMNI_SECRET",
        },
      },
    };

    const parsed = IntegrationManifestSchema.safeParse(invalidOauthManifest);
    expect(parsed.success).toBe(false);
  });
});
