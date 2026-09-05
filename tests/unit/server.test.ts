import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMerchantMcpServer } from "../../src/server.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { processWebhookEvent } from "../../src/payment/webhook.js";
import { TransactionState } from "../../src/types/index.js";

const sampleManifest: IntegrationManifest = {
  merchant: {
    name: "TechBazaar",
    description: "Electronics Demo Store",
    commerce_domain: "retail",
    currency: "INR",
    base_url: "https://api.techbazaar.local",
  },
  auth: { type: "none" },
  operations: {
    search: {
      method: "POST",
      path: "/api/search",
      response_path: "$.products",
    },
    get_product: {
      method: "GET",
      path: "/api/products/:product_id",
    },
    create_checkout: {
      method: "POST",
      path: "/api/checkout",
    },
    get_checkout: {
      method: "GET",
      path: "/api/checkout/:checkout_id",
    },
    confirm_order: {
      method: "POST",
      path: "/api/orders",
    },
    get_order_status: {
      method: "GET",
      path: "/api/orders/:order_id",
    },
  },
  filters: [
    { key: "category", label: "Category", type: "enum", options: [{ value: "laptop", label: "Laptop" }] },
  ],
  field_mappings: {
    offer: {
      offer_id: { from: "$.sku" },
      title: { from: "$.product_name" },
      description: { from: "$.desc" },
      "price.amount": { from: "$.price_inr", transform: { type: "multiply", value: 100 } },
      "price.currency": { from: null, transform: { type: "default", value: "INR" } },
      availability: { from: "$.stock_status", transform: { type: "enum", enum_map: { AVAILABLE: "in_stock", OUT_OF_STOCK: "out_of_stock" } } },
      "attributes.brand": { from: "$.brand" },
    },
    checkout: {
      checkout_id: { from: "$.id" },
      "total.amount": { from: "$.total_inr", transform: { type: "multiply", value: 100 } },
      "total.currency": { from: null, transform: { type: "default", value: "INR" } },
      available: { from: "$.in_stock" },
      expires_at: { from: "$.expires" },
    },
    order: {
      order_id: { from: "$.order_id" },
      status: { from: "$.status" },
    },
  },
  payment: {
    provider: "razorpay",
    razorpay_key_id_env: "RAZORPAY_KEY_ID",
    razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
  },
};

describe("MerchantMCP Server & Tools Integration", () => {
  let instance: ReturnType<typeof createMerchantMcpServer>;

  beforeEach(() => {
    instance = createMerchantMcpServer(sampleManifest, undefined, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize McpServer and register all discovery, refinement, and transaction tools", () => {
    expect(instance.server).toBeDefined();
    expect(instance.manifest.merchant.name).toBe("TechBazaar");

    const registeredTools = Object.keys(
      (instance.server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
    );

    expect(registeredTools).toContain("search_products");
    expect(registeredTools).toContain("get_product");
    expect(registeredTools).toContain("get_merchant_info");
    expect(registeredTools).toContain("refine_search");
    expect(registeredTools).toContain("get_refinement_options");
    expect(registeredTools).toContain("browse_categories");
    expect(registeredTools).toContain("autocomplete");
    expect(registeredTools).toContain("check_availability");
    expect(registeredTools).toContain("add_to_cart");
    expect(registeredTools).toContain("get_cart");
    expect(registeredTools).toContain("apply_coupon");
    expect(registeredTools).toContain("get_delivery_options");
    expect(registeredTools).toContain("select_delivery_option");
    expect(registeredTools).toContain("prepare_purchase");
    expect(registeredTools).toContain("get_transaction_status");
    expect(registeredTools).toContain("get_transaction_audit");
    expect(registeredTools).toContain("cancel_transaction");
    expect(registeredTools).toContain("request_refund");
    expect(registeredTools).toContain("create_mandate");
    expect(registeredTools).toContain("check_auth_status");
    expect(registeredTools).toContain("request_login");
    expect(registeredTools).toContain("logout");
    expect(registeredTools.length).toBe(22);
  });

  it("should execute full end-to-end commerce lifecycle: discover -> prepare -> webhook -> reconcile -> audit", async () => {
    const { connector, txnManager, auditLedger, paymentAdapter, policyEngine } = instance;

    // 1. Mock Merchant API calls
    const mockProduct = {
      sku: "LEN-LAP-001",
      product_name: "Lenovo IdeaPad Slim 5",
      desc: "16GB RAM 512GB SSD",
      price_inr: 64999,
      stock_status: "AVAILABLE",
      brand: "Lenovo",
    };

    const mockCheckout = {
      id: "chk_tb_001",
      total_inr: 64999,
      in_stock: true,
      expires: new Date(Date.now() + 3600000).toISOString(),
    };

    const mockOrder = {
      order_id: "ORD-CONFIRMED-999",
      status: "CONFIRMED",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      if (urlStr.includes("/api/products/LEN-LAP-001")) {
        return { ok: true, json: async () => mockProduct } as Response;
      }
      if (urlStr.includes("/api/checkout") && method === "POST") {
        return { ok: true, json: async () => mockCheckout } as Response;
      }
      if (urlStr.includes("/api/orders") && method === "POST") {
        return { ok: true, json: async () => mockOrder } as Response;
      }

      return { ok: false, status: 404, text: async () => "Not Found" } as Response;
    });

    // 2. Step: Discovery (Product lookup)
    const offer = await connector.getProduct("LEN-LAP-001");
    expect(offer.offer_id).toBe("LEN-LAP-001");
    expect(offer.price.amount).toBe(6499900);

    // 3. Step: Initiate Transaction
    const txn = txnManager.create({
      product_id: "LEN-LAP-001",
      quantity: 1,
      selection_reason: "Best value laptop",
    });
    const txnId = txn.transaction_id;

    // Checkout
    const checkout = await connector.createCheckout(offer.offer_id, 1);
    txnManager.bindCheckout(txnId, checkout);
    txnManager.transition(txnId, TransactionState.CHECKOUT_CREATED, "checkout_created");

    // Policy Gating
    const policyDecision = policyEngine.evaluate(txnManager.get(txnId), "CREATE_PAYMENT", {
      bypass_mandate_for_manual_link: true,
    });
    expect(policyDecision.decision).toBe("ALLOW");
    txnManager.bindPolicyDecision(txnId, policyDecision);

    // Payment Order & Link Creation
    const orderRes = await paymentAdapter.createOrder({
      amount: checkout.total,
      receipt: txnId,
    });
    const linkRes = await paymentAdapter.createPaymentLink({
      amount: checkout.total,
      description: `Purchase: ${offer.title}`,
      reference_id: txnId,
    });

    txnManager.bindPayment(txnId, {
      provider: "razorpay",
      razorpay_order_id: orderRes.order_id,
      payment_link_id: linkRes.payment_link_id,
      payment_link_url: linkRes.short_url,
      payment_status: "pending",
    });
    txnManager.transition(txnId, TransactionState.PAYMENT_PENDING, "payment_link_created");

    expect(txnManager.get(txnId).state).toBe(TransactionState.PAYMENT_PENDING);

    // 4. Step: Inbound Razorpay Webhook
    const webhookPayload = {
      event: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            reference_id: txnId,
            payment_id: "pay_rzp_live_12345",
          },
        },
        payment: {
          entity: {
            id: "pay_rzp_live_12345",
            amount: 6499900,
            currency: "INR",
          },
        },
      },
    };

    const webhookResult = processWebhookEvent(webhookPayload, txnManager, auditLedger);
    expect(webhookResult.status).toBe("processed");
    expect(txnManager.get(txnId).state).toBe(TransactionState.PAYMENT_AUTHORIZED);

    // 5. Step: Order Confirmation
    const finalOrder = await connector.confirmOrder(checkout.checkout_id, "pay_rzp_live_12345");
    txnManager.bindOrder(txnId, finalOrder);
    txnManager.transition(txnId, TransactionState.ORDER_CONFIRMED, "merchant_order_placed");

    expect(txnManager.get(txnId).state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(txnManager.get(txnId).merchant_order?.order_id).toBe("ORD-CONFIRMED-999");

    // 6. Step: Audit Verification & Decision Receipt
    const auditEvents = auditLedger.getTransactionAudit(txnId);
    expect(auditEvents.length).toBeGreaterThan(0);

    const verification = auditLedger.verifyChain(txnId);
    expect(verification.valid).toBe(true);
  });

  it("should return dual payment methods (payment_link + checkout_sdk) in prepare_purchase tool response", async () => {
    const mockProduct = {
      sku: "LEN-LAP-001",
      product_name: "Lenovo IdeaPad Slim 5",
      desc: "16GB RAM 512GB SSD",
      price_inr: 64999,
      stock_status: "AVAILABLE",
    };
    const mockCheckout = {
      id: "tb_cart_test_123",
      total_inr: 64999,
      in_stock: true,
      expires: "2026-12-31T23:59:59Z",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/products/")) {
        return { ok: true, json: async () => mockProduct } as Response;
      }
      if (urlStr.includes("/api/checkout")) {
        return { ok: true, json: async () => mockCheckout } as Response;
      }
      return { ok: false, status: 404, text: async () => "Not Found" } as Response;
    });

    const tool = (instance.server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<{ content: [{ text: string }] }> }> })._registeredTools["prepare_purchase"];
    expect(tool).toBeDefined();

    const response = await tool.handler({
      product_id: "LEN-LAP-001",
      quantity: 1,
      selection_reason: "Recommended laptop",
    });

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.state).toBe("PAYMENT_PENDING");
    expect(parsed.payment).toBeDefined();
    expect(parsed.payment.payment_url).toContain("http://localhost:");
    expect(parsed.payment.methods).toBeDefined();
    expect(parsed.payment.methods.payment_link.url).toContain("http://localhost:");
    expect(parsed.payment.methods.checkout_sdk).toBeDefined();
    expect(parsed.payment.methods.checkout_sdk.publishable_key).toBe(instance.paymentAdapter.publishableKey);
    expect(parsed.payment.methods.checkout_sdk.amount).toBe(6499900);
    expect(parsed.payment.methods.checkout_sdk.currency).toBe("INR");
    expect(parsed.payment.methods.checkout_sdk.merchant_name).toBe("TechBazaar");
  });
});

describe("Hosted MerchantMCP Server (SSE)", () => {
  it("should start hosted SSE server and respond to /health", async () => {
    const { startHostedMerchantMcpServer } = await import("../../src/server-sse.js");
    const testPort = 4055;
    const sseApp = startHostedMerchantMcpServer(sampleManifest, testPort);

    try {
      const res = await fetch(`http://localhost:${testPort}/health`);
      const health = await res.json();

      expect(health.status).toBe("healthy");
      expect(health.merchant).toBe("TechBazaar");
      expect(health.transport).toBe("SSE");
    } finally {
      await sseApp.close();
    }
  });
});

