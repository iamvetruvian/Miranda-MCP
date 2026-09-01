/**
 * Rate Limiting & Abuse Detection Subsystem
 * Enforces per-identity token-bucket rate limits at the MCP tool and webhook boundaries,
 * and detects repetitive failure patterns, ephemeral-offer grinding, and refund storms.
 */

import { Request, Response, NextFunction } from "express";
import { PolicyGate } from "./gates.js";
import { Transaction, PolicyCheck } from "../types/index.js";

export interface RateLimitConfig {
  defaultBurst: number;
  defaultRefillPerMin: number;
  toolLimits?: Record<string, { burst: number; refillPerMin: number }>;
}

export class TokenBucket {
  private capacity: number;
  private refillRatePerMs: number;
  private tokens: number;
  private lastRefill: number;

  constructor(burst: number, refillPerMin: number) {
    this.capacity = burst;
    this.refillRatePerMs = refillPerMin / 60000;
    this.tokens = burst;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      const added = elapsed * this.refillRatePerMs;
      this.tokens = Math.min(this.capacity, this.tokens + added);
      this.lastRefill = now;
    }
  }

  tryConsume(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  getMsUntilNextToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const needed = 1 - this.tokens;
    return Math.ceil(needed / this.refillRatePerMs);
  }
}

export class RateLimiter {
  private config: RateLimitConfig;
  private buckets: Map<string, TokenBucket> = new Map();

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      defaultBurst: config?.defaultBurst ?? 60,
      defaultRefillPerMin: config?.defaultRefillPerMin ?? 60,
      toolLimits: config?.toolLimits ?? {
        search_products: { burst: 60, refillPerMin: 60 },
        prepare_purchase: { burst: 15, refillPerMin: 15 },
        request_refund: { burst: 10, refillPerMin: 10 },
      },
    };
  }

  checkLimit(
    identity: string,
    toolName?: string
  ): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const key = `${identity}:${toolName || "default"}`;
    let bucket = this.buckets.get(key);

    if (!bucket) {
      const limits = (toolName && this.config.toolLimits?.[toolName]) || {
        burst: this.config.defaultBurst,
        refillPerMin: this.config.defaultRefillPerMin,
      };
      bucket = new TokenBucket(limits.burst, limits.refillPerMin);
      this.buckets.set(key, bucket);
    }

    const allowed = bucket.tryConsume(1);
    const remaining = bucket.getAvailableTokens();
    const retryAfterMs = allowed ? 0 : bucket.getMsUntilNextToken();

    return { allowed, remaining, retryAfterMs };
  }

  reset(): void {
    this.buckets.clear();
  }
}

export interface AbuseDetectorOptions {
  maxConsecutiveDenials?: number; // e.g. 5 consecutive policy denials
  denialWindowMs?: number; // e.g. 5 minutes
  maxRefundsPerWindow?: number; // e.g. 5 refunds in 1 minute
  refundWindowMs?: number; // e.g. 1 minute
  maxOfferGrinds?: number; // e.g. 3 expired quotes without purchase
}

export class AbuseDetector {
  private options: Required<AbuseDetectorOptions>;
  private denialHistory: Map<string, number[]> = new Map();
  private refundHistory: Map<string, number[]> = new Map();
  private offerGrinds: Map<string, { productId: string; timestamp: number }[]> = new Map();
  private flaggedSessions: Map<string, { reason: string; flaggedAt: string }> = new Map();

  constructor(options?: AbuseDetectorOptions) {
    this.options = {
      maxConsecutiveDenials: options?.maxConsecutiveDenials ?? 5,
      denialWindowMs: options?.denialWindowMs ?? 5 * 60 * 1000,
      maxRefundsPerWindow: options?.maxRefundsPerWindow ?? 5,
      refundWindowMs: options?.refundWindowMs ?? 60 * 1000,
      maxOfferGrinds: options?.maxOfferGrinds ?? 3,
    };
  }

  recordDenial(sessionId: string): { flagged: boolean; reason?: string } {
    const now = Date.now();
    const windowStart = now - this.options.denialWindowMs;
    const timestamps = (this.denialHistory.get(sessionId) ?? []).filter((t) => t >= windowStart);
    timestamps.push(now);
    this.denialHistory.set(sessionId, timestamps);

    if (timestamps.length >= this.options.maxConsecutiveDenials) {
      const reason = `Excessive policy denials (${timestamps.length} within ${this.options.denialWindowMs / 1000}s)`;
      this.flaggedSessions.set(sessionId, { reason, flaggedAt: new Date().toISOString() });
      return { flagged: true, reason };
    }

    return { flagged: false };
  }

  recordSuccess(sessionId: string): void {
    // A successful purchase resets consecutive denial history
    this.denialHistory.delete(sessionId);
  }

  recordRefundAttempt(userRef: string): { flagged: boolean; reason?: string } {
    const now = Date.now();
    const windowStart = now - this.options.refundWindowMs;
    const timestamps = (this.refundHistory.get(userRef) ?? []).filter((t) => t >= windowStart);
    timestamps.push(now);
    this.refundHistory.set(userRef, timestamps);

    if (timestamps.length > this.options.maxRefundsPerWindow) {
      const reason = `Refund request storm detected (${timestamps.length} attempts in ${this.options.refundWindowMs / 1000}s)`;
      this.flaggedSessions.set(userRef, { reason, flaggedAt: new Date().toISOString() });
      return { flagged: true, reason };
    }

    return { flagged: false };
  }

  recordCheckoutExpiryLoop(
    sessionId: string,
    productId: string
  ): { flagged: boolean; reason?: string } {
    const now = Date.now();
    const windowStart = now - 15 * 60 * 1000;
    const records = (this.offerGrinds.get(sessionId) ?? []).filter(
      (r) => r.timestamp >= windowStart && r.productId === productId
    );
    records.push({ productId, timestamp: now });
    this.offerGrinds.set(sessionId, records);

    if (records.length >= this.options.maxOfferGrinds) {
      const reason = `Ephemeral offer grinding pattern detected on item ${productId} (${records.length} expired holds)`;
      this.flaggedSessions.set(sessionId, { reason, flaggedAt: new Date().toISOString() });
      return { flagged: true, reason };
    }

    return { flagged: false };
  }

  isFlagged(sessionId: string): { flagged: boolean; reason?: string } {
    const record = this.flaggedSessions.get(sessionId);
    if (record) {
      return { flagged: true, reason: record.reason };
    }
    return { flagged: false };
  }

  reset(): void {
    this.denialHistory.clear();
    this.refundHistory.clear();
    this.offerGrinds.clear();
    this.flaggedSessions.clear();
  }
}

/**
 * RateLimitGate
 * Evaluates token bucket limits inside the deterministic PolicyEngine.
 */
export class RateLimitGate implements PolicyGate {
  readonly name = "RateLimitGate";
  private rateLimiter: RateLimiter;

  constructor(rateLimiter: RateLimiter) {
    this.rateLimiter = rateLimiter;
  }

  check(txn: Transaction, action: string, context?: Record<string, unknown>): PolicyCheck {
    const identity = String(context?.client_identity ?? context?.session_id ?? "global_agent");
    const { allowed, remaining, retryAfterMs } = this.rateLimiter.checkLimit(identity, action);

    if (!allowed) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Rate limit exceeded for client "${identity}" on action "${action}". Retry after ${Math.ceil(
          retryAfterMs / 1000
        )}s`,
      };
    }

    return {
      gate: this.name,
      result: "PASS",
      detail: `Rate limit check passed (${remaining} tokens remaining)`,
    };
  }
}

/**
 * AbuseDetectionGate
 * Deterministically blocks flagged agent sessions or abusive patterns inside the PolicyEngine.
 */
export class AbuseDetectionGate implements PolicyGate {
  readonly name = "AbuseDetectionGate";
  private abuseDetector: AbuseDetector;

  constructor(abuseDetector: AbuseDetector) {
    this.abuseDetector = abuseDetector;
  }

  check(txn: Transaction, action: string, context?: Record<string, unknown>): PolicyCheck {
    const identity = String(context?.client_identity ?? context?.session_id ?? txn.transaction_id);
    const { flagged, reason } = this.abuseDetector.isFlagged(identity);

    if (flagged) {
      return {
        gate: this.name,
        result: "FAIL",
        detail: `Agent session "${identity}" is flagged for abuse: ${reason}`,
      };
    }

    return {
      gate: this.name,
      result: "PASS",
      detail: "Abuse detection check passed: session in good standing",
    };
  }
}

/**
 * Express middleware for webhook endpoints.
 */
export function createRateLimitMiddleware(
  rateLimiter: RateLimiter,
  options?: { keyGenerator?: (req: Request) => string }
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const keyGen =
      options?.keyGenerator ||
      ((r: Request) => r.ip || r.socket.remoteAddress || "webhook_client");
    const clientKey = keyGen(req);

    const { allowed, remaining, retryAfterMs } = rateLimiter.checkLimit(clientKey, "webhook");

    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (!allowed) {
      res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit exceeded. Please retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      });
      return;
    }

    next();
  };
}
