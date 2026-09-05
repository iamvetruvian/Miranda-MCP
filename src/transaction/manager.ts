/**
 * Transaction Manager
 * Manages the lifecycle, bindings, and state transitions of commerce transactions.
 */

import crypto from "crypto";
import {
  Transaction,
  TransactionState,
  AgentClaim,
  MerchantVerifiedCheckout,
  PaymentBinding,
  RefundRecord,
  MerchantOrderBinding,
  PolicyDecision,
} from "../types/index.js";
import { AuditLedger } from "../audit/ledger.js";
import { stateTransitionEvent, transactionFailedEvent } from "../audit/events.js";
import { isValidTransition } from "./states.js";
import { PersistenceStore } from "../persistence/store.js";

export class TransactionManager {
  private transactions: Map<string, Transaction> = new Map();
  private auditLedger: AuditLedger;
  private store?: PersistenceStore;

  constructor(auditLedger?: AuditLedger, store?: PersistenceStore) {
    this.auditLedger = auditLedger ?? new AuditLedger();
    this.store = store;
  }

  /**
   * Set or update persistence store reference.
   */
  setStore(store: PersistenceStore): void {
    this.store = store;
  }

  /**
   * Hydrate in-memory transactions from persisted records.
   */
  hydrate(transactions: Transaction[]): void {
    for (const txn of transactions) {
      this.transactions.set(txn.transaction_id, txn);
    }
  }

  private persist(txn: Transaction): void {
    if (this.store) {
      this.store.saveTransaction(txn).catch((err) => {
        console.error(`[TransactionManager] Failed to persist transaction ${txn.transaction_id}:`, err);
      });
    }
  }

  /**
   * Create a new transaction initialized with an untrusted agent claim.
   * Generates an authoritative, MCP-controlled transaction ID.
   */
  create(agentClaim: AgentClaim): Transaction {
    const transactionId = `txn_${crypto.randomUUID()}`;

    const transaction: Transaction = {
      transaction_id: transactionId,
      state: TransactionState.CREATED,
      created_at: new Date().toISOString(),
      agent_claim: agentClaim,
      audit_event_ids: [],
    };

    this.transactions.set(transactionId, transaction);
    this.persist(transaction);
    return transaction;
  }

  /**
   * Fetch a transaction by ID. Throws an error if not found.
   */
  get(transactionId: string): Transaction {
    const txn = this.transactions.get(transactionId);
    if (!txn) {
      throw new Error(`Transaction "${transactionId}" not found`);
    }
    return txn;
  }

  /**
   * Check whether a transaction exists.
   */
  has(transactionId: string): boolean {
    return this.transactions.has(transactionId);
  }

  /**
   * Retrieve all transactions.
   */
  list(): Transaction[] {
    return Array.from(this.transactions.values());
  }

  /**
   * Execute a state transition on a transaction.
   * Validates transition legality against VALID_TRANSITIONS and records a tamper-evident audit event.
   */
  transition(
    transactionId: string,
    toState: TransactionState,
    trigger: string
  ): Transaction {
    const txn = this.get(transactionId);
    const fromState = txn.state;

    if (fromState === toState) {
      return txn; // No-op
    }

    if (!isValidTransition(fromState, toState)) {
      throw new Error(
        `Illegal state transition for transaction "${transactionId}": cannot move from "${fromState}" to "${toState}" (trigger: "${trigger}")`
      );
    }

    txn.state = toState;

    // Log the transition in the audit ledger
    const event = this.auditLedger.append(
      stateTransitionEvent(transactionId, fromState, toState, trigger)
    );
    txn.audit_event_ids.push(event.event_id);

    this.persist(txn);
    return txn;
  }

  /**
   * Fail a transaction gracefully and record a failure audit event.
   */
  fail(
    transactionId: string,
    reason: string,
    component: string = "mcp"
  ): Transaction {
    const txn = this.get(transactionId);

    // Record failure audit event
    const failEvent = this.auditLedger.append(
      transactionFailedEvent(transactionId, reason, component)
    );
    txn.audit_event_ids.push(failEvent.event_id);

    // Transition to FAILED if not already terminal
    if (txn.state !== TransactionState.FAILED && txn.state !== TransactionState.CANCELLED) {
      return this.transition(transactionId, TransactionState.FAILED, `failure: ${reason}`);
    }

    this.persist(txn);
    return txn;
  }

  /**
   * Bind authoritative merchant checkout information to the transaction.
   */
  bindCheckout(
    transactionId: string,
    checkout: MerchantVerifiedCheckout
  ): Transaction {
    const txn = this.get(transactionId);
    txn.merchant_verified = checkout;
    this.persist(txn);
    return txn;
  }

  /**
   * Bind payment orchestration data (Razorpay order/payment/link).
   */
  bindPayment(
    transactionId: string,
    payment: PaymentBinding
  ): Transaction {
    const txn = this.get(transactionId);
    txn.payment = {
      ...(txn.payment ?? { provider: "razorpay", payment_status: "pending" }),
      ...payment,
    };
    this.persist(txn);
    return txn;
  }

  /**
   * Bind authoritative merchant order confirmation data.
   */
  bindOrder(
    transactionId: string,
    order: MerchantOrderBinding
  ): Transaction {
    const txn = this.get(transactionId);
    if (txn.shipping_address && !order.shipping_address) {
      order.shipping_address = txn.shipping_address;
    }
    txn.merchant_order = order;
    this.persist(txn);
    return txn;
  }

  /**
   * Bind policy evaluation outcome.
   */
  bindPolicyDecision(
    transactionId: string,
    decision: PolicyDecision
  ): Transaction {
    const txn = this.get(transactionId);
    txn.policy_decision = decision;
    this.persist(txn);
    return txn;
  }

  /**
   * Component 3: Bind a refund record and update cumulative refunded_amount.
   * Idempotent by refund_id (webhook retries must not double-count).
   */
  bindRefund(transactionId: string, refund: RefundRecord): Transaction {
    const txn = this.get(transactionId);
    const payment: PaymentBinding = txn.payment ?? {
      provider: "stripe",
      payment_status: "captured",
      refunds: [],
      refunded_amount: 0,
    };
    const refunds: RefundRecord[] = payment.refunds ?? [];
    if (refunds.some((r: RefundRecord) => r.refund_id === refund.refund_id)) {
      const existingIdx = refunds.findIndex((r: RefundRecord) => r.refund_id === refund.refund_id);
      if (existingIdx !== -1) {
        refunds[existingIdx] = { ...refunds[existingIdx], ...refund };
      }
      this.persist(txn);
      return txn;
    }

    txn.payment = {
      ...payment,
      refunds: [...refunds, refund],
      refunded_amount: (payment.refunded_amount ?? 0) + refund.amount.amount,
    };
    this.persist(txn);
    return txn;
  }
}
