import { describe, it, expect } from "vitest";
import { AuditLedger } from "../../src/audit/ledger.js";
import {
  toolInvokedEvent,
  productResolvedEvent,
  checkoutCreatedEvent,
  policyEvaluatedEvent,
  stateTransitionEvent,
  orderConfirmedEvent,
} from "../../src/audit/events.js";
import { generateDecisionReceipt } from "../../src/audit/receipt.js";
import {
  Transaction,
  TransactionState,
  AuditEventType,
} from "../../src/types/index.js";

describe("AuditLedger and Hash-Chaining", () => {
  it("should append events and form a valid cryptographic SHA-256 hash chain", () => {
    const ledger = new AuditLedger();
    const txnId = "txn_test_001";

    const evt1 = ledger.append(toolInvokedEvent(txnId, "prepare_purchase", { product_id: "SKU-100", quantity: 1 }));
    const evt2 = ledger.append(productResolvedEvent(txnId, {
      offer_id: "SKU-100",
      title: "MacBook Air M3",
      description: "16GB RAM 512GB SSD",
      price: { amount: 11490000, currency: "INR" },
      availability: "in_stock",
      attributes: { brand: "Apple" },
    }));
    const evt3 = ledger.append(stateTransitionEvent(txnId, TransactionState.CREATED, TransactionState.CHECKOUT_CREATED, "checkout_created"));

    expect(evt1.integrity.previous_event_hash).toBe("GENESIS");
    expect(evt2.integrity.previous_event_hash).toBe(evt1.integrity.event_hash);
    expect(evt3.integrity.previous_event_hash).toBe(evt2.integrity.event_hash);

    const verification = ledger.verifyChain(txnId);
    expect(verification.valid).toBe(true);
    expect(verification.event_count).toBe(3);
  });

  it("should detect tampering if an event's response or payload is modified", () => {
    const ledger = new AuditLedger();
    const txnId = "txn_tamper_001";

    ledger.append(toolInvokedEvent(txnId, "prepare_purchase", { product_id: "SKU-200" }));
    const evt2 = ledger.append(checkoutCreatedEvent(txnId, {
      checkout_id: "chk_999",
      sku: "SKU-200",
      unit_price: { amount: 50000, currency: "INR" },
      total: { amount: 50000, currency: "INR" },
      available: true,
    }));
    ledger.append(stateTransitionEvent(txnId, TransactionState.CREATED, TransactionState.CHECKOUT_CREATED, "checkout"));

    // Verify initially valid
    expect(ledger.verifyChain(txnId).valid).toBe(true);

    // Tamper with evt2's total amount in memory
    if (evt2.response) {
      (evt2.response.total as { amount: number }).amount = 99999999;
    }

    const tamperedCheck = ledger.verifyChain(txnId);
    expect(tamperedCheck.valid).toBe(false);
    expect(tamperedCheck.broken_at_event_id).toBe(evt2.event_id);
    expect(tamperedCheck.error).toContain("Tampered event data");
  });

  it("should detect broken hash links if an event is deleted or swapped", () => {
    const ledger = new AuditLedger();
    const txnId = "txn_swap_001";

    ledger.append(toolInvokedEvent(txnId, "prepare_purchase", { product_id: "SKU-1" }));
    const evt2 = ledger.append(toolInvokedEvent(txnId, "prepare_purchase", { product_id: "SKU-2" }));

    // Tamper with previous hash link
    evt2.integrity.previous_event_hash = "INVALID_HASH_LINK";

    const check = ledger.verifyChain(txnId);
    expect(check.valid).toBe(false);
    expect(check.error).toContain("Broken chain link");
  });

  it("should return empty verification for unknown transactions", () => {
    const ledger = new AuditLedger();
    const check = ledger.verifyChain("txn_non_existent");
    expect(check.valid).toBe(true);
    expect(check.event_count).toBe(0);
  });
});

describe("Decision Receipt Generator", () => {
  it("should generate a complete, formatted audit decision receipt", () => {
    const txn: Transaction = {
      transaction_id: "txn_receipt_999",
      state: TransactionState.ORDER_CONFIRMED,
      created_at: "2026-08-28T21:00:00.000Z",
      agent_claim: {
        product_id: "LEN-YOGA-7",
        quantity: 1,
        variant: { color: "Slate Grey" },
        selection_reason: "Best rated 2-in-1 laptop under ₹90,000",
      },
      merchant_verified: {
        checkout_id: "chk_tb_12345",
        sku: "LEN-YOGA-7",
        unit_price: { amount: 8299900, currency: "INR" },
        total: { amount: 8299900, currency: "INR" },
        available: true,
        expires_at: "2026-08-28T21:30:00.000Z",
      },
      policy_decision: {
        decision: "ALLOW",
        gate_token: "gate_sec_tok_123",
        checks: [
          { gate: "AmountBoundsGate", result: "PASS", detail: "Checkout total ₹82,999.00 within bounds" },
          { gate: "CheckoutBindingGate", result: "PASS", detail: "Checkout binding valid and unexpired" },
          { gate: "IdempotencyGate", result: "PASS", detail: "Transaction request is unique" },
        ],
        evaluated_at: "2026-08-28T21:01:00.000Z",
      },
      payment: {
        provider: "razorpay",
        razorpay_order_id: "order_rzp_991122",
        razorpay_payment_id: "pay_rzp_887766",
        payment_link_url: "https://rzp.io/i/mockLink",
        payment_status: "captured",
      },
      merchant_order: {
        order_id: "ORD-TB-774411",
        status: "CONFIRMED",
        confirmed_at: "2026-08-28T21:02:00.000Z",
      },
      audit_event_ids: ["evt_1", "evt_2", "evt_3"],
    };

    const ledger = new AuditLedger();
    const evt1 = ledger.append(toolInvokedEvent(txn.transaction_id, "prepare_purchase", {}));
    const evt2 = ledger.append(policyEvaluatedEvent(txn.transaction_id, txn.policy_decision!));
    const evt3 = ledger.append(orderConfirmedEvent(txn.transaction_id, txn.merchant_order!));

    const events = ledger.getTransactionAudit(txn.transaction_id);
    const receipt = generateDecisionReceipt(txn, events, true);

    expect(receipt).toContain("AI PURCHASE AUDIT RECEIPT");
    expect(receipt).toContain("Transaction ID : txn_receipt_999");
    expect(receipt).toContain("Status         : ORDER_CONFIRMED");
    expect(receipt).toContain('Selection Reason : "Best rated 2-in-1 laptop under ₹90,000"');
    expect(receipt).toContain("Checkout Total   : ₹82,999.00");
    expect(receipt).toContain("✓ [AmountBoundsGate] Checkout total ₹82,999.00 within bounds");
    expect(receipt).toContain("Order ID         : order_rzp_991122");
    expect(receipt).toContain("Payment ID       : pay_rzp_887766");
    expect(receipt).toContain("Order ID         : ORD-TB-774411");
    expect(receipt).toContain("Hash Chain Valid : VALID (Verified SHA-256)");
    expect(receipt).toContain("3 immutable events");
  });
});
