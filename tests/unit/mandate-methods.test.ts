import { describe, it, expect, afterAll } from "vitest";
import { startAuthCallbackServer, AuthCallbackServerResult } from "../../src/auth/callback-server.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { RazorpayAdapter } from "../../src/payment/razorpay.js";

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
      gateway: "razorpay",
      key_id_env: "RAZORPAY_KEY_ID",
      key_secret_env: "RAZORPAY_KEY_SECRET",
      supported_methods: ["card", "upi"],
      currency: "INR",
    },
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

    // Verify Razorpay Checkout options restrict payment methods to card and upi
    expect(html).toContain("card: true");
    expect(html).toContain("upi: true");
    expect(html).toContain("netbanking: false");
    expect(html).toContain("wallet: false");
    expect(html).toContain("emi: false");
    expect(html).toContain("paylater: false");

    // Verify custom display blocks & preferences to disallow other payment options
    expect(html).toContain("mandate_methods");
    expect(html).toContain("Autopay Mandate Supported");
    expect(html).toContain("show_default_blocks: false");

    // Verify prefill customer credentials
    expect(html).toContain('email: "alice@example.com"');
    expect(html).toContain('contact: "+919876543210"');
    expect(html).toContain('customer_id: "cust_alice_001"');
  });

  it("should NOT restrict payment methods on /pay when mode=one_time", async () => {
    const res = await fetch(
      `http://localhost:${PORT}/pay?order_id=order_onetime_002&amount=6899900&currency=INR&desc=Single+Order+Payment&mode=one_time`
    );

    expect(res.status).toBe(200);
    const html = await res.text();

    // Single payment banner
    expect(html).toContain("Single One-Time Payment");
    // Does NOT restrict netbanking
    expect(html).not.toContain("netbanking: false");
    expect(html).not.toContain("show_default_blocks: false");
  });

  it("should support restricting methods to card and upi in RazorpayAdapter createPaymentLink", async () => {
    const adapter = new RazorpayAdapter("mock_key", "mock_secret", true);

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
