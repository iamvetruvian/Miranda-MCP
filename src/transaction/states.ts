/**
 * Transaction State Machine Transitions
 * Explicitly defines all permitted state transitions to prevent out-of-order execution.
 */

import { TransactionState } from "../types/index.js";

/**
 * Transition adjacency map defining allowed direct next states for each current state.
 */
export const VALID_TRANSITIONS: Record<TransactionState, TransactionState[]> = {
  [TransactionState.CREATED]: [
    TransactionState.CHECKOUT_CREATED,
    TransactionState.FAILED,
    TransactionState.CANCELLED,
  ],
  [TransactionState.CHECKOUT_CREATED]: [
    TransactionState.MANDATE_EVALUATED,
    TransactionState.PAYMENT_PENDING,
    TransactionState.PAYMENT_AUTHORIZED,
    TransactionState.FAILED,
    TransactionState.CANCELLED,
  ],
  [TransactionState.MANDATE_EVALUATED]: [
    TransactionState.PAYMENT_PENDING,
    TransactionState.PAYMENT_AUTHORIZED,
    TransactionState.FAILED,
    TransactionState.CANCELLED,
  ],
  [TransactionState.PAYMENT_PENDING]: [
    TransactionState.PAYMENT_AUTHORIZED,
    TransactionState.FAILED,
    TransactionState.CANCELLED,
  ],
  [TransactionState.PAYMENT_AUTHORIZED]: [
    TransactionState.ORDER_CONFIRMED,
    TransactionState.FAILED,
    TransactionState.CANCELLED,
  ],
  [TransactionState.ORDER_CONFIRMED]: [
    TransactionState.REFUND_PENDING,
    TransactionState.CANCELLED,
  ],
  [TransactionState.REFUND_PENDING]: [
    TransactionState.REFUNDED,
    TransactionState.ORDER_CONFIRMED,
    TransactionState.FAILED,
  ],
  [TransactionState.REFUNDED]: [],
  [TransactionState.FAILED]: [],
  [TransactionState.CANCELLED]: [],
};

/**
 * Checks whether transitioning from `from` to `to` is legally permitted.
 */
export function isValidTransition(
  from: TransactionState,
  to: TransactionState
): boolean {
  if (from === to) return true; // Idempotent no-op
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Checks whether a given state is terminal (cannot progress to new forward actions).
 */
export function isTerminalState(state: TransactionState): boolean {
  return (
    state === TransactionState.FAILED ||
    state === TransactionState.CANCELLED ||
    state === TransactionState.REFUNDED
  );
}
