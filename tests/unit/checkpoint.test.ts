import { describe, it, expect } from "vitest";
import { AuditLedger } from "../../src/audit/ledger.js";
import { AuditEventType } from "../../src/types/index.js";
import { generateDecisionReceipt } from "../../src/audit/receipt.js";
import { Transaction, TransactionState } from "../../src/types/index.js";

describe("Component 5b: Cryptographic Audit Checkpoints & Tamper Detection", () => {
  it("should periodically emit unsigned checkpoints when no signing secret is provided", () => {
    const ledger = new AuditLedger(undefined, { checkpointInterval: 3 });

    for (let i = 1; i <= 6; i++) {
      ledger.append({
        event_type: AuditEventType.STATE_TRANSITION,
        timestamp: new Date().toISOString(),
        transaction_id: "txn_test_1",
        actor: { type: "system" },
      });
    }

    const checkpoints = ledger.getCheckpoints();
    expect(checkpoints.length).toBe(2);
    expect(checkpoints[0].checkpoint_index).toBe(0);
    expect(checkpoints[0].algorithm).toBe("unsigned");
    expect(checkpoints[0].signature).toBeUndefined();
    expect(checkpoints[1].checkpoint_index).toBe(1);

    const verification = ledger.verifyCheckpoints();
    expect(verification.valid).toBe(true);
  });

  it("should generate and verify valid HMAC-SHA256 signatures when signing secret is set", () => {
    const signingSecret = "super-secret-audit-key-2026";
    const ledger = new AuditLedger(undefined, {
      checkpointInterval: 2,
      signingSecret,
    });

    for (let i = 1; i <= 4; i++) {
      ledger.append({
        event_type: AuditEventType.MCP_TOOL_INVOKED,
        timestamp: new Date().toISOString(),
        transaction_id: "txn_signed_test",
        actor: { type: "buyer_agent" },
      });
    }

    const checkpoints = ledger.getCheckpoints();
    expect(checkpoints.length).toBe(2);
    expect(checkpoints[0].algorithm).toBe("hmac-sha256");
    expect(checkpoints[0].signature).toBeDefined();
    expect(checkpoints[0].signature?.length).toBe(64); // SHA-256 hex string

    const verification = ledger.verifyCheckpoints();
    expect(verification.valid).toBe(true);
  });

  it("should detect signature tampering in checkpoints", () => {
    const signingSecret = "audit-key-tamper-check";
    const ledger = new AuditLedger(undefined, {
      checkpointInterval: 2,
      signingSecret,
    });

    for (let i = 1; i <= 2; i++) {
      ledger.append({
        event_type: AuditEventType.PAYMENT_CAPTURED,
        timestamp: new Date().toISOString(),
        transaction_id: "txn_tamper_cp",
        actor: { type: "razorpay" },
      });
    }

    const checkpoints = ledger.getCheckpoints();
    expect(checkpoints.length).toBe(1);

    // Tamper with the checkpoint signature
    checkpoints[0].signature = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    const verification = ledger.verifyCheckpoints();
    expect(verification.valid).toBe(false);
    expect(verification.first_invalid).toBe(0);
    expect(verification.error).toContain("signature verification failed");
  });

  it("should include checkpoint attestation line in Decision Receipt", () => {
    const ledger = new AuditLedger(undefined, {
      checkpointInterval: 2,
      signingSecret: "receipt-checkpoint-secret",
    });

    for (let i = 1; i <= 2; i++) {
      ledger.append({
        event_type: AuditEventType.CHECKOUT_CREATED,
        timestamp: new Date().toISOString(),
        transaction_id: "txn_receipt_cp",
        actor: { type: "mcp" },
      });
    }

    const mockTxn: Transaction = {
      transaction_id: "txn_receipt_cp",
      state: TransactionState.CHECKOUT_CREATED,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      agent_claim: {
        product_id: "prod_1",
        title: "Test Item",
        quantity: 1,
        selection_reason: "Testing",
      },
    };

    const events = ledger.getTransactionAudit("txn_receipt_cp");
    const lastCheckpoint = ledger.getLastCheckpoint();
    expect(lastCheckpoint).toBeDefined();

    const receipt = generateDecisionReceipt(mockTxn, events, true, lastCheckpoint);
    expect(receipt).toContain("Last Checkpoint  : #0 (HMAC-SHA256 at");
  });
});
