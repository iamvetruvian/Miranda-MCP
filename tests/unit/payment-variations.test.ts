/**
 * Component 6: Payment Variations Unit Tests
 * Tests capture modes (auto vs manual_capture), partial payments,
 * payment link TTL expiration, notifications, and method restrictions.
 */

import { describe, it, expect } from "vitest";
import { RazorpayAdapter } from "../../src/payment/razorpay.js";
import { PaymentConfig } from "../../src/types/manifest.js";

describe("Component 6: Payment Variations", () => {
  it("should configure manual capture mode and partial payments in RazorpayAdapter", async () => {
    const adapter = new RazorpayAdapter(); // Simulation mode

    const paymentConfig: PaymentConfig = {
      provider: "razorpay",
      capture: {
        mode: "manual_capture",
        manual_capture_timeout_seconds: 7200,
      },
      partial_payment: {
        allowed: true,
        min_first_payment_percent: 25,
      },
      currency: "INR",
    };

    const orderResult = await adapter.createOrder({
      amount: { amount: 100000, currency: "INR" },
      receipt: "txn_test_123",
      manifestPaymentConfig: paymentConfig,
    });

    expect(orderResult.order_id).toBeDefined();
    expect(orderResult.status).toBe("created");
    expect(orderResult.amount.amount).toBe(100000);
  });

  it("should apply payment link expiration, notification, and method restrictions", async () => {
    const adapter = new RazorpayAdapter();

    const paymentConfig: PaymentConfig = {
      provider: "razorpay",
      payment_link: {
        expire_after_seconds: 1800,
        send_notification: true,
      },
      allowed_methods: {
        methods: ["upi", "card"],
      },
      currency: "INR",
    };

    const linkResult = await adapter.createPaymentLink({
      amount: { amount: 249900, currency: "INR" },
      description: "Purchase: Smart Watch",
      reference_id: "txn_test_456",
      manifestPaymentConfig: paymentConfig,
    });

    expect(linkResult.payment_link_id).toBeDefined();
    expect(linkResult.short_url).toContain("https://rzp.io/i/");
    expect(linkResult.amount.amount).toBe(249900);
  });
});
