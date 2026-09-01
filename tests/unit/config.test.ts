/**
 * Runtime Configuration Unit Tests
 * Tests environment parsing, defaults, per-currency limits, and fail-fast validation.
 */

import { describe, it, expect } from "vitest";
import { loadRuntimeConfig } from "../../src/config.js";

describe("RuntimeConfig", () => {
  it("should load standard default configuration when env is empty", () => {
    const config = loadRuntimeConfig({});
    expect(config.port).toBe(4000);
    expect(config.host).toBe("0.0.0.0");
    expect(config.authMode).toBe("none");
    expect(config.rateLimitEnabled).toBe(true);
    expect(config.rateLimitBurst).toBe(60);
    expect(config.maxTransactionLimits.INR).toBe(500000);
  });

  it("should parse custom environment variables correctly", () => {
    const env = {
      PORT: "8080",
      HOST: "127.0.0.1",
      AUTH_MODE: "mandates",
      MANDATE_SIGNING_SECRET: "super_secret_mandate_key",
      LEDGER_SIGNING_SECRET: "super_secret_ledger_key",
      LEDGER_CHECKPOINT_INTERVAL: "50",
      MAX_TRANSACTION_INR: "1000000",
      RATE_LIMIT_BURST: "120",
      RATE_LIMIT_REFILL_PER_MIN: "120",
      AUDIT_EXPORT_OTEL_ENDPOINT: "http://localhost:4318/v1/logs",
    };

    const config = loadRuntimeConfig(env);
    expect(config.port).toBe(8080);
    expect(config.host).toBe("127.0.0.1");
    expect(config.authMode).toBe("mandates");
    expect(config.mandateSigningSecret).toBe("super_secret_mandate_key");
    expect(config.ledgerSigningSecret).toBe("super_secret_ledger_key");
    expect(config.ledgerCheckpointInterval).toBe(50);
    expect(config.maxTransactionLimits.INR).toBe(1000000);
    expect(config.rateLimitBurst).toBe(120);
    expect(config.auditExportOtelEndpoint).toBe("http://localhost:4318/v1/logs");
  });

  it("should fail fast if authMode is mandates but MANDATE_SIGNING_SECRET is missing", () => {
    expect(() => {
      loadRuntimeConfig({
        AUTH_MODE: "mandates",
      });
    }).toThrow(/MANDATE_SIGNING_SECRET is required/);
  });

  it("should fail fast on invalid port or URL types", () => {
    expect(() => {
      loadRuntimeConfig({
        PORT: "not-a-number",
      });
    }).toThrow(/Fatal Configuration Error/);

    expect(() => {
      loadRuntimeConfig({
        AUDIT_EXPORT_OTEL_ENDPOINT: "invalid-url-string",
      });
    }).toThrow(/Fatal Configuration Error/);
  });
});
