/**
 * Secret Hygiene & Ledger Boundary Redaction Unit Tests
 * Enforces Invariant 8: Secrets never enter the immutable audit ledger.
 * Verifies that redacted logs maintain cryptographic hash-chain and checkpoint integrity.
 */

import { describe, it, expect } from "vitest";
import { AuditLedger, redact } from "../../src/audit/ledger.js";
import { toolInvokedEvent, toolCompletedEvent } from "../../src/audit/events.js";

describe("Secret Hygiene & Ledger Redaction (Invariant 8)", () => {
  it("should recursively mask sensitive keys in objects", () => {
    const rawData = {
      user: "buyer_123",
      razorpay_key_secret: "rzp_secret_9999",
      nested: {
        api_token: "jwt.token.secret",
        password_hash: "bcrypt$12345",
        normal_field: "visible_value",
      },
      headers: {
        authorization: "Bearer secret_bearer_token",
      },
    };

    const redacted = redact(rawData);
    expect(redacted.razorpay_key_secret).toBe("[REDACTED]");
    expect(redacted.nested.api_token).toBe("[REDACTED]");
    expect(redacted.nested.password_hash).toBe("[REDACTED]");
    expect(redacted.nested.normal_field).toBe("visible_value");
    expect(redacted.headers.authorization).toBe("[REDACTED]");
  });

  it("should mask embedded Bearer tokens in plain string values", () => {
    const message = "Failed authorization attempt with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const redacted = redact(message);
    expect(redacted).toBe("Failed authorization attempt with Bearer [REDACTED]");
  });

  it("should record redacted payload into the ledger while verifying the hash chain cleanly", () => {
    const ledger = new AuditLedger(undefined, { signingSecret: "test_signing_secret", checkpointInterval: 2 });
    const txnId = "txn_redact_test_1";

    const sensitiveEvent = toolInvokedEvent(txnId, "prepare_purchase", {
      sku: "PROD-001",
      razorpay_key_secret: "very_sensitive_razorpay_secret_key",
      auth_token: "secret_token_123",
    });

    const event1 = ledger.append(sensitiveEvent);

    // Verify event in ledger has sensitive keys masked
    expect(event1.request?.params).toBeDefined();
    const params = event1.request?.params as Record<string, unknown>;
    expect(params.razorpay_key_secret).toBe("[REDACTED]");
    expect(params.auth_token).toBe("[REDACTED]");
    expect(params.sku).toBe("PROD-001");

    const completeEvent = toolCompletedEvent(txnId, "prepare_purchase", {
      status: "ok",
      checkout_id: "chk_123",
      cookie_secret: "cookie_val_abc",
    });
    const event2 = ledger.append(completeEvent);
    expect((event2.response as any).cookie_secret).toBe("[REDACTED]");

    // Verify hash chain
    const chainResult = ledger.verifyChain(txnId);
    expect(chainResult.valid).toBe(true);
    expect(chainResult.event_count).toBe(2);

    // Verify checkpoints
    const checkpointResult = ledger.verifyCheckpoints();
    expect(checkpointResult.valid).toBe(true);
  });
});
