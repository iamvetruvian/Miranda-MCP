/**
 * Pagination Handler Unit Tests
 * Tests page_number, offset_limit, cursor, and link_header pagination strategies.
 */

import { describe, it, expect } from "vitest";
import { PaginationHandler } from "../../src/connector/pagination-handler.js";

describe("PaginationHandler", () => {
  it("should build page_number parameters correctly", () => {
    const handler = new PaginationHandler({
      strategy: "page_number",
      page_param: "page_num",
      page_size_param: "per_page",
      default_page_size: 15,
    });

    const params = handler.buildParams({ page: 3, pageSize: 15 });
    expect(params).toEqual({
      page_num: 3,
      per_page: 15,
    });
  });

  it("should build offset_limit parameters correctly", () => {
    const handler = new PaginationHandler({
      strategy: "offset_limit",
      offset_param: "skip",
      limit_param: "take",
      first_page: 1,
      default_page_size: 20,
    });

    const params = handler.buildParams({ page: 4, pageSize: 20 });
    expect(params).toEqual({
      skip: 60, // (4 - 1) * 20
      take: 20,
    });
  });

  it("should build cursor parameters correctly", () => {
    const handler = new PaginationHandler({
      strategy: "cursor",
      cursor_request_param: "after",
      page_size_param: "limit",
    });

    const params = handler.buildParams({ cursor: "cursor_xyz_789", pageSize: 50 });
    expect(params).toEqual({
      after: "cursor_xyz_789",
      limit: 50,
    });
  });

  it("should extract metadata from response with total_count_path and has_more_path", () => {
    const handler = new PaginationHandler({
      strategy: "page_number",
      total_count_path: "$.meta.total",
      has_more_path: "$.meta.has_next",
      default_page_size: 10,
    });

    const body = {
      items: [1, 2, 3, 4, 5],
      meta: {
        total: 100,
        has_next: true,
      },
    };

    const meta = handler.extractMetadata(body, 5, 1);
    expect(meta.total_count).toBe(100);
    expect(meta.has_more).toBe(true);
    expect(meta.page).toBe(1);
  });
});
