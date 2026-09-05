/**
 * AP2 Mandate Store & Authorization Broker
 * Constructs, validates, signs, persists, and derives Intent and Payment Mandates
 * according to Google Agent Payments Protocol (AP2) standards.
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
  OpenPaymentMandate,
  ClosedPaymentMandate,
  PaymentInstrument,
  MerchantCheckoutObject,
  CheckoutReceipt,
  PaymentReceipt,
} from "./types.js";
import {
  canonicalJsonStringify,
  generateEcKeyPair,
  signJws,
  verifyJws,
  hashCheckoutJwt,
  EcKeyPair,
  PublicJwk,
} from "./crypto.js";

/**
 * Deterministically serialize a JSON object by recursively sorting all keys per RFC 8785 (JCS).
 */
export function canonicalStringify(obj: unknown): string {
  return canonicalJsonStringify(obj);
}

/**
 * Compute cryptographic SHA-256 hash over canonical merchant checkout facts.
 * If checkout_jwt is available, hashes checkout_jwt per AP2 standard;
 * otherwise hashes the deterministic canonical checkout facts.
 */
export function hashCheckout(checkout: MerchantVerifiedCheckout): string {
  if (checkout.checkout_jwt) {
    return hashCheckoutJwt(checkout.checkout_jwt);
  }
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
    .update(canonicalJsonStringify(canonicalFacts))
    .digest("hex");
}

export class MandateStore {
  private store: PersistenceStore;
  private signingSecret: string;
  private authMode: "mandate" | "none";
  private publicBaseUrl: string;
  private mandates: Map<string, SignedMandate> = new Map();
  private pendingChallenges: Map<string, ConsentChallenge> = new Map();

  // AP2 Cryptographic Keys & State
  private merchantKeyPair: EcKeyPair;
  private consumedBudget: Map<string, number> = new Map(); // mandate_id -> cumulative consumed amount
  private receipts: Map<string, string> = new Map(); // receipt_id -> JWS

  constructor(
    store: PersistenceStore,
    signingSecret?: string,
    authMode?: "mandate" | "none",
    publicBaseUrl?: string,
    merchantKeyPair?: EcKeyPair
  ) {
    this.store = store;
    this.signingSecret =
      signingSecret || process.env.MANDATE_SIGNING_SECRET || "default_mandate_secret_key_mcp";
    const mode = (authMode || process.env.MERCHANTMCP_AUTH_MODE || "none").toLowerCase();
    this.authMode = mode.startsWith("mandate") ? "mandate" : "none";
    const callbackPort = Number(process.env.AUTH_CALLBACK_PORT || 3002);
    this.publicBaseUrl =
      publicBaseUrl || process.env.MCP_PUBLIC_BASE_URL || `http://localhost:${callbackPort}`;

    this.merchantKeyPair = merchantKeyPair || generateEcKeyPair("merchant-key-1");
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

  getMerchantPublicKey(): PublicJwk {
    return this.merchantKeyPair.publicJwk;
  }

  getMerchantKeyPair(): EcKeyPair {
    return this.merchantKeyPair;
  }

  /**
   * Get cumulative consumed amount against an intent/budget mandate.
   */
  getConsumedBudget(mandateId: string): number {
    return this.consumedBudget.get(mandateId) || 0;
  }

  /**
   * Record expenditure against a mandate budget.
   */
  consumeBudget(mandateId: string, amount: number): void {
    const current = this.getConsumedBudget(mandateId);
    this.consumedBudget.set(mandateId, current + amount);
  }

  /**
   * Create an authoritative merchant-signed Checkout JWT (AP2 checkout.merchant.1)
   */
  createMerchantCheckoutJwt(
    checkout: MerchantVerifiedCheckout,
    merchantName: string = "Merchant",
    merchantDomain?: string
  ): { checkoutJwt: string; checkoutHash: string } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 15 * 60; // 15 minutes TTL

    const checkoutObj: MerchantCheckoutObject = {
      vct: "checkout.merchant.1",
      checkout_id: checkout.checkout_id,
      sku: checkout.sku,
      title: checkout.title || checkout.sku,
      total: {
        amount: checkout.total.amount,
        currency: checkout.total.currency,
      },
      available: checkout.available,
      merchant: {
        name: merchantName,
        domain: merchantDomain,
      },
      iat: now,
      exp,
    };

    const checkoutJwt = signJws(checkoutObj as any, this.merchantKeyPair.privateKey, {
      kid: "merchant-key-1",
      typ: "JWT",
    });
    const checkoutHash = hashCheckoutJwt(checkoutJwt);

    checkout.checkout_jwt = checkoutJwt;
    checkout.checkout_hash = checkoutHash;

    return { checkoutJwt, checkoutHash };
  }

  /**
   * Create and sign a Checkout Receipt JWT (mandate.checkout.receipt.1)
   */
  createCheckoutReceipt(
    transactionId: string,
    checkoutId: string,
    checkoutHash: string,
    status: "accepted" | "rejected" = "accepted"
  ): { receiptId: string; receiptJwt: string } {
    const receiptId = `rcpt_chk_${crypto.randomUUID()}`;
    const payload: CheckoutReceipt = {
      vct: "mandate.checkout.receipt.1",
      receipt_id: receiptId,
      transaction_id: transactionId,
      checkout_id: checkoutId,
      checkout_hash: checkoutHash,
      status,
      timestamp: new Date().toISOString(),
    };

    const receiptJwt = signJws(payload as any, this.merchantKeyPair.privateKey, {
      kid: "merchant-key-1",
      typ: "JWT",
    });

    this.receipts.set(receiptId, receiptJwt);
    return { receiptId, receiptJwt };
  }

  /**
   * Create and sign a Payment Receipt JWT (mandate.payment.receipt.1)
   */
  createPaymentReceipt(
    transactionId: string,
    paymentId: string,
    paymentMandateHash: string,
    amount: { amount: number; currency: string },
    status: "captured" | "authorized" | "failed" = "captured"
  ): { receiptId: string; receiptJwt: string } {
    const receiptId = `rcpt_pay_${crypto.randomUUID()}`;
    const payload: PaymentReceipt = {
      vct: "mandate.payment.receipt.1",
      receipt_id: receiptId,
      transaction_id: transactionId,
      payment_id: paymentId,
      payment_mandate_hash: paymentMandateHash,
      amount,
      status,
      timestamp: new Date().toISOString(),
    };

    const receiptJwt = signJws(payload as any, this.merchantKeyPair.privateKey, {
      kid: "merchant-key-1",
      typ: "JWT",
    });

    this.receipts.set(receiptId, receiptJwt);
    return { receiptId, receiptJwt };
  }

  getReceipt(receiptId: string): string | undefined {
    return this.receipts.get(receiptId);
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
   * Cryptographically sign a mandate.
   * Supports both standard AP2 ES256 asymmetric JWS signatures and HMAC-SHA256.
   */
  /**
   * Cryptographically sign a mandate.
   * Supports both standard AP2 ES256 asymmetric JWS signatures and HMAC-SHA256.
   */
  sign(
    mandate: IntentMandate | PaymentMandate,
    options?: {
      algorithm?: "ES256" | "hmac-sha256";
      privateKey?: crypto.KeyObject | string;
      publicJwk?: PublicJwk;
      kid?: string;
      signerRole?: "user" | "agent" | "merchant";
    }
  ): SignedMandate {
    const alg = options?.algorithm || (options?.privateKey ? "ES256" : "hmac-sha256");

    if (alg === "ES256") {
      const privKey = options?.privateKey || this.merchantKeyPair.privateKey;
      const kid = options?.kid || (options?.privateKey ? "custom-key" : "merchant-key-1");
      const jws = signJws(mandate as any, privKey, { kid });
      // Enforce keypair integrity: if signed with merchant private key, public key must be merchant's public JWK
      const pubJwk = options?.privateKey
        ? (options?.publicJwk || this.merchantKeyPair.publicJwk)
        : this.merchantKeyPair.publicJwk;

      return {
        mandate,
        signature: jws,
        algorithm: "ES256",
        jws,
        public_jwk: pubJwk,
        signer_role: options?.signerRole || "merchant",
      };
    }

    // Default: HMAC-SHA256
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
   * Cryptographically verify a signed mandate (supports both ES256 JWS and HMAC).
   */
  verify(signed: SignedMandate): { valid: boolean; error?: string } {
    if (signed.algorithm === "ES256") {
      const jwsToVerify = signed.jws || signed.signature;
      const keyToUse = signed.public_jwk || this.merchantKeyPair.publicKey;
      const result = verifyJws(jwsToVerify, keyToUse);
      if (!result.valid) {
        return { valid: false, error: result.error };
      }
      // Detect in-memory tampering (exclude transient jws field)
      const { jws: _mJws, ...mandateWithoutJws } = signed.mandate as any;
      const { jws: _pJws, ...payloadWithoutJws } = (result.payload || {}) as any;
      const canonicalMandate = canonicalStringify(mandateWithoutJws);
      const canonicalPayload = canonicalStringify(payloadWithoutJws);
      if (canonicalMandate !== canonicalPayload) {
        return { valid: false, error: "Mandate signature verification failed (tampered)" };
      }
      return { valid: true };
    }

    if (signed.algorithm === "hmac-sha256") {
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

    return { valid: false, error: `Unsupported signature algorithm "${signed.algorithm}"` };
  }

  /**
   * Create an Intent Mandate (Mode A — Autonomous Authorization).
   * Constructs an AP2 Open Payment Mandate (mandate.payment.open.1) with constraints and cnf confirmation key.
   */
  async createIntentMandate(params: {
    user_ref: string;
    constraints: IntentMandateConstraints;
    user_consent_token?: string;
    agent_jwk?: PublicJwk;
    user_jwk?: PublicJwk;
    payment_instrument?: PaymentInstrument;
    algorithm?: "ES256" | "hmac-sha256";
  }): Promise<{ authorization_reference: string; mandate: SignedMandate }> {
    const mandateId = `man_intent_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = Math.floor(new Date(params.constraints.expires_at).getTime() / 1000);

    const openMandate: OpenPaymentMandate = {
      vct: "mandate.payment.open.1",
      mandate_id: mandateId,
      principal: {
        user_ref: params.user_ref,
      },
      constraints: [
        {
          type: "payment.amount_range",
          max: params.constraints.max_amount,
          currency: params.constraints.currency,
        },
        {
          type: "payment.budget",
          max: params.constraints.max_amount,
          currency: params.constraints.currency,
          consumed: 0,
        },
        ...(params.constraints.allowed_domains
          ? [
              {
                type: "payment.allowed_payees" as const,
                allowed: params.constraints.allowed_domains.map((d) => ({ name: d })),
              },
            ]
          : []),
      ],
      cnf: {
        jwk: params.agent_jwk || this.merchantKeyPair.publicJwk,
      },
      user_jwk: params.user_jwk,
      payment_instrument: params.payment_instrument,
      iat: nowSec,
      exp: isNaN(expSec) ? nowSec + 3600 : expSec,
      nonce: crypto.randomUUID(),
    };

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
      open_mandate: openMandate,
      user_jwk: params.user_jwk,
    };

    const chosenAlg = params.algorithm || "hmac-sha256";
    const signingPrivKey = (params as any).user_private_key || this.merchantKeyPair.privateKey;
    const signingPubJwk = (params as any).user_private_key && params.user_jwk ? params.user_jwk : this.merchantKeyPair.publicJwk;

    const signed = this.sign(intentMandate, {
      algorithm: chosenAlg,
      privateKey: signingPrivKey,
      publicJwk: signingPubJwk,
      signerRole: (params as any).user_private_key ? "user" : "merchant",
    });
    intentMandate.jws = signed.jws;

    this.mandates.set(mandateId, signed);
    await this.store.saveMandate(signed);

    return {
      authorization_reference: mandateId,
      mandate: signed,
    };
  }

  /**
   * Derive a concrete Payment Mandate for a transaction.
   * In AP2 Autonomous Mode, evaluates constraints and signs a Closed Payment Mandate (mandate.payment.1)
   * using the Agent's session key.
   */
  async derivePaymentMandate(
    txn: Transaction,
    intentMandateRef?: string,
    userJitApproved: boolean = false,
    payeeName: string = "Merchant",
    options?: {
      agentKeyPair?: EcKeyPair;
      userJws?: string;
      userJwk?: PublicJwk;
    }
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

      // 3. Verify cumulative budget (AP2 payment.budget constraint)
      const consumed = this.getConsumedBudget(intent.mandate_id);
      if (consumed + checkout.total.amount > intent.constraints.max_amount) {
        return {
          status: "denied",
          reason: `Cumulative budget exceeded: already spent ${consumed} ${intent.constraints.currency}, attempted ${checkout.total.amount} ${checkout.total.currency}, max budget is ${intent.constraints.max_amount}`,
        };
      }

      // 4. Verify currency match
      if (checkout.total.currency.toUpperCase() !== intent.constraints.currency.toUpperCase()) {
        return {
          status: "denied",
          reason: `Currency mismatch: checkout is ${checkout.total.currency}, mandate is for ${intent.constraints.currency}`,
        };
      }

      // Construct and sign concrete Closed Payment Mandate (mandate.payment.1)
      const mandateId = `man_pay_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const nowSec = Math.floor(Date.now() / 1000);
      const expSec = nowSec + 15 * 60;

      const closedMandate: ClosedPaymentMandate = {
        vct: "mandate.payment.1",
        mandate_id: mandateId,
        intent_mandate_id: intent.mandate_id,
        transaction_id: txn.transaction_id,
        checkout_id: checkout.checkout_id,
        checkout_hash: checkoutHash,
        payee: {
          name: payeeName,
        },
        payment_amount: {
          amount: checkout.total.amount,
          currency: checkout.total.currency,
        },
        payment_instrument: intent.open_mandate?.payment_instrument,
        approved_by: "derived_from_intent",
        iat: nowSec,
        exp: expSec,
        nonce: crypto.randomUUID(),
      };

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
        closed_mandate: closedMandate,
      };

      // Sign with Agent Keypair if available (proves possession of cnf.jwk), else fallback to merchant key
      const agentKey = options?.agentKeyPair;
      const signedPayment = this.sign(paymentMandate, {
        algorithm: signedIntent.algorithm === "hmac-sha256" ? "hmac-sha256" : "ES256",
        privateKey: agentKey?.privateKey || this.merchantKeyPair.privateKey,
        publicJwk: agentKey?.publicJwk || this.merchantKeyPair.publicJwk,
        signerRole: agentKey ? "agent" : "merchant",
      });
      paymentMandate.jws = signedPayment.jws;

      this.mandates.set(mandateId, signedPayment);
      await this.store.saveMandate(signedPayment);

      // Record budget consumption
      this.consumeBudget(intent.mandate_id, checkout.total.amount);

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
      const nowSec = Math.floor(Date.now() / 1000);
      const expSec = nowSec + 15 * 60;

      const closedMandate: ClosedPaymentMandate = {
        vct: "mandate.payment.1",
        mandate_id: mandateId,
        transaction_id: txn.transaction_id,
        checkout_id: checkout.checkout_id,
        checkout_hash: checkoutHash,
        payee: {
          name: payeeName,
        },
        payment_amount: {
          amount: checkout.total.amount,
          currency: checkout.total.currency,
        },
        approved_by: "user_jit",
        iat: nowSec,
        exp: expSec,
        nonce: crypto.randomUUID(),
      };

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
        closed_mandate: closedMandate,
        ...(options?.userJws ? { user_consent_jws: options.userJws } : {}),
        ...(options?.userJwk ? { user_consent_jwk: options.userJwk } : {}),
      };

      const signedPayment = this.sign(paymentMandate, {
        algorithm: "ES256",
        privateKey: this.merchantKeyPair.privateKey,
        publicJwk: this.merchantKeyPair.publicJwk,
        signerRole: options?.userJwk ? "user" : "merchant",
      });
      paymentMandate.jws = signedPayment.jws;
      if (options?.userJws) {
        signedPayment.user_consent_jws = options.userJws;
      }
      if (options?.userJwk) {
        signedPayment.user_consent_jwk = options.userJwk;
      }

      this.mandates.set(mandateId, signedPayment);
      await this.store.saveMandate(signedPayment);

      return {
        status: "authorized",
        payment_mandate: signedPayment,
        authorization_reference: mandateId,
      };
    }

    // ── Mode B: Consent Challenge Required ───────────────────────────────────
    const challenge = this.createConsentChallenge(txn, checkout, payeeName, options?.agentKeyPair?.publicJwk);
    return {
      status: "consent_required",
      consent_challenge: challenge,
    };
  }

  /**
   * Generate an AP2 Consent Challenge for human approval on a Trusted Surface.
   */
  createConsentChallenge(
    txn: Transaction,
    checkout: MerchantVerifiedCheckout,
    payeeName: string = "Merchant",
    agentJwk?: PublicJwk
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
      checkout_jwt: checkout.checkout_jwt,
      agent_jwk: agentJwk,
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
   * Confirm a Consent Challenge when user approves on Trusted Surface.
   * Supports client-side JWS signatures generated by browser Web Crypto.
   */
  async confirmConsentChallenge(
    challengeId: string,
    payeeName: string = "Merchant",
    options?: {
      userJws?: string;
      userJwk?: PublicJwk;
      paymentInstrument?: PaymentInstrument;
    }
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

    // If client provided a JWS signed via Web Crypto, verify it against client's JWK
    if (options?.userJws && options?.userJwk) {
      const verification = verifyJws(options.userJws, options.userJwk);
      if (!verification.valid) {
        return { status: "denied", error: `User mandate signature verification failed: ${verification.error}` };
      }
    }

    const mandateId = `man_pay_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + 15 * 60;

    const closedMandate: ClosedPaymentMandate = {
      vct: "mandate.payment.1",
      mandate_id: mandateId,
      transaction_id: challenge.transaction_id,
      checkout_id: challenge.checkout_id,
      checkout_hash: challenge.checkout_hash,
      payee: {
        name: payeeName,
      },
      payment_amount: {
        amount: challenge.amount,
        currency: challenge.currency,
      },
      payment_instrument: options?.paymentInstrument,
      approved_by: "user_jit",
      iat: nowSec,
      exp: expSec,
      nonce: crypto.randomUUID(),
    };

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
      closed_mandate: closedMandate,
      ...(options?.userJws ? { user_consent_jws: options.userJws } : {}),
      ...(options?.userJwk ? { user_consent_jwk: options.userJwk } : {}),
    };

    const signedPayment = this.sign(paymentMandate, {
      algorithm: "ES256",
      privateKey: this.merchantKeyPair.privateKey,
      publicJwk: this.merchantKeyPair.publicJwk,
      signerRole: options?.userJwk ? "user" : "merchant",
    });
    paymentMandate.jws = signedPayment.jws;
    if (options?.userJws) {
      signedPayment.user_consent_jws = options.userJws;
    }
    if (options?.userJwk) {
      signedPayment.user_consent_jwk = options.userJwk;
    }

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
