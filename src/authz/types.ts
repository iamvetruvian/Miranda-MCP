/**
 * AP2-Shaped Authorization Types
 * Defines Intent Mandates (open constraint class authorizations),
 * Payment Mandates (bound to a specific checkout),
 * Signed Mandates, and Consent Challenges.
 */

export interface IntentMandateConstraints {
  max_amount: number; // in currency sub-units (paise / cents)
  currency: string;
  allowed_domains?: string[]; // e.g. ["retail", "ticketing"]
  category_constraints?: Record<string, unknown>;
  requires_refundability?: boolean;
  expires_at: string; // ISO 8601
}

export interface IntentMandate {
  mandate_id: string;
  kind: "intent";
  principal: {
    user_ref: string; // opaque user reference
  };
  constraints: IntentMandateConstraints;
  nonce: string;
  issued_at: string;
}

export interface PaymentMandateBinding {
  transaction_id: string;
  checkout_id: string;
  checkout_hash: string; // SHA-256 over canonical checkout facts
  amount: number;
  currency: string;
  payee: string; // merchant name or identifier
}

export interface PaymentMandate {
  mandate_id: string;
  kind: "payment";
  intent_mandate_id?: string; // lineage when derived from an intent mandate
  binding: PaymentMandateBinding;
  approved_by: "user_jit" | "derived_from_intent";
  nonce: string;
  issued_at: string;
  expires_at: string; // short-lived (e.g. 15 minutes)
}

export interface SignedMandate {
  mandate: IntentMandate | PaymentMandate;
  signature: string; // HMAC-SHA256 signature
  algorithm: "hmac-sha256";
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
}
