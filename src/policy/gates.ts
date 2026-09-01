/**
 * Policy Gates for Bounded and Gated Commerce Operations
 * Deterministic rules that must ALL pass before any money action or state transition.
 */

import { Transaction, TransactionState, PolicyCheck } from "../types/index.js";
import { hashCheckout } from "../authz/mandate-store.js";

export interface PolicyGate {
  readonly name: string;
  check(txn: Transaction, action: string, context?: Record<string, unknown>): PolicyCheck;
}

/**
 * AmountBoundsGate
 * Ensures that the transaction amount is strictly positive and within configured maximum bounds.
 * Supports per-currency ceilings and evaluates both payment and refund amounts.
 */
export class AmountBoundsGate implements PolicyGate {
  readonly name = "AmountBoundsGate";
  /** Per-currency ceilings in MAJOR units, e.g. { INR: 500000, USD: 6000 } */
  private maxByCurrency: Record<string, number>;

  constructor(maxByCurrency: number | Record<string, number> = 500000) {
    this.maxByCurrency =
      typeof maxByCurrency === "number" ? { INR: maxByCurrency } : maxByCurrency;
  }

  check(txn: Transaction, action: string, context?: Record<string, unknown>): PolicyCheck {
    const moneyActions = ["CREATE_PAYMENT", "CAPTURE_PAYMENT", "REQUEST_REFUND"];
    if (!moneyActions.includes(action)) {
      return {
        gate: this.name,
        result: "PASS",
        detail: `Action "${action}" is not money-moving; amount bounds check skipped`,
      };
    }

    if (!txn.merchant_verified) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: "Cannot evaluate amount bounds: No authoritative merchant checkout found",
      };
    }

    const currency = txn.merchant_verified.total.currency ?? "INR";
    const ceilingMajor = this.maxByCurrency[currency] ?? this.maxByCurrency["INR"] ?? 500000;
    const ceilingSubUnits = ceilingMajor * 100;

    if (action === "REQUEST_REFUND") {
      const requestedSubUnits = Number(
        context?.requested_amount ??
          (txn.merchant_verified.total.amount - (txn.payment?.refunded_amount ?? 0))
      );
      if (requestedSubUnits <= 0) {
        return {
          gate: this.name,
          result: "FAIL",
          detail: `Invalid non-positive refund amount: ${requestedSubUnits} sub-units`,
        };
      }
      if (requestedSubUnits > ceilingSubUnits) {
        return {
          gate: this.name,
          result: "FAIL",
          detail: `Refund amount of ${(requestedSubUnits / 100).toFixed(2)} ${currency} exceeds policy ceiling of ${ceilingMajor.toFixed(2)} ${currency}`,
        };
      }
      return {
        gate: this.name,
        result: "PASS",
        detail: `Refund amount of ${(requestedSubUnits / 100).toFixed(2)} ${currency} is within policy bounds`,
      };
    }

    const totalPaise = txn.merchant_verified.total.amount;

    if (totalPaise <= 0) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Invalid non-positive checkout total: ${totalPaise} sub-units`,
      };
    }

    if (totalPaise > ceilingSubUnits) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Checkout total of ${(totalPaise / 100).toFixed(2)} ${currency} exceeds maximum policy ceiling of ${ceilingMajor.toFixed(2)} ${currency}`,
      };
    }

    // If context specifies a requested capture amount, ensure it matches checkout total
    if (context?.requested_amount !== undefined) {
      const requestedPaise = Number(context.requested_amount);
      if (requestedPaise !== totalPaise) {
        return {
          gate: this.name,
          result: "FAIL",
          detail: `Requested amount (${requestedPaise} sub-units) does not match authoritative checkout total (${totalPaise} sub-units)`,
        };
      }
    }

    return {
      gate: this.name,
      result: "PASS",
      detail: `Checkout total of ${(totalPaise / 100).toFixed(2)} ${currency} is within authorized bounds`,
    };
  }
}

/**
 * CheckoutBindingGate
 * Ensures that payment references a valid, available, and unexpired merchant checkout.
 */
export class CheckoutBindingGate implements PolicyGate {
  readonly name = "CheckoutBindingGate";

  check(txn: Transaction, action: string): PolicyCheck {
    if (action !== "CREATE_PAYMENT" && action !== "CAPTURE_PAYMENT") {
      return {
        gate: this.name,
        result: "PASS",
        detail: `Checkout binding check skipped for non-payment action "${action}"`,
      };
    }

    if (!txn.merchant_verified) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: "No merchant checkout binding present",
      };
    }

    if (!txn.merchant_verified.checkout_id) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: "Merchant checkout ID is missing or empty",
      };
    }

    if (!txn.merchant_verified.available) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: "Merchant marked checkout items as unavailable/out of stock",
      };
    }

    if (txn.merchant_verified.expires_at) {
      const expiry = new Date(txn.merchant_verified.expires_at).getTime();
      const now = Date.now();
      if (!isNaN(expiry) && expiry <= now) {
        return {
          gate: this.name,
          result: "FAIL",
          detail: `Merchant checkout has expired at ${txn.merchant_verified.expires_at}`,
        };
      }
    }

    return {
      gate: this.name,
      result: "PASS",
      detail: `Valid checkout binding "${txn.merchant_verified.checkout_id}" confirmed and unexpired`,
    };
  }
}

/**
 * TransactionStateGate
 * Ensures that the transaction is in an appropriate state for the requested operation.
 */
export class TransactionStateGate implements PolicyGate {
  readonly name = "TransactionStateGate";

  private allowedStatesForAction: Record<string, TransactionState[]> = {
    CREATE_PAYMENT: [TransactionState.CHECKOUT_CREATED],
    CAPTURE_PAYMENT: [TransactionState.PAYMENT_PENDING, TransactionState.PAYMENT_AUTHORIZED],
    CONFIRM_ORDER: [TransactionState.PAYMENT_AUTHORIZED],
    CANCEL: [
      TransactionState.CREATED,
      TransactionState.CHECKOUT_CREATED,
      TransactionState.PAYMENT_PENDING,
      TransactionState.PAYMENT_AUTHORIZED,
      TransactionState.ORDER_CONFIRMED,
    ],
    REQUEST_REFUND: [TransactionState.ORDER_CONFIRMED],
  };

  check(txn: Transaction, action: string): PolicyCheck {
    const validStates = this.allowedStatesForAction[action];
    if (!validStates) {
      // Default: allow if not in a terminal state
      if (
        txn.state === TransactionState.FAILED ||
        txn.state === TransactionState.CANCELLED ||
        txn.state === TransactionState.REFUNDED
      ) {
        return {
          gate: this.name,
          result: "FAIL",
          detail: `Cannot perform action "${action}" on transaction in terminal state "${txn.state}"`,
        };
      }
      return {
        gate: this.name,
        result: "PASS",
        detail: `State "${txn.state}" acceptable for action "${action}"`,
      };
    }

    if (!validStates.includes(txn.state)) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Action "${action}" requires transaction in state [${validStates.join(", ")}], but current state is "${txn.state}"`,
      };
    }

    return {
      gate: this.name,
      result: "PASS",
      detail: `Transaction state "${txn.state}" is valid for action "${action}"`,
    };
  }
}

/**
 * RefundBoundsGate
 * Enforces: refunds only on captured payments; refund amount never exceeds
 * captured amount minus already-refunded amount; currency consistency.
 */
export class RefundBoundsGate implements PolicyGate {
  readonly name = "RefundBoundsGate";

  check(txn: Transaction, action: string, context?: Record<string, unknown>): PolicyCheck {
    if (action !== "REQUEST_REFUND") {
      return { gate: this.name, result: "PASS", detail: `Not a refund action ("${action}")` };
    }

    const payment = txn.payment;
    if (!payment?.razorpay_payment_id) {
      return { gate: this.name, result: "FAIL", detail: "No Razorpay payment bound to this transaction" };
    }
    if (payment.payment_status !== "captured") {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Payment status is "${payment.payment_status}"; only captured payments are refundable`,
      };
    }

    const captured = txn.merchant_verified?.total;
    if (!captured) {
      return { gate: this.name, result: "FAIL", detail: "No authoritative checkout total to bound the refund" };
    }

    const alreadyRefunded = payment.refunded_amount ?? 0;
    const requested = Number(context?.requested_amount ?? (captured.amount - alreadyRefunded));
    const refundable = captured.amount - alreadyRefunded;

    if (requested <= 0 || requested > refundable) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Refund of ${requested} sub-units out of bounds; refundable remainder is ${refundable} (captured ${captured.amount}, already refunded ${alreadyRefunded})`,
      };
    }

    if (context?.requested_currency && context.requested_currency !== captured.currency) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Refund currency (${context.requested_currency}) must match captured payment currency (${captured.currency})`,
      };
    }

    return {
      gate: this.name,
      result: "PASS",
      detail: `Refund of ${requested} sub-units within refundable remainder ${refundable}`,
    };
  }
}

/**
 * IdempotencyGate
 * Detects duplicate action requests on the same transaction to prevent double charges or duplicate refunds.
 */
export class IdempotencyGate implements PolicyGate {
  readonly name = "IdempotencyGate";
  private processedActions: Set<string> = new Set();

  check(txn: Transaction, action: string): PolicyCheck {
    const key = `${txn.transaction_id}:${action}`;

    if (action === "CREATE_PAYMENT" || action === "REQUEST_REFUND") {
      if (this.processedActions.has(key)) {
        return {
          gate: this.name,
          result: "FAIL",
          detail: `Duplicate ${action} request detected for transaction ${txn.transaction_id}`,
        };
      }
    }

    return {
      gate: this.name,
      result: "PASS",
      detail: `Idempotency check passed for action "${action}"`,
    };
  }

  recordExecution(txnId: string, action: string): void {
    this.processedActions.add(`${txnId}:${action}`);
  }
}

/**
 * CurrencyConsistencyGate
 * The checkout must be denominated in the merchant's declared currency.
 * Prevents FX ambiguity in a single-currency merchant deployment (the
 * Razorpay order, the checkout total, and the mandate must all agree).
 */
export class CurrencyConsistencyGate implements PolicyGate {
  readonly name = "CurrencyConsistencyGate";
  constructor(private expectedCurrency: string = "INR") {}

  check(txn: Transaction, action: string): PolicyCheck {
    if (
      action !== "CREATE_PAYMENT" &&
      action !== "CAPTURE_PAYMENT" &&
      action !== "REQUEST_REFUND"
    ) {
      return { gate: this.name, result: "PASS", detail: `Non-money action "${action}"` };
    }
    const currency = txn.merchant_verified?.total.currency;
    if (!currency) {
      return { gate: this.name, result: "FAIL", detail: "No currency on authoritative checkout" };
    }
    if (currency !== this.expectedCurrency) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Checkout currency "${currency}" ≠ merchant currency "${this.expectedCurrency}"; cross-currency checkout requires explicit merchant configuration`,
      };
    }
    return {
      gate: this.name,
      result: "PASS",
      detail: `Currency "${currency}" matches merchant declaration`,
    };
  }
}

/**
 * MandateGate
 * Invariant: no payment without a valid payment mandate bound to THIS transaction's checkout.
 * Auto-passes when mandate store is not configured or auth mode is "none".
 */
export class MandateGate implements PolicyGate {
  readonly name = "MandateGate";
  constructor(private mandateStore?: any) {}

  check(txn: Transaction, action: string, context?: Record<string, unknown>): PolicyCheck {
    if (action !== "CREATE_PAYMENT") {
      return {
        gate: this.name,
        result: "PASS",
        detail: `Mandate check skipped for non-payment action "${action}"`,
      };
    }

    if (!this.mandateStore || !this.mandateStore.isAuthModeEnabled()) {
      return {
        gate: this.name,
        result: "PASS",
        detail: "Authorization layer disabled (auth_mode=none)",
      };
    }

    const ref = (context?.authorization_reference as string) || txn.authorization_reference;
    if (!ref) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: "No authorization_reference supplied for CREATE_PAYMENT",
      };
    }

    const signed = this.mandateStore.getMandateSync(ref);
    if (!signed) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Authorization reference "${ref}" not found`,
      };
    }

    const verification = this.mandateStore.verify(signed);
    if (!verification.valid) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Invalid or tampered mandate signature: ${verification.error}`,
      };
    }

    if (signed.mandate.kind !== "payment") {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Supplied reference "${ref}" is an Intent Mandate, not a Payment Mandate. A concrete Payment Mandate must be derived first.`,
      };
    }

    const paymentMandate = signed.mandate;
    const binding = paymentMandate.binding;

    if (binding.transaction_id !== txn.transaction_id) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Mandate bound to transaction "${binding.transaction_id}", but presented for "${txn.transaction_id}"`,
      };
    }

    if (!txn.merchant_verified || binding.checkout_id !== txn.merchant_verified.checkout_id) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Mandate bound to checkout "${binding.checkout_id}", but transaction has "${txn.merchant_verified?.checkout_id}"`,
      };
    }

    const currentCheckoutHash = hashCheckout(txn.merchant_verified);
    if (binding.checkout_hash !== currentCheckoutHash) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: "Checkout details changed after mandate issuance (hash mismatch)",
      };
    }

    if (Date.now() > new Date(paymentMandate.expires_at).getTime()) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Payment mandate expired at ${paymentMandate.expires_at}`,
      };
    }

    return {
      gate: this.name,
      result: "PASS",
      detail: `Payment mandate "${paymentMandate.mandate_id}" valid for checkout "${binding.checkout_id}"`,
    };
  }
}

/**
 * MandateBoundsGate
 * Intent mandates constrain WHAT may be bought (amount ceiling, currency, domain, expiry)
 * before any payment mandate is derived.
 */
export class MandateBoundsGate implements PolicyGate {
  readonly name = "MandateBoundsGate";
  constructor(private mandateStore?: any) {}

  check(txn: Transaction, action: string, context?: Record<string, unknown>): PolicyCheck {
    if (action !== "CREATE_PAYMENT") {
      return {
        gate: this.name,
        result: "PASS",
        detail: `Mandate bounds check skipped for non-payment action "${action}"`,
      };
    }

    if (!this.mandateStore || !this.mandateStore.isAuthModeEnabled()) {
      return {
        gate: this.name,
        result: "PASS",
        detail: "Authorization layer disabled (auth_mode=none)",
      };
    }

    const ref = (context?.authorization_reference as string) || txn.authorization_reference;
    if (!ref) {
      return {
        gate: this.name,
        result: "PASS",
        detail: "No mandate reference to check bounds for (handled by MandateGate)",
      };
    }

    const signed = this.mandateStore.getMandateSync(ref);
    if (!signed || signed.mandate.kind !== "payment") {
      return {
        gate: this.name,
        result: "PASS",
        detail: "Mandate is not a payment mandate; bounds evaluation skipped",
      };
    }

    const paymentMandate = signed.mandate;
    if (!paymentMandate.intent_mandate_id) {
      // JIT approved — user explicitly approved this concrete checkout
      return {
        gate: this.name,
        result: "PASS",
        detail: "Payment mandate was approved by direct user JIT consent",
      };
    }

    // Lineage from intent mandate
    const intentSigned = this.mandateStore.getMandateSync(paymentMandate.intent_mandate_id);
    if (!intentSigned || intentSigned.mandate.kind !== "intent") {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Lineage intent mandate "${paymentMandate.intent_mandate_id}" not found`,
      };
    }

    const intent = intentSigned.mandate;
    const checkout = txn.merchant_verified;
    if (!checkout) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: "No merchant-verified checkout found for bounds check",
      };
    }

    if (checkout.total.amount > intent.constraints.max_amount) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Checkout amount ${checkout.total.amount} exceeds intent mandate max_amount ${intent.constraints.max_amount}`,
      };
    }

    if (checkout.total.currency.toUpperCase() !== intent.constraints.currency.toUpperCase()) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Currency mismatch: checkout is ${checkout.total.currency}, intent mandate is ${intent.constraints.currency}`,
      };
    }

    if (Date.now() > new Date(intent.constraints.expires_at).getTime()) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Parent intent mandate expired at ${intent.constraints.expires_at}`,
      };
    }

    return {
      gate: this.name,
      result: "PASS",
      detail: `Payment mandate complies with intent mandate "${intent.mandate_id}" bounds`,
    };
  }
}

export { RateLimitGate, AbuseDetectionGate } from "./rate-limit.js";


