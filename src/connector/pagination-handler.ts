/**
 * Strategy-Driven Pagination Handler (Manifest v2)
 * Supports page_number, offset_limit, cursor, link_header, token, and unpaginated strategies.
 */

import { PaginationConfig, PaginationStrategy } from "../types/manifest.js";
import { ResponseMapper } from "./mapper.js";

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

export interface PaginationResultInfo {
  page: number;
  page_size: number;
  has_more: boolean;
  total_count?: number;
  next_cursor?: string;
}

export class PaginationHandler {
  private config: PaginationConfig;
  private responseMapper = new ResponseMapper();

  constructor(config?: PaginationConfig) {
    this.config = config ?? { strategy: "page_number" };
  }

  getStrategy(): PaginationStrategy {
    return this.config.strategy;
  }

  /**
   * Translates canonical page and pageSize into merchant query/body parameters.
   */
  buildParams(params: PaginationParams): Record<string, unknown> {
    const strategy = this.config.strategy;
    const page = params.page ?? this.config.first_page ?? 1;
    const pageSize = params.pageSize ?? this.config.default_page_size ?? 20;

    switch (strategy) {
      case "page_number": {
        const pageParam = this.config.page_param || "page";
        const result: Record<string, unknown> = { [pageParam]: page };
        if (this.config.page_size_param) {
          result[this.config.page_size_param] = pageSize;
        }
        return result;
      }

      case "offset_limit": {
        const offsetParam = this.config.offset_param || "offset";
        const limitParam = this.config.limit_param || "limit";
        const firstPage = this.config.first_page ?? 1;
        const offset = Math.max(0, (page - firstPage) * pageSize);
        return {
          [offsetParam]: offset,
          [limitParam]: pageSize,
        };
      }

      case "cursor": {
        const cursorParam = this.config.cursor_request_param || "cursor";
        const result: Record<string, unknown> = {};
        if (params.cursor) {
          result[cursorParam] = params.cursor;
        }
        if (this.config.page_size_param) {
          result[this.config.page_size_param] = pageSize;
        }
        return result;
      }

      case "token": {
        const tokenParam = this.config.cursor_request_param || "page_token";
        const result: Record<string, unknown> = {};
        if (params.cursor) {
          result[tokenParam] = params.cursor;
        }
        if (this.config.page_size_param) {
          result[this.config.page_size_param] = pageSize;
        }
        return result;
      }

      case "link_header":
      case "none":
      default:
        return {};
    }
  }

  /**
   * Extracts pagination metadata from merchant response body and headers.
   */
  extractMetadata(
    responseBody: unknown,
    itemCount: number,
    currentPage: number = 1,
    headers?: Headers
  ): PaginationResultInfo {
    const pageSize = this.config.default_page_size ?? 20;
    let totalCount: number | undefined;
    let hasMore = false;
    let nextCursor: string | undefined;

    // 1. Total count extraction
    if (this.config.total_count_path && responseBody && typeof responseBody === "object") {
      const extractedTotal = this.responseMapper.resolvePath(
        responseBody,
        this.config.total_count_path
      );
      if (typeof extractedTotal === "number") {
        totalCount = extractedTotal;
      }
    }

    // 2. has_more flag extraction
    if (this.config.has_more_path && responseBody && typeof responseBody === "object") {
      const extractedHasMore = this.responseMapper.resolvePath(
        responseBody,
        this.config.has_more_path
      );
      if (typeof extractedHasMore === "boolean") {
        hasMore = extractedHasMore;
      }
    } else if (totalCount !== undefined) {
      hasMore = currentPage * pageSize < totalCount;
    } else {
      // Slicing heuristic: if returned items equal requested pageSize, assume more exists
      hasMore = itemCount >= pageSize;
    }

    // 3. Cursor extraction
    if (this.config.cursor_response_path && responseBody && typeof responseBody === "object") {
      const extractedCursor = this.responseMapper.resolvePath(
        responseBody,
        this.config.cursor_response_path
      );
      if (typeof extractedCursor === "string") {
        nextCursor = extractedCursor;
      }
    }

    // 4. Link header extraction for link_header strategy
    if (this.config.strategy === "link_header" && headers) {
      const linkHeader = headers.get("link");
      const targetRel = this.config.link_rel || "next";
      if (linkHeader) {
        hasMore = linkHeader.includes(`rel="${targetRel}"`);
      }
    }

    return {
      page: currentPage,
      page_size: pageSize,
      has_more: hasMore,
      total_count: totalCount,
      next_cursor: nextCursor,
    };
  }
}
