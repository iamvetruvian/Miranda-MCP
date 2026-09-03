/**
 * Razorpay Payment Adapter
 * Concrete Razorpay implementation for orders, payment links, checkout sessions, and verification.
 */

import crypto from "crypto";
import Razorpay from "razorpay";
import { Money } from "../types/index.js";
import { PaymentConfig } from "../types/manifest.js";

export interface CreateOrderParams {
  amount: Money;
  receipt: string; // The transaction_id for financial reconciliation
  notes?: Record<string, string>;
  customer_id?: string;
  notification?: {
    token_id: string;
    payment_after?: number;
  };
  enable_recurring_mandate?: boolean;
  mandate_max_amount?: number;
  manifestPaymentConfig?: PaymentConfig;
}

export interface CreateOrderResult {
  order_id: string;
  status: string;
  amount: Money;
}

export interface CreatePaymentLinkParams {
  amount: Money;
  description: string;
  reference_id: string; // The transaction_id
  order_id?: string;    // Existing Razorpay order ID to reuse
  expire_by?: number;   // Unix timestamp in seconds
  callback_url?: string;
  customer?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  manifestPaymentConfig?: PaymentConfig;
  restrict_to_mandate_methods?: boolean;
}

export interface CreatePaymentLinkResult {
  payment_link_id: string;
  short_url: string;
  amount: Money;
  status: string;
}

export interface PaymentStatusResult {
  payment_id: string;
  order_id?: string;
  status: "created" | "authorized" | "captured" | "failed";
  amount: Money;
}

export interface CheckoutSessionResult {
  razorpay_order_id: string;
  razorpay_key_id: string;
  amount: Money;
  currency: string;
  merchant_name: string;
  description: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
}

export interface RefundResult {
  refund_id: string;
  payment_id: string;
  amount: Money;
  status: "initiated" | "processed" | "failed";
}

export interface RecurringChargeParams {
  customer_id: string;
  token_id: string;
  amount: Money;
  order_id: string;
  email: string;
  contact: string;
  description?: string;
}

export interface RecurringChargeResult {
  payment_id: string;
  status: "authorized" | "captured" | "failed";
  amount: Money;
}

export interface CustomerTokenInfo {
  token_id: string;
  method: "upi" | "card" | string;
  max_amount?: number;
  created_at?: string;
}

function extractRazorpayError(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  const anyErr = err as Record<string, unknown>;
  if (anyErr.error && typeof anyErr.error === "object") {
    const nested = anyErr.error as Record<string, unknown>;
    if (nested.description) return String(nested.description);
    if (nested.message) return String(nested.message);
  }
  if (anyErr.description) return String(anyErr.description);
  if (anyErr.message) return String(anyErr.message);
  return (err as Error).message ?? JSON.stringify(err);
}

export class RazorpayAdapter {
  private client?: Razorpay;
  private isSimulated: boolean;
  public readonly keyId: string;
  private keySecret?: string;

  // In-memory store for simulated payments
  private simulatedOrders: Map<string, CreateOrderResult> = new Map();
  private simulatedLinks: Map<string, CreatePaymentLinkResult> = new Map();
  private simulatedPayments: Map<string, PaymentStatusResult> = new Map();
  private simulatedRefunds: Map<string, RefundResult> = new Map();
  private simulatedCustomers: Map<string, { customer_id: string; email: string; contact: string; name?: string }> = new Map();
  private simulatedCustomerTokens: Map<string, CustomerTokenInfo[]> = new Map();
  private simulateRecurringFailure: boolean = false;
  private simulateRecurringFailureReason: string = "Bank mandate expired or revoked by customer";

  constructor(keyId?: string, keySecret?: string, forceSimulation?: boolean) {
    this.keyId = keyId ?? "mock_key";
    this.keySecret = keySecret;

    // Use simulation mode if keys are mock/missing or explicitly forced
    const isMockKey = !keyId || keyId.startsWith("mock") || keyId === "mock_key";
    this.isSimulated = forceSimulation ?? isMockKey;

    if (!this.isSimulated && keyId && keySecret) {
      try {
        this.client = new Razorpay({
          key_id: keyId,
          key_secret: keySecret,
        });
      } catch (err) {
        console.warn("Failed to initialize Razorpay SDK client; falling back to simulated mode:", err);
        this.isSimulated = true;
      }
    } else {
      this.isSimulated = true;
    }
  }

  isKeyTestMode(): boolean {
    return this.keyId.startsWith("rzp_test_") || this.isSimulated;
  }

  isSimulatedMode(): boolean {
    return this.isSimulated;
  }

  getClient(): Razorpay | undefined {
    return this.client;
  }

  /**
   * Configure simulated recurring payment failure for testing and demo flows.
   */
  setSimulateRecurringFailure(shouldFail: boolean, reason?: string): void {
    this.simulateRecurringFailure = shouldFail;
    if (reason) {
      this.simulateRecurringFailureReason = reason;
    }
  }

  /**
   * Check if adapter is running in offline simulation mode.
   */
  isSimulationMode(): boolean {
    return this.isSimulated;
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const paymentConfig = params.manifestPaymentConfig;

    if (this.isSimulated || !this.client) {
      const orderId = `order_sim_${crypto.randomUUID().slice(0, 14)}`;
      const result: CreateOrderResult = {
        order_id: orderId,
        status: "created",
        amount: params.amount,
      };
      this.simulatedOrders.set(orderId, result);
      return result;
    }

    try {
      const orderOptions: Record<string, unknown> = {
        amount: params.amount.amount, // in paise
        currency: params.amount.currency,
        receipt: params.receipt,
        notes: params.notes,
      };

      if (params.customer_id) {
        orderOptions.customer_id = params.customer_id;
      }

      if (params.notification) {
        orderOptions.notification = params.notification;
      }

      if (params.enable_recurring_mandate) {
        orderOptions.token = {
          max_amount: params.mandate_max_amount ?? 10000000,
          frequency: "as_presented",
          expire_at: Math.floor(Date.now() / 1000) + 31536000,
        };
      }

      // Manual vs Auto capture
      if (paymentConfig?.capture?.mode === "manual_capture") {
        orderOptions.payment_capture = 0; // Razorpay: 0 = manual, 1 = auto
      } else {
        orderOptions.payment_capture = 1;
      }

      // Partial payments
      if (paymentConfig?.partial_payment?.allowed) {
        orderOptions.partial_payment = true;
        if (paymentConfig.partial_payment.min_first_payment_percent) {
          orderOptions.first_min_partial_amount = Math.floor(
            (params.amount.amount * paymentConfig.partial_payment.min_first_payment_percent) / 100
          );
        }
      }

      const order = await this.client.orders.create(orderOptions as any);

      return {
        order_id: String(order.id),
        status: String(order.status),
        amount: {
          amount: Number(order.amount),
          currency: String(order.currency),
        },
      };
    } catch (err: unknown) {
      throw new Error(`Razorpay createOrder failed: ${(err as Error).message}`);
    }
  }

  async createPaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
    const paymentConfig = params.manifestPaymentConfig;

    if (this.isSimulated || !this.client) {
      const linkId = `plink_sim_${crypto.randomUUID().slice(0, 14)}`;
      const shortUrl = `https://rzp.io/i/sim_${linkId.slice(10)}`;
      const result: CreatePaymentLinkResult = {
        payment_link_id: linkId,
        short_url: shortUrl,
        amount: params.amount,
        status: "created",
      };
      this.simulatedLinks.set(linkId, result);
      return result;
    }

    try {
      let expireBy = params.expire_by;
      if (!expireBy && paymentConfig?.payment_link?.expire_after_seconds) {
        expireBy = Math.floor(Date.now() / 1000) + paymentConfig.payment_link.expire_after_seconds;
      }

      const options: Record<string, unknown> = {
        amount: params.amount.amount,
        currency: params.amount.currency,
        description: params.description,
        reference_id: params.reference_id,
        expire_by: expireBy,
        callback_url: params.callback_url,
      };

      if (params.customer) {
        options.customer = params.customer;
      }

      if (paymentConfig?.payment_link?.send_notification !== undefined) {
        options.notify = {
          sms: paymentConfig.payment_link.send_notification,
          email: paymentConfig.payment_link.send_notification,
        };
      }

      if (params.restrict_to_mandate_methods) {
        options.options = {
          checkout: {
            method: {
              card: true,
              upi: true,
              netbanking: false,
              wallet: false,
              emi: false,
              bank_transfer: false,
              paylater: false,
            },
          },
        };
      } else if (paymentConfig?.allowed_methods?.methods && paymentConfig.allowed_methods.methods.length > 0) {
        const methods: Record<string, boolean> = {};
        for (const m of paymentConfig.allowed_methods.methods) {
          methods[m] = true;
        }
        for (const m of ["card", "upi", "netbanking", "wallet", "emi", "bank_transfer", "paylater"]) {
          if (!methods[m]) methods[m] = false;
        }
        options.options = { checkout: { method: methods } };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paymentLink = (await this.client.paymentLink.create(options as any)) as any;

      return {
        payment_link_id: String(paymentLink.id),
        short_url: String(paymentLink.short_url),
        amount: {
          amount: Number(paymentLink.amount),
          currency: String(paymentLink.currency),
        },
        status: String(paymentLink.status),
      };
    } catch (err: unknown) {
      const errMsg = extractRazorpayError(err);
      const isQuotaLimit = errMsg.includes("limit of 30") || (err as any)?.statusCode === 429;
      if (isQuotaLimit && this.client) {
        // Free/Test tier 30-link quota reached on Razorpay: Reuse existing Razorpay order & provide hosted checkout URL
        try {
          const rzpOrderId = params.order_id ?? (await this.client.orders.create({
            amount: params.amount.amount,
            currency: params.amount.currency,
            receipt: params.reference_id,
          })).id;
          const callbackPort = Number(process.env.AUTH_CALLBACK_PORT || 3002);
          const checkoutUrl = `http://localhost:${callbackPort}/pay?order_id=${rzpOrderId}&amount=${params.amount.amount}&currency=${params.amount.currency}&desc=${encodeURIComponent(params.description)}&txn_id=${params.reference_id}`;
          return {
            payment_link_id: rzpOrderId,
            short_url: checkoutUrl,
            amount: params.amount,
            status: "created",
          };
        } catch { }
      }

      if (this.isSimulated) {
        const linkId = `plink_sim_${crypto.randomUUID().slice(0, 14)}`;
        const shortUrl = `https://rzp.io/i/sim_${linkId.slice(10)}`;
        const result: CreatePaymentLinkResult = {
          payment_link_id: linkId,
          short_url: shortUrl,
          amount: params.amount,
          status: "created",
        };
        this.simulatedLinks.set(linkId, result);
        return result;
      }

      throw new Error(`Razorpay payment link creation failed: ${errMsg}`);
    }
  }

  /**
   * Create a checkout session for Razorpay Standard Checkout SDK.
   * Returns public key_id, order_id, amount, and metadata needed for native checkout integration.
   */
  async createCheckoutSession(params: {
    order_id: string;
    amount: Money;
    merchant_name: string;
    description: string;
    prefill?: {
      name?: string;
      email?: string;
      contact?: string;
    };
  }): Promise<CheckoutSessionResult> {
    return {
      razorpay_order_id: params.order_id,
      razorpay_key_id: this.keyId,
      amount: params.amount,
      currency: params.amount.currency,
      merchant_name: params.merchant_name,
      description: params.description,
      prefill: params.prefill,
    };
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentStatusResult> {
    if (this.isSimulated || !this.client) {
      const simulated = this.simulatedPayments.get(paymentId);
      if (simulated) {
        return simulated;
      }
      return {
        payment_id: paymentId,
        status: "captured",
        amount: { amount: 10000, currency: "INR" },
      };
    }

    try {
      const payment = await this.client.payments.fetch(paymentId);
      return {
        payment_id: String(payment.id),
        order_id: payment.order_id ? String(payment.order_id) : undefined,
        status: payment.status as "created" | "authorized" | "captured" | "failed",
        amount: {
          amount: Number(payment.amount),
          currency: String(payment.currency),
        },
      };
    } catch (err: unknown) {
      throw new Error(`Razorpay getPaymentStatus failed: ${(err as Error).message}`);
    }
  }

  /**
   * Checks if a Razorpay order has any captured or authorized payments.
   */
  async checkOrderPayment(orderId: string): Promise<PaymentStatusResult | null> {
    if (this.isSimulated || !this.client) {
      for (const payment of this.simulatedPayments.values()) {
        if (payment.order_id === orderId) {
          return payment;
        }
      }
      return null;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paymentsRes = (await (this.client.orders as any).fetchPayments(orderId)) as any;
      const items = paymentsRes?.items || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const successful = items.find((p: any) => p.status === "captured" || p.status === "authorized");
      if (successful) {
        return {
          payment_id: String(successful.id),
          order_id: orderId,
          status: successful.status as "authorized" | "captured",
          amount: {
            amount: Number(successful.amount),
            currency: String(successful.currency),
          },
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Checks if a Razorpay payment link has been completed/paid.
   */
  async checkPaymentLink(linkId: string): Promise<PaymentStatusResult | null> {
    if (this.isSimulated || !this.client) {
      for (const payment of this.simulatedPayments.values()) {
        if (payment.order_id === linkId || payment.payment_id.includes(linkId)) {
          return payment;
        }
      }
      return null;
    }

    if (linkId.startsWith("order_")) {
      return this.checkOrderPayment(linkId);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const link = (await (this.client.paymentLink as any).fetch(linkId)) as any;
      if (link && (link.status === "paid" || link.amount_paid > 0)) {
        const payments = link.payments || [];
        const latestPayment = payments[payments.length - 1];
        return {
          payment_id: latestPayment?.payment_id || `pay_${link.id}`,
          order_id: link.order_id,
          status: "captured",
          amount: {
            amount: Number(link.amount_paid || link.amount),
            currency: String(link.currency),
          },
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async capturePayment(paymentId: string, amount: Money): Promise<{ payment_id: string; status: string }> {
    if (this.isSimulated || !this.client) {
      const result: PaymentStatusResult = {
        payment_id: paymentId,
        status: "captured",
        amount,
      };
      this.simulatedPayments.set(paymentId, result);
      return { payment_id: paymentId, status: "captured" };
    }

    try {
      const captureResult = await this.client.payments.capture(
        paymentId,
        amount.amount,
        amount.currency
      );
      return {
        payment_id: String(captureResult.id),
        status: String(captureResult.status),
      };
    } catch (err: unknown) {
      throw new Error(`Razorpay capturePayment failed: ${(err as Error).message}`);
    }
  }

  /**
   * Component 3: Refund a captured payment via Razorpay.
   * Omit amount for a full refund of the remaining amount.
   * Notes carry transaction_id so refund webhooks resolve to the transaction
   * (same reconciliation pattern as order notes in createOrder).
   */
  async refundPayment(
    paymentId: string,
    amount?: Money,
    notes?: Record<string, string>
  ): Promise<RefundResult> {
    if (this.isSimulated || !this.client || this.simulatedPayments.has(paymentId)) {
      const refundId = `rfnd_sim_${crypto.randomUUID().slice(0, 14)}`;
      const result: RefundResult = {
        refund_id: refundId,
        payment_id: paymentId,
        amount: amount ?? this.simulatedPayments.get(paymentId)?.amount ?? { amount: 0, currency: "INR" },
        status: "processed", // simulation settles instantly; demo webhook still exercises the async path
      };
      this.simulatedRefunds.set(refundId, result);
      return result;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const refund = (await (this.client.payments.refund as any)(paymentId, {
        ...(amount ? { amount: amount.amount } : {}), // sub-units; omitted => full refund
        ...(notes ? { notes } : {}),
      })) as any;

      return {
        refund_id: String(refund.id),
        payment_id: paymentId,
        amount: {
          amount: Number(refund.amount),
          currency: String(refund.currency ?? amount?.currency ?? "INR"),
        },
        status: refund.status === "processed" ? "processed" : "initiated",
      };
    } catch (err: unknown) {
      throw new Error(`Razorpay refundPayment failed: ${(err as Error).message}`);
    }
  }

  /**
   * Create a Razorpay customer entity for recurring token association.
   */
  async createCustomer(params: {
    name?: string;
    email: string;
    contact: string;
  }): Promise<{ customer_id: string }> {
    if (this.isSimulated || !this.client) {
      const customerId = `cust_sim_${crypto.randomUUID().slice(0, 14)}`;
      const record = {
        customer_id: customerId,
        email: params.email,
        contact: params.contact,
        name: params.name,
      };
      this.simulatedCustomers.set(customerId, record);
      this.simulatedCustomerTokens.set(customerId, [
        {
          token_id: `token_sim_${customerId.slice(9)}`,
          method: "upi",
          max_amount: 10000000,
        },
      ]);
      return { customer_id: customerId };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customer = (await (this.client.customers as any).create({
        name: params.name,
        email: params.email,
        contact: params.contact,
      })) as any;

      return { customer_id: String(customer.id) };
    } catch (err: unknown) {
      const errMsg = extractRazorpayError(err);
      if (this.isSimulated) {
        const customerId = `cust_sim_${crypto.randomUUID().slice(0, 14)}`;
        return { customer_id: customerId };
      }
      throw new Error(`Razorpay createCustomer failed: ${errMsg}`);
    }
  }

  /**
   * Charge a stored Razorpay recurring token autonomously (Server-to-Server).
   */
  async chargeRecurringToken(params: RecurringChargeParams): Promise<RecurringChargeResult> {
    const envFailure = process.env.SIMULATE_RECURRING_PAYMENT_FAILURE;
    if (
      this.simulateRecurringFailure ||
      envFailure === "true" ||
      (typeof envFailure === "string" && envFailure.length > 0 && envFailure !== "false")
    ) {
      const reason = this.simulateRecurringFailure
        ? this.simulateRecurringFailureReason
        : (envFailure === "true" ? "Bank mandate expired or revoked by customer" : envFailure);
      throw new Error(`Razorpay chargeRecurringToken failed: ${reason}`);
    }

    if (this.isSimulated || !this.client) {
      const paymentId = `pay_rec_sim_${crypto.randomUUID().slice(0, 14)}`;
      const result: RecurringChargeResult = {
        payment_id: paymentId,
        status: "captured",
        amount: params.amount,
      };
      this.simulatedPayments.set(paymentId, {
        payment_id: paymentId,
        order_id: params.order_id,
        status: "captured",
        amount: params.amount,
      });
      return result;
    }

    try {
      const payload = {
        email: params.email,
        contact: params.contact,
        amount: params.amount.amount, // in paise
        currency: params.amount.currency,
        order_id: params.order_id,
        customer_id: params.customer_id,
        token: params.token_id,
        recurring: true,
        description: params.description || "Recurring payment via AI agent",
      };

      const authHeader = Buffer.from(`${this.keyId}:${this.keySecret || ""}`).toString("base64");
      const res = await fetch("https://api.razorpay.com/v1/payments/create/recurring", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${authHeader}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const errMsg = extractRazorpayError(errJson);
        throw new Error(`Razorpay recurring payment charge failed (${res.status}): ${errMsg}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paymentData = (await res.json()) as any;
      const status: "authorized" | "captured" | "failed" =
        paymentData.status === "captured"
          ? "captured"
          : paymentData.status === "authorized"
          ? "authorized"
          : "failed";

      const paymentId = String(paymentData.razorpay_payment_id || paymentData.id);

      // Track in simulated/captured payments map for status queries & refunds
      this.simulatedPayments.set(paymentId, {
        payment_id: paymentId,
        order_id: params.order_id,
        status,
        amount: {
          amount: Number(paymentData.amount || params.amount.amount),
          currency: String(paymentData.currency || params.amount.currency),
        },
      });

      return {
        payment_id: paymentId,
        status,
        amount: {
          amount: Number(paymentData.amount || params.amount.amount),
          currency: String(paymentData.currency || params.amount.currency),
        },
      };
    } catch (err: unknown) {
      const errMsg = extractRazorpayError(err);
      throw new Error(`Razorpay chargeRecurringToken failed: ${errMsg}`);
    }
  }

  /**
   * Fetch saved recurring payment tokens for a given customer ID.
   */
  async fetchTokensForCustomer(customerId: string): Promise<CustomerTokenInfo[]> {
    if (this.isSimulated || !this.client) {
      const tokens = this.simulatedCustomerTokens.get(customerId);
      if (tokens && tokens.length > 0) {
        return tokens;
      }
      return [
        {
          token_id: `token_sim_${customerId.slice(9)}`,
          method: "upi",
          max_amount: 10000000,
        },
      ];
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokensRes = (await (this.client.customers as any).fetchTokens(customerId)) as any;
      const items = tokensRes?.items || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return items.map((item: any) => ({
        token_id: String(item.id),
        method: String(item.method || "upi"),
        max_amount: item.max_amount ? Number(item.max_amount) : undefined,
        created_at: item.created_at ? new Date(item.created_at * 1000).toISOString() : undefined,
      }));
    } catch (err: unknown) {
      const errMsg = extractRazorpayError(err);
      if (this.isSimulated) {
        return [
          {
            token_id: `token_sim_${customerId.slice(9)}`,
            method: "upi",
            max_amount: 10000000,
          },
        ];
      }
      throw new Error(`Razorpay fetchTokensForCustomer failed: ${errMsg}`);
    }
  }

  /**
   * Fetch token_id from a specific authorized payment.
   */
  async fetchTokenForPayment(paymentId: string): Promise<string | undefined> {
    if (this.isSimulated || !this.client) return undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payment = (await this.client.payments.fetch(paymentId)) as any;
      return payment?.token_id ? String(payment.token_id) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Helper for tests & demo: simulate a successful payment completion on a link or order.
   */
  simulatePaymentSuccess(paymentId: string, amount: Money, orderId?: string): PaymentStatusResult {
    const record: PaymentStatusResult = {
      payment_id: paymentId,
      order_id: orderId,
      status: "captured",
      amount,
    };
    this.simulatedPayments.set(paymentId, record);
    return record;
  }

  /**
   * Helper for tests & demo: inject a simulated customer token.
   */
  simulateCustomerToken(customerId: string, token: CustomerTokenInfo): void {
    const existing = this.simulatedCustomerTokens.get(customerId) || [];
    existing.push(token);
    this.simulatedCustomerTokens.set(customerId, existing);
  }
}
