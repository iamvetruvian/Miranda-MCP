/**
 * Local OAuth2 Callback HTTP Server
 * Runs alongside the Stdio MCP server to handle browser OAuth2 redirects.
 */

import http from "http";
import express, { Request, Response } from "express";
import { OAuth2Handler } from "./oauth2-handler.js";
import { IntegrationManifest } from "../types/manifest.js";
import { listenWithPortRecovery } from "../utils/dev-port-killer.js";
import { TransactionManager } from "../transaction/manager.js";
import { ConnectorRuntime } from "../connector/runtime.js";
import { AuditLedger } from "../audit/ledger.js";
import {
  paymentCapturedEvent,
  orderConfirmedEvent,
  recurringTokenCapturedEvent,
  consentGrantedEvent,
  consentRejectedEvent,
  paymentOrderCreatedEvent,
  paymentLinkGeneratedEvent,
} from "../audit/events.js";
import { TransactionState } from "../types/index.js";
import { RazorpayAdapter } from "../payment/razorpay.js";
import { RecurringTokenStore } from "../payment/token-store.js";
import { MandateStore } from "../authz/mandate-store.js";
import { SessionStore } from "./session-store.js";

export interface AuthCallbackServerResult {
  app: express.Express;
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export interface AuthCallbackServerContext {
  txnManager?: TransactionManager;
  connector?: ConnectorRuntime;
  auditLedger?: AuditLedger;
  paymentAdapter?: RazorpayAdapter;
  recurringTokenStore?: RecurringTokenStore;
  mandateStore?: MandateStore;
  sessionStore?: SessionStore;
}

/**
 * Starts a lightweight Express HTTP server to receive OAuth2 authorization code callbacks and hosted payments.
 */
export function startAuthCallbackServer(
  oauth2Handler: OAuth2Handler | null,
  manifest: IntegrationManifest,
  port: number = 3002,
  context?: AuthCallbackServerContext
): AuthCallbackServerResult {
  const app = express();
  app.use(express.json());

  // Enable CORS
  app.use((req: Request, res: Response, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Diagnostic logging
  app.use((req: Request, _res: Response, next) => {
    console.error(`[MerchantMCP-Auth] ${req.method} ${req.path}`);
    next();
  });

  // ─── GET /auth/callback ──────────────────────────────────────────────────
  app.get("/auth/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;
    const errorDescription = req.query.error_description as string | undefined;

    if (error) {
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Failed - ${manifest.merchant.name}</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 480px; text-align: center; border: 1px solid #ef4444; }
              h1 { color: #ef4444; margin-top: 0; font-size: 1.5rem; }
              p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Authentication Failed</h1>
              <p>Merchant error: <strong>${error}</strong>${errorDescription ? ` - ${errorDescription}` : ""}</p>
            </div>
          </body>
        </html>
      `);
      return;
    }

    if (!code || !state) {
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Invalid Callback - ${manifest.merchant.name}</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2rem; border-radius: 12px; max-width: 480px; text-align: center; border: 1px solid #ef4444; }
              h1 { color: #ef4444; margin-top: 0; font-size: 1.5rem; }
              p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Invalid Callback Request</h1>
              <p>Missing required authorization <code>code</code> or <code>state</code> parameter.</p>
            </div>
          </body>
        </html>
      `);
      return;
    }

    if (!oauth2Handler) {
      res.status(400).send("OAuth2 handler is not configured for this merchant.");
      return;
    }

    try {
      const session = await oauth2Handler.handleCallback(code, state);
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Successful - ${manifest.merchant.name}</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2.5rem; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); max-width: 480px; text-align: center; border: 1px solid #334155; }
              .icon { font-size: 3rem; margin-bottom: 1rem; color: #22c55e; }
              h1 { color: #f8fafc; margin: 0 0 0.5rem 0; font-size: 1.5rem; }
              .merchant { color: #38bdf8; font-weight: 600; }
              p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin: 0.5rem 0 1.5rem 0; }
              .user-info { background: #0f172a; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; font-size: 0.875rem; color: #cbd5e1; border: 1px solid #334155; }
              .hint { font-size: 0.85rem; color: #64748b; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">✓</div>
              <h1>Logged in Successfully</h1>
              <p>Your account is now linked to <span class="merchant">${manifest.merchant.name}</span> for your AI assistant.</p>
              ${session.user_name || session.user_id
          ? `<div class="user-info">Logged in as: <strong>${session.user_name || session.user_id}</strong></div>`
          : ""
        }
              <div class="hint">You can close this tab and return to your conversation.</div>
            </div>
          </body>
        </html>
      `);
    } catch (err: unknown) {
      const errorMsg = (err as Error).message;
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Error</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2rem; border-radius: 12px; max-width: 480px; text-align: center; border: 1px solid #ef4444; }
              h1 { color: #ef4444; margin-top: 0; font-size: 1.5rem; }
              p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Authentication Failed</h1>
              <p>${errorMsg}</p>
            </div>
          </body>
        </html>
      `);
    }
  });

  // ─── GET /auth/status ────────────────────────────────────────────────────
  app.get("/auth/status", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      merchant: manifest.merchant.name,
      oauth2_configured: !!manifest.auth?.oauth2_user,
    });
  });

  // ─── GET /pay ────────────────────────────────────────────────────────────
  app.get("/pay", (req: Request, res: Response) => {
    const orderId = (req.query.order_id as string) || "";
    const amount = Number(req.query.amount) || 0;
    const currency = (req.query.currency as string) || manifest.merchant.currency || "INR";
    const desc = (req.query.desc as string) || "Order Payment";
    const txnId = (req.query.txn_id as string) || "";
    const mode = (req.query.mode as string) || "one_time";
    const customerId = (req.query.customer_id as string) || "";
    const customerEmail = (req.query.customer_email as string) || "";
    const customerContact = (req.query.customer_contact as string) || "";
    const isMandate = mode === "mandate";

    let effectiveCustId = customerId;
    let effectiveEmail = customerEmail;
    let effectiveContact = customerContact;

    if (txnId && context?.txnManager && context.txnManager.has(txnId)) {
      const txn = context.txnManager.get(txnId);
      if (!effectiveCustId) effectiveCustId = txn.customer_id || txn.payment?.customer_id || "";
      if (!effectiveEmail) effectiveEmail = txn.payment?.customer_email || "";
      if (!effectiveContact) effectiveContact = txn.payment?.customer_contact || "";
    }

    const keyId =
      (manifest.payment.razorpay_key_id_env ? process.env[manifest.payment.razorpay_key_id_env] : undefined) ||
      process.env.RAZORPAY_KEY_ID ||
      "rzp_test_TVVFU5yXYmeSCq";

    const displayAmount = (amount / 100).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const badgeText = isMandate ? "Autopay Mandate Setup" : "One-Time Payment";
    const badgeBg = isMandate ? "#16a34a" : "#0284c7";
    const themeColor = isMandate ? "#16a34a" : "#2563eb";
    const btnText = isMandate
      ? `Authorize Mandate & Pay ₹${displayAmount}`
      : `Pay ₹${displayAmount} (One-Time)`;

    const bannerHtml = isMandate
      ? `<div style="background: #022c22; border: 1px solid #16a34a; border-radius: 8px; padding: 0.85rem; margin-bottom: 1.25rem; font-size: 0.85rem; color: #86efac; line-height: 1.4;">
           <strong>✓ Autopay Mandate Enabled</strong><br>
           Authorizes your AI assistant to handle future purchases autonomously up to ₹1,00,000 without requiring manual payment links.
           <div style="margin-top: 0.6rem; color: #38bdf8; font-size: 0.8rem; background: #0c4a6e; padding: 0.5rem; border-radius: 6px; border: 1px solid #0284c7;">
             🔒 <strong>Restricted to Autopay Instruments:</strong> Only Card and UPI Autopay instruments are permitted to register an RBI recurring token.
           </div>
           <div style="margin-top: 0.6rem; background: #0f172a; border: 1px solid #334155; padding: 0.6rem; border-radius: 6px; font-size: 0.78rem; color: #cbd5e1;">
             <strong style="color: #facc15;">💳 Razorpay Test Mode Card Details:</strong><br>
             • <strong>Domestic Visa:</strong> <code style="color: #67e8f9; background: #1e293b; padding: 1px 4px; border-radius: 3px;">4718 6091 0820 4366</code><br>
             • <strong>Domestic Mastercard:</strong> <code style="color: #67e8f9; background: #1e293b; padding: 1px 4px; border-radius: 3px;">5267 3181 8797 5449</code><br>
             • <strong>Expiry:</strong> Any future date (e.g. 12/30) &nbsp;|&nbsp; <strong>CVV:</strong> 123 &nbsp;|&nbsp; <strong>OTP:</strong> 123456<br>
             <span style="color: #94a3b8; font-size: 0.72rem;">⚠️ Do not use Stripe cards (4111...) as Razorpay rejects international cards by default.</span>
           </div>
         </div>`
      : `<div style="background: #082f49; border: 1px solid #0284c7; border-radius: 8px; padding: 0.85rem; margin-bottom: 1.25rem; font-size: 0.85rem; color: #7dd3fc; line-height: 1.4;">
           <strong>ℹ Single One-Time Payment</strong><br>
           This payment is for this order only. No card or payment details will be saved for autopay.
         </div>`;

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${isMandate ? "Setup Autopay Mandate" : "Payment"} - ${manifest.merchant.name}</title>
        <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          body { background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
          .card { background: #1e293b; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); width: 100%; max-width: 480px; padding: 2rem; }
          .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #334155; }
          .brand { font-size: 1.25rem; font-weight: 700; color: #38bdf8; }
          .badge { background: ${badgeBg}; color: white; padding: 0.25rem 0.6rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; }
          .order-summary { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem; }
          .row { display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.9rem; color: #94a3b8; }
          .row.total { border-top: 1px solid #334155; padding-top: 0.5rem; margin-top: 0.5rem; font-size: 1.15rem; font-weight: 700; color: #f8fafc; }
          .btn-pay { width: 100%; padding: 0.85rem; background: ${themeColor}; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: filter 0.2s; }
          .btn-pay:hover { filter: brightness(1.1); }
          .hint { text-align: center; font-size: 0.8rem; color: #64748b; margin-top: 1rem; }
          .success-box { display: none; text-align: center; }
          .success-box .icon { font-size: 3rem; color: #22c55e; margin-bottom: 0.5rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <div id="payment-view">
            <div class="header">
              <div class="brand">${manifest.merchant.name}</div>
              <span class="badge">${badgeText}</span>
            </div>
            ${bannerHtml}
            <div class="order-summary">
              <div class="row">
                <span>Description</span>
                <span>${desc}</span>
              </div>
              <div class="row total">
                <span>Total Amount</span>
                <span>₹${displayAmount} ${currency}</span>
              </div>
            </div>
            <button class="btn-pay" id="pay-btn" onclick="openRazorpay()">
              ${btnText}
            </button>
            <button type="button" id="verify-btn" onclick="checkPaymentSuccess()" style="width: 100%; margin-top: 0.75rem; background: #0f172a; border: 1px solid #0284c7; color: #38bdf8; padding: 0.65rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; display: none;">
              ✓ Already entered OTP? Click to Confirm
            </button>
            <p class="hint">🔒 Protected by 256-bit Razorpay Payment Gateway</p>
          </div>

          <div class="success-box" id="success-view">
            <div class="icon">✓</div>
            <h2 style="margin-bottom: 0.5rem;">${isMandate ? "Mandate Authorized & Paid!" : "Payment Successful!"}</h2>
            <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1rem;">
              ${isMandate
                ? "Your autopay mandate has been registered. Future purchases can now be completed autonomously by your AI agent."
                : "Your payment has been verified by Razorpay."}
            </p>
            <div id="payment-ref" style="font-size: 0.8rem; color: #64748b; background: #0f172a; padding: 0.5rem; border-radius: 6px; margin-bottom: 1.5rem;"></div>
            <p style="color: #38bdf8; font-size: 0.85rem;">You can close this window and return to your AI conversation.</p>
          </div>
        </div>

        <script>
          const isMandateMode = ${isMandate};
          const options = {
            key: "${keyId}",
            amount: ${amount},
            currency: "${currency}",
            name: "${manifest.merchant.name}",
            description: "${desc}",
            order_id: "${orderId}",
            ${effectiveCustId ? `customer_id: "${effectiveCustId}",` : ""}
            ${isMandate ? `recurring: true,` : ""}
            ${effectiveEmail || effectiveContact ? `prefill: {
              ${effectiveEmail ? `email: "${effectiveEmail}",` : ""}
              ${effectiveContact ? `contact: "${effectiveContact}",` : ""}
            },` : ""}
            theme: { color: "${themeColor}" },
            modal: {
              ondismiss: function () {
                const vBtn = document.getElementById('verify-btn');
                if (vBtn) vBtn.style.display = 'block';
                checkPaymentSuccess();
              }
            },
            ${isMandate ? `
            method: {
              card: true,
              upi: true,
              netbanking: false,
              wallet: false,
              emi: false,
              paylater: false,
            },
            config: {
              display: {
                blocks: {
                  mandate_methods: {
                    name: "Autopay Mandate Supported",
                    instruments: [
                      { method: "card" },
                      { method: "upi" }
                    ]
                  }
                },
                sequence: ["block.mandate_methods"],
                preferences: {
                  show_default_blocks: false
                }
              }
            },
            ` : ""}
            handler: async function (response) {
              document.getElementById('payment-view').style.display = 'none';
              document.getElementById('success-view').style.display = 'block';
              document.getElementById('payment-ref').innerText = "Razorpay Payment ID: " + response.razorpay_payment_id;

              try {
                await fetch('/pay/confirm', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    txn_id: "${txnId}",
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_signature: response.razorpay_signature,
                    mode: "${mode}",
                  })
                });
              } catch (err) {
                console.error("Payment confirmation callback error:", err);
              }
            }
          };

          const rzp = new Razorpay(options);

          function openRazorpay() {
            rzp.open();
          }

          async function checkPaymentSuccess() {
            try {
              const res = await fetch('/pay/verify?order_id=${orderId}&txn_id=${txnId}&mode=${mode}');
              const data = await res.json();
              if (data.verified) {
                document.getElementById('payment-view').style.display = 'none';
                document.getElementById('success-view').style.display = 'block';
                document.getElementById('payment-ref').innerText = "Razorpay Payment ID: " + data.payment_id + " (Verified)";
                return true;
              }
            } catch (e) {
              console.warn("Verify check error:", e);
            }
            return false;
          }

          let pollInterval = setInterval(async () => {
            const ok = await checkPaymentSuccess();
            if (ok) {
              clearInterval(pollInterval);
              try { rzp.close(); } catch {}
            }
          }, 2500);

          window.onload = function() {
            setTimeout(openRazorpay, 300);
          };
        </script>
      </body>
      </html>
    `);
  });

  // ─── GET /pay/verify ─────────────────────────────────────────────────────
  app.get("/pay/verify", async (req: Request, res: Response) => {
    const txnId = (req.query.txn_id as string) || "";
    const orderId = (req.query.order_id as string) || "";
    const mode = (req.query.mode as string) || "one_time";
    const txnManager = context?.txnManager;
    const connector = context?.connector;
    const auditLedger = context?.auditLedger;
    const paymentAdapter = context?.paymentAdapter;
    const recurringTokenStore = context?.recurringTokenStore;
    const sessionStore = context?.sessionStore;

    if (!paymentAdapter) {
      return res.json({ verified: false, error: "No payment adapter" });
    }

    try {
      let verifiedPayment: { payment_id: string; status: string } | null = null;
      if (orderId) {
        verifiedPayment = await paymentAdapter.checkOrderPayment(orderId);
      }
      if (!verifiedPayment && txnId && txnManager && txnManager.has(txnId)) {
        const t = txnManager.get(txnId);
        if (t.payment?.razorpay_mandate_order_id) {
          verifiedPayment = await paymentAdapter.checkOrderPayment(t.payment.razorpay_mandate_order_id);
        }
        if (!verifiedPayment && t.payment?.razorpay_order_id) {
          verifiedPayment = await paymentAdapter.checkOrderPayment(t.payment.razorpay_order_id);
        }
      }

      if (verifiedPayment && (verifiedPayment.status === "captured" || verifiedPayment.status === "authorized")) {
        const payId = verifiedPayment.payment_id;
        if (txnId && txnManager && txnManager.has(txnId)) {
          const txn = txnManager.get(txnId);
          if (txn.state === TransactionState.PAYMENT_PENDING) {
            txnManager.bindPayment(txnId, {
              provider: "razorpay",
              ...txn.payment,
              razorpay_payment_id: payId,
              razorpay_order_id: orderId || txn.payment?.razorpay_order_id,
              payment_status: verifiedPayment.status,
            });
            txnManager.transition(txnId, TransactionState.PAYMENT_AUTHORIZED, "payment_verified_polling");
            if (auditLedger && txn.merchant_verified?.total) {
              auditLedger.append(
                paymentCapturedEvent(txnId, {
                  payment_id: payId,
                  amount: txn.merchant_verified.total.amount,
                  currency: txn.merchant_verified.total.currency,
                })
              );
            }

            if (connector && txn.merchant_verified?.checkout_id) {
              try {
                const order = await connector.confirmOrder(txn.merchant_verified.checkout_id, payId);
                txnManager.bindOrder(txnId, order);
                txnManager.transition(txnId, TransactionState.ORDER_CONFIRMED, "merchant_order_confirmed");
                if (auditLedger) auditLedger.append(orderConfirmedEvent(txnId, order));
              } catch (e) {
                console.error("[MerchantMCP-Auth] Error confirming order on /pay/verify:", e);
              }
            }

            // Capture recurring token if mandate mode
            if (mode === "mandate" || txn.payment?.razorpay_mandate_order_id) {
              const targetCustomerId = txn.customer_id || txn.payment?.customer_id;
              let capturedTokenId: string | undefined;
              let capturedMethod = "card";
              let capturedMaxAmount = 10000000;

              if (paymentAdapter && (paymentAdapter as any).fetchTokenForPayment) {
                capturedTokenId = await (paymentAdapter as any).fetchTokenForPayment(payId);
              }

              if (!capturedTokenId && targetCustomerId && paymentAdapter) {
                try {
                  const tokens = await paymentAdapter.fetchTokensForCustomer(targetCustomerId);
                  if (tokens && tokens.length > 0) {
                    capturedTokenId = tokens[0].token_id;
                    capturedMethod = tokens[0].method || "card";
                    capturedMaxAmount = tokens[0].max_amount || 10000000;
                  }
                } catch {}
              }

              if (capturedTokenId && targetCustomerId) {
                if (recurringTokenStore) {
                  recurringTokenStore.save({
                    customer_id: targetCustomerId,
                    token_id: capturedTokenId,
                    method: (capturedMethod === "card" ? "card" : "upi") as "upi" | "card",
                    max_amount: capturedMaxAmount,
                    email: txn.payment?.customer_email,
                    contact: txn.payment?.customer_contact,
                    created_at: new Date().toISOString(),
                  });
                }
                if (sessionStore) {
                  const activeSession = sessionStore.getActiveSession();
                  if (activeSession) {
                    sessionStore.attachCustomerId(activeSession.session_id, targetCustomerId);
                  }
                }
                txn.token_captured = true;
                if (txn.payment) {
                  txn.payment.recurring_token_id = capturedTokenId;
                  txn.payment.token_captured = true;
                }
                if (auditLedger) {
                  auditLedger.append(
                    recurringTokenCapturedEvent(txnId, {
                      customer_id: targetCustomerId,
                      token_id: capturedTokenId,
                      method: capturedMethod === "card" ? "card" : "upi",
                      max_amount: capturedMaxAmount,
                    })
                  );
                }
              }
            }
          }
        }
        return res.json({ verified: true, status: verifiedPayment.status, payment_id: payId });
      }
      return res.json({ verified: false });
    } catch (err) {
      console.error("[MerchantMCP-Auth] Error in /pay/verify:", err);
      return res.json({ verified: false, error: String(err) });
    }
  });

  // ─── POST /pay/confirm ───────────────────────────────────────────────────
  app.post("/pay/confirm", async (req: Request, res: Response) => {
    const { txn_id, razorpay_payment_id, razorpay_order_id, mode } = req.body;
    const txnManager = context?.txnManager;
    const connector = context?.connector;
    const auditLedger = context?.auditLedger;
    const paymentAdapter = context?.paymentAdapter;
    const recurringTokenStore = context?.recurringTokenStore;

    if (txn_id && txnManager && txnManager.has(txn_id)) {
      const txn = txnManager.get(txn_id);
      if (txn.state === TransactionState.PAYMENT_PENDING) {
        txnManager.bindPayment(txn_id, {
          provider: "razorpay",
          ...txn.payment,
          razorpay_payment_id,
          razorpay_order_id,
          payment_status: "captured",
        });
        txnManager.transition(txn_id, TransactionState.PAYMENT_AUTHORIZED, "client_payment_confirmed");
        if (auditLedger && txn.merchant_verified?.total) {
          auditLedger.append(
            paymentCapturedEvent(txn_id, {
              payment_id: razorpay_payment_id,
              amount: txn.merchant_verified.total.amount,
              currency: txn.merchant_verified.total.currency,
            })
          );
        }

        // Confirm merchant order immediately
        if (connector && txn.merchant_verified?.checkout_id) {
          try {
            const order = await connector.confirmOrder(
              txn.merchant_verified.checkout_id,
              razorpay_payment_id
            );
            txnManager.bindOrder(txn_id, order);
            txnManager.transition(txn_id, TransactionState.ORDER_CONFIRMED, "merchant_order_confirmed");
            if (auditLedger) {
              auditLedger.append(orderConfirmedEvent(txn_id, order));
            }
          } catch (err) {
            console.error("[MerchantMCP-Auth] Error confirming order with merchant:", err);
          }
        }

        // Capture and store recurring token ONLY if mandate mode was chosen
        const targetCustomerId = txn.customer_id || txn.payment?.customer_id;
        const isMandateMode = mode === "mandate" || (txn.payment as any)?.razorpay_mandate_order_id === razorpay_order_id;
        if (targetCustomerId && paymentAdapter && isMandateMode && !txn.token_captured) {
          try {
            let capturedTokenId: string | undefined;
            let capturedMethod = "card";
            let capturedMaxAmount = 10000000;

            if ((paymentAdapter as any).fetchTokenForPayment) {
              capturedTokenId = await (paymentAdapter as any).fetchTokenForPayment(razorpay_payment_id);
            }

            if (!capturedTokenId) {
              const tokens = await paymentAdapter.fetchTokensForCustomer(targetCustomerId);
              if (tokens && tokens.length > 0) {
                capturedTokenId = tokens[0].token_id;
                capturedMethod = tokens[0].method || "card";
                capturedMaxAmount = tokens[0].max_amount || 10000000;
              }
            }

            if (capturedTokenId) {
              if (recurringTokenStore) {
                recurringTokenStore.save({
                  customer_id: targetCustomerId,
                  token_id: capturedTokenId,
                  method: (capturedMethod === "card" ? "card" : "upi") as "upi" | "card",
                  max_amount: capturedMaxAmount,
                  email: txn.payment?.customer_email,
                  contact: txn.payment?.customer_contact,
                  created_at: new Date().toISOString(),
                });
              }
              if (context?.sessionStore) {
                const activeSession = context.sessionStore.getActiveSession();
                if (activeSession) {
                  context.sessionStore.attachCustomerId(activeSession.session_id, targetCustomerId);
                }
              }
              txn.token_captured = true;
              if (txn.payment) {
                txn.payment.recurring_token_id = capturedTokenId;
                txn.payment.token_captured = true;
              }
              if (auditLedger) {
                auditLedger.append(
                  recurringTokenCapturedEvent(txn_id, {
                    customer_id: targetCustomerId,
                    token_id: capturedTokenId,
                    method: capturedMethod,
                    max_amount: capturedMaxAmount,
                  })
                );
              }
            }
          } catch (tokErr) {
            console.warn("[MerchantMCP-Auth] Error capturing token on /pay/confirm:", tokErr);
          }
        }
      }
    }
    res.json({ status: "ok" });
  });

  // ─── Human Consent Challenge Endpoints ────────────────────────────────────
  app.get("/consent/:challengeId", (req: Request, res: Response) => {
    const mandateStore = context?.mandateStore;
    if (!mandateStore) {
      res.status(404).json({ error: "Mandate store not available" });
      return;
    }
    const challengeId = req.params.challengeId as string;
    const challenge = mandateStore.getConsentChallenge(challengeId);
    if (!challenge) {
      if (req.headers.accept?.includes("text/html")) {
        res.status(404).send(`
          <!DOCTYPE html>
          <html>
            <head><title>Consent Challenge Not Found - ${manifest.merchant.name}</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
              <div style="background: #1e293b; padding: 2rem; border-radius: 12px; max-width: 480px; text-align: center; border: 1px solid #ef4444;">
                <h2 style="color: #ef4444;">Consent Challenge Not Found or Expired</h2>
                <p style="color: #94a3b8;">This consent request is invalid or has already expired.</p>
              </div>
            </body>
          </html>
        `);
        return;
      }
      res.status(404).json({ error: "Consent challenge not found or expired" });
      return;
    }

    if (req.headers.accept?.includes("text/html")) {
      const formattedAmount = (challenge.amount / 100).toFixed(2);
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authorize Payment Mandate - ${manifest.merchant.name}</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
              .card { background: #1e293b; padding: 2rem; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.4); max-width: 500px; width: 100%; border: 1px solid #334155; }
              h1 { color: #f8fafc; margin: 0 0 0.5rem 0; font-size: 1.4rem; text-align: center; }
              .merchant { color: #38bdf8; font-weight: 600; }
              .desc { color: #94a3b8; font-size: 0.9rem; text-align: center; margin-bottom: 1.5rem; line-height: 1.4; }
              .details { background: #0f172a; border-radius: 10px; padding: 1.25rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
              .row { display: flex; justify-content: space-between; margin-bottom: 0.75rem; font-size: 0.9rem; }
              .row:last-child { margin-bottom: 0; }
              .label { color: #94a3b8; }
              .value { font-weight: 600; color: #f8fafc; }
              .amount { font-size: 1.3rem; color: #22c55e; }
              .actions { display: flex; gap: 0.75rem; flex-direction: column; }
              button { width: 100%; padding: 0.85rem; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; }
              .btn-approve { background: #22c55e; color: #022c22; }
              .btn-approve:hover { background: #16a34a; }
              .btn-reject { background: #334155; color: #f8fafc; border: 1px solid #475569; }
              .btn-reject:hover { background: #475569; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Authorize Payment Mandate</h1>
              <p class="desc">Your AI assistant is requesting authorization to make a purchase at <span class="merchant">${manifest.merchant.name}</span>.</p>
              <div class="details">
                <div class="row">
                  <span class="label">Payee:</span>
                  <span class="value">${challenge.payee}</span>
                </div>
                <div class="row">
                  <span class="label">Checkout ID:</span>
                  <span class="value">${challenge.checkout_id}</span>
                </div>
                <div class="row">
                  <span class="label">Total Amount:</span>
                  <span class="value amount">₹${formattedAmount} ${challenge.currency}</span>
                </div>
              </div>
              <div class="actions">
                <form method="POST" action="/consent/${challengeId}/confirm">
                  <button type="submit" class="btn-approve">Approve Autonomous Mandate</button>
                </form>
                <form method="POST" action="/consent/${challengeId}/reject">
                  <button type="submit" class="btn-reject">Reject Mandate & Pay Manually</button>
                </form>
              </div>
            </div>
          </body>
        </html>
      `);
      return;
    }

    res.json({
      challenge_id: challenge.challenge_id,
      transaction_id: challenge.transaction_id,
      checkout_id: challenge.checkout_id,
      amount: challenge.amount,
      currency: challenge.currency,
      payee: challenge.payee,
      expires_at: challenge.expires_at,
    });
  });

  app.post("/consent/:challengeId/confirm", async (req: Request, res: Response) => {
    const mandateStore = context?.mandateStore;
    const txnManager = context?.txnManager;
    const auditLedger = context?.auditLedger;
    if (!mandateStore) {
      res.status(404).json({ error: "Mandate store not available" });
      return;
    }
    const challengeId = req.params.challengeId as string;
    const result = await mandateStore.confirmConsentChallenge(challengeId, manifest.merchant.name);
    if (result.status === "denied") {
      res.status(400).json({ error: result.error });
      return;
    }

    if (txnManager && txnManager.has(result.transaction_id)) {
      const txn = txnManager.get(result.transaction_id);
      txn.authorization_reference = result.authorization_reference;
      if (auditLedger) {
        auditLedger.append(consentGrantedEvent(result.transaction_id, challengeId, result.authorization_reference));
      }
    }

    if (req.headers.accept?.includes("text/html") || req.is("application/x-www-form-urlencoded")) {
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Mandate Approved - ${manifest.merchant.name}</title>
            <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
              <div style="background: #1e293b; padding: 2.5rem; border-radius: 16px; max-width: 480px; text-align: center; border: 1px solid #22c55e;">
                <div style="font-size: 3rem; color: #22c55e; margin-bottom: 1rem;">✓</div>
                <h1 style="margin: 0 0 0.5rem 0; font-size: 1.5rem;">Mandate Approved</h1>
                <p style="color: #94a3b8; line-height: 1.5;">Your payment mandate has been authorized. You can close this window; your AI agent will finalize your purchase.</p>
              </div>
            </body>
          </head>
        </html>
      `);
      return;
    }

    res.json({
      status: "authorized",
      mandate_id: result.payment_mandate.mandate.mandate_id,
      authorization_reference: result.authorization_reference,
      transaction_id: result.transaction_id,
    });
  });

  const handleConsentRejection = async (req: Request, res: Response) => {
    const mandateStore = context?.mandateStore;
    const txnManager = context?.txnManager;
    const auditLedger = context?.auditLedger;
    const paymentAdapter = context?.paymentAdapter;
    if (!mandateStore) {
      res.status(404).json({ error: "Mandate store not available" });
      return;
    }
    const challengeId = req.params.challengeId as string;
    const result = await mandateStore.rejectConsentChallenge(challengeId);
    if (result.status === "denied") {
      res.status(404).json({ error: result.error });
      return;
    }

    const txnId = result.transaction_id;
    let fallbackPaymentUrl: string | undefined;

    if (txnManager && txnManager.has(txnId)) {
      const txn = txnManager.get(txnId);
      if (auditLedger) {
        auditLedger.append(
          consentRejectedEvent(txnId, {
            challenge_id: challengeId,
            rejected_at: new Date().toISOString(),
            reason: result.reason || "User rejected mandate authorization",
          })
        );
      }

      if (paymentAdapter && txn.merchant_verified) {
        try {
          let orderId = txn.payment?.razorpay_order_id;
          if (!orderId) {
            const orderResult = await paymentAdapter.createOrder({
              amount: txn.merchant_verified.total,
              receipt: txnId,
              notes: { transaction_id: txnId, customer_id: txn.customer_id || "" },
              manifestPaymentConfig: manifest.payment,
            });
            orderId = orderResult.order_id;
            if (auditLedger) {
              auditLedger.append(
                paymentOrderCreatedEvent(txnId, {
                  order_id: orderId,
                  amount: txn.merchant_verified.total.amount,
                  currency: txn.merchant_verified.total.currency,
                })
              );
            }
          }

          const linkResult = await paymentAdapter.createPaymentLink({
            amount: txn.merchant_verified.total,
            description: `Manual Payment: ${txn.merchant_verified.title || txn.merchant_verified.sku}`,
            reference_id: txnId,
            order_id: orderId,
            customer: txn.payment?.customer_email || txn.payment?.customer_contact ? {
              email: txn.payment.customer_email,
              contact: txn.payment.customer_contact,
            } : undefined,
            manifestPaymentConfig: manifest.payment,
          });

          fallbackPaymentUrl = linkResult.short_url;

          if (auditLedger) {
            auditLedger.append(
              paymentLinkGeneratedEvent(txnId, {
                payment_link_id: linkResult.payment_link_id,
                short_url: linkResult.short_url,
                amount: txn.merchant_verified.total.amount,
              })
            );
          }

          txnManager.bindPayment(txnId, {
            provider: "razorpay",
            payment_method: "payment_link",
            razorpay_order_id: orderId,
            payment_link_id: linkResult.payment_link_id,
            payment_link_url: linkResult.short_url,
            one_time_payment_url: linkResult.short_url,
            payment_status: "pending",
            customer_id: txn.customer_id,
          });

          txnManager.transition(txnId, TransactionState.PAYMENT_PENDING, "consent_rejected_manual_payment_link_generated");
        } catch (linkErr) {
          console.error("[Consent] Failed to generate fallback payment link:", linkErr);
          txnManager.fail(txnId, "Consent rejected and failed to generate payment link", "consent_broker");
        }
      } else {
        txnManager.fail(txnId, "Consent rejected by user", "consent_broker");
      }
    }

    if (req.headers.accept?.includes("text/html") || req.is("application/x-www-form-urlencoded")) {
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Mandate Rejected - Pay Manually</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2.5rem; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); max-width: 480px; text-align: center; border: 1px solid #f59e0b; }
              h1 { color: #f59e0b; margin: 0 0 0.5rem 0; font-size: 1.4rem; }
              p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin: 0.5rem 0 1.5rem 0; }
              .btn-pay { display: inline-block; background: #38bdf8; color: #082f49; padding: 0.85rem 1.5rem; border-radius: 8px; font-weight: 600; text-decoration: none; transition: background 0.2s; }
              .btn-pay:hover { background: #0284c7; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Mandate Rejected</h1>
              <p>You chose to pay manually. You can complete your purchase using the hosted Razorpay link below:</p>
              ${fallbackPaymentUrl ? `<a href="${fallbackPaymentUrl}" class="btn-pay" target="_blank">Open One-Time Payment Link</a>` : "<p>Please return to your chat assistant.</p>"}
            </div>
          </body>
        </html>
      `);
      return;
    }

    res.json({
      status: "fallback_to_payment_link",
      message: "Mandate rejected by user. A manual one-time payment link has been generated.",
      transaction_id: txnId,
      payment_url: fallbackPaymentUrl,
    });
  };

  app.post("/consent/:challengeId/reject", handleConsentRejection);
  app.post("/consent/:challengeId/deny", handleConsentRejection);

  if (context?.mandateStore) {
    context.mandateStore.setPublicBaseUrl(`http://localhost:${port}`);
  }

  const server = listenWithPortRecovery(app, port, () => {
    console.error(`[MerchantMCP-Auth] OAuth2 Callback listener active on http://localhost:${port}/auth/callback`);
  });

  return {
    app,
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
