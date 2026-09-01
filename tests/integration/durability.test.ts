import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import express from "express";
import { createMerchantMcpServer } from "../../src/server.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { TransactionState } from "../../src/types/index.js";
import { processWebhookEvent } from "../../src/payment/webhook.js";

describe("Durability Integration Tests (Crash & Restart Recovery)", () => {
  let tmpDir: string;
  let dbPath: string;
  let mockMerchantServer: http.Server;
  let mockMerchantPort: number;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-durability-test-"));
    dbPath = path.join(tmpDir, "durability.db");

    // Setup local mock merchant backend
    const mockApp = express();
    mockApp.use(express.json());

    mockApp.get("/api/products/laptop_101", (_req, res) => {
      res.json({
        id: "laptop_101",
        name: "ZenBook Pro 16",
        description: "High-performance laptop",
        price: { amount: 8500000, currency: "INR" },
        stock: "in_stock",
        specs: { ram: "16GB", ssd: "512GB" },
      });
    });

    mockApp.post("/api/checkout", (_req, res) => {
      res.json({
        checkout_id: "chk_durability_999",
        sku: "laptop_101",
        total: { amount: 8500000, currency: "INR" },
        available: true,
      });
    });

    mockApp.post("/api/orders", (req, res) => {
      res.json({
        order_id: "ord_durability_777",
        status: "CONFIRMED",
        created_at: new Date().toISOString(),
        payment_id: req.body.razorpay_payment_id,
      });
    });

    mockApp.get("/api/orders/ord_durability_777", (_req, res) => {
      res.json({
        order_id: "ord_durability_777",
        status: "CONFIRMED",
        created_at: new Date().toISOString(),
      });
    });

    await new Promise<void>((resolve) => {
      mockMerchantServer = mockApp.listen(0, () => {
        mockMerchantPort = (mockMerchantServer.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (mockMerchantServer) {
      await new Promise<void>((resolve) => mockMerchantServer.close(() => resolve()));
    }
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it("should survive restart mid-transaction and reconcile webhook payments post-restart", async () => {
    const manifest: IntegrationManifest = {
      merchant: {
        name: "DurabilityMart",
        description: "Resilient merchant",
        commerce_domain: "retail",
        currency: "INR",
        base_url: `http://localhost:${mockMerchantPort}`,
      },
      operations: {
        search: { method: "GET", path: "/api/products" },
        get_product: { method: "GET", path: "/api/products/:product_id" },
        create_checkout: { method: "POST", path: "/api/checkout" },
        get_checkout: { method: "GET", path: "/api/checkout/:checkout_id" },
        confirm_order: { method: "POST", path: "/api/orders" },
        get_order_status: { method: "GET", path: "/api/orders/:order_id" },
      },
      field_mappings: {
        offer: {
          offer_id: { from: "$.id" },
          title: { from: "$.name" },
          description: { from: "$.description" },
          price: { from: "$.price" },
          availability: { from: "$.stock", transform: { type: "enum", enum_map: { in_stock: "in_stock" } } },
          attributes: { from: "$.specs" },
        },
        checkout: {
          checkout_id: { from: "$.checkout_id" },
          sku: { from: "$.sku" },
          total: { from: "$.total" },
          available: { from: "$.available" },
        },
        order: {
          order_id: { from: "$.order_id" },
          status: { from: "$.status" },
          confirmed_at: { from: "$.created_at" },
        },
      },
      payment: {
        provider: "razorpay",
        razorpay_key_id_env: "RAZORPAY_KEY_ID",
        razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
      },
    };

    // ─── Step 1: Boot MCP Server Instance #1 ────────────────────────────────────
    const instance1 = createMerchantMcpServer(manifest, {
      dbPath,
      forceSimulation: true,
    });

    // Invoke prepare_purchase directly or via manager / tools
    const product = await instance1.connector.getProduct("laptop_101");
    expect(product.title).toBe("ZenBook Pro 16");

    const checkout = await instance1.connector.createCheckout("laptop_101", 1);
    expect(checkout.checkout_id).toBe("chk_durability_999");

    const txn = instance1.txnManager.create({
      product_id: "laptop_101",
      quantity: 1,
      selection_reason: "Durability integration test",
    });
    const txnId = txn.transaction_id;

    instance1.txnManager.bindCheckout(txnId, checkout);
    instance1.txnManager.transition(txnId, TransactionState.CHECKOUT_CREATED, "checkout_created");

    // Evaluate policy
    const policyDecision = instance1.policyEngine.evaluate(instance1.txnManager.get(txnId), "CREATE_PAYMENT");
    expect(policyDecision.decision).toBe("ALLOW");
    instance1.txnManager.bindPolicyDecision(txnId, policyDecision);

    // Create payment order
    const orderResult = await instance1.paymentAdapter.createOrder({
      amount: checkout.total,
      receipt: txnId,
    });
    const linkResult = await instance1.paymentAdapter.createPaymentLink({
      amount: checkout.total,
      description: "Purchase: ZenBook Pro 16",
      reference_id: txnId,
    });

    instance1.txnManager.bindPayment(txnId, {
      provider: "razorpay",
      razorpay_order_id: orderResult.order_id,
      payment_link_id: linkResult.payment_link_id,
      payment_link_url: linkResult.short_url,
      payment_status: "pending",
    });

    instance1.txnManager.transition(txnId, TransactionState.PAYMENT_PENDING, "payment_link_created");

    // Verify transaction is in PAYMENT_PENDING state before crash
    expect(instance1.txnManager.get(txnId).state).toBe(TransactionState.PAYMENT_PENDING);

    // ─── Step 2: SIMULATE PROCESS CRASH & RESTART ──────────────────────────────
    // (instance1 is discarded; new server instance2 created with same dbPath)
    const instance2 = createMerchantMcpServer(manifest, {
      dbPath,
      forceSimulation: true,
    });

    // ─── Step 3: Verify State is Preserved Post-Restart ──────────────────────────
    expect(instance2.txnManager.has(txnId)).toBe(true);
    const recoveredTxn = instance2.txnManager.get(txnId);
    expect(recoveredTxn.state).toBe(TransactionState.PAYMENT_PENDING);
    expect(recoveredTxn.merchant_verified?.checkout_id).toBe("chk_durability_999");
    expect(recoveredTxn.payment?.razorpay_order_id).toBe(orderResult.order_id);

    // Audit chain must be 100% valid up to the restart point
    const chainCheck1 = instance2.auditLedger.verifyChain(txnId);
    expect(chainCheck1.valid).toBe(true);

    // ─── Step 4: Webhook Reconciles for Pre-Restart In-Flight Payment ────────────
    const webhookPayload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_durability_12345",
            order_id: orderResult.order_id,
            notes: {
              transaction_id: txnId,
            },
            status: "captured",
            amount: 8500000,
            currency: "INR",
          },
        },
      },
    };

    const webhookResult = processWebhookEvent(
      webhookPayload,
      instance2.txnManager,
      instance2.auditLedger
    );

    expect(webhookResult.status).toBe("processed");
    expect(webhookResult.transaction_id).toBe(txnId);

    // Transaction moved to PAYMENT_AUTHORIZED
    const paidTxn = instance2.txnManager.get(txnId);
    expect(paidTxn.state).toBe(TransactionState.PAYMENT_AUTHORIZED);
    expect(paidTxn.payment?.payment_status).toBe("captured");

    // ─── Step 5: Final Order Confirmation Post-Restart ──────────────────────────
    const orderBinding = await instance2.connector.confirmOrder(
      paidTxn.merchant_verified!.checkout_id,
      paidTxn.payment!.razorpay_payment_id!
    );
    instance2.txnManager.bindOrder(txnId, orderBinding);
    instance2.txnManager.transition(txnId, TransactionState.ORDER_CONFIRMED, "merchant_order_confirmed");

    const finalTxn = instance2.txnManager.get(txnId);
    expect(finalTxn.state).toBe(TransactionState.ORDER_CONFIRMED);
    expect(finalTxn.merchant_order?.order_id).toBe("ord_durability_777");

    // ─── Step 6: Verify Full Audit Hash Chain across Lifecycle & Restarts ──────
    const finalChainCheck = instance2.auditLedger.verifyChain(txnId);
    expect(finalChainCheck.valid).toBe(true);
    expect(finalChainCheck.event_count).toBeGreaterThanOrEqual(4);
  });
});
