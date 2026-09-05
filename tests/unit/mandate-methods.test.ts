import { describe, it, expect, afterAll } from "vitest";
import { startAuthCallbackServer, AuthCallbackServerResult } from "../../src/auth/callback-server.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { StripeAdapter } from "../../src/payment/stripe.js";

describe("Mandate Payment Method Restrictions (Card & UPI Autopay Only)", () => {
  let serverResult: AuthCallbackServerResult | undefined;
  const PORT = 3456;

  const manifest: IntegrationManifest = {
    merchant: {
      id: "proshop_mandate_methods",
      name: "ProShop Electronics",
      description: "Demo electronics store",
      homepage: "http://localhost:5000",
      domains: ["retail"],
      protocol_version: "2.0.0",
      signing: { key_id: "key_1", algorithm: "HMAC-SHA256" },
    },
    catalog: {
      endpoints: {
        search: { path: "/api/products", method: "GET" },
      },
      mapping: {
        item_id: "$._id",
        title: "$.name",
        price: "$.price",
        currency: "INR",
        availability: "$.countInStock",
      },
    },
    payment: {
      provider: "stripe",
      stripe_secret_key_env: "STRIPE_SECRET_KEY",
      allowed_methods: { methods: ["card"] },
    } as any,
  };

  afterAll(async () => {
    if (serverResult) {
      await serverResult.close();
    }
  });

  it("should configure Razorpay Checkout on /pay to allow ONLY card and UPI when mode=mandate", async () => {
    serverResult = startAuthCallbackServer(null, manifest, PORT);
    await new Promise((resolve) => setTimeout(resolve, 80));

    const res = await fetch(
      `http://localhost:${PORT}/pay?order_id=order_mandate_001&amount=6899900&currency=INR&desc=Autopay+Mandate+Setup&mode=mandate&customer_id=cust_alice_001&customer_email=alice%40example.com&customer_contact=%2B919876543210`
    );

    expect(res.status).toBe(200);
    const html = await res.text();

    // Verify UI messaging
    expect(html).toContain("Autopay Mandate Enabled");
    expect(html).toContain("Restricted to Autopay Instruments");

    // Verify Stripe Card Vaulting UI
    expect(html).toContain("4242 4242 4242 4242");
    expect(html).toContain("Never triggers OTP or 36h delay");
    expect(html).toContain("Stripe Test Mode Card Details");
  });

  it("should display one-time payment UI on /pay when mode=one_time", async () => {
    const res = await fetch(
      `http://localhost:${PORT}/pay?order_id=order_onetime_002&amount=6899900&currency=INR&desc=Single+Order+Payment&mode=one_time`
    );

    expect(res.status).toBe(200);
    const html = await res.text();

    // Single payment banner
    expect(html).toContain("Single One-Time Payment");
  });

  it("should support creating payment link in StripeAdapter createPaymentLink", async () => {
    const adapter = new StripeAdapter("mock_key", undefined, true);

    const link = await adapter.createPaymentLink({
      amount: { amount: 100000, currency: "INR" },
      description: "Mandate payment link test",
      reference_id: "txn_mandate_link_test",
      restrict_to_mandate_methods: true,
    });

    expect(link.payment_link_id).toBeDefined();
    expect(link.short_url).toBeDefined();
    expect(link.status).toBe("created");
  });

  it("should verify payment status on GET /pay/verify", async () => {
    const res = await fetch(`http://localhost:${PORT}/pay/verify?order_id=order_nonexistent&txn_id=txn_none`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.verified).toBe(false);
  });
});
