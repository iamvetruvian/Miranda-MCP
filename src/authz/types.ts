/**
 * AP2-Shaped Authorization Types
 * Implements Google Agent Payments Protocol (AP2) schemas:
 * - Open & Closed Payment Mandates (mandate.payment.open.1 / mandate.payment.1)
 * - Open & Closed Checkout Mandates (mandate.checkout.open.1 / mandate.checkout.1)
 * - Cryptographic Receipts (mandate.payment.receipt.1 / mandate.checkout.receipt.1)
 * - Standard AP2 Constraints (amount_range, budget, allowed_payees, allowed_payment_instruments, agent_recurrence)
 * - Confirmation Claims (cnf.jwk) and Asymmetric JWS Tokens
 */

import { PublicJwk } from "./crypto.js";

export type MandateVct =
  | "mandate.payment.open.1"
  | "mandate.payment.1"
  | "mandate.checkout.open.1"
  | "mandate.checkout.1"
  | "mandate.payment.receipt.1"
  | "mandate.checkout.receipt.1";

export interface PaymentInstrument {
  id: string;
  type: "card" | "upi" | "bank_transfer" | "token" | string;
  description: string;
  last4?: string;
  network?: string;
}

export interface AmountRangeConstraint {
  type: "payment.amount_range";
  min?: number;
  max: number;
  currency: string;
}

export interface BudgetConstraint {
  type: "payment.budget";
  max: number;
  currency: string;
  consumed?: number;
}

export interface AllowedPayeesConstraint {
  type: "payment.allowed_payees";
  allowed: Array<{
    name: string;
    website?: string;
    id?: string;
  }>;
}

export interface AllowedPaymentInstrumentsConstraint {
  type: "payment.allowed_payment_instruments";
  allowed: PaymentInstrument[];
}

export interface AgentRecurrenceConstraint {
  type: "payment.agent_recurrence";
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | string;
  max_occurrences?: number;
}

export interface ExecutionDateConstraint {
  type: "payment.execution_date";
  not_before?: string;
  not_after?: string;
}

export type Ap2PaymentConstraint =
  | AmountRangeConstraint
  | BudgetConstraint
  | AllowedPayeesConstraint
  | AllowedPaymentInstrumentsConstraint
  | AgentRecurrenceConstraint
  | ExecutionDateConstraint;

/**
 * Open Payment Mandate (AP2 mandate.payment.open.1)
 * Authorized by human user on a Trusted Surface (TS), delegating to an Agent key via cnf.
 */
export interface OpenPaymentMandate {
  vct: "mandate.payment.open.1";
  mandate_id: string;
  principal: {
    user_ref: string;
  };
  constraints: Ap2PaymentConstraint[];
  cnf: {
    jwk: PublicJwk; // Confirmation key: Shopping Agent's session public key
  };
  user_jwk?: PublicJwk; // User's public key that signed this mandate
  payment_instrument?: PaymentInstrument;
  iat: number;
  exp: number;
  nonce: string;
}

/**
 * Closed Payment Mandate (AP2 mandate.payment.1)
 * Bound to a concrete merchant checkout and transaction.
 */
export interface ClosedPaymentMandate {
  vct: "mandate.payment.1";
  mandate_id: string;
  intent_mandate_id?: string; // Lineage from open mandate
  transaction_id: string;
  checkout_id: string;
  checkout_hash: string; // SHA-256 over merchant checkout JWT
  payee: {
    name: string;
    id?: string;
    website?: string;
  };
  payment_amount: {
    amount: number;
    currency: string;
  };
  payment_instrument?: PaymentInstrument;
  approved_by: "user_jit" | "derived_from_intent";
  iat: number;
  exp: number;
  nonce: string;
}

/**
 * Authoritative Merchant Checkout Object (packaged inside checkout_jwt)
 */
export interface MerchantCheckoutObject {
  vct: "checkout.merchant.1";
  checkout_id: string;
  sku: string;
  title: string;
  total: {
    amount: number;
    currency: string;
  };
  available: boolean;
  merchant: {
    name: string;
    domain?: string;
  };
  iat: number;
  exp: number;
}

/**
 * Checkout Receipt (mandate.checkout.receipt.1)
 */
export interface CheckoutReceipt {
  vct: "mandate.checkout.receipt.1";
  receipt_id: string;
  transaction_id: string;
  checkout_id: string;
  checkout_hash: string;
  status: "accepted" | "rejected";
  timestamp: string;
}

/**
 * Payment Receipt (mandate.payment.receipt.1)
 */
export interface PaymentReceipt {
  vct: "mandate.payment.receipt.1";
  receipt_id: string;
  transaction_id: string;
  payment_id: string; // Stripe PaymentIntent ID / Razorpay Payment ID
  payment_mandate_hash: string;
  amount: {
    amount: number;
    currency: string;
  };
  status: "captured" | "authorized" | "failed";
  timestamp: string;
}

// ── Legacy Compatibility Interfaces ──────────────────────────────────────────

export interface IntentMandateConstraints {
  max_amount: number;
  currency: string;
  allowed_domains?: string[];
  category_constraints?: Record<string, unknown>;
  requires_refundability?: boolean;
  expires_at: string;
}

export interface IntentMandate {
  mandate_id: string;
  kind: "intent";
  principal: {
    user_ref: string;
  };
  user_consent_token?: string;
  constraints: IntentMandateConstraints;
  nonce: string;
  issued_at: string;
  open_mandate?: OpenPaymentMandate;
  jws?: string;
  user_jwk?: PublicJwk;
}

export interface PaymentMandateBinding {
  transaction_id: string;
  checkout_id: string;
  checkout_hash: string;
  amount: number;
  currency: string;
  payee: string;
}

export interface PaymentMandate {
  mandate_id: string;
  kind: "payment";
  intent_mandate_id?: string;
  binding: PaymentMandateBinding;
  approved_by: "user_jit" | "derived_from_intent";
  nonce: string;
  issued_at: string;
  expires_at: string;
  closed_mandate?: ClosedPaymentMandate;
  jws?: string;
  user_consent_jws?: string;
  user_consent_jwk?: PublicJwk;
}

export interface SignedMandate {
  mandate: IntentMandate | PaymentMandate;
  signature: string;
  algorithm: "hmac-sha256" | "ES256";
  jws?: string;
  public_jwk?: PublicJwk;
  signer_role?: "user" | "agent" | "merchant";
  user_consent_jws?: string;
  user_consent_jwk?: PublicJwk;
}

export interface ConsentChallenge {
  challenge_id: string;
  transaction_id: string;
  checkout_id: string;
  checkout_hash: string;
  amount: number;
  currency: string;
  payee: string;
  consent_url: string;
  expires_at: string;
  signature: string;
  checkout_jwt?: string;
  agent_jwk?: PublicJwk;
  payment_instrument?: PaymentInstrument;
}
