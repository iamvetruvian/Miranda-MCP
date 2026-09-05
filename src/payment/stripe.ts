/**
 * Stripe Payment Adapter
 * Handles payment intents, checkout sessions, setup sessions for card vaulting,
 * off-session autonomous recurring charges, and refunds via Stripe SDK.
 */

import Stripe from "stripe";
import crypto from "crypto";
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
  order_id?: string;    // Existing payment intent or checkout session ID
  expire_by?: number;   // Unix timestamp in seconds
  callback_url?: string;
  customer?: {
    customer_id?: string;
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
  amount?: Money;
  status?: string;
}

export interface CreateSetupLinkParams {
  customer_id: string;
  transaction_id: string;
  customer_email?: string;
  success_url?: string;
  cancel_url?: string;
}

export interface CreateSetupLinkResult {
  setup_session_id: string;
  setup_url: string;
}

export interface PaymentStatusResult {
  payment_id: string;
  order_id?: string;
  status: "created" | "authorized" | "captured" | "failed";
  amount: Money;
}

export interface RefundParams {
  payment_id: string;
  amount?: Money;
  notes?: Record<string, string>;
  reason?: string;
}

export interface RefundResult {
  refund_id: string;
  payment_id: string;
  amount: Money;
  status: "initiated" | "processed" | "failed";
}

export interface RecurringChargeParams {
  customer_id: string;
  token_id: string; // Stripe PaymentMethod ID (pm_...)
  amount: Money;
  order_id?: string;
  email?: string;
  contact?: string;
  description?: string;
}

export interface RecurringChargeResult {
  payment_id: string; // Stripe PaymentIntent ID (pi_...)
  order_id?: string;
  status: "captured" | "authorized" | "pending";
  amount: Money;
}

export interface CustomerTokenInfo {
  token_id: string;
  method: "card";
  card_last4?: string;
  card_network?: string;
  recurring_status: "confirmed" | "rejected" | "paused";
  max_amount?: number;
  created_at: number;
}

export class StripeAdapter {
  private client?: Stripe;
  private isSimulated: boolean;
  public readonly secretKey: string;
  public readonly publishableKey?: string;

  // In-memory store for simulated payments
  private simulatedPaymentIntents: Map<string, CreateOrderResult> = new Map();
  private simulatedCheckoutSessions: Map<string, CreatePaymentLinkResult> = new Map();
  private simulatedSetupSessions: Map<string, CreateSetupLinkResult> = new Map();
  private simulatedPayments: Map<string, PaymentStatusResult> = new Map();
  private simulatedRefunds: Map<string, RefundResult> = new Map();
  private simulatedCustomers: Map<string, { customer_id: string; email: string; name?: string }> = new Map();
  private simulatedCustomerTokens: Map<string, CustomerTokenInfo[]> = new Map();
  private simulateRecurringFailure: boolean = false;
  private simulateRecurringFailureReason: string = "Card declined";
  private callbackPort: number = Number(process.env.AUTH_CALLBACK_PORT || 3002);
  private sessionUrls: Map<string, string> = new Map();

  constructor(secretKey?: string, publishableKey?: string, forceSimulation?: boolean) {
    const cleanedSecret = secretKey ? secretKey.trim() : "mock_key";
    this.secretKey = cleanedSecret;
    this.publishableKey = publishableKey ? publishableKey.trim() : undefined;

    const isMockKey =
      !cleanedSecret ||
      cleanedSecret === "mock_key" ||
      cleanedSecret.startsWith("mock") ||
      cleanedSecret.startsWith("sk_test_mock") ||
      cleanedSecret.includes("mock");
    this.isSimulated = forceSimulation ?? isMockKey;

    if (!this.isSimulated && cleanedSecret) {
      try {
        this.client = new Stripe(cleanedSecret, {
          apiVersion: "2025-02-24.acacia" as any,
        });
      } catch (err) {
        console.warn("Failed to initialize Stripe SDK client; falling back to simulated mode:", err);
        this.isSimulated = true;
      }
    } else {
      this.isSimulated = true;
    }
  }

  setCallbackPort(port: number): void {
    this.callbackPort = port;
  }

  getCallbackPort(): number {
    return this.callbackPort;
  }

  async retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session | null> {
    if (this.isSimulated || !this.client) {
      return null;
    }
    try {
      return await this.client.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent", "setup_intent.payment_method", "customer"],
      });
    } catch (err) {
      console.warn(`[Stripe] Failed to retrieve checkout session ${sessionId}:`, err);
      return null;
    }
  }

  isKeyTestMode(): boolean {
    return this.secretKey.startsWith("sk_test_") || this.isSimulated;
  }

  isSimulatedMode(): boolean {
    return this.isSimulated;
  }

  isSimulationMode(): boolean {
    return this.isSimulated;
  }

  getClient(): Stripe | undefined {
    return this.client;
  }

  setSimulateRecurringFailure(shouldFail: boolean, reason?: string): void {
    this.simulateRecurringFailure = shouldFail;
    if (reason) {
      this.simulateRecurringFailureReason = reason;
    }
  }

  /**
   * Create a PaymentIntent (or simulated order) for financial tracking.
   */
  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    if (this.isSimulated || !this.client) {
      const paymentIntentId = `pi_sim_${crypto.randomUUID().slice(0, 16)}`;
      const result: CreateOrderResult = {
        order_id: paymentIntentId,
        status: "created",
        amount: params.amount,
      };
      this.simulatedPaymentIntents.set(paymentIntentId, result);
      return result;
    }

    try {
      const paymentIntent = await this.client.paymentIntents.create({
        amount: params.amount.amount,
        currency: params.amount.currency.toLowerCase(),
        customer: params.customer_id,
        metadata: {
          receipt: params.receipt,
          ...(params.notes || {}),
        },
        automatic_payment_methods: { enabled: true },
      });

      return {
        order_id: paymentIntent.id,
        status: paymentIntent.status,
        amount: params.amount,
      };
    } catch (err: unknown) {
      throw new Error(`Stripe createOrder failed: ${(err as Error).message}`);
    }
  }

  /**
   * Create a hosted payment link using Stripe Checkout Session.
   */
  async createPaymentLink(params: CreatePaymentLinkParams): Promise<CreatePaymentLinkResult> {
    if (this.isSimulated || !this.client) {
      const sessionId = `cs_sim_${crypto.randomUUID().slice(0, 16)}`;
      const port = this.callbackPort;
      const url = `http://localhost:${port}/stripe-checkout?session_id=${sessionId}&amount=${params.amount.amount}&currency=${params.amount.currency}&desc=${encodeURIComponent(params.description)}&ref=${params.reference_id}`;
      const result: CreatePaymentLinkResult = {
        payment_link_id: sessionId,
        short_url: url,
        amount: params.amount,
        status: "created",
      };
      this.simulatedCheckoutSessions.set(sessionId, result);
      return result;
    }

    try {
      const port = this.callbackPort;
      const successUrl = params.callback_url || `http://localhost:${port}/checkout/callback?session_id={CHECKOUT_SESSION_ID}&ref=${encodeURIComponent(params.reference_id)}`;
      const cancelUrl = `http://localhost:${port}/checkout/cancel?ref=${encodeURIComponent(params.reference_id)}`;

      const sessionPayload: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: params.amount.currency.toLowerCase(),
              product_data: {
                name: params.description,
              },
              unit_amount: params.amount.amount,
            },
            quantity: 1,
          },
        ],
        client_reference_id: params.reference_id,
        success_url: successUrl,
        cancel_url: cancelUrl,
      };

      if (params.customer?.customer_id && params.customer.customer_id.startsWith("cus_")) {
        sessionPayload.customer = params.customer.customer_id;
      } else if (params.customer?.email) {
        sessionPayload.customer_email = params.customer.email;
      }

      const session = await this.client.checkout.sessions.create(sessionPayload);
      if (session.url) {
        this.sessionUrls.set(session.id, session.url);
      }

      return {
        payment_link_id: session.id,
        short_url: session.url || "",
        amount: params.amount,
        status: "created",
      };
    } catch (err: unknown) {
      throw new Error(`Stripe createPaymentLink failed: ${(err as Error).message}`);
    }
  }

  /**
   * Create a hosted Card Vault setup link using Stripe Checkout Session in "setup" mode.
   * Allows saving card 4242... into a vaulted PaymentMethod without charging immediately.
   */
  async createSetupLink(params: CreateSetupLinkParams): Promise<CreateSetupLinkResult> {
    if (this.isSimulated || !this.client) {
      const setupSessionId = `cs_setup_sim_${crypto.randomUUID().slice(0, 16)}`;
      const port = this.callbackPort;
      const url = `http://localhost:${port}/stripe-setup?session_id=${setupSessionId}&customer_id=${params.customer_id}&txn_id=${params.transaction_id}`;
      const result: CreateSetupLinkResult = {
        setup_session_id: setupSessionId,
        setup_url: url,
      };
      this.simulatedSetupSessions.set(setupSessionId, result);
      return result;
    }

    try {
      const port = this.callbackPort;
      const successUrl = params.success_url || `http://localhost:${port}/setup/callback?session_id={CHECKOUT_SESSION_ID}&txn_id=${encodeURIComponent(params.transaction_id)}`;
      const cancelUrl = params.cancel_url || `http://localhost:${port}/setup/cancel?txn_id=${encodeURIComponent(params.transaction_id)}`;

      const sessionPayload: Stripe.Checkout.SessionCreateParams = {
        mode: "setup",
        payment_method_types: ["card"],
        client_reference_id: params.transaction_id,
        success_url: successUrl,
        cancel_url: cancelUrl,
      };

      if (params.customer_id && params.customer_id.startsWith("cus_")) {
        sessionPayload.customer = params.customer_id;
      } else {
        sessionPayload.customer_creation = "always";
      }

      const session = await this.client.checkout.sessions.create(sessionPayload);
      if (session.url) {
        this.sessionUrls.set(session.id, session.url);
      }

      return {
        setup_session_id: session.id,
        setup_url: session.url || "",
      };
    } catch (err: unknown) {
      throw new Error(`Stripe createSetupLink failed: ${(err as Error).message}`);
    }
  }

  /**
   * Retrieve the full, unmodified Stripe hosted checkout/setup session URL (including #hash fragment).
   */
  async getCheckoutSessionUrl(sessionId: string): Promise<string | undefined> {
    if (this.sessionUrls.has(sessionId)) {
      return this.sessionUrls.get(sessionId);
    }
    if (this.client && sessionId.startsWith("cs_") && !sessionId.startsWith("cs_sim_") && !sessionId.startsWith("cs_setup_sim_")) {
      try {
        const session = await this.client.checkout.sessions.retrieve(sessionId);
        if (session.url) {
          this.sessionUrls.set(sessionId, session.url);
          return session.url;
        }
      } catch (err) {
        console.warn(`[StripeAdapter] Could not retrieve session ${sessionId}:`, err);
      }
    }
    return undefined;
  }

  getIsSimulated(): boolean {
    return this.isSimulated;
  }

  /**
   * Charge a saved PaymentMethod off-session (autonomous machine-to-machine payment).
   * Executes in ~400ms without OTP for test card 4242...
   */
  async chargeRecurringToken(params: RecurringChargeParams): Promise<RecurringChargeResult> {
    if (this.isSimulated || !this.client) {
      if (this.simulateRecurringFailure) {
        throw new Error(`Stripe autonomous charge failed: ${this.simulateRecurringFailureReason}`);
      }

      const paymentId = `pi_off_sim_${crypto.randomUUID().slice(0, 16)}`;
      const result: RecurringChargeResult = {
        payment_id: paymentId,
        order_id: params.order_id,
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
      const paymentIntent = await this.client.paymentIntents.create({
        amount: params.amount.amount,
        currency: params.amount.currency.toLowerCase(),
        customer: params.customer_id,
        payment_method: params.token_id,
        off_session: true, // Machine / agent initiated off-session debit
        confirm: true,     // Immediately authorize and capture
        description: params.description || "Autonomous agent purchase",
        metadata: {
          order_id: params.order_id || "",
        },
      });

      const isSuccessful = paymentIntent.status === "succeeded";

      return {
        payment_id: paymentIntent.id,
        order_id: params.order_id,
        status: isSuccessful ? "captured" : "pending",
        amount: params.amount,
      };
    } catch (err: unknown) {
      throw new Error(`Stripe off-session recurring charge failed: ${(err as Error).message}`);
    }
  }

  /**
   * Fetch payment status directly from Stripe.
   */
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
      const paymentIntent = await this.client.paymentIntents.retrieve(paymentId);
      let status: "created" | "authorized" | "captured" | "failed" = "created";
      if (paymentIntent.status === "succeeded") {
        status = "captured";
      } else if (paymentIntent.status === "requires_capture") {
        status = "authorized";
      } else if (paymentIntent.status === "canceled") {
        status = "failed";
      }

      return {
        payment_id: paymentIntent.id,
        status,
        amount: {
          amount: paymentIntent.amount,
          currency: paymentIntent.currency.toUpperCase(),
        },
      };
    } catch (err: unknown) {
      throw new Error(`Stripe getPaymentStatus failed: ${(err as Error).message}`);
    }
  }

  /**
   * Checks if an order or session has a completed payment.
   */
  async checkOrderPayment(orderId: string): Promise<PaymentStatusResult | null> {
    if (this.isSimulated || !this.client) {
      for (const payment of this.simulatedPayments.values()) {
        if (payment.order_id === orderId) {
          return payment;
        }
      }
      const simSession = this.simulatedCheckoutSessions.get(orderId);
      if (simSession) {
        return {
          payment_id: `pi_link_${orderId}`,
          order_id: orderId,
          status: "captured",
          amount: simSession.amount ?? { amount: 10000, currency: "INR" },
        };
      }
      return null;
    }

    try {
      // Check if orderId is a PaymentIntent
      if (orderId.startsWith("pi_")) {
        const pi = await this.client.paymentIntents.retrieve(orderId);
        if (pi.status === "succeeded" || pi.status === "requires_capture") {
          return {
            payment_id: pi.id,
            order_id: orderId,
            status: pi.status === "succeeded" ? "captured" : "authorized",
            amount: { amount: pi.amount, currency: pi.currency.toUpperCase() },
          };
        }
      }

      // Check if orderId is a Checkout Session
      if (orderId.startsWith("cs_")) {
        const session = await this.client.checkout.sessions.retrieve(orderId, {
          expand: ["payment_intent"],
        });
        if (session.payment_status === "paid" || session.status === "complete") {
          const pi = typeof session.payment_intent === "object" && session.payment_intent !== null
            ? (session.payment_intent as Stripe.PaymentIntent)
            : typeof session.payment_intent === "string"
            ? await this.client.paymentIntents.retrieve(session.payment_intent)
            : null;

          const paymentId = pi ? pi.id : session.id;
          const amount = pi ? pi.amount : (session.amount_total || 0);
          const currency = (pi ? pi.currency : (session.currency || "inr")).toUpperCase();

          return {
            payment_id: paymentId,
            order_id: orderId,
            status: "captured",
            amount: { amount, currency },
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Process refund for a PaymentIntent.
   */
  async refundPayment(params: RefundParams): Promise<RefundResult> {
    if (this.isSimulated || !this.client) {
      const refundId = `re_sim_${crypto.randomUUID().slice(0, 16)}`;
      const result: RefundResult = {
        refund_id: refundId,
        payment_id: params.payment_id,
        amount: params.amount ?? { amount: 10000, currency: "INR" },
        status: "processed",
      };
      this.simulatedRefunds.set(refundId, result);
      return result;
    }

    try {
      const refund = await this.client.refunds.create({
        payment_intent: params.payment_id,
        amount: params.amount?.amount,
        reason: (params.reason as any) || undefined,
      });

      return {
        refund_id: refund.id,
        payment_id: params.payment_id,
        amount: {
          amount: refund.amount,
          currency: refund.currency.toUpperCase(),
        },
        status: refund.status === "succeeded" ? "processed" : "initiated",
      };
    } catch (err: unknown) {
      throw new Error(`Stripe refundPayment failed: ${(err as Error).message}`);
    }
  }

  /**
   * Create or fetch a Stripe customer.
   */
  async getOrCreateCustomer(email: string, name?: string): Promise<string> {
    if (this.isSimulated || !this.client) {
      for (const [id, cust] of this.simulatedCustomers.entries()) {
        if (cust.email === email) return id;
      }
      const customerId = `cus_sim_${crypto.randomUUID().slice(0, 14)}`;
      this.simulatedCustomers.set(customerId, { customer_id: customerId, email, name });
      return customerId;
    }

    try {
      const existing = await this.client.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        return existing.data[0].id;
      }
      const customer = await this.client.customers.create({ email, name });
      return customer.id;
    } catch (err: unknown) {
      throw new Error(`Stripe getOrCreateCustomer failed: ${(err as Error).message}`);
    }
  }

  async createCustomer(params: { name?: string; email?: string; contact?: string }): Promise<{ customer_id: string }> {
    const id = await this.getOrCreateCustomer(params.email || "customer@example.com", params.name);
    return { customer_id: id };
  }

  async capturePayment(paymentId: string, amount?: Money): Promise<PaymentStatusResult> {
    return {
      payment_id: paymentId,
      status: "captured",
      amount: amount ?? { amount: 10000, currency: "INR" },
    };
  }

  async checkPaymentLink(linkId: string): Promise<PaymentStatusResult | null> {
    const session = this.simulatedCheckoutSessions.get(linkId);
    if (session) {
      return {
        payment_id: `pi_link_${linkId}`,
        status: "captured",
        amount: { amount: 10000, currency: "INR" },
      };
    }
    return null;
  }

  simulateCustomerToken(customerId: string, token: CustomerTokenInfo): void {
    const existing = this.simulatedCustomerTokens.get(customerId) || [];
    existing.push(token);
    this.simulatedCustomerTokens.set(customerId, existing);
  }

  async createCheckoutSession(params: {
    order_id: string;
    amount: Money;
    merchant_name: string;
    description: string;
    prefill?: { email?: string; contact?: string };
  }) {
    return {
      publishable_key: this.publishableKey || "pk_test_mock",
      payment_intent_id: params.order_id,
      amount: params.amount,
      currency: params.amount.currency,
      merchant_name: params.merchant_name,
      description: params.description,
      prefill: params.prefill,
    };
  }

  simulatePaymentSuccess(paymentId: string, amount: Money, orderId?: string): void {
    const statusResult: PaymentStatusResult = {
      payment_id: paymentId,
      order_id: orderId,
      status: "captured",
      amount,
    };
    this.simulatedPayments.set(paymentId, statusResult);
    if (orderId) {
      this.simulatedPaymentIntents.set(orderId, {
        order_id: orderId,
        status: "captured",
        amount,
      });
    }
  }

  /**
   * Fetch saved payment method tokens (vaulted cards) for a customer.
   */
  async fetchCustomerTokens(customerId: string): Promise<CustomerTokenInfo[]> {
    if (this.isSimulated || !this.client) {
      const stored = this.simulatedCustomerTokens.get(customerId);
      if (stored && stored.length > 0) return stored;
      // Default simulated token for testing
      return [
        {
          token_id: `token_sim_${customerId.replace(/^cust_sim_/, "")}`,
          method: "card",
          card_last4: "4242",
          card_network: "visa",
          recurring_status: "confirmed",
          max_amount: 10000000,
          created_at: Date.now(),
        },
      ];
    }

    try {
      const methods = await this.client.paymentMethods.list({
        customer: customerId,
        type: "card",
      });

      return methods.data.map((pm) => ({
        token_id: pm.id,
        method: "card",
        card_last4: pm.card?.last4,
        card_network: pm.card?.brand,
        recurring_status: "confirmed",
        created_at: pm.created,
      }));
    } catch (err: unknown) {
      console.warn(`[Stripe] Failed to fetch payment methods for customer ${customerId}:`, err);
      return [];
    }
  }

  /**
   * Fetch payment method token attached to a PaymentIntent.
   */
  async fetchTokenForPayment(paymentId: string): Promise<CustomerTokenInfo | null> {
    if (this.isSimulated || !this.client) {
      return null;
    }

    try {
      const pi = await this.client.paymentIntents.retrieve(paymentId, {
        expand: ["payment_method"],
      });
      const pm = pi.payment_method as Stripe.PaymentMethod;
      if (pm && typeof pm === "object") {
        return {
          token_id: pm.id,
          method: "card",
          card_last4: pm.card?.last4,
          card_network: pm.card?.brand,
          recurring_status: "confirmed",
          created_at: pm.created,
        };
      }
      return null;
    } catch (err: unknown) {
      console.warn(`[Stripe] Failed to fetch token for payment ${paymentId}:`, err);
      return null;
    }
  }
}
