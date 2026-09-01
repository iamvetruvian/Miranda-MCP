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
} from "../audit/events.js";
import { TransactionState } from "../types/index.js";

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
    const keyId =
      (manifest.payment.razorpay_key_id_env ? process.env[manifest.payment.razorpay_key_id_env] : undefined) ||
      process.env.RAZORPAY_KEY_ID ||
      "rzp_test_TVVFU5yXYmeSCq";

    const displayAmount = (amount / 100).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment - ${manifest.merchant.name}</title>
        <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          body { background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
          .card { background: #1e293b; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); width: 100%; max-width: 480px; padding: 2rem; }
          .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #334155; }
          .brand { font-size: 1.25rem; font-weight: 700; color: #38bdf8; }
          .badge { background: #0284c7; color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
          .order-summary { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
          .row { display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.9rem; color: #94a3b8; }
          .row.total { border-top: 1px solid #334155; padding-top: 0.5rem; margin-top: 0.5rem; font-size: 1.15rem; font-weight: 700; color: #f8fafc; }
          .btn-pay { width: 100%; padding: 0.85rem; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
          .btn-pay:hover { background: #1d4ed8; }
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
              <span class="badge">Razorpay Secure</span>
            </div>
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
              Pay ₹${displayAmount} with Razorpay
            </button>
            <p class="hint">🔒 Protected by 256-bit Razorpay Payment Gateway</p>
          </div>

          <div class="success-box" id="success-view">
            <div class="icon">✓</div>
            <h2 style="margin-bottom: 0.5rem;">Payment Successful!</h2>
            <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1rem;">Your payment has been verified by Razorpay.</p>
            <div id="payment-ref" style="font-size: 0.8rem; color: #64748b; background: #0f172a; padding: 0.5rem; border-radius: 6px; margin-bottom: 1.5rem;"></div>
            <p style="color: #38bdf8; font-size: 0.85rem;">You can close this window and return to your AI conversation.</p>
          </div>
        </div>

        <script>
          const options = {
            key: "${keyId}",
            amount: ${amount},
            currency: "${currency}",
            name: "${manifest.merchant.name}",
            description: "${desc}",
            order_id: "${orderId}",
            theme: { color: "#2563eb" },
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

          window.onload = function() {
            setTimeout(openRazorpay, 300);
          };
        </script>
      </body>
      </html>
    `);
  });

  // ─── POST /pay/confirm ───────────────────────────────────────────────────
  app.post("/pay/confirm", async (req: Request, res: Response) => {
    const { txn_id, razorpay_payment_id, razorpay_order_id } = req.body;
    const txnManager = context?.txnManager;
    const connector = context?.connector;
    const auditLedger = context?.auditLedger;

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
      }
    }
    res.json({ status: "ok" });
  });

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
