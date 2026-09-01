import { describe, it, expect, beforeEach } from "vitest";
import { TransactionManager } from "../../src/transaction/manager.js";
import { isValidTransition, isTerminalState } from "../../src/transaction/states.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { TransactionState, AuditEventType } from "../../src/types/index.js";

describe("Transaction States and State Machine", () => {
  it("should validate allowed and disallowed direct state transitions", () => {
    expect(isValidTransition(TransactionState.CREATED, TransactionState.CHECKOUT_CREATED)).toBe(true);
    expect(isValidTransition(TransactionState.CHECKOUT_CREATED, TransactionState.PAYMENT_PENDING)).toBe(true);
    expect(isValidTransition(TransactionState.PAYMENT_PENDING, TransactionState.PAYMENT_AUTHORIZED)).toBe(true);
    expect(isValidTransition(TransactionState.PAYMENT_AUTHORIZED, TransactionState.ORDER_CONFIRMED)).toBe(true);

    // Any state to FAILED or CANCELLED
    expect(isValidTransition(TransactionState.CREATED, TransactionState.FAILED)).toBe(true);
    expect(isValidTransition(TransactionState.CHECKOUT_CREATED, TransactionState.CANCELLED)).toBe(true);

    // Illegal transitions
    expect(isValidTransition(TransactionState.CREATED, TransactionState.ORDER_CONFIRMED)).toBe(false);
    expect(isValidTransition(TransactionState.CHECKOUT_CREATED, TransactionState.ORDER_CONFIRMED)).toBe(false);
    expect(isValidTransition(TransactionState.FAILED, TransactionState.ORDER_CONFIRMED)).toBe(false);
  });

  it("should correctly identify terminal states", () => {
    expect(isTerminalState(TransactionState.FAILED)).toBe(true);
    expect(isTerminalState(TransactionState.CANCELLED)).toBe(true);
    expect(isTerminalState(TransactionState.CREATED)).toBe(false);
    expect(isTerminalState(TransactionState.PAYMENT_PENDING)).toBe(false);
  });
});

describe("TransactionManager", () => {
  let auditLedger: AuditLedger;
  let manager: TransactionManager;

  beforeEach(() => {
    auditLedger = new AuditLedger();
    manager = new TransactionManager(auditLedger);
  });

  it("should create a transaction with unique transaction_id and CREATED state", () => {
    const txn = manager.create({
      product_id: "SKU-TEST-1",
      quantity: 2,
      selection_reason: "User requested laptop",
    });

    expect(txn.transaction_id).toMatch(/^txn_/);
    expect(txn.state).toBe(TransactionState.CREATED);
    expect(txn.agent_claim.product_id).toBe("SKU-TEST-1");
    expect(manager.has(txn.transaction_id)).toBe(true);
  });

  it("should step through the complete happy-path lifecycle while recording audit events", () => {
    const txn = manager.create({
      product_id: "SKU-99",
      quantity: 1,
      selection_reason: "Top seller",
    });
    const txnId = txn.transaction_id;

    // 1. Checkout Created
    manager.bindCheckout(txnId, {
      checkout_id: "chk_001",
      sku: "SKU-99",
      unit_price: { amount: 5000000, currency: "INR" },
      total: { amount: 5000000, currency: "INR" },
      available: true,
    });
    manager.transition(txnId, TransactionState.CHECKOUT_CREATED, "checkout_received");
    expect(manager.get(txnId).state).toBe(TransactionState.CHECKOUT_CREATED);

    // 2. Payment Pending
    manager.bindPayment(txnId, {
      provider: "razorpay",
      razorpay_order_id: "order_123",
      payment_link_url: "https://rzp.io/i/test",
      payment_status: "pending",
    });
    manager.transition(txnId, TransactionState.PAYMENT_PENDING, "link_generated");
    expect(manager.get(txnId).state).toBe(TransactionState.PAYMENT_PENDING);

    // 3. Payment Authorized
    manager.bindPayment(txnId, {
      provider: "razorpay",
      razorpay_payment_id: "pay_456",
      payment_status: "authorized",
    });
    manager.transition(txnId, TransactionState.PAYMENT_AUTHORIZED, "webhook_payment_authorized");
    expect(manager.get(txnId).state).toBe(TransactionState.PAYMENT_AUTHORIZED);

    // 4. Order Confirmed
    manager.bindOrder(txnId, {
      order_id: "ORD-9999",
      status: "CONFIRMED",
      confirmed_at: new Date().toISOString(),
    });
    manager.transition(txnId, TransactionState.ORDER_CONFIRMED, "merchant_order_placed");
    expect(manager.get(txnId).state).toBe(TransactionState.ORDER_CONFIRMED);

    // Verify Audit Trail & Hash Chain
    const auditEvents = auditLedger.getTransactionAudit(txnId);
    expect(auditEvents.length).toBe(4);
    expect(auditEvents.every((e) => e.event_type === AuditEventType.STATE_TRANSITION)).toBe(true);

    const chainVerification = auditLedger.verifyChain(txnId);
    expect(chainVerification.valid).toBe(true);
    expect(chainVerification.event_count).toBe(4);
  });

  it("should throw an error and refuse illegal state transitions", () => {
    const txn = manager.create({
      product_id: "SKU-ILLEGAL",
      quantity: 1,
      selection_reason: "Test",
    });

    expect(() =>
      manager.transition(txn.transaction_id, TransactionState.ORDER_CONFIRMED, "bypass_attempt")
    ).toThrow(/Illegal state transition/);
  });

  it("should fail transaction gracefully and record failure audit event", () => {
    const txn = manager.create({
      product_id: "SKU-FAIL",
      quantity: 1,
      selection_reason: "Test fail",
    });

    manager.fail(txn.transaction_id, "Card declined by issuing bank", "payment_adapter");

    const updated = manager.get(txn.transaction_id);
    expect(updated.state).toBe(TransactionState.FAILED);

    const events = auditLedger.getTransactionAudit(txn.transaction_id);
    expect(events.some((e) => e.event_type === AuditEventType.TRANSACTION_FAILED)).toBe(true);
    expect(events.some((e) => e.event_type === AuditEventType.STATE_TRANSITION)).toBe(true);
  });
});
