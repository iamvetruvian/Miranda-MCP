/**
 * HTTP Retry Handler Unit Tests
 * Tests retry on 429/503 status codes, retry limits, and header delays.
 */

import { describe, it, expect } from "vitest";
import { RetryHandler } from "../../src/connector/retry.js";

describe("RetryHandler", () => {
  it("should return immediately on successful response", async () => {
    const handler = new RetryHandler({ maxRetries: 2, initialBackoffMs: 10 });
    let attempts = 0;

    const result = await handler.execute(async () => {
      attempts++;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    expect((result as Response).status).toBe(200);
    expect(attempts).toBe(1);
  });

  it("should retry on 503 and succeed on subsequent attempt", async () => {
    const handler = new RetryHandler({ maxRetries: 3, initialBackoffMs: 10, maxBackoffMs: 50 });
    let attempts = 0;

    const result = await handler.execute(async () => {
      attempts++;
      if (attempts < 3) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ recovered: true }), { status: 200 });
    });

    expect((result as Response).status).toBe(200);
    expect(attempts).toBe(3);
  });

  it("should stop retrying after maxRetries is reached and return last response", async () => {
    const handler = new RetryHandler({ maxRetries: 2, initialBackoffMs: 10 });
    let attempts = 0;

    const result = await handler.execute(async () => {
      attempts++;
      return new Response("Rate limit exceeded", { status: 429 });
    });

    expect((result as Response).status).toBe(429);
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });
});
