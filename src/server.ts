/**
 * MerchantMCP Main Server Entry Point
 * Exposes discovery, transaction, policy gating, and audit tools over Model Context Protocol (MCP).
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { IntegrationManifest } from "./types/manifest.js";
import { ConnectorRuntime } from "./connector/runtime.js";
import { UcpNativeConnector } from "./connector/ucp-native.js";
import { AuditLedger } from "./audit/ledger.js";
import { PolicyEngine } from "./policy/engine.js";
import { TransactionManager } from "./transaction/manager.js";
import { RazorpayAdapter } from "./payment/razorpay.js";
import { startWebhookServer } from "./payment/webhook.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerRefinementTools } from "./tools/refinement.js";
import { registerTransactionTools } from "./tools/transaction.js";
import {
  deriveCapabilityMatrix,
  classifyIntegrationLevel,
  CapabilityStatus,
} from "./connector/capabilities.js";
import { CurrencyConsistencyGate } from "./policy/gates.js";

import { PersistenceStore, InMemoryStore } from "./persistence/store.js";
import { SqliteStore } from "./persistence/sqlite.js";
import { setRefinementStore, hydrateSearchStates } from "./tools/refinement.js";

import { MandateStore } from "./authz/mandate-store.js";
import { registerMandateTools } from "./tools/mandate.js";

import { SessionStore } from "./auth/session-store.js";
import { OAuth2Handler } from "./auth/oauth2-handler.js";
import { AuthGuard } from "./auth/auth-guard.js";
import { registerAuthTools } from "./tools/auth.js";
import { startAuthCallbackServer } from "./auth/callback-server.js";

import { RateLimiter, AbuseDetector } from "./policy/rate-limit.js";
import { AuditExporter } from "./audit/exporter.js";
import { loadRuntimeConfig } from "./config.js";

// Load environment variables from cwd and known fallback paths
dotenv.config();
const fallbackEnvPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
  "/home/vetruvian/Desktop/MerchantMCP/.env",
  "/home/vetruvian/Desktop/MerchantMCP/demo/merchants/proshop-v2/.env",
];
for (const envPath of fallbackEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

export interface CreateServerOptions {
  auditLogFile?: string;
  forceSimulation?: boolean;
  store?: PersistenceStore;
  dbPath?: string;
  skipBootVerification?: boolean;
  mandateSigningSecret?: string;
  authMode?: "mandate" | "mandates" | "none";
  rateLimiter?: RateLimiter;
  abuseDetector?: AbuseDetector;
  auditExporter?: AuditExporter;
  otelEndpoint?: string;
}

export interface ServerInstance {
  server: McpServer;
  connector: ConnectorRuntime;
  auditLedger: AuditLedger;
  policyEngine: PolicyEngine;
  txnManager: TransactionManager;
  paymentAdapter: RazorpayAdapter;
  manifest: IntegrationManifest;
  store: PersistenceStore;
  mandateStore: MandateStore;
  sessionStore: SessionStore;
  oauth2Handler: OAuth2Handler | null;
  authGuard: AuthGuard;
  rateLimiter: RateLimiter;
  abuseDetector: AbuseDetector;
}

/**
 * Creates and configures a MerchantMCP server instance.
 */
export function createMerchantMcpServer(
  manifest: IntegrationManifest,
  optionsOrAuditLogFile?: string | CreateServerOptions,
  forceSimulation?: boolean
): ServerInstance {
  const options: CreateServerOptions =
    typeof optionsOrAuditLogFile === "string"
      ? { auditLogFile: optionsOrAuditLogFile, forceSimulation }
      : (optionsOrAuditLogFile ?? { forceSimulation });

  let runtimeConfig;
  try {
    runtimeConfig = loadRuntimeConfig();
  } catch {
    runtimeConfig = null;
  }

  // Fail fast: a manifest below "transactable" cannot serve the core promise
  const matrix = deriveCapabilityMatrix(manifest);
  const level = classifyIntegrationLevel(matrix);
  if (level === "incompatible" || level === "discoverable") {
    const missing = Object.entries(matrix)
      .filter(([, s]) => !s.supported && (s as CapabilityStatus).required_for_transactable)
      .map(([k]) => k);
    throw new Error(
      `Integration manifest is only "${level}". Missing operations for: ${missing.join(", ")}. ` +
      `Required for transactable: search, get_product, create_checkout, confirm_order.`
    );
  }

  // Determine persistence store
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
  policyEngine.registerGate(new CurrencyConsistencyGate(manifest.merchant.currency));

  const txnManager = new TransactionManager(auditLedger, store);

  // ─── Boot Hydration & Integrity Gate ──────────────────────────────────────────
  if (store instanceof SqliteStore || store instanceof InMemoryStore) {
    // 1. Hydrate ledger first
    const events = store.loadLedgerEventsSync();
    const checkpoints = store.loadCheckpointsSync();
    auditLedger.hydrate(events, checkpoints);

    // 2. Re-verify ledger integrity at boot
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

    // 3. Hydrate transactions
    const txns = store.loadTransactionsSync();
    txnManager.hydrate(txns);

    // 4. Hydrate gate tokens
    const tokens = store.loadGateTokensSync();
    policyEngine.hydrate(tokens);

    // 5. Hydrate search states
    const states = store.loadSearchStatesSync();
    hydrateSearchStates(states);

    // 6. Hydrate mandates
    const mandates = store.loadMandatesSync();
    mandateStore.hydrate(mandates as any);

    // 7. Hydrate user sessions
    const sessions = store.loadSessionsSync();
    sessionStore.hydrate(sessions);
  }
  setRefinementStore(store);

  // Resolve Razorpay credentials from environment
  const keyId =
    process.env[manifest.payment.razorpay_key_id_env] ??
    process.env.RAZORPAY_KEY_ID ??
    "rzp_test_TVVFU5yXYmeSCq";
  const keySecret =
    process.env[manifest.payment.razorpay_key_secret_env] ??
    process.env.RAZORPAY_KEY_SECRET ??
    "TVuHVs0k8UJFW2gmhmTOYzPk";

  const paymentAdapter = new RazorpayAdapter(keyId, keySecret, options.forceSimulation);

  const server = new McpServer({
    name: `MerchantMCP — ${manifest.merchant.name}`,
    version: "0.1.0",
  });

  // Register tools
  registerDiscoveryTools(server, connector, manifest, auditLedger, authGuard);
  registerRefinementTools(server, connector, auditLedger);
  registerMandateTools(server, mandateStore, auditLedger);
  registerAuthTools(server, sessionStore, authGuard, manifest, oauth2Handler, auditLedger);
  registerTransactionTools(server, connector, txnManager, policyEngine, paymentAdapter, auditLedger, mandateStore, authGuard);

  return {
    server,
    connector,
    auditLedger,
    policyEngine,
    txnManager,
    paymentAdapter,
    manifest,
    store,
    mandateStore,
    sessionStore,
    oauth2Handler,
    authGuard,
    rateLimiter,
    abuseDetector,
  };
}

/**
 * CLI Execution Entry Point
 */
async function main() {
  // Ensure standard output is strictly reserved for MCP JSON-RPC protocol transport.
  // Divert standard console logging to stderr to prevent stdout pollution for connected AI agents.
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  console.debug = (...args: unknown[]) => console.error(...args);

  const manifestPath =
    process.env.MERCHANT_MANIFEST ||
    process.argv[2] ||
    path.resolve(process.cwd(), "merchant-config.json");

  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest file not found at "${manifestPath}". Set MERCHANT_MANIFEST or pass path as arg.`);
    process.exit(1);
  }

  let manifest: IntegrationManifest;
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    manifest = JSON.parse(raw);
  } catch (err: unknown) {
    console.error(`Error reading manifest file "${manifestPath}":`, (err as Error).message);
    process.exit(1);
  }

  const { server, connector, txnManager, auditLedger, oauth2Handler } = createMerchantMcpServer(
    manifest,
    {
      auditLogFile: process.env.AUDIT_LOG_FILE || path.resolve(process.cwd(), "audit.jsonl"),
      dbPath: process.env.MERCHANTMCP_DB_PATH ?? path.resolve(process.cwd(), "merchant.db"),
    }
  );

  // Start OAuth2 and Hosted Payment listener for stdio mode
  if (oauth2Handler || manifest.payment) {
    let callbackPort = 3002;
    if (manifest.auth?.oauth2_user?.redirect_uri) {
      try {
        const parsed = new URL(manifest.auth.oauth2_user.redirect_uri);
        if (parsed.port) callbackPort = Number(parsed.port);
      } catch { }
    }
    callbackPort = Number(process.env.AUTH_CALLBACK_PORT || callbackPort);
    startAuthCallbackServer(oauth2Handler, manifest, callbackPort, {
      txnManager,
      connector,
      auditLedger,
    });
  }

  // Start Razorpay webhook listener if enabled
  if (process.env.DISABLE_WEBHOOK_SERVER !== "true") {
    const webhookPort = Number(process.env.WEBHOOK_PORT || 3001);
    const webhookSecret = manifest.payment.webhook_secret_env
      ? process.env[manifest.payment.webhook_secret_env]
      : undefined;

    startWebhookServer(txnManager, auditLedger, webhookPort, webhookSecret);
  }

  // Connect over standard I/O transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run if executed directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main().catch((err) => {
    console.error("Fatal server error:", err);
    process.exit(1);
  });
}
