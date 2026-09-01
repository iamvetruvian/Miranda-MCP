/**
 * Rate Limiting & Abuse Detection Unit Tests
 * Tests token bucket algorithms, identity isolation, abuse heuristic triggers,
 * PolicyGate enforcement, and webhook express middleware.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  TokenBucket,
  RateLimiter,
  AbuseDetector,
  RateLimitGate,
  AbuseDetectionGate,
  createRateLimitMiddleware,
} from "../../src/policy/rate-limit.js";
import { Transaction, TransactionState } from "../../src/types/index.js";

function mockTransaction(id = "txn_test_1"): Transaction {
  return {
    transaction_id: id,
    state: TransactionState.CHECKOUT_CREATED,
    created_at: new Date().toISOString(),
    agent_claim: { product_id: "prod_1", quantity: 1, selection_reason: "test" },
    audit_event_ids: [],
  };
}

describe("Rate Limiting Subsystem", () => {
  it("should allow burst and reject once token bucket is exhausted", () => {
    const bucket = new TokenBucket(3, 60); // 3 tokens burst, 60 refill/min (1/sec)
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false); // Exhausted
  });

  it("should isolate rate limits across different client identities in RateLimiter", () => {
    const limiter = new RateLimiter({ defaultBurst: 2, defaultRefillPerMin: 60 });

    // Client A uses 2 tokens
    expect(limiter.checkLimit("client_A", "search").allowed).toBe(true);
    expect(limiter.checkLimit("client_A", "search").allowed).toBe(true);
    expect(limiter.checkLimit("client_A", "search").allowed).toBe(false);

    // Client B has its own bucket intact
    expect(limiter.checkLimit("client_B", "search").allowed).toBe(true);
    expect(limiter.checkLimit("client_B", "search").allowed).toBe(true);
    expect(limiter.checkLimit("client_B", "search").allowed).toBe(false);
  });

  it("should enforce RateLimitGate in policy checks", () => {
    const limiter = new RateLimiter({ defaultBurst: 1, defaultRefillPerMin: 60 });
    const gate = new RateLimitGate(limiter);
    const txn = mockTransaction();

    const passCheck = gate.check(txn, "CREATE_PAYMENT", { client_identity: "agent_1" });
    expect(passCheck.result).toBe("PASS");

    const failCheck = gate.check(txn, "CREATE_PAYMENT", { client_identity: "agent_1" });
    expect(failCheck.result).toBe("FAIL");
    expect(failCheck.detail).toContain("Rate limit exceeded");
  });
});

describe("Abuse Detection Subsystem", () => {
  let detector: AbuseDetector;

  beforeEach(() => {
    detector = new AbuseDetector({
      maxConsecutiveDenials: 3,
      denialWindowMs: 60000,
      maxRefundsPerWindow: 2,
      refundWindowMs: 60000,
      maxOfferGrinds: 2,
    });
  });

  it("should flag a session after reaching consecutive policy denial threshold", () => {
    const sessionId = "session_malicious_agent";

    expect(detector.recordDenial(sessionId).flagged).toBe(false);
    expect(detector.recordDenial(sessionId).flagged).toBe(false);

    const third = detector.recordDenial(sessionId);
    expect(third.flagged).toBe(true);
    expect(third.reason).toContain("Excessive policy denials");

    // AbuseDetectionGate should now fail closed
    const gate = new AbuseDetectionGate(detector);
    const txn = mockTransaction();
    const check = gate.check(txn, "CREATE_PAYMENT", { session_id: sessionId });
    expect(check.result).toBe("FAIL");
    expect(check.detail).toContain("flagged for abuse");
  });

  it("should flag a user following rapid refund storm", () => {
    const userRef = "user_refund_stormer";

    expect(detector.recordRefundAttempt(userRef).flagged).toBe(false);
    expect(detector.recordRefundAttempt(userRef).flagged).toBe(false);

    const third = detector.recordRefundAttempt(userRef);
    expect(third.flagged).toBe(true);
    expect(third.reason).toContain("Refund request storm detected");
  });

  it("should flag a session repeatedly grinding ephemeral offers without purchase", () => {
    const sessionId = "session_quote_grinder";

    expect(detector.recordCheckoutExpiryLoop(sessionId, "ticket_show_1").flagged).toBe(false);

    const second = detector.recordCheckoutExpiryLoop(sessionId, "ticket_show_1");
    expect(second.flagged).toBe(true);
    expect(second.reason).toContain("Ephemeral offer grinding pattern");
  });
});

describe("Rate Limit Express Middleware", () => {
  it("should return HTTP 429 when webhook rate limit is breached", () => {
    const limiter = new RateLimiter({ defaultBurst: 1, defaultRefillPerMin: 60 });
    const middleware = createRateLimitMiddleware(limiter, {
      keyGenerator: () => "mock_ip_1.2.3.4",
    });

    let nextCalled = false;
    const req: any = {};
    const res: any = {
      headers: {},
      statusCode: 200,
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
      },
    };

    // First request passes
    middleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    // Second request blocked with 429
    nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeDefined();
  });
});
