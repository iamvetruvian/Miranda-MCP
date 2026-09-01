/**
 * UCP Status Mapping & Actions Envelope Projection
 * Maps internal TransactionState to standard UCP checkout lifecycle states
 * and formats outstanding gated operations as UCP extension actions.
 */

import { Transaction, TransactionState } from "../types/index.js";

export const TO_UCP_CHECKOUT_STATUS: Record<TransactionState, string> = {
  [TransactionState.CREATED]: "incomplete",
  [TransactionState.CHECKOUT_CREATED]: "incomplete",
  [TransactionState.MANDATE_EVALUATED]: "requires_escalation",
  [TransactionState.PAYMENT_PENDING]: "ready_for_complete",
  [TransactionState.PAYMENT_AUTHORIZED]: "complete_in_progress",
  [TransactionState.ORDER_CONFIRMED]: "completed",
  [TransactionState.REFUND_PENDING]: "completed",
  [TransactionState.REFUNDED]: "canceled",
  [TransactionState.FAILED]: "canceled",
  [TransactionState.CANCELLED]: "canceled",
};

export interface UcpAction {
  id: string;
  config: Record<string, unknown>;
}

export interface UcpEnvelope {
  checkout_status: string;
  actions?: Record<string, UcpAction[]>;
}

/**
 * Projects a transaction into a UCP status and actions envelope.
 */
export function projectUcpEnvelope(
  txn: Transaction,
  extraActions?: Record<string, UcpAction[]>
): UcpEnvelope {
  const checkout_status = TO_UCP_CHECKOUT_STATUS[txn.state] ?? "incomplete";
  const actions: Record<string, UcpAction[]> = { ...extraActions };

  // If transaction is in MANDATE_EVALUATED and has pending consent details, embed action
  if (txn.state === TransactionState.MANDATE_EVALUATED && !actions["com.merchantmcp.mandates.consent"]) {
    actions["com.merchantmcp.mandates.consent"] = [
      {
        id: `consent_${txn.transaction_id}`,
        config: {
          transaction_id: txn.transaction_id,
          message: "User consent challenge awaiting out-of-band human approval",
        },
      },
    ];
  }

  return {
    checkout_status,
    ...(Object.keys(actions).length > 0 ? { actions } : {}),
  };
}
