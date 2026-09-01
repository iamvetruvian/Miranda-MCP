/**
 * Merchant Error Parser
 * Parses non-OK HTTP responses into canonical error structures using the manifest's
 * declared error_mapping and http_conventions paths.
 */

import { ErrorMapping, HttpConventions } from "../types/manifest.js";
import { ResponseMapper } from "./mapper.js";

export type CanonicalErrorCategory =
  | "out_of_stock"
  | "invalid_input"
  | "payment_failed"
  | "not_found"
  | "rate_limited"
  | "auth_failed"
  | "server_error"
  | "checkout_expired"
  | "order_cancelled"
  | "refund_failed"
  | "variant_required"
  | "quantity_exceeded"
  | "region_unavailable"
  | "time_slot_unavailable"
  | "coupon_invalid"
  | "minimum_order_not_met"
  | "transient"
  | "unknown";

export interface ParsedError {
  category: CanonicalErrorCategory;
  message: string;
  merchantCode?: string;
  retryable: boolean;
  raw: unknown;
}

export class MerchantApiError extends Error {
  public readonly parsed: ParsedError;

  constructor(parsed: ParsedError) {
    super(parsed.message);
    this.name = "MerchantApiError";
    this.parsed = parsed;
    Object.setPrototypeOf(this, MerchantApiError.prototype);
  }
}

/**
 * Parses merchant HTTP error responses into canonical error structures.
 * Uses the manifest's error_mapping to categorize errors, and
 * http_conventions.error_message_path / error_code_path to extract details.
 */
export class ErrorParser {
  private mapper = new ResponseMapper();
  private errorMapping?: ErrorMapping;
  private messagePath?: string;
  private codePath?: string;
  private validationPath?: string;

  constructor(errorMapping?: ErrorMapping, conventions?: HttpConventions) {
    this.errorMapping = errorMapping;
    this.messagePath = conventions?.error_message_path;
    this.codePath = conventions?.error_code_path;
    this.validationPath = conventions?.validation_errors_path;
  }

  /**
   * Parse a non-OK HTTP response into a structured error.
   */
  parse(statusCode: number, body: unknown): ParsedError {
    // 1. Try to extract merchant error code
    const rawCode = this.codePath ? this.mapper.resolvePath(body, this.codePath) : undefined;
    const merchantCode = rawCode !== undefined && rawCode !== null ? String(rawCode) : undefined;

    // 2. Try to extract message
    let message: string | undefined = undefined;
    if (this.messagePath) {
      const resolved = this.mapper.resolvePath(body, this.messagePath);
      if (resolved !== undefined && resolved !== null) {
        message = String(resolved);
      }
    }

    if (!message) {
      if (typeof body === "string" && body.trim()) {
        message = body;
      } else if (body && typeof body === "object") {
        if ("message" in (body as Record<string, unknown>)) {
          message = String((body as Record<string, unknown>).message);
        } else if ("error" in (body as Record<string, unknown>)) {
          const errVal = (body as Record<string, unknown>).error;
          message = typeof errVal === "string" ? errVal : JSON.stringify(errVal);
        } else {
          message = JSON.stringify(body);
        }
      } else {
        message = `HTTP ${statusCode}`;
      }
    }

    // 3. Try code_map first (merchant-specific error codes)
    if (merchantCode && this.errorMapping?.code_map?.[merchantCode]) {
      const mapping = this.errorMapping.code_map[merchantCode];
      return {
        category: (mapping.category as CanonicalErrorCategory) ?? "unknown",
        message: mapping.message ?? message,
        merchantCode,
        retryable: mapping.retryable ?? false,
        raw: body,
      };
    }

    // 4. Fall back to status_code_map
    if (this.errorMapping?.status_code_map?.[statusCode]) {
      const mapping = this.errorMapping.status_code_map[statusCode];
      return {
        category: (mapping.category as CanonicalErrorCategory) ?? "unknown",
        message: mapping.message ?? message,
        merchantCode,
        retryable: mapping.retryable ?? false,
        raw: body,
      };
    }

    // 5. Default classification by HTTP status
    return {
      category: this.defaultCategory(statusCode),
      message: message || `HTTP ${statusCode}`,
      merchantCode,
      retryable: statusCode === 429 || statusCode >= 500,
      raw: body,
    };
  }

  private defaultCategory(status: number): CanonicalErrorCategory {
    if (status === 401 || status === 403) return "auth_failed";
    if (status === 404) return "not_found";
    if (status === 409) return "invalid_input";
    if (status === 422) return "invalid_input";
    if (status === 429) return "rate_limited";
    if (status >= 500) return "server_error";
    return "unknown";
  }
}
