/**
 * ErrorParser Unit Tests
 * Tests error categorization, merchant code mapping, status code mapping,
 * and canonical error classification.
 */

import { describe, it, expect } from "vitest";
import { ErrorParser, MerchantApiError } from "../../src/connector/error-parser.js";
import { ErrorMapping, HttpConventions } from "../../src/types/manifest.js";

describe("ErrorParser", () => {
  it("should match merchant-specific error code from code_map first", () => {
    const errorMapping: ErrorMapping = {
      code_map: {
        ERR_SEAT_TAKEN: {
          category: "out_of_stock",
          message: "Selected seat is already reserved.",
          retryable: false,
        },
        ERR_QUOTA_EXCEEDED: {
          category: "rate_limited",
          message: "Rate quota exceeded, please retry shortly.",
          retryable: true,
        },
      },
    };

    const conventions: HttpConventions = {
      error_code_path: "$.code",
      error_message_path: "$.err_msg",
    };

    const parser = new ErrorParser(errorMapping, conventions);

    const parsed = parser.parse(409, {
      code: "ERR_SEAT_TAKEN",
      err_msg: "Seat A12 is locked",
    });

    expect(parsed.category).toBe("out_of_stock");
    expect(parsed.message).toBe("Selected seat is already reserved.");
    expect(parsed.merchantCode).toBe("ERR_SEAT_TAKEN");
    expect(parsed.retryable).toBe(false);
  });

  it("should fall back to status_code_map when code_map does not match", () => {
    const errorMapping: ErrorMapping = {
      status_code_map: {
        404: {
          category: "not_found",
          message: "Product or offer no longer exists.",
          retryable: false,
        },
        429: {
          category: "rate_limited",
          message: "Too many requests to merchant API.",
          retryable: true,
        },
      },
    };

    const parser = new ErrorParser(errorMapping);
    const parsed = parser.parse(404, { error: "Resource not found" });

    expect(parsed.category).toBe("not_found");
    expect(parsed.message).toBe("Product or offer no longer exists.");
    expect(parsed.retryable).toBe(false);
  });

  it("should classify standard HTTP statuses according to default rules when unmapped", () => {
    const parser = new ErrorParser();

    expect(parser.parse(401, "Unauthorized").category).toBe("auth_failed");
    expect(parser.parse(403, "Forbidden").category).toBe("auth_failed");
    expect(parser.parse(404, "Not Found").category).toBe("not_found");
    expect(parser.parse(422, "Unprocessable Entity").category).toBe("invalid_input");
    expect(parser.parse(429, "Rate limit").category).toBe("rate_limited");
    expect(parser.parse(500, "Internal Server Error").category).toBe("server_error");
    expect(parser.parse(503, "Service Unavailable").category).toBe("server_error");
  });

  it("should instantiate MerchantApiError with structured ParsedError", () => {
    const parser = new ErrorParser();
    const parsed = parser.parse(400, { message: "Invalid SKU parameter" });
    const apiError = new MerchantApiError(parsed);

    expect(apiError.name).toBe("MerchantApiError");
    expect(apiError.message).toBe("Invalid SKU parameter");
    expect(apiError.parsed.category).toBe("unknown");
    expect(apiError.parsed.raw).toEqual({ message: "Invalid SKU parameter" });
  });
});
