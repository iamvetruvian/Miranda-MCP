/**
 * Runtime Configuration & Environment Validation
 * Consolidates and validates all environment variables and server parameters
 * using a strict Zod schema for fail-fast production startup.
 */

import { z } from "zod";

export const RuntimeConfigSchema = z.object({
  /** HTTP server listening port */
  port: z.number().int().min(1).max(65535).default(4000),

  /** HTTP server bind host */
  host: z.string().default("0.0.0.0"),

  /** Optional SQLite database path for persistent durability */
  dbPath: z.string().optional(),

  /** Authorization mode: 'none' (default) or 'mandates' (AP2 Mode A/B) */
  authMode: z.enum(["none", "mandates"]).default("none"),

  /** Secret key used for HMAC signing of mandates (required if authMode === 'mandates') */
  mandateSigningSecret: z.string().optional(),

  /** Secret key used for signing periodic audit ledger checkpoints */
  ledgerSigningSecret: z.string().optional(),

  /** Checkpoint frequency in ledger events (0 disables periodic checkpoints) */
  ledgerCheckpointInterval: z.number().int().nonnegative().default(100),

  /** Per-currency maximum transaction limits in major units (e.g. INR: 500000) */
  maxTransactionLimits: z.record(z.number().positive()).default({ INR: 500000, USD: 6000, EUR: 5000 }),

  /** Rate limiting enabled */
  rateLimitEnabled: z.boolean().default(true),

  /** Default rate limit burst capacity per client identity */
  rateLimitBurst: z.number().int().positive().default(60),

  /** Default rate limit token refill per minute */
  rateLimitRefillPerMin: z.number().int().positive().default(60),

  /** Optional OpenTelemetry / SIEM collector HTTP log endpoint */
  auditExportOtelEndpoint: z.string().url().optional(),

  /** Public base URL for external links (e.g. consent challenge URLs) */
  mcpPublicBaseUrl: z.string().default("http://localhost:4000"),

  /** Stripe credentials */
  stripeSecretKey: z.string().optional(),
  stripePublishableKey: z.string().optional(),
  stripeWebhookSecret: z.string().optional(),
  /** Legacy Razorpay credentials (optional) */
  razorpayKeyId: z.string().optional(),
  razorpayKeySecret: z.string().optional(),
  razorpayWebhookSecret: z.string().optional(),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

/**
 * Parses and validates environment variables into a typed RuntimeConfig.
 * Fails fast with clear actionable error messages if required variables are missing or invalid.
 */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const maxLimits: Record<string, number> = { INR: 500000, USD: 6000, EUR: 5000 };

  // Support MAX_TRANSACTION_LIMITS JSON or individual env vars e.g. MAX_TRANSACTION_INR
  if (env.MAX_TRANSACTION_LIMITS) {
    try {
      const parsed = JSON.parse(env.MAX_TRANSACTION_LIMITS);
      if (typeof parsed === "object" && parsed !== null) {
        Object.assign(maxLimits, parsed);
      }
    } catch {
      // Ignored, fallback to defaults
    }
  }

  for (const [key, val] of Object.entries(env)) {
    if (key.startsWith("MAX_TRANSACTION_") && val) {
      const currency = key.replace("MAX_TRANSACTION_", "").toUpperCase();
      const num = Number(val);
      if (!isNaN(num) && num > 0) {
        maxLimits[currency] = num;
      }
    }
  }

  const rawConfig = {
    port: env.PORT ? Number(env.PORT) : 4000,
    host: env.HOST || "0.0.0.0",
    dbPath: env.MERCHANTMCP_DB_PATH || undefined,
    authMode: (env.AUTH_MODE as any) || "none",
    mandateSigningSecret: env.MANDATE_SIGNING_SECRET || undefined,
    ledgerSigningSecret: env.LEDGER_SIGNING_SECRET || undefined,
    ledgerCheckpointInterval: env.LEDGER_CHECKPOINT_INTERVAL
      ? Number(env.LEDGER_CHECKPOINT_INTERVAL)
      : 100,
    maxTransactionLimits: maxLimits,
    rateLimitEnabled: env.RATE_LIMIT_ENABLED !== "false",
    rateLimitBurst: env.RATE_LIMIT_BURST ? Number(env.RATE_LIMIT_BURST) : 60,
    rateLimitRefillPerMin: env.RATE_LIMIT_REFILL_PER_MIN
      ? Number(env.RATE_LIMIT_REFILL_PER_MIN)
      : 60,
    auditExportOtelEndpoint: env.AUDIT_EXPORT_OTEL_ENDPOINT || undefined,
    mcpPublicBaseUrl: env.MCP_PUBLIC_BASE_URL || `http://localhost:${env.PORT || 4000}`,
    stripeSecretKey: env.STRIPE_SECRET_KEY || undefined,
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || undefined,
    razorpayKeyId: env.RAZORPAY_KEY_ID || undefined,
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET || undefined,
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || undefined,
  };

  const parseResult = RuntimeConfigSchema.safeParse(rawConfig);

  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `[MerchantMCP] Fatal Configuration Error:\n${errorDetails}\nPlease check your environment variables.`
    );
  }

  const config = parseResult.data;

  // Additional cross-field semantic validation
  if (config.authMode === "mandates" && !config.mandateSigningSecret) {
    throw new Error(
      "[MerchantMCP] Fatal Configuration Error: MANDATE_SIGNING_SECRET is required when AUTH_MODE is 'mandates'."
    );
  }

  return config;
}
