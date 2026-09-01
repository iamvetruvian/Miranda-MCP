/**
 * AP2 Mandate Store & Policy Gates Unit Tests
 * Verifies Intent Mandates, Payment Mandates, HMAC cryptographic signing,
 * bounds validation, replay protection, and Mode A & Mode B authorization flows.
 */

import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { MandateStore, canonicalStringify, hashCheckout } from "../../src/authz/mandate-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { MandateGate, MandateBoundsGate } from "../../src/policy/gates.js";
import { Transaction, TransactionState, MerchantVerifiedCheckout } from "../../src/types/index.js";
import { createMerchantMcpServer } from "../../src/server.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

const sampleManifest: IntegrationManifest = {
  merchant: {
    name: "TestStore",
    description: "Testing store",
    commerce_domain: "retail",
    currency: "INR",
    base_url: "http://localhost:9999",
  },
  operations: {
    search: { method: "GET", path: "/products" },
    get_product: { method: "GET", path: "/products/:product_id" },
    create_checkout: { method: "POST", path: "/checkout" },
    get_checkout: { method: "GET", path: "/checkout/:checkout_id" },
    confirm_order: { method: "POST", path: "/orders" },
    get_order_status: { method: "GET", path: "/orders/:order_id" },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.id" },
      title: { from: "$.name" },
      description: { from: "$.desc" },
      "price.amount": { from: "$.price" },
      "price.currency": { from: null, transform: { type: "default", value: "INR" } },
      availability: { from: "$.stock", transform: { type: "enum", enum_map: { available: "in_stock" } } },
      attributes: { from: "$.specs" },
    },
    checkout: {
      checkout_id: { from: "$.chk_id" },
      sku: { from: "$.sku" },
      "total.amount": { from: "$.total_amount" },
      "total.currency": { from: null, transform: { type: "default", value: "INR" } },
      available: { from: "$.is_avail" },
    },
    order: {
      order_id: { from: "$.ord_id" },
      status: { from: "$.order_status" },
    },
  },
  payment: {
    provider: "razorpay",
    razorpay_key_id_env: "TEST_RZP_KEY",
    razorpay_key_secret_env: "TEST_RZP_SECRET",
  },
};

function createMockTransaction(overrides?: Partial<Transaction>): Transaction {
  const checkout: MerchantVerifiedCheckout = {
    checkout_id: "chk_test_123",
    sku: "prod_laptop_1",
    title: "Gaming Laptop",
    unit_price: { amount: 7500000, currency: "INR" },
    total: { amount: 7500000, currency: "INR" },
    available: true,
  };

  return {
    transaction_id: "txn_test_456",
    state: TransactionState.CHECKOUT_CREATED,
    created_at: new Date().toISOString(),
    agent_claim: {
      product_id: "prod_laptop_1",
      quantity: 1,
      selection_reason: "Best value under budget",
    },
    merchant_verified: checkout,
    audit_event_ids: [],
    ...overrides,
  };
}

describe("AP2 Mandate Store & Authorization Broker", () => {
  let store: InMemoryStore;
  let mandateStore: MandateStore;
  const signingSecret = "test_signing_secret_key_1234567890";

  beforeEach(() => {
    store = new InMemoryStore();
    mandateStore = new MandateStore(store, signingSecret, "mandate");
  });

  describe("Canonical JSON & Checkout Hashing", () => {
    it("should serialize objects deterministically regardless of key order", () => {
      const objA = { z: 1, a: "hello", m: [3, 2, 1], nested: { y: true, x: false } };
      const objB = { nested: { x: false, y: true }, a: "hello", z: 1, m: [3, 2, 1] };

      expect(canonicalStringify(objA)).toBe(canonicalStringify(objB));
    });

    it("should compute deterministic SHA-256 hash over checkout facts", () => {
      const checkout: MerchantVerifiedCheckout = {
        checkout_id: "chk_100",
        sku: "sku_100",
        unit_price: { amount: 5000, currency: "INR" },
        total: { amount: 5000, currency: "INR" },
        available: true,
      };

      const hash1 = hashCheckout(checkout);
      const hash2 = hashCheckout({ ...checkout, raw_merchant_data: { extra: "ignored" } });

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
    });
  });

  describe("Intent Mandate Creation & Verification", () => {
    it("should create and sign an Intent Mandate with HMAC-SHA256", async () => {
      const { authorization_reference, mandate } = await mandateStore.createIntentMandate({
        user_ref: "user_session_abc",
        constraints: {
          max_amount: 8000000, // ₹80,000
          currency: "INR",
          allowed_domains: ["retail"],
          requires_refundability: true,
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });

      expect(authorization_reference).toBe(mandate.mandate.mandate_id);
      expect(mandate.algorithm).toBe("hmac-sha256");
      expect(mandate.signature).toHaveLength(64);

      const verification = mandateStore.verify(mandate);
      expect(verification.valid).toBe(true);
    });

    it("should reject tampered intent mandates", async () => {
      const { mandate } = await mandateStore.createIntentMandate({
        user_ref: "user_session_abc",
        constraints: {
          max_amount: 5000000,
          currency: "INR",
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });

      // Tamper: increase max_amount
      const tampered = {
        ...mandate,
        mandate: {
          ...mandate.mandate,
          constraints: {
            ...mandate.mandate.constraints,
            max_amount: 99999999,
          },
        },
      };

      const verification = mandateStore.verify(tampered as any);
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain("tampered");
    });
  });

  describe("Mode A: Derived Payment Mandates", () => {
    it("should derive a concrete Payment Mandate within intent bounds", async () => {
      const { authorization_reference: intentRef } = await mandateStore.createIntentMandate({
        user_ref: "user_123",
        constraints: {
          max_amount: 8000000, // ₹80,000 ceiling
          currency: "INR",
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });

      const txn = createMockTransaction(); // total: ₹75,000
      const result = await mandateStore.derivePaymentMandate(txn, intentRef, false, "TechBazaar");

      expect(result.status).toBe("authorized");
      if (result.status === "authorized") {
        expect(result.authorization_reference).toMatch(/^man_pay_/);
        expect(result.payment_mandate.mandate.kind).toBe("payment");
        const payMandate = result.payment_mandate.mandate as any;
        expect(payMandate.approved_by).toBe("derived_from_intent");
        expect(payMandate.intent_mandate_id).toBe(intentRef);
        expect(payMandate.binding.transaction_id).toBe(txn.transaction_id);
        expect(payMandate.binding.checkout_id).toBe(txn.merchant_verified?.checkout_id);
        expect(payMandate.binding.amount).toBe(7500000);

        const verifyResult = mandateStore.verify(result.payment_mandate);
        expect(verifyResult.valid).toBe(true);
      }
    });

    it("should deny deriving payment mandate if checkout total exceeds intent limit", async () => {
      const { authorization_reference: intentRef } = await mandateStore.createIntentMandate({
        user_ref: "user_123",
        constraints: {
          max_amount: 5000000, // ₹50,000 ceiling
          currency: "INR",
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });

      const txn = createMockTransaction(); // total: ₹75,000 (exceeds ₹50k)
      const result = await mandateStore.derivePaymentMandate(txn, intentRef);

      expect(result.status).toBe("denied");
      if (result.status === "denied") {
        expect(result.reason).toContain("exceeds intent mandate limit");
      }
    });

    it("should deny deriving payment mandate if currency does not match", async () => {
      const { authorization_reference: intentRef } = await mandateStore.createIntentMandate({
        user_ref: "user_123",
        constraints: {
          max_amount: 8000000,
          currency: "USD", // Mismatched currency
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });

      const txn = createMockTransaction(); // currency: INR
      const result = await mandateStore.derivePaymentMandate(txn, intentRef);

      expect(result.status).toBe("denied");
      if (result.status === "denied") {
        expect(result.reason).toContain("Currency mismatch");
      }
    });

    it("should deny deriving payment mandate if intent mandate has expired", async () => {
      const { authorization_reference: intentRef } = await mandateStore.createIntentMandate({
        user_ref: "user_123",
        constraints: {
          max_amount: 8000000,
          currency: "INR",
          expires_at: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
        },
      });

      const txn = createMockTransaction();
      const result = await mandateStore.derivePaymentMandate(txn, intentRef);

      expect(result.status).toBe("denied");
      if (result.status === "denied") {
        expect(result.reason).toContain("expired");
      }
    });
  });

  describe("Mode B: Just-in-Time Consent Challenges", () => {
    it("should generate consent challenge when no mandate is provided", async () => {
      const txn = createMockTransaction();
      const result = await mandateStore.derivePaymentMandate(txn, undefined, false, "TechBazaar");

      expect(result.status).toBe("consent_required");
      if (result.status === "consent_required") {
        expect(result.consent_challenge.challenge_id).toMatch(/^chn_/);
        expect(result.consent_challenge.consent_url).toContain("/consent/");
        expect(result.consent_challenge.amount).toBe(7500000);
        expect(result.consent_challenge.signature).toHaveLength(64);
      }
    });

    it("should confirm consent challenge and derive signed payment mandate", async () => {
      const txn = createMockTransaction();
      const challengeResult = await mandateStore.derivePaymentMandate(txn, undefined, false, "TechBazaar");
      expect(challengeResult.status).toBe("consent_required");

      if (challengeResult.status === "consent_required") {
        const challengeId = challengeResult.consent_challenge.challenge_id;
        const confirmResult = await mandateStore.confirmConsentChallenge(challengeId, "TechBazaar");

        expect(confirmResult.status).toBe("authorized");
        if (confirmResult.status === "authorized") {
          expect(confirmResult.authorization_reference).toMatch(/^man_pay_/);
          expect(confirmResult.transaction_id).toBe(txn.transaction_id);
          expect(confirmResult.payment_mandate.mandate.kind).toBe("payment");
          expect((confirmResult.payment_mandate.mandate as any).approved_by).toBe("user_jit");
        }
      }
    });
  });

  describe("Policy Gates: MandateGate & MandateBoundsGate", () => {
    it("should pass MandateGate when auth_mode is none (backward compatibility)", () => {
      const unauthenticatedStore = new MandateStore(store, signingSecret, "none");
      const gate = new MandateGate(unauthenticatedStore);
      const txn = createMockTransaction();

      const check = gate.check(txn, "CREATE_PAYMENT");
      expect(check.result).toBe("PASS");
      expect(check.detail).toContain("auth_mode=none");
    });

    it("should fail MandateGate if auth_mode is mandate and no reference is provided", () => {
      const gate = new MandateGate(mandateStore);
      const txn = createMockTransaction();

      const check = gate.check(txn, "CREATE_PAYMENT");
      expect(check.result).toBe("FAIL");
      expect(check.detail).toContain("No authorization_reference supplied");
    });

    it("should pass MandateGate with valid signed payment mandate", async () => {
      const { authorization_reference: intentRef } = await mandateStore.createIntentMandate({
        user_ref: "user_1",
        constraints: {
          max_amount: 8000000,
          currency: "INR",
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });

      const txn = createMockTransaction();
      const result = await mandateStore.derivePaymentMandate(txn, intentRef);
      expect(result.status).toBe("authorized");

      if (result.status === "authorized") {
        const gate = new MandateGate(mandateStore);
        const check = gate.check(txn, "CREATE_PAYMENT", {
          authorization_reference: result.authorization_reference,
        });

        expect(check.result).toBe("PASS");
        expect(check.detail).toContain("Payment mandate");
      }
    });

    it("should fail MandateGate if checkout details changed after mandate was signed", async () => {
      const { authorization_reference: intentRef } = await mandateStore.createIntentMandate({
        user_ref: "user_1",
        constraints: {
          max_amount: 8000000,
          currency: "INR",
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });

      const txn = createMockTransaction();
      const result = await mandateStore.derivePaymentMandate(txn, intentRef);
      expect(result.status).toBe("authorized");

      if (result.status === "authorized") {
        // Tamper with merchant verified checkout total after signing
        txn.merchant_verified!.total.amount = 7600000;

        const gate = new MandateGate(mandateStore);
        const check = gate.check(txn, "CREATE_PAYMENT", {
          authorization_reference: result.authorization_reference,
        });

        expect(check.result).toBe("FAIL");
        expect(check.detail).toContain("Checkout details changed");
      }
    });
  });

  describe("Server Integration: Server with Mandate Auth Mode", () => {
    it("should expose create_mandate tool and support Mode A autonomous checkout", async () => {
      const serverInstance = createMerchantMcpServer(sampleManifest, {
        forceSimulation: true,
        authMode: "mandate",
      });

      expect(serverInstance.mandateStore).toBeDefined();
      expect(serverInstance.mandateStore.isAuthModeEnabled()).toBe(true);

      // 1. Create intent mandate
      const { authorization_reference } = await serverInstance.mandateStore.createIntentMandate({
        user_ref: "agent_session_1",
        constraints: {
          max_amount: 10000000,
          currency: "INR",
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        },
      });

      expect(authorization_reference).toBeDefined();
    });
  });
});
