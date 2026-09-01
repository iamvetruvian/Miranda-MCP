/**
 * Policy Engine
 * Evaluates all deterministic policy gates and issues short-lived authorization gate tokens.
 */

import crypto from "crypto";
import { Transaction, PolicyDecision, PolicyCheck } from "../types/index.js";
import {
  PolicyGate,
  AmountBoundsGate,
  CheckoutBindingGate,
  TransactionStateGate,
  RefundBoundsGate,
  IdempotencyGate,
  MandateGate,
  MandateBoundsGate,
  RateLimitGate,
  AbuseDetectionGate,
} from "./gates.js";
import { PersistenceStore, type ActiveGateToken } from "../persistence/store.js";
import { MandateStore } from "../authz/mandate-store.js";
import { RateLimiter, AbuseDetector } from "./rate-limit.js";

export type { ActiveGateToken };

export class PolicyEngine {
  private gates: PolicyGate[] = [];
  private idempotencyGate: IdempotencyGate;
  private issuedTokens: Map<string, ActiveGateToken> = new Map();
  private tokenTtlMs: number;
  private store?: PersistenceStore;
  private mandateStore?: MandateStore;
  private rateLimiter?: RateLimiter;
  private abuseDetector?: AbuseDetector;

  constructor(
    customGates?: PolicyGate[],
    maxTransactionRupees?: number | Record<string, number>,
    tokenTtlSeconds: number = 300, // 5 minutes
    store?: PersistenceStore,
    mandateStore?: MandateStore,
    rateLimiter?: RateLimiter,
    abuseDetector?: AbuseDetector
  ) {
    this.idempotencyGate = new IdempotencyGate();
    this.tokenTtlMs = tokenTtlSeconds * 1000;
    this.store = store;
    this.mandateStore = mandateStore;
    this.rateLimiter = rateLimiter;
    this.abuseDetector = abuseDetector;

    const baseGates: PolicyGate[] = [];
    if (rateLimiter) baseGates.push(new RateLimitGate(rateLimiter));
    if (abuseDetector) baseGates.push(new AbuseDetectionGate(abuseDetector));

    baseGates.push(
      new AmountBoundsGate(maxTransactionRupees),
      new CheckoutBindingGate(),
      new TransactionStateGate(),
      new RefundBoundsGate(),
      new MandateGate(mandateStore),
      new MandateBoundsGate(mandateStore),
      this.idempotencyGate
    );

    this.gates = customGates ?? baseGates;
  }

  setMandateStore(mandateStore: MandateStore): void {
    this.mandateStore = mandateStore;
    // Update existing MandateGate and MandateBoundsGate or register them
    const mandateGate = this.gates.find((g) => g.name === "MandateGate") as MandateGate | undefined;
    if (mandateGate) {
      (mandateGate as any).mandateStore = mandateStore;
    }
    const boundsGate = this.gates.find((g) => g.name === "MandateBoundsGate") as MandateBoundsGate | undefined;
    if (boundsGate) {
      (boundsGate as any).mandateStore = mandateStore;
    }
  }

  setStore(store: PersistenceStore): void {
    this.store = store;
  }

  /**
   * Hydrate in-memory gate tokens from persisted store.
   */
  hydrate(tokens: ActiveGateToken[]): void {
    this.issuedTokens.clear();
    for (const token of tokens) {
      this.issuedTokens.set(token.token, token);
    }
  }

  /**
   * Register an additional policy gate dynamically (e.g. CurrencyConsistencyGate).
   */
  registerGate(gate: PolicyGate): void {
    // Insert before idempotency gate if present, so idempotency is evaluated last
    const idempIdx = this.gates.findIndex((g) => g.name === "IdempotencyGate");
    if (idempIdx !== -1) {
      this.gates.splice(idempIdx, 0, gate);
    } else {
      this.gates.push(gate);
    }
  }

  getGates(): PolicyGate[] {
    return [...this.gates];
  }

  /**
   * Evaluate all registered gates for a requested transaction action.
   * ALL gates must return result "PASS" for the overall decision to be "ALLOW".
   *
   * @param txn Current transaction state
   * @param requestedAction The action to be guarded (e.g. "CREATE_PAYMENT")
   * @param context Optional parameters (e.g. requested_amount)
   * @returns PolicyDecision with all individual check outcomes and an authorization gate token if allowed
   */
  evaluate(
    txn: Transaction,
    requestedAction: string,
    context?: Record<string, unknown>
  ): PolicyDecision {
    const checks: PolicyCheck[] = [];

    for (const gate of this.gates) {
      const checkResult = gate.check(txn, requestedAction, context);
      checks.push(checkResult);
    }

    const allPassed = checks.every((c) => c.result === "PASS");
    const sessionId = String(context?.client_identity ?? context?.session_id ?? txn.transaction_id);

    if (!allPassed) {
      if (this.abuseDetector) {
        this.abuseDetector.recordDenial(sessionId);
      }
      return {
        decision: "DENY",
        checks,
        evaluated_at: new Date().toISOString(),
      };
    }

    if (this.abuseDetector) {
      this.abuseDetector.recordSuccess(sessionId);
    }

    // Generate short-lived gate token
    const gateToken = `gate_${crypto.randomUUID()}`;
    const tokenRecord: ActiveGateToken = {
      token: gateToken,
      transaction_id: txn.transaction_id,
      action: requestedAction,
      expires_at: Date.now() + this.tokenTtlMs,
      consumed: false,
    };
    this.issuedTokens.set(gateToken, tokenRecord);

    if (this.store) {
      this.store.saveGateToken(tokenRecord).catch((err) => {
        console.error(`[PolicyEngine] Failed to persist gate token ${gateToken}:`, err);
      });
    }

    // Record idempotency
    this.idempotencyGate.recordExecution(txn.transaction_id, requestedAction);

    return {
      decision: "ALLOW",
      gate_token: gateToken,
      checks,
      evaluated_at: new Date().toISOString(),
    };
  }

  /**
   * Verify and consume a gate token before executing a protected operation.
   * Ensures that money actions cannot be called directly without policy approval.
   */
  verifyAndConsumeGateToken(
    gateToken: string,
    expectedAction: string,
    expectedTxnId: string
  ): { valid: boolean; error?: string } {
    const entry = this.issuedTokens.get(gateToken);

    if (!entry) {
      return { valid: false, error: "Invalid or unrecognized gate token" };
    }

    if (entry.consumed) {
      return { valid: false, error: "Gate token has already been consumed (replay rejected)" };
    }

    if (entry.transaction_id !== expectedTxnId) {
      return {
        valid: false,
        error: `Gate token mismatch: issued for ${entry.transaction_id}, presented for ${expectedTxnId}`,
      };
    }

    if (entry.action !== expectedAction) {
      return {
        valid: false,
        error: `Gate token action mismatch: issued for ${entry.action}, presented for ${expectedAction}`,
      };
    }

    if (Date.now() > entry.expires_at) {
      return { valid: false, error: "Gate token has expired" };
    }

    // Mark consumed
    entry.consumed = true;
    if (this.store) {
      this.store.consumeGateToken(gateToken).catch((err) => {
        console.error(`[PolicyEngine] Failed to mark gate token ${gateToken} consumed in store:`, err);
      });
    }

    return { valid: true };
  }
}
