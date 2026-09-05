import { describe, it, expect, beforeEach } from "vitest";
import { MandateStore } from "../../src/authz/mandate-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { generateEcKeyPair, signJws, verifyJws } from "../../src/authz/crypto.js";
import { Transaction, TransactionState, MerchantVerifiedCheckout } from "../../src/types/index.js";
import { MandateGate } from "../../src/policy/gates.js";

function createMockTxn(overrides?: Partial<Transaction>): Transaction {
  const checkout: MerchantVerifiedCheckout = {
    checkout_id: "chk_ap2_999",
    sku: "prod_headphones_1",
    title: "Noise Cancelling Headphones",
    unit_price: { amount: 250000, currency: "INR" },
    total: { amount: 250000, currency: "INR" },
    available: true,
  };

  return {
    transaction_id: "txn_ap2_888",
    state: TransactionState.CHECKOUT_CREATED,
    created_at: new Date().toISOString(),
    agent_claim: {
      product_id: "prod_headphones_1",
      quantity: 1,
      selection_reason: "High fidelity audio",
    },
    merchant_verified: checkout,
    audit_event_ids: [],
    ...overrides,
  };
}

describe("AP2 Standards Compliance: MandateStore & Authorization Engine", () => {
  let store: InMemoryStore;
  let mandateStore: MandateStore;

  beforeEach(() => {
    store = new InMemoryStore();
    mandateStore = new MandateStore(store, undefined, "mandate");
  });

  describe("Merchant Checkout JWT & Hashing", () => {
    it("should issue an authoritative merchant-signed Checkout JWT (checkout.merchant.1)", () => {
      const txn = createMockTxn();
      const { checkoutJwt, checkoutHash } = mandateStore.createMerchantCheckoutJwt(
        txn.merchant_verified!,
        "SuperStore",
        "superstore.com"
      );

      expect(checkoutJwt).toBeDefined();
      expect(checkoutHash).toBeDefined();
      expect(txn.merchant_verified?.checkout_jwt).toBe(checkoutJwt);
      expect(txn.merchant_verified?.checkout_hash).toBe(checkoutHash);

      // Verify JWT with merchant's public key
      const verification = verifyJws(checkoutJwt, mandateStore.getMerchantPublicKey());
      expect(verification.valid).toBe(true);
      expect((verification.payload as any).vct).toBe("checkout.merchant.1");
      expect((verification.payload as any).checkout_id).toBe("chk_ap2_999");
      expect((verification.payload as any).merchant.name).toBe("SuperStore");
    });
  });

  describe("AP2 Open Mandate with cnf Confirmation Key (Mode A)", () => {
    it("should create an Open Payment Mandate (mandate.payment.open.1) binding Agent public JWK", async () => {
      const agentKeyPair = generateEcKeyPair("agent-session-1");
      const userKeyPair = generateEcKeyPair("user-device-1");

      const { authorization_reference, mandate } = await mandateStore.createIntentMandate({
        user_ref: "user_session_42",
        constraints: {
          max_amount: 500000, // ₹5,000 budget
          currency: "INR",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          allowed_domains: ["electronics"],
        },
        agent_jwk: agentKeyPair.publicJwk,
        user_jwk: userKeyPair.publicJwk,
        user_private_key: userKeyPair.privateKey,
        payment_instrument: {
          id: "pm_card_4242",
          type: "card",
          description: "Visa ending in 4242",
          last4: "4242",
        },
        algorithm: "ES256",
      } as any);

      expect(mandate.algorithm).toBe("ES256");
      expect(mandate.jws).toBeDefined();
      expect(mandate.mandate.kind).toBe("intent");

      const openMandate = (mandate.mandate as any).open_mandate;
      expect(openMandate.vct).toBe("mandate.payment.open.1");
      expect(openMandate.cnf.jwk).toEqual(agentKeyPair.publicJwk);
      expect(openMandate.payment_instrument?.last4).toBe("4242");

      // Verify user's digital signature
      const verified = mandateStore.verify(mandate);
      expect(verified.valid).toBe(true);
    });

    it("should derive Closed Payment Mandate (mandate.payment.1) signed by Agent Key", async () => {
      const agentKeyPair = generateEcKeyPair("agent-session-1");
      const { authorization_reference } = await mandateStore.createIntentMandate({
        user_ref: "user_session_42",
        constraints: {
          max_amount: 500000,
          currency: "INR",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
        agent_jwk: agentKeyPair.publicJwk,
        payment_instrument: {
          id: "pm_card_4242",
          type: "card",
          description: "Visa ending in 4242",
        },
        algorithm: "ES256",
      });

      const txn = createMockTxn();
      mandateStore.createMerchantCheckoutJwt(txn.merchant_verified!, "SuperStore");

      const derived = await mandateStore.derivePaymentMandate(
        txn,
        authorization_reference,
        false,
        "SuperStore",
        { agentKeyPair }
      );

      expect(derived.status).toBe("authorized");
      if (derived.status === "authorized") {
        expect(derived.payment_mandate.algorithm).toBe("ES256");
        expect(derived.payment_mandate.signer_role).toBe("agent");

        const closedMandate = (derived.payment_mandate.mandate as any).closed_mandate;
        expect(closedMandate.vct).toBe("mandate.payment.1");
        expect(closedMandate.checkout_hash).toBe(txn.merchant_verified?.checkout_hash);
        expect(closedMandate.payment_instrument?.id).toBe("pm_card_4242");

        // Verify the closed mandate JWS with agent's public key
        const jwsVerification = verifyJws(derived.payment_mandate.jws!, agentKeyPair.publicJwk);
        expect(jwsVerification.valid).toBe(true);
      }
    });

    it("should enforce cumulative budget tracking (payment.budget)", async () => {
      const { authorization_reference } = await mandateStore.createIntentMandate({
        user_ref: "user_session_42",
        constraints: {
          max_amount: 300000, // ₹3,000 budget cap
          currency: "INR",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
        algorithm: "ES256",
      });

      // First purchase: ₹2,500 (total budget ₹3,000) -> Allowed
      const txn1 = createMockTxn();
      const derived1 = await mandateStore.derivePaymentMandate(txn1, authorization_reference, false, "SuperStore");
      expect(derived1.status).toBe("authorized");
      expect(mandateStore.getConsumedBudget(authorization_reference)).toBe(250000);

      // Second purchase: ₹1,000 (remaining budget is only ₹500) -> Denied
      const txn2 = createMockTxn({
        transaction_id: "txn_ap2_second",
        merchant_verified: {
          checkout_id: "chk_second",
          sku: "prod_cable",
          unit_price: { amount: 100000, currency: "INR" },
          total: { amount: 100000, currency: "INR" },
          available: true,
        },
      });

      const derived2 = await mandateStore.derivePaymentMandate(txn2, authorization_reference, false, "SuperStore");
      expect(derived2.status).toBe("denied");
      if (derived2.status === "denied") {
        expect(derived2.reason).toContain("Cumulative budget exceeded");
      }
    });
  });

  describe("Cryptographic Dispute Receipts", () => {
    it("should issue signed Checkout Receipt and Payment Receipt", () => {
      const checkoutReceipt = mandateStore.createCheckoutReceipt(
        "txn_ap2_123",
        "chk_ap2_123",
        "mock_checkout_hash_xyz",
        "accepted"
      );
      expect(checkoutReceipt.receiptJwt).toBeDefined();

      const verifyChk = verifyJws(checkoutReceipt.receiptJwt, mandateStore.getMerchantPublicKey());
      expect(verifyChk.valid).toBe(true);
      expect((verifyChk.payload as any).vct).toBe("mandate.checkout.receipt.1");
      expect((verifyChk.payload as any).status).toBe("accepted");

      const paymentReceipt = mandateStore.createPaymentReceipt(
        "txn_ap2_123",
        "pi_stripe_99999",
        "mock_payment_mandate_hash",
        { amount: 50000, currency: "INR" },
        "captured"
      );
      expect(paymentReceipt.receiptJwt).toBeDefined();

      const verifyPay = verifyJws(paymentReceipt.receiptJwt, mandateStore.getMerchantPublicKey());
      expect(verifyPay.valid).toBe(true);
      expect((verifyPay.payload as any).vct).toBe("mandate.payment.receipt.1");
      expect((verifyPay.payload as any).payment_id).toBe("pi_stripe_99999");
    });
  });

  describe("Trusted Surface Client-Side Signing (Mode B)", () => {
    it("should confirm consent challenge with client-side Web Crypto signature", async () => {
      const txn = createMockTxn();
      const challenge = mandateStore.createConsentChallenge(txn, txn.merchant_verified!, "SuperStore");

      // Simulate client-side user browser signing
      const userKeyPair = generateEcKeyPair("browser-user-key");
      const clientJws = signJws(
        {
          challenge_id: challenge.challenge_id,
          approved: true,
          timestamp: Date.now(),
        },
        userKeyPair.privateKey,
        { kid: "browser-user-key" }
      );

      const confirmation = await mandateStore.confirmConsentChallenge(challenge.challenge_id, "SuperStore", {
        userJws: clientJws,
        userJwk: userKeyPair.publicJwk,
        paymentInstrument: {
          id: "pm_card_vault_9876",
          type: "card",
          description: "Mastercard ending in 9876",
        },
      });

      expect(confirmation.status).toBe("authorized");
      if (confirmation.status === "authorized") {
        expect(confirmation.payment_mandate.algorithm).toBe("ES256");
        expect(confirmation.payment_mandate.signer_role).toBe("user");
        expect(confirmation.payment_mandate.user_consent_jws).toBe(clientJws);
        expect(confirmation.payment_mandate.user_consent_jwk).toEqual(userKeyPair.publicJwk);

        // Cryptographic verification must succeed without key mismatch
        const verifyResult = mandateStore.verify(confirmation.payment_mandate);
        expect(verifyResult.valid).toBe(true);

        // MandateGate check must PASS
        const mandateGate = new MandateGate(mandateStore);
        const gateCheck = mandateGate.check(txn, "CREATE_PAYMENT", {
          authorization_reference: confirmation.authorization_reference,
        });
        expect(gateCheck.result).toBe("PASS");
      }
    });
  });
});
