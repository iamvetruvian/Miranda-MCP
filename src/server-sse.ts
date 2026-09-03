import fs from "fs";
import path from "path";
import express, { Request, Response } from "express";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IntegrationManifest } from "./types/manifest.js";
import { ConnectorRuntime } from "./connector/runtime.js";
import { UcpNativeConnector } from "./connector/ucp-native.js";
import { deriveCapabilityMatrix } from "./connector/capabilities.js";
import { buildUcpProfile } from "./ucp/profile.js";
import { AuditLedger } from "./audit/ledger.js";
import { PolicyEngine } from "./policy/engine.js";
import { TransactionManager } from "./transaction/manager.js";
import { RazorpayAdapter } from "./payment/razorpay.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerRefinementTools } from "./tools/refinement.js";
import { registerTransactionTools } from "./tools/transaction.js";
import { startWebhookServer } from "./payment/webhook.js";
import { TransactionState } from "./types/index.js";
import { PersistenceStore, InMemoryStore } from "./persistence/store.js";
import { SqliteStore } from "./persistence/sqlite.js";
import { setRefinementStore, hydrateSearchStates } from "./tools/refinement.js";
import { MandateStore } from "./authz/mandate-store.js";
import { registerMandateTools } from "./tools/mandate.js";
import {
  consentGrantedEvent,
  consentRejectedEvent,
  paymentOrderCreatedEvent,
  paymentLinkGeneratedEvent,
} from "./audit/events.js";

import { SessionStore } from "./auth/session-store.js";
import { OAuth2Handler } from "./auth/oauth2-handler.js";
import { AuthGuard } from "./auth/auth-guard.js";
import { registerAuthTools } from "./tools/auth.js";

import { RateLimiter, AbuseDetector, createRateLimitMiddleware } from "./policy/rate-limit.js";
import { AuditExporter } from "./audit/exporter.js";
import { loadRuntimeConfig } from "./config.js";
import { listenWithPortRecovery } from "./utils/dev-port-killer.js";
import { RecurringTokenStore } from "./payment/token-store.js";

dotenv.config();

export interface SseServerResult {
  app: express.Express;
  close: () => Promise<void>;
  store: PersistenceStore;
  mandateStore: MandateStore;
  sessionStore: SessionStore;
  oauth2Handler: OAuth2Handler | null;
  authGuard: AuthGuard;
  rateLimiter: RateLimiter;
  abuseDetector: AbuseDetector;
  recurringTokenStore: RecurringTokenStore;
  txnManager: TransactionManager;
  auditLedger: AuditLedger;
}

export interface HostedServerOptions {
  port?: number;
  auditLogFile?: string;
  store?: PersistenceStore;
  dbPath?: string;
  skipBootVerification?: boolean;
  mandateSigningSecret?: string;
  authMode?: "mandate" | "mandates" | "none";
  disableWebhookServer?: boolean;
  webhookPort?: number;
  rateLimiter?: RateLimiter;
  abuseDetector?: AbuseDetector;
  auditExporter?: AuditExporter;
  otelEndpoint?: string;
}

/**
 * Starts a hosted MerchantMCP server on the specified port.
 * A fresh McpServer is created per SSE session so the SDK's single-connection
 * constraint does not cause 502s on reconnects or multi-agent scenarios.
 * All stateful infrastructure (TransactionManager, AuditLedger, etc.) is shared.
 */
export function startHostedMerchantMcpServer(
  manifest: IntegrationManifest,
  portOrOptions: number | HostedServerOptions = 3000,
  auditLogFile?: string
): SseServerResult {
  const options: HostedServerOptions =
    typeof portOrOptions === "number"
      ? { port: portOrOptions, auditLogFile }
      : portOrOptions;

  let runtimeConfig;
  try {
    runtimeConfig = loadRuntimeConfig();
  } catch {
    runtimeConfig = null;
  }

  const port = options.port ?? runtimeConfig?.port ?? 3000;
  const dbPath = options.dbPath ?? runtimeConfig?.dbPath ?? process.env.MERCHANTMCP_DB_PATH;
  const store = options.store ?? (dbPath ? new SqliteStore(dbPath) : new InMemoryStore());

  const mandateStore = new MandateStore(
    store,
    options.mandateSigningSecret ?? runtimeConfig?.mandateSigningSecret,
    (options.authMode as any) ?? runtimeConfig?.authMode
  );

  const sessionStore = new SessionStore(store, manifest.auth?.oauth2_user?.session_ttl_seconds);
  const oauth2Handler = manifest.auth?.oauth2_user
    ? new OAuth2Handler(manifest.auth.oauth2_user, sessionStore)
    : null;
  const authGuard = new AuthGuard(manifest, oauth2Handler, sessionStore);
  const recurringTokenStore = new RecurringTokenStore();

  const app = express();
  app.use(express.json());

  // Enable CORS for remote AI clients (Claude.ai, Cursor, browser hosts)
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

  // Diagnostic middleware — logs every inbound request so we can debug tunnel issues
  app.use((req: Request, _res: Response, next) => {
    console.log(`[MerchantMCP-Hosted] ${req.method} ${req.path} | host=${req.headers.host} | fwd-host=${req.headers["x-forwarded-host"]} | fwd-proto=${req.headers["x-forwarded-proto"]} | origin=${req.headers.origin}`);
    next();
  });

  // ── Shared stateful infrastructure (all sessions share this) ────────────────
  const connector =
    (manifest as any).integration?.type === "ucp_native"
      ? (new UcpNativeConnector(manifest) as unknown as ConnectorRuntime)
      : new ConnectorRuntime(manifest);

  const auditLedger = new AuditLedger(options.auditLogFile, {
    checkpointInterval: runtimeConfig?.ledgerCheckpointInterval ?? Number(process.env.LEDGER_CHECKPOINT_INTERVAL ?? 100),
    signingSecret: runtimeConfig?.ledgerSigningSecret ?? process.env.LEDGER_SIGNING_SECRET,
    store,
  });

  const otelUrl = options.otelEndpoint ?? runtimeConfig?.auditExportOtelEndpoint ?? process.env.AUDIT_EXPORT_OTEL_ENDPOINT;
  if (otelUrl) {
    const exporter = options.auditExporter ?? new AuditExporter({ endpointUrl: otelUrl });
    exporter.attach(auditLedger);
  }

  const rateLimiter = options.rateLimiter ?? new RateLimiter({
    defaultBurst: runtimeConfig?.rateLimitBurst ?? 60,
    defaultRefillPerMin: runtimeConfig?.rateLimitRefillPerMin ?? 60,
  });
  const abuseDetector = options.abuseDetector ?? new AbuseDetector();

  const maxLimits = runtimeConfig?.maxTransactionLimits ?? {
    [manifest.merchant.currency]: Number(
      process.env.MAX_TRANSACTION_INR ?? process.env.MAX_TRANSACTION_AMOUNT ?? 500000
    ),
  };

  const policyEngine = new PolicyEngine(
    undefined,
    maxLimits,
    undefined,
    store,
    mandateStore,
    runtimeConfig?.rateLimitEnabled !== false ? rateLimiter : undefined,
    abuseDetector
  );
  const txnManager = new TransactionManager(auditLedger, store);

  // Boot hydration & verification
  if (store instanceof SqliteStore || store instanceof InMemoryStore) {
    const events = store.loadLedgerEventsSync();
    const checkpoints = store.loadCheckpointsSync();
    auditLedger.hydrate(events, checkpoints);

    if (!options.skipBootVerification && events.length > 0) {
      const cpResult = auditLedger.verifyCheckpoints();
      if (!cpResult.valid) {
        throw new Error(`Audit ledger failed integrity verification at boot; refusing to start: ${cpResult.error}`);
      }
      const allEvents = auditLedger.getAllEvents();
      const txnsInLedger = new Set(
        allEvents
          .map((e) => e.transaction_id)
          .filter((id) => id && id !== "__ledger__")
      );
      for (const txnId of txnsInLedger) {
        const chainResult = auditLedger.verifyChain(txnId);
        if (!chainResult.valid) {
          throw new Error(`Audit ledger failed integrity verification at boot; refusing to start: ${chainResult.error}`);
        }
      }
    }

    const txns = store.loadTransactionsSync();
    txnManager.hydrate(txns);

    const tokens = store.loadGateTokensSync();
    policyEngine.hydrate(tokens);

    const states = store.loadSearchStatesSync();
    hydrateSearchStates(states);

    const mandates = store.loadMandatesSync();
    mandateStore.hydrate(mandates as any);

    const sessions = store.loadSessionsSync();
    sessionStore.hydrate(sessions);

    const recurringTokens = store.loadRecurringTokensSync ? store.loadRecurringTokensSync() : [];
    recurringTokenStore.hydrate(recurringTokens);
  }
  setRefinementStore(store);

  const keyId = process.env[manifest.payment.razorpay_key_id_env] ?? "mock_key";
  const keySecret = process.env[manifest.payment.razorpay_key_secret_env] ?? "mock_secret";
  const paymentAdapter = new RazorpayAdapter(keyId, keySecret);

  const transports: Record<string, SSEServerTransport> = {};

  // ── SSE endpoint — creates a fresh McpServer per session ────────────────────
  app.get("/sse", async (req: Request, res: Response) => {
    console.log(`[MerchantMCP-Hosted] Agent connected: ${req.headers["user-agent"]?.slice(0, 60) ?? "unknown"}`);

    // Construct absolute message endpoint URL for remote/tunneled clients
    const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
    const proto = (req.headers["x-forwarded-proto"] as string) || (req.secure ? "https" : "http");
    const messageEndpoint = `${proto}://${host}/message`;

    // Fresh McpServer per session — shares state via captured closures
    const sessionServer = new McpServer({
      name: `MerchantMCP — ${manifest.merchant.name}`,
      version: "0.1.0",
    });

    registerDiscoveryTools(sessionServer, connector, manifest, auditLedger, authGuard);
    registerRefinementTools(sessionServer, connector, auditLedger);
    registerMandateTools(sessionServer, mandateStore, auditLedger);
    registerAuthTools(sessionServer, sessionStore, authGuard, manifest, oauth2Handler, auditLedger);
    registerTransactionTools(sessionServer, connector, txnManager, policyEngine, paymentAdapter, auditLedger, mandateStore, authGuard, recurringTokenStore);

    const transport = new SSEServerTransport(messageEndpoint, res);
    transports[transport.sessionId] = transport;

    transport.onclose = () => {
      console.log(`[MerchantMCP-Hosted] Session ${transport.sessionId} closed`);
      delete transports[transport.sessionId];
    };

    try {
      await sessionServer.connect(transport);
      console.log(`[MerchantMCP-Hosted] Session ${transport.sessionId} ready`);
    } catch (err) {
      console.error(`[MerchantMCP-Hosted] Session connect error:`, err);
      delete transports[transport.sessionId];
    }
  });

  // ── Message endpoint ─────────────────────────────────────────────────────────
  app.post("/message", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];
    if (!transport) {
      res.status(404).json({ error: `Session "${sessionId}" not found or expired.` });
      return;
    }
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      console.error(`[MerchantMCP-Hosted] Message handler error:`, err);
      res.status(500).json({ error: "Internal error processing MCP message" });
    }
  });

  // ── OAuth2 User Authentication Endpoints ────────────────────────────────────
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
              <h1>Authentication Cancelled or Failed</h1>
              <p>${errorDescription || error}</p>
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
          <head><title>Invalid OAuth2 Callback</title></head>
          <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
            <h2>Invalid Request</h2>
            <p>Missing "code" or "state" parameters in callback.</p>
          </body>
        </html>
      `);
      return;
    }

    if (!oauth2Handler) {
      res.status(500).send("OAuth2 handler is not configured for this server.");
      return;
    }

    try {
      const session = await oauth2Handler.handleCallback(code, state);
      res.send(`
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
              ${session.user_name || session.user_id ? `<div class="user-info">Logged in as: <strong>${session.user_name || session.user_id}</strong></div>` : ""}
              <div class="hint">You can close this tab and return to your conversation.</div>
            </div>
          </body>
        </html>
      `);
    } catch (err: unknown) {
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
              <p>${(err as Error).message}</p>
            </div>
          </body>
        </html>
      `);
    }
  });

  app.get("/auth/status", (req: Request, res: Response) => {
    const sessionId = req.query.session_id as string | undefined;
    const session = sessionId
      ? sessionStore.getSession(sessionId)
      : sessionStore.getActiveSession();

    if (session && session.status === "authenticated") {
      res.json({
        authenticated: true,
        session_id: session.session_id,
        user_id: session.user_id,
        user_name: session.user_name,
        session_expires_at: new Date(session.session_expires_at).toISOString(),
      });
    } else {
      res.json({
        authenticated: false,
        session_id: sessionId ?? null,
      });
    }
  });

  // ── Human Consent Endpoints (Mode B JIT Approval & Path 3 Fallback) ────────
  app.get("/consent/:challengeId", (req: Request, res: Response) => {
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
    const challengeId = req.params.challengeId as string;
    const result = await mandateStore.confirmConsentChallenge(
      challengeId,
      manifest.merchant.name
    );
    if (result.status === "denied") {
      res.status(400).json({ error: result.error });
      return;
    }

    if (txnManager.has(result.transaction_id)) {
      const txn = txnManager.get(result.transaction_id);
      txn.authorization_reference = result.authorization_reference;
      auditLedger.append(
        consentGrantedEvent(
          result.transaction_id,
          challengeId,
          result.authorization_reference
        )
      );
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
    const challengeId = req.params.challengeId as string;
    const result = await mandateStore.rejectConsentChallenge(challengeId);

    if (result.status === "denied") {
      res.status(404).json({ error: result.error });
      return;
    }

    const txnId = result.transaction_id;
    let fallbackPaymentUrl: string | undefined;

    if (txnManager.has(txnId)) {
      const txn = txnManager.get(txnId);
      auditLedger.append(
        consentRejectedEvent(txnId, {
          challenge_id: challengeId,
          rejected_at: new Date().toISOString(),
          reason: result.reason || "User rejected mandate authorization",
        })
      );

      // Path 3 Fallback: Generate a manual hosted payment link if checkout exists
      if (txn.merchant_verified) {
        try {
          // 1. Create order if not already created
          let orderId = txn.payment?.razorpay_order_id;
          if (!orderId) {
            const orderResult = await paymentAdapter.createOrder({
              amount: txn.merchant_verified.total,
              receipt: txnId,
              notes: { transaction_id: txnId, customer_id: txn.customer_id || "" },
              manifestPaymentConfig: manifest.payment,
            });
            orderId = orderResult.order_id;
            auditLedger.append(
              paymentOrderCreatedEvent(txnId, {
                order_id: orderId,
                amount: txn.merchant_verified.total.amount,
                currency: txn.merchant_verified.total.currency,
              })
            );
          }

          // 2. Generate Razorpay Payment Link
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

          auditLedger.append(
            paymentLinkGeneratedEvent(txnId, {
              payment_link_id: linkResult.payment_link_id,
              short_url: linkResult.short_url,
              amount: txn.merchant_verified.total.amount,
            })
          );

          // 3. Bind manual payment link and transition to PAYMENT_PENDING
          txnManager.bindPayment(txnId, {
            provider: "razorpay",
            payment_method: "payment_link",
            razorpay_order_id: orderId,
            payment_link_id: linkResult.payment_link_id,
            payment_link_url: linkResult.short_url,
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
              ${fallbackPaymentUrl ? `<a href="${fallbackPaymentUrl}" class="btn-pay" target="_blank">Open Payment Link</a>` : "<p>Please return to your chat assistant.</p>"}
            </div>
          </body>
        </html>
      `);
      return;
    }

    res.json({
      status: "fallback_to_payment_link",
      message: "Mandate rejected by user. A manual payment link has been generated.",
      transaction_id: txnId,
      payment_url: fallbackPaymentUrl,
    });
  };

  app.post("/consent/:challengeId/reject", handleConsentRejection);
  app.post("/consent/:challengeId/deny", handleConsentRejection);

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "healthy",
      merchant: manifest.merchant.name,
      transport: "SSE",
      active_sessions: Object.keys(transports).length,
    });
  });

  // ── UCP Discovery Endpoint (/.well-known/ucp) ──────────────────────────────
  app.get("/.well-known/ucp", (_req: Request, res: Response) => {
    const matrix = deriveCapabilityMatrix(manifest);
    const profile = buildUcpProfile(matrix, manifest);
    res.json(profile);
  });

  const httpServer = listenWithPortRecovery(app, port, () => {
    console.log(`\n══════════════════════════════════════════════════════════════════════`);
    console.log(`  MERCHANT MCP HOSTED SERVER RUNNING (REMOTE SSE TRANSPORT)`);
    console.log(`══════════════════════════════════════════════════════════════════════`);
    console.log(`  Merchant Store   : ${manifest.merchant.name}`);
    console.log(`  Target Backend   : ${manifest.merchant.base_url}`);
    console.log(`  MCP SSE URL      : http://localhost:${port}/sse`);
    console.log(`  Health Endpoint  : http://localhost:${port}/health`);
    console.log(`══════════════════════════════════════════════════════════════════════\n`);
  });

  // Start Razorpay webhook listener if enabled
  let webhookServer: any = undefined;
  if (!options.disableWebhookServer && process.env.DISABLE_WEBHOOK_SERVER !== "true") {
    const webhookPort = options.webhookPort ?? Number(process.env.WEBHOOK_PORT || 3001);
    const webhookSecret = manifest.payment.webhook_secret_env
      ? process.env[manifest.payment.webhook_secret_env]
      : undefined;

    startWebhookServer(txnManager, auditLedger, webhookPort, webhookSecret);
  }

  return {
    app,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
    store,
    mandateStore,
    sessionStore,
    oauth2Handler,
    authGuard,
    rateLimiter,
    abuseDetector,
    recurringTokenStore,
    txnManager,
    auditLedger,
  };
}

/**
 * CLI Entry point for hosted mode
 */
async function main() {
  const manifestPath =
    process.env.MERCHANT_MANIFEST ||
    process.argv[2] ||
    path.resolve(process.cwd(), "demo/merchants/electronics-store/merchant-config.json");

  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest file not found at "${manifestPath}".`);
    process.exit(1);
  }

  const manifest: IntegrationManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const mcpPort = Number(process.env.MCP_PORT || 3000);
  const auditFile = process.env.AUDIT_LOG_FILE || path.resolve(process.cwd(), "audit.jsonl");

  startHostedMerchantMcpServer(manifest, mcpPort, auditFile);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main().catch((err) => {
    console.error("Fatal server error:", err);
    process.exit(1);
  });
}
