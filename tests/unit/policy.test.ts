import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/policy/engine.js";
import {
  AmountBoundsGate,
  CheckoutBindingGate,
  TransactionStateGate,
  IdempotencyGate,
  CurrencyConsistencyGate,
} from "../../src/policy/gates.js";
import { Transaction, TransactionState } from "../../src/types/index.js";

function createMockTransaction(overrides?: Partial<Transaction>): Transaction {
  return {
    transaction_id: "txn_pol_001",
    state: TransactionState.CHECKOUT_CREATED,
    created_at: new Date().toISOString(),
    agent_claim: {
      product_id: "PROD-123",
      quantity: 1,
      selection_reason: "Best value",
    },
    merchant_verified: {
      checkout_id: "chk_987",
      sku: "PROD-123",
      unit_price: { amount: 500000, currency: "INR" },
      total: { amount: 500000, currency: "INR" },
      available: true,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    },
    audit_event_ids: [],
    ...overrides,
  };
}

describe("Individual Policy Gates", () => {
  describe("AmountBoundsGate", () => {
    const gate = new AmountBoundsGate(100000); // max ₹1,00,000

    it("should PASS when checkout total is within bounds", () => {
      const txn = createMockTransaction();
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("PASS");
    });

    it("should FAIL when checkout total exceeds maximum ceiling", () => {
      const txn = createMockTransaction({
        merchant_verified: {
          checkout_id: "chk_big",
          sku: "PROD-BIG",
          unit_price: { amount: 15000000, currency: "INR" },
          total: { amount: 15000000, currency: "INR" }, // ₹1,50,000 > ₹1,00,000
          available: true,
        },
      });
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain("exceeds maximum policy ceiling");
    });

    it("should FAIL when checkout total is non-positive", () => {
      const txn = createMockTransaction({
        merchant_verified: {
          checkout_id: "chk_zero",
          sku: "PROD-0",
          unit_price: { amount: 0, currency: "INR" },
          total: { amount: 0, currency: "INR" },
          available: true,
        },
      });
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain("non-positive checkout total");
    });

    it("should FAIL if requested capture amount does not match checkout total", () => {
      const txn = createMockTransaction();
      const res = gate.check(txn, "CREATE_PAYMENT", { requested_amount: 999999 });
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain("does not match authoritative checkout total");
    });
  });

  describe("CheckoutBindingGate", () => {
    const gate = new CheckoutBindingGate();

    it("should PASS for an active, available, unexpired checkout", () => {
      const txn = createMockTransaction();
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("PASS");
    });

    it("should FAIL if merchant marked items as unavailable", () => {
      const txn = createMockTransaction({
        merchant_verified: {
          checkout_id: "chk_oos",
          sku: "PROD-OOS",
          unit_price: { amount: 1000, currency: "INR" },
          total: { amount: 1000, currency: "INR" },
          available: false,
        },
      });
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain("unavailable/out of stock");
    });

    it("should FAIL if checkout has expired", () => {
      const txn = createMockTransaction({
        merchant_verified: {
          checkout_id: "chk_exp",
          sku: "PROD-EXP",
          unit_price: { amount: 1000, currency: "INR" },
          total: { amount: 1000, currency: "INR" },
          available: true,
          expires_at: new Date(Date.now() - 60000).toISOString(), // 1 minute in the past
        },
      });
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain("checkout has expired");
    });
  });

  describe("TransactionStateGate", () => {
    const gate = new TransactionStateGate();

    it("should PASS for CREATE_PAYMENT when state is CHECKOUT_CREATED", () => {
      const txn = createMockTransaction({ state: TransactionState.CHECKOUT_CREATED });
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("PASS");
    });

    it("should FAIL for CREATE_PAYMENT when state is CREATED (no checkout yet)", () => {
      const txn = createMockTransaction({ state: TransactionState.CREATED });
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain("requires transaction in state");
    });

    it("should FAIL for actions on a FAILED transaction", () => {
      const txn = createMockTransaction({ state: TransactionState.FAILED });
      const res = gate.check(txn, "CONFIRM_ORDER");
      expect(res.result).toBe("FAIL");
    });
  });

  describe("IdempotencyGate", () => {
    it("should PASS on first execution and FAIL on duplicate execution", () => {
      const gate = new IdempotencyGate();
      const txn = createMockTransaction();

      expect(gate.check(txn, "CREATE_PAYMENT").result).toBe("PASS");
      gate.recordExecution(txn.transaction_id, "CREATE_PAYMENT");

      expect(gate.check(txn, "CREATE_PAYMENT").result).toBe("FAIL");
    });
  });

  describe("CurrencyConsistencyGate", () => {
    const gate = new CurrencyConsistencyGate("INR");

    it("should PASS when checkout currency matches expected merchant currency", () => {
      const txn = createMockTransaction({
        merchant_verified: {
          checkout_id: "chk_inr",
          sku: "PROD-1",
          unit_price: { amount: 1000, currency: "INR" },
          total: { amount: 1000, currency: "INR" },
          available: true,
        },
      });
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("PASS");
    });

    it("should FAIL when checkout currency does not match expected merchant currency", () => {
      const txn = createMockTransaction({
        merchant_verified: {
          checkout_id: "chk_usd",
          sku: "PROD-1",
          unit_price: { amount: 1000, currency: "USD" },
          total: { amount: 1000, currency: "USD" },
          available: true,
        },
      });
      const res = gate.check(txn, "CREATE_PAYMENT");
      expect(res.result).toBe("FAIL");
      expect(res.detail).toContain('Checkout currency "USD" ≠ merchant currency "INR"');
    });

    it("should PASS for non-money actions regardless of currency", () => {
      const txn = createMockTransaction();
      const res = gate.check(txn, "PREPARE_PURCHASE");
      expect(res.result).toBe("PASS");
    });
  });
});

describe("PolicyEngine Evaluation & Token Management", () => {
  it("should return ALLOW and issue a gate_token when all gates pass", () => {
    const engine = new PolicyEngine();
    const txn = createMockTransaction();

    const decision = engine.evaluate(txn, "CREATE_PAYMENT");
    expect(decision.decision).toBe("ALLOW");
    expect(decision.gate_token).toMatch(/^gate_/);
    expect(decision.checks.every((c) => c.result === "PASS")).toBe(true);

    // Verify token
    const tokenVerification = engine.verifyAndConsumeGateToken(
      decision.gate_token!,
      "CREATE_PAYMENT",
      txn.transaction_id
    );
    expect(tokenVerification.valid).toBe(true);

    // Cannot consume twice
    const replayCheck = engine.verifyAndConsumeGateToken(
      decision.gate_token!,
      "CREATE_PAYMENT",
      txn.transaction_id
    );
    expect(replayCheck.valid).toBe(false);
    expect(replayCheck.error).toContain("already been consumed");
  });

  it("should return DENY without gate_token if any gate fails", () => {
    const engine = new PolicyEngine();
    const txn = createMockTransaction({
      merchant_verified: {
        checkout_id: "chk_denied",
        sku: "PROD-D",
        unit_price: { amount: 0, currency: "INR" },
        total: { amount: 0, currency: "INR" }, // 0 paise fails AmountBoundsGate
        available: true,
      },
    });

    const decision = engine.evaluate(txn, "CREATE_PAYMENT");
    expect(decision.decision).toBe("DENY");
    expect(decision.gate_token).toBeUndefined();
    expect(decision.checks.some((c) => c.result === "FAIL")).toBe(true);
  });
});
