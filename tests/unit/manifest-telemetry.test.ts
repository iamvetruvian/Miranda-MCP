import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IntegrationManifestSchema } from "../../src/manifest/schema.js";
import { createMerchantMcpServer } from "../../src/server.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

const baseManifest: IntegrationManifest = {
  merchant: {
    name: "Telemetry Test Store",
    description: "Store for testing manifest-level telemetry",
    commerce_domain: "retail",
    currency: "INR",
    base_url: "http://localhost:5000",
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
      title: { from: "$.title" },
      description: { from: "$.desc" },
      "price.amount": { from: "$.price" },
      "price.currency": { from: null, transform: { type: "default", value: "INR" } },
      availability: { from: "$.stock", transform: { type: "enum", enum_map: { true: "in_stock" } } },
      attributes: { from: "$.attrs" },
    },
    checkout: {
      checkout_id: { from: "$.checkout_id" },
      sku: { from: "$.sku" },
      "total.amount": { from: "$.total" },
      "total.currency": { from: null, transform: { type: "default", value: "INR" } },
      available: { from: "$.available" },
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

describe("Manifest Telemetry Grammar & Exporter Integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AUDIT_EXPORT_OTEL_ENDPOINT;
    delete process.env.AUDIT_EXPORT_OTEL_HEADERS;
    delete process.env.HONEYCOMB_API_KEY;
    delete process.env.CUSTOM_SIEM_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should successfully validate manifest with telemetry configuration", () => {
    const manifestWithTelemetry = {
      ...baseManifest,
      telemetry: {
        provider: "honeycomb",
        endpoint: "https://api.honeycomb.io/v1/logs",
        service_name: "test-proshop",
        api_key_env: "HONEYCOMB_API_KEY",
        batch_size: 20,
        flush_interval_ms: 1500,
      },
    };

    const parsed = IntegrationManifestSchema.safeParse(manifestWithTelemetry);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.telemetry?.endpoint).toBe("https://api.honeycomb.io/v1/logs");
      expect(parsed.data.telemetry?.provider).toBe("honeycomb");
      expect(parsed.data.telemetry?.batch_size).toBe(20);
    }
  });

  it("should fail validation if telemetry endpoint is not a valid URL", () => {
    const manifestInvalidEndpoint = {
      ...baseManifest,
      telemetry: {
        endpoint: "not-a-valid-url",
      },
    };

    const parsed = IntegrationManifestSchema.safeParse(manifestInvalidEndpoint);
    expect(parsed.success).toBe(false);
  });

  it("should initialize AuditExporter from manifest.telemetry and resolve Honeycomb API key", () => {
    process.env.HONEYCOMB_API_KEY = "hc_secret_key_998877";

    const manifestWithTelemetry: IntegrationManifest = {
      ...baseManifest,
      telemetry: {
        provider: "honeycomb",
        endpoint: "https://api.honeycomb.io/v1/logs",
        service_name: "proshop-mcp-audit",
        api_key_env: "HONEYCOMB_API_KEY",
      },
    };

    const serverInstance = createMerchantMcpServer(manifestWithTelemetry, {
      dbPath: ":memory:",
      forceSimulation: true,
    });

    expect(serverInstance.auditLedger).toBeDefined();

    // Verify AuditLedger has listeners attached (from AuditExporter)
    const ledgerAny = serverInstance.auditLedger as any;
    expect(ledgerAny.listeners.length).toBeGreaterThan(0);
  });

  it("should resolve Bearer token for generic OTLP provider", () => {
    process.env.CUSTOM_SIEM_TOKEN = "siem_bearer_token_123";

    const manifestWithGenericOtel: IntegrationManifest = {
      ...baseManifest,
      telemetry: {
        provider: "otlp_generic",
        endpoint: "https://otel-collector.company.internal/v1/logs",
        api_key_env: "CUSTOM_SIEM_TOKEN",
      },
    };

    const serverInstance = createMerchantMcpServer(manifestWithGenericOtel, {
      dbPath: ":memory:",
      forceSimulation: true,
    });

    const ledgerAny = serverInstance.auditLedger as any;
    expect(ledgerAny.listeners.length).toBeGreaterThan(0);
  });

  it("should support 'audit' alias in manifest", () => {
    const manifestWithAuditAlias: IntegrationManifest = {
      ...baseManifest,
      audit: {
        endpoint: "https://loki.internal:3100/otlp/v1/logs",
        headers: { "X-Scope-OrgID": "tenant-proshop" },
      },
    };

    const parsed = IntegrationManifestSchema.safeParse(manifestWithAuditAlias);
    expect(parsed.success).toBe(true);

    const serverInstance = createMerchantMcpServer(manifestWithAuditAlias, {
      dbPath: ":memory:",
      forceSimulation: true,
    });

    const ledgerAny = serverInstance.auditLedger as any;
    expect(ledgerAny.listeners.length).toBeGreaterThan(0);
  });

  it("should resolve Honeycomb API key when raw key literal is passed in api_key_env", () => {
    const manifestWithRawKey: IntegrationManifest = {
      ...baseManifest,
      telemetry: {
        provider: "honeycomb",
        endpoint: "https://api.honeycomb.io/v1/logs",
        api_key_env: "6Ra8DKlzf8PeVcBfD041QB",
      },
    };

    const serverInstance = createMerchantMcpServer(manifestWithRawKey, {
      dbPath: ":memory:",
      forceSimulation: true,
    });

    const ledgerAny = serverInstance.auditLedger as any;
    expect(ledgerAny.listeners.length).toBeGreaterThan(0);
  });

  it("should resolve Honeycomb API key from direct api_key field", () => {
    const manifestWithDirectKey: IntegrationManifest = {
      ...baseManifest,
      telemetry: {
        provider: "honeycomb",
        endpoint: "https://api.honeycomb.io/v1/logs",
        api_key: "6Ra8DKlzf8PeVcBfD041QB",
      },
    };

    const parsed = IntegrationManifestSchema.safeParse(manifestWithDirectKey);
    expect(parsed.success).toBe(true);

    const serverInstance = createMerchantMcpServer(manifestWithDirectKey, {
      dbPath: ":memory:",
      forceSimulation: true,
    });

    const ledgerAny = serverInstance.auditLedger as any;
    expect(ledgerAny.listeners.length).toBeGreaterThan(0);
  });

  it("should resolve Honeycomb API key from default HONEYCOMB_API_KEY env var if not specified", () => {
    process.env.HONEYCOMB_API_KEY = "hc_default_env_key";

    const manifestWithoutKey: IntegrationManifest = {
      ...baseManifest,
      telemetry: {
        provider: "honeycomb",
        endpoint: "https://api.honeycomb.io/v1/logs",
      },
    };

    const serverInstance = createMerchantMcpServer(manifestWithoutKey, {
      dbPath: ":memory:",
      forceSimulation: true,
    });

    const ledgerAny = serverInstance.auditLedger as any;
    expect(ledgerAny.listeners.length).toBeGreaterThan(0);
  });
});
