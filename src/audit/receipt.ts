/**
 * Human-Readable Decision Receipt Generator
 * Produces structured audit receipts proving that every money action was
 * explainable, bounded, and gated.
 */

import { Transaction, AuditEvent } from "../types/index.js";
import { LedgerCheckpoint } from "./ledger.js";

export function generateDecisionReceipt(
  txn: Transaction,
  events: AuditEvent[],
  chainValid: boolean = true,
  checkpoint?: LedgerCheckpoint
): string {
  const formatCurrency = (paise?: number) => {
    if (paise === undefined || isNaN(paise)) return "₹0.00";
    return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const policyChecks = txn.policy_decision?.checks ?? [];
  const checksFormatted =
    policyChecks.length > 0
      ? policyChecks
          .map(
            (c) =>
              `  ${c.result === "PASS" ? "✓" : "✗"} [${c.gate}] ${c.detail}`
          )
          .join("\n")
      : "  • No policy evaluations recorded";

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];

  const variantStr =
    txn.agent_claim.variant && Object.keys(txn.agent_claim.variant).length > 0
      ? ` (${Object.entries(txn.agent_claim.variant)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")})`
      : "";

  const refunds = txn.payment?.refunds ?? [];
  const refundedAmount = txn.payment?.refunded_amount ?? 0;
  const capturedAmount = txn.merchant_verified?.total.amount ?? 0;
  const netSettled = capturedAmount - refundedAmount;

  let refundsSection = "";
  if (refunds.length > 0 || refundedAmount > 0) {
    const refundLines = refunds
      .map(
        (r) =>
          `   - Refund ID: ${r.refund_id} | Amount: ${formatCurrency(r.amount.amount)} | Status: ${r.status.toUpperCase()}${r.reason ? ` | Reason: ${r.reason}` : ""}`
      )
      .join("\n");

    refundsSection = `
6. REFUND ORCHESTRATION (Stripe Rails)
   Total Refunded   : ${formatCurrency(refundedAmount)}
   Net Settled      : ${formatCurrency(netSettled)}
${refundLines}
`;
  }

  const auditSectionNum = refundsSection ? "7" : "6";

  return `══════════════════════════════════════════════════════════════════════
                     AI PURCHASE AUDIT RECEIPT
══════════════════════════════════════════════════════════════════════
Transaction ID : ${txn.transaction_id}
Status         : ${txn.state}
Created At     : ${txn.created_at}

1. AGENT CLAIM (Untrusted Input)
   Product ID       : ${txn.agent_claim.product_id}${variantStr}
   Title            : ${txn.agent_claim.title ?? txn.merchant_verified?.title ?? "N/A"}
   Quantity         : ${txn.agent_claim.quantity}
   Selection Reason : "${txn.agent_claim.selection_reason}"

2. MERCHANT VERIFICATION (Authoritative Facts)
   Checkout ID      : ${txn.merchant_verified?.checkout_id ?? "N/A"}
   Authoritative SKU: ${txn.merchant_verified?.sku ?? "N/A"}
   Title            : ${txn.merchant_verified?.title ?? txn.agent_claim.title ?? "N/A"}
   Unit Price       : ${formatCurrency(txn.merchant_verified?.unit_price.amount)}
   Checkout Total   : ${formatCurrency(txn.merchant_verified?.total.amount)}
   Stock Status     : ${txn.merchant_verified?.available ? "In Stock" : "Unavailable"}
   Valid Until      : ${txn.merchant_verified?.expires_at ?? "N/A"}

3. POLICY EVALUATION (Bounded & Gated)
${checksFormatted}
   Overall Decision : ${txn.policy_decision?.decision ?? "N/A"}
   Gate Token       : ${txn.policy_decision?.gate_token ?? "None"}

4. PAYMENT ORCHESTRATION (Stripe)
   Provider         : Stripe
   Payment Intent ID: ${txn.payment?.stripe_payment_intent_id ?? (txn.payment as any)?.razorpay_payment_id ?? "Pending / Not Captured"}
   Payment Link     : ${txn.payment?.payment_link_url ?? "N/A"}
   Payment Status   : ${txn.payment?.payment_status?.toUpperCase() ?? "PENDING"}

5. MERCHANT ORDER (Fulfillment)
   Order ID         : ${txn.merchant_order?.order_id ?? "Pending Confirmation"}
   Order Status     : ${txn.merchant_order?.status?.toUpperCase() ?? "PENDING"}
   Confirmed At     : ${txn.merchant_order?.confirmed_at ?? "N/A"}
${refundsSection}
${auditSectionNum}. AUDIT & CRYPTOGRAPHIC INTEGRITY
   Event Count      : ${events.length} immutable events
   Hash Chain Valid : ${chainValid ? "VALID (Verified SHA-256)" : "TAMPERED / BROKEN"}
   Genesis Link     : ${firstEvent?.integrity.previous_event_hash ?? "N/A"}
   Final Hash       : ${lastEvent?.integrity.event_hash ? lastEvent.integrity.event_hash.slice(0, 32) + "..." : "N/A"}${
     checkpoint
       ? `\n   Last Checkpoint  : #${checkpoint.checkpoint_index} (${checkpoint.algorithm.toUpperCase()} at ${checkpoint.signed_at})`
       : ""
   }
══════════════════════════════════════════════════════════════════════`;
}
