/**
 * AP2 Mandate Store & Authorization Broker
 * Constructs, validates, signs, persists, and derives Intent and Payment Mandates.
 */

import crypto from "crypto";
import { PersistenceStore } from "../persistence/store.js";
import { Transaction, MerchantVerifiedCheckout } from "../types/index.js";
import {
  IntentMandate,
  PaymentMandate,
  SignedMandate,
  ConsentChallenge,
  IntentMandateConstraints,
} from "./types.js";

/**
 * Deterministically serialize a JSON object by recursively sorting all keys.
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => canonicalStringify(item)).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify((obj as Record<string, unknown>)[k])}`
  );
  return "{" + pairs.join(",") + "}";
}

/**
 * Compute cryptographic SHA-256 hash over canonical merchant checkout facts.
 */
export function hashCheckout(checkout: MerchantVerifiedCheckout): string {
  const canonicalFacts = {
    checkout_id: checkout.checkout_id,
    sku: checkout.sku,
    total: {
      amount: checkout.total.amount,
      currency: checkout.total.currency,
    },
    available: checkout.available,
  };
  return crypto
    .createHash("sha256")
    .update(canonicalStringify(canonicalFacts))
    .digest("hex");
}

export class MandateStore {
  private store: PersistenceStore;
  private signingSecret: string;
  private authMode: "mandate" | "none";
  private publicBaseUrl: string;
  private mandates: Map<string, SignedMandate> = new Map();
  private pendingChallenges: Map<string, ConsentChallenge> = new Map();

  constructor(
    store: PersistenceStore,
    signingSecret?: string,
    authMode?: "mandate" | "none",
    publicBaseUrl?: string
  ) {
    this.store = store;
    this.signingSecret =
      signingSecret || process.env.MANDATE_SIGNING_SECRET || "default_mandate_secret_key_mcp";
    const mode = (authMode || process.env.MERCHANTMCP_AUTH_MODE || "none").toLowerCase();
    this.authMode = mode.startsWith("mandate") ? "mandate" : "none";
    const callbackPort = Number(process.env.AUTH_CALLBACK_PORT || 3002);
    this.publicBaseUrl =
      publicBaseUrl || process.env.MCP_PUBLIC_BASE_URL || `http://localhost:${callbackPort}`;
  }

  isAuthModeEnabled(): boolean {
    return this.authMode === "mandate";
  }

  setAuthMode(mode: "mandate" | "none"): void {
    this.authMode = mode;
  }

  setPublicBaseUrl(url: string): void {
    this.publicBaseUrl = url;
  }

  /**
   * Hydrate in-memory mandates from persistence.
   */
  hydrate(mandates: SignedMandate[]): void {
    this.mandates.clear();
    for (const signed of mandates) {
      const id = signed.mandate.mandate_id;
      this.mandates.set(id, signed);
    }
  }

  /**
   * Cryptographically sign a mandate using HMAC-SHA256 over its canonical JSON.
   */
  sign(mandate: IntentMandate | PaymentMandate): SignedMandate {
    const canonical = canonicalStringify(mandate);
    const signature = crypto
      .createHmac("sha256", this.signingSecret)
      .update(canonical)
      .digest("hex");

    return {
      mandate,
      signature,
      algorithm: "hmac-sha256",
    };
  }

  /**
   * Cryptographically verify a signed mandate.
   */
  verify(signed: SignedMandate): { valid: boolean; error?: string } {
    if (signed.algorithm !== "hmac-sha256") {
      return { valid: false, error: `Unsupported signature algorithm "${signed.algorithm}"` };
    }

    try {
      const canonical = canonicalStringify(signed.mandate);
      const expected = crypto
        .createHmac("sha256", this.signingSecret)
        .update(canonical)
        .digest("hex");

      const match = crypto.timingSafeEqual(
        Buffer.from(signed.signature, "utf8"),
        Buffer.from(expected, "utf8")
      );

      if (!match) {
        return { valid: false, error: "Mandate signature verification failed (tampered)" };
      }

      return { valid: true };
    } catch {
      return { valid: false, error: "Invalid mandate signature format" };
    }
  }

  /**
   * Create an Intent Mandate (Mode A — Autonomous Authorization).
   */
  async createIntentMandate(params: {
    user_ref: string;
    constraints: IntentMandateConstraints;
    user_consent_token?: string;
  }): Promise<{ authorization_reference: string; mandate: SignedMandate }> {
    const mandateId = `man_intent_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const intentMandate: IntentMandate = {
      mandate_id: mandateId,
      kind: "intent",
      principal: {
        user_ref: params.user_ref,
      },
      user_consent_token: params.user_consent_token,
      constraints: { ...params.constraints },
      nonce: crypto.randomUUID(),
      issued_at: now,
    };

    const signed = this.sign(intentMandate);
    this.mandates.set(mandateId, signed);
    await this.store.saveMandate(signed);

    return {
      authorization_reference: mandateId,
      mandate: signed,
    };
  }

  /**
   * Derive a concrete Payment Mandate for a transaction.
   */
  async derivePaymentMandate(
    txn: Transaction,
    intentMandateRef?: string,
    userJitApproved: boolean = false,
    payeeName: string = "Merchant"
  ): Promise<
    | { status: "authorized"; payment_mandate: SignedMandate; authorization_reference: string }
    | { status: "consent_required"; consent_challenge: ConsentChallenge }
    | { status: "denied"; reason: string }
  > {
    if (!txn.merchant_verified) {
      return {
        status: "denied",
        reason: "Cannot derive payment mandate: checkout is not yet verified by merchant",
      };
    }

    const checkout = txn.merchant_verified;
    const checkoutHash = hashCheckout(checkout);

    // ── Mode A: Derived from Intent Mandate ────────────────────────────────────
    if (intentMandateRef) {
      const signedIntent = await this.getMandate(intentMandateRef);
      if (!signedIntent) {
        return { status: "denied", reason: `Intent mandate "${intentMandateRef}" not found` };
      }

      const verification = this.verify(signedIntent);
      if (!verification.valid) {
        return { status: "denied", reason: `Invalid intent mandate signature: ${verification.error}` };
      }

      const intent = signedIntent.mandate;
      if (intent.kind !== "intent") {
        return { status: "denied", reason: `Mandate "${intentMandateRef}" is not an intent mandate` };
      }

      // 1. Verify expiry
      if (Date.now() > new Date(intent.constraints.expires_at).getTime()) {
        return {
          status: "denied",
          reason: `Intent mandate expired at ${intent.constraints.expires_at}`,
        };
      }

      // 2. Verify amount ceiling
      if (checkout.total.amount > intent.constraints.max_amount) {
        return {
          status: "denied",
          reason: `Checkout total (${checkout.total.amount} ${checkout.total.currency}) exceeds intent mandate limit (${intent.constraints.max_amount} ${intent.constraints.currency})`,
        };
      }

      // 3. Verify currency match
      if (checkout.total.currency.toUpperCase() !== intent.constraints.currency.toUpperCase()) {
        return {
          status: "denied",
          reason: `Currency mismatch: checkout is ${checkout.total.currency}, mandate is for ${intent.constraints.currency}`,
        };
      }

      // Construct and sign payment mandate
      const mandateId = `man_pay_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min TTL

      const paymentMandate: PaymentMandate = {
        mandate_id: mandateId,
        kind: "payment",
        intent_mandate_id: intent.mandate_id,
        binding: {
          transaction_id: txn.transaction_id,
          checkout_id: checkout.checkout_id,
          checkout_hash: checkoutHash,
          amount: checkout.total.amount,
          currency: checkout.total.currency,
          payee: payeeName,
        },
        approved_by: "derived_from_intent",
        nonce: crypto.randomUUID(),
        issued_at: now,
        expires_at: expiresAt,
      };

      const signedPayment = this.sign(paymentMandate);
      this.mandates.set(mandateId, signedPayment);
      await this.store.saveMandate(signedPayment);

      return {
        status: "authorized",
        payment_mandate: signedPayment,
        authorization_reference: mandateId,
      };
    }

    // ── Mode B: Approved by User Just-in-Time ─────────────────────────────────
    if (userJitApproved) {
      const mandateId = `man_pay_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      const paymentMandate: PaymentMandate = {
        mandate_id: mandateId,
        kind: "payment",
        binding: {
          transaction_id: txn.transaction_id,
          checkout_id: checkout.checkout_id,
          checkout_hash: checkoutHash,
          amount: checkout.total.amount,
          currency: checkout.total.currency,
          payee: payeeName,
        },
        approved_by: "user_jit",
        nonce: crypto.randomUUID(),
        issued_at: now,
        expires_at: expiresAt,
      };

      const signedPayment = this.sign(paymentMandate);
      this.mandates.set(mandateId, signedPayment);
      await this.store.saveMandate(signedPayment);

      return {
        status: "authorized",
        payment_mandate: signedPayment,
        authorization_reference: mandateId,
      };
    }

    // ── Mode B: Consent Challenge Required ───────────────────────────────────
    const challenge = this.createConsentChallenge(txn, checkout, payeeName);
    return {
      status: "consent_required",
      consent_challenge: challenge,
    };
  }

  /**
   * Generate an HMAC-signed Consent Challenge for human approval.
   */
  createConsentChallenge(
    txn: Transaction,
    checkout: MerchantVerifiedCheckout,
    payeeName: string = "Merchant"
  ): ConsentChallenge {
    const challengeId = `chn_${crypto.randomUUID()}`;
    const checkoutHash = hashCheckout(checkout);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const consentUrl = `${this.publicBaseUrl}/consent/${challengeId}`;

    const material = `${challengeId}:${txn.transaction_id}:${checkout.checkout_id}:${checkoutHash}:${checkout.total.amount}:${checkout.total.currency}`;
    const signature = crypto
      .createHmac("sha256", this.signingSecret)
      .update(material)
      .digest("hex");

    const challenge: ConsentChallenge = {
      challenge_id: challengeId,
      transaction_id: txn.transaction_id,
      checkout_id: checkout.checkout_id,
      checkout_hash: checkoutHash,
      amount: checkout.total.amount,
      currency: checkout.total.currency,
      payee: payeeName,
      consent_url: consentUrl,
      expires_at: expiresAt,
      signature,
    };

    this.pendingChallenges.set(challengeId, challenge);
    return challenge;
  }

  getConsentChallenge(challengeId: string): ConsentChallenge | undefined {
    return this.pendingChallenges.get(challengeId);
  }

  getConsentChallengeByTransaction(transactionId: string): ConsentChallenge | undefined {
    for (const challenge of this.pendingChallenges.values()) {
      if (challenge.transaction_id === transactionId) {
        return challenge;
      }
    }
    return undefined;
  }

  /**
   * Confirm a Consent Challenge when user approves out-of-band.
   */
  async confirmConsentChallenge(
    challengeId: string,
    payeeName: string = "Merchant"
  ): Promise<
    | { status: "authorized"; payment_mandate: SignedMandate; authorization_reference: string; transaction_id: string }
    | { status: "denied"; error: string }
  > {
    const challenge = this.pendingChallenges.get(challengeId);
    if (!challenge) {
      return { status: "denied", error: "Consent challenge not found or expired" };
    }

    if (Date.now() > new Date(challenge.expires_at).getTime()) {
      this.pendingChallenges.delete(challengeId);
      return { status: "denied", error: "Consent challenge has expired" };
    }

    const mandateId = `man_pay_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const paymentMandate: PaymentMandate = {
      mandate_id: mandateId,
      kind: "payment",
      binding: {
        transaction_id: challenge.transaction_id,
        checkout_id: challenge.checkout_id,
        checkout_hash: challenge.checkout_hash,
        amount: challenge.amount,
        currency: challenge.currency,
        payee: payeeName,
      },
      approved_by: "user_jit",
      nonce: crypto.randomUUID(),
      issued_at: now,
      expires_at: expiresAt,
    };

    const signedPayment = this.sign(paymentMandate);
    this.mandates.set(mandateId, signedPayment);
    await this.store.saveMandate(signedPayment);
    this.pendingChallenges.delete(challengeId);

    return {
      status: "authorized",
      payment_mandate: signedPayment,
      authorization_reference: mandateId,
      transaction_id: challenge.transaction_id,
    };
  }

  /**
   * Reject a Consent Challenge when user rejects out-of-band.
   */
  async rejectConsentChallenge(
    challengeId: string
  ): Promise<
    | { status: "rejected"; transaction_id: string; reason?: string }
    | { status: "denied"; error: string }
  > {
    const challenge = this.pendingChallenges.get(challengeId);
    if (!challenge) {
      return { status: "denied", error: "Consent challenge not found or expired" };
    }

    this.pendingChallenges.delete(challengeId);

    return {
      status: "rejected",
      transaction_id: challenge.transaction_id,
      reason: "User rejected mandate authorization",
    };
  }

  async getMandate(mandateId: string): Promise<SignedMandate | undefined> {
    const inMemory = this.mandates.get(mandateId);
    if (inMemory) return inMemory;

    const loaded = await this.store.loadMandates();
    const found = loaded.find(
      (m: any) => m?.mandate?.mandate_id === mandateId || m?.mandate_id === mandateId
    );
    if (found) {
      this.mandates.set(mandateId, found);
      return found;
    }
    return undefined;
  }

  getMandateSync(mandateId: string): SignedMandate | undefined {
    return this.mandates.get(mandateId);
  }
}
