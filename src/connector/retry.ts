/**
 * HTTP Retry & Backoff Handler
 * Handles transient failures, network dropouts, rate limiting, and 5xx errors
 * with jittered exponential backoff and standard Retry-After header parsing.
 */

import { HttpConventions } from "../types/manifest.js";

export interface RetryOptions {
  max_retries?: number;
  retryable_status_codes?: number[];
  initial_backoff_ms?: number;
  max_backoff_ms?: number;
  retry_after_header?: string;

  maxRetries?: number;
  retryableStatusCodes?: number[];
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  retryAfterHeader?: string;
}

export interface RetryConfig {
  maxRetries: number;
  retryableStatusCodes: number[];
  initialBackoffMs: number;
  maxBackoffMs: number;
  retryAfterHeader: string;
}

interface ResolvedRetryOptions {
  maxRetries: number;
  retryableStatusCodes: number[];
  initialBackoffMs: number;
  maxBackoffMs: number;
  retryAfterHeader: string;
}

/**
 * Extract retry config from manifest's http_conventions.retry block.
 * Falls back to sensible defaults if not declared.
 */
export function buildRetryConfig(conventions?: HttpConventions): RetryConfig {
  const r = conventions?.retry;
  return {
    maxRetries: r?.max_retries ?? 0,
    retryableStatusCodes: r?.retryable_status_codes ?? [429, 502, 503, 504],
    initialBackoffMs: r?.initial_backoff_ms ?? 1000,
    maxBackoffMs: r?.max_backoff_ms ?? 30000,
    retryAfterHeader: r?.retry_after_header ?? "retry-after",
  };
}

/**
 * Execute a fetch with retry logic and timeout.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config?: RetryConfig | RetryOptions,
  timeoutMs?: number
): Promise<Response> {
  const handler = new RetryHandler(config);
  const resolved = handler.execute(async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
  return resolved as Promise<Response>;
}

export class RetryHandler {
  private options: ResolvedRetryOptions;

  constructor(options?: RetryOptions) {
    this.options = {
      maxRetries: options?.max_retries ?? options?.maxRetries ?? 0,
      retryableStatusCodes: options?.retryable_status_codes ?? options?.retryableStatusCodes ?? [429, 502, 503, 504],
      initialBackoffMs: options?.initial_backoff_ms ?? options?.initialBackoffMs ?? 1000,
      maxBackoffMs: options?.max_backoff_ms ?? options?.maxBackoffMs ?? 30000,
      retryAfterHeader: options?.retry_after_header ?? options?.retryAfterHeader ?? "retry-after",
    };
  }

  async execute<T>(
    fn: (attempt: number) => Promise<Response | T>,
    customOptions?: RetryOptions
  ): Promise<Response | T> {
    const opts: ResolvedRetryOptions = {
      maxRetries: customOptions?.max_retries ?? customOptions?.maxRetries ?? this.options.maxRetries,
      retryableStatusCodes: customOptions?.retryable_status_codes ?? customOptions?.retryableStatusCodes ?? this.options.retryableStatusCodes,
      initialBackoffMs: customOptions?.initial_backoff_ms ?? customOptions?.initialBackoffMs ?? this.options.initialBackoffMs,
      maxBackoffMs: customOptions?.max_backoff_ms ?? customOptions?.maxBackoffMs ?? this.options.maxBackoffMs,
      retryAfterHeader: customOptions?.retry_after_header ?? customOptions?.retryAfterHeader ?? this.options.retryAfterHeader,
    };
    let attempt = 0;

    while (true) {
      attempt++;
      try {
        const result = await fn(attempt);

        // If result is a fetch Response, check status code for retryability
        if (result && typeof (result as Response).status === "number") {
          const res = result as Response;
          if (
            !res.ok &&
            opts.retryableStatusCodes.includes(res.status) &&
            attempt <= opts.maxRetries
          ) {
            const delay = this.calculateDelay(res, attempt, opts);
            await this.sleep(delay);
            continue;
          }
        }

        return result;
      } catch (err) {
        if (attempt <= opts.maxRetries) {
          const delay = this.calculateExponentialDelay(attempt, opts);
          await this.sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }

  private calculateDelay(res: Response, attempt: number, opts: ResolvedRetryOptions): number {
    const headerName = opts.retryAfterHeader.toLowerCase();
    const retryAfter = res.headers.get(headerName);

    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!isNaN(seconds)) {
        return Math.min(seconds * 1000, opts.maxBackoffMs);
      }
      const date = Date.parse(retryAfter);
      if (!isNaN(date)) {
        const diff = date - Date.now();
        if (diff > 0) return Math.min(diff, opts.maxBackoffMs);
      }
    }

    return this.calculateExponentialDelay(attempt, opts);
  }

  private calculateExponentialDelay(attempt: number, opts: ResolvedRetryOptions): number {
    const exp = Math.min(opts.initialBackoffMs * Math.pow(2, attempt - 1), opts.maxBackoffMs);
    // Add 10-25% random jitter
    const jitter = exp * (0.1 + Math.random() * 0.15);
    return Math.min(exp + jitter, opts.maxBackoffMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
