/**
 * MCP Refinement Tools
 * Exposes iterative search refinement capabilities (`refine_search`) and
 * refinement option search/pagination (`get_refinement_options`) to AI buyer agents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConnectorRuntime } from "../connector/runtime.js";
import { AuditLedger } from "../audit/ledger.js";
import {
  toolInvokedEvent,
  toolCompletedEvent,
  toolFailedEvent,
  refinementOptionsQueriedEvent,
} from "../audit/events.js";
import { AuditEventType, Refinement, RefinementOption } from "../types/index.js";
import { truncateRefinementOptions } from "../connector/refinements.js";

import { PersistenceStore } from "../persistence/store.js";

export interface SearchStateRecord {
  query: string;
  filters: Record<string, unknown>;
  page: number;
  sort?: string;
  createdAt: string;
  parameters?: Record<string, unknown>;
  refinements: Refinement[];
}

export const SEARCH_STATE_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_SEARCH_STATES = 500;

let refinementStore: PersistenceStore | undefined;

/**
 * Shared in-memory store mapping search_id -> active SearchState.
 * Populated by search_products and refine_search.
 */
export const searchStates = new Map<string, SearchStateRecord>();

export function setRefinementStore(store?: PersistenceStore): void {
  refinementStore = store;
}

export function hydrateSearchStates(states: [string, SearchStateRecord][]): void {
  searchStates.clear();
  for (const [id, state] of states) {
    searchStates.set(id, state);
  }
}

export function recordSearchState(id: string, state: SearchStateRecord): void {
  searchStates.set(id, state);
  if (refinementStore) {
    refinementStore.saveSearchState(id, state).catch((err) => {
      console.error(`[SearchState] Failed to persist search state ${id}:`, err);
    });
  }
}

export function pruneSearchStates(): number {
  const now = Date.now();
  let pruned = 0;
  for (const [id, state] of searchStates) {
    if (now - new Date(state.createdAt).getTime() > SEARCH_STATE_TTL_MS) {
      searchStates.delete(id);
      if (refinementStore) {
        refinementStore.deleteSearchState(id).catch(() => {});
      }
      pruned += 1;
    }
  }
  while (searchStates.size > MAX_SEARCH_STATES) {
    const oldest = [...searchStates.entries()].sort(
      (a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime()
    )[0];
    if (oldest) {
      searchStates.delete(oldest[0]);
      if (refinementStore) {
        refinementStore.deleteSearchState(oldest[0]).catch(() => {});
      }
      pruned += 1;
    }
  }
  return pruned;
}

export function registerRefinementTools(
  server: McpServer,
  connector: ConnectorRuntime,
  auditLedger: AuditLedger
): void {
  // ─── refine_search ────────────────────────────────────────────────────────
  server.tool(
    "refine_search",
    "Refine a previous search by applying discovered facet/filter selections. Returns updated product results and a new set of dynamic refinements valid for the refined search context.",
    {
      search_id: z
        .string()
        .describe("The search_id returned by a previous search_products or refine_search call"),
      filters: z
        .record(z.unknown())
        .describe(
          "Filter selections using discovered refinement keys, e.g. { brand: 'lenovo', price: { min: 20000, max: 80000 } }"
        ),
      page: z.number().optional().default(1).describe("Page number (1-indexed)"),
      sort: z.string().optional().describe("Sort option key (e.g. 'price_asc', 'price_desc')"),
    },
    async (params) => {
      pruneSearchStates();
      const trackId = `refine_tool_${Date.now()}`;
      auditLedger.append(toolInvokedEvent(trackId, "refine_search", params));

      try {
        // Retrieve prior search context
        const prevState = searchStates.get(params.search_id);
        if (!prevState) {
          throw new Error(
            `Search session "${params.search_id}" not found or expired. Initiate a new search with search_products first.`
          );
        }

        // Merge existing filters with new refinements
        const mergedFilters: Record<string, unknown> = {
          ...prevState.filters,
          ...params.filters,
        };

        // Execute refined search
        const page = params.page ?? prevState.page ?? 1;
        const searchResult = await connector.search({
          query: prevState.query,
          parameters: prevState.parameters,
          filters: mergedFilters,
          page,
          sort: params.sort ?? prevState.sort,
        });

        // Store new search state (untruncated refinements)
        recordSearchState(searchResult.search_id, {
          query: prevState.query,
          filters: mergedFilters,
          page,
          sort: params.sort ?? prevState.sort,
          parameters: prevState.parameters,
          createdAt: new Date().toISOString(),
          refinements: searchResult.refinements,
        });

        // Truncate refinement options for agent-facing response
        const truncatedRefinements = truncateRefinementOptions(
          searchResult.refinements,
          connector.getManifest().refinements?.option_pagination
        );

        // Audit the refinement event
        auditLedger.append({
          event_type: AuditEventType.SEARCH_REFINED,
          timestamp: new Date().toISOString(),
          transaction_id: searchResult.search_id,
          actor: { type: "buyer_agent" },
          request: {
            previous_search_id: params.search_id,
            applied_refinements: params.filters,
            merged_filters: mergedFilters,
          },
          response: {
            new_search_id: searchResult.search_id,
            result_count: searchResult.total_results,
            refinement_count: searchResult.refinements.length,
          },
        });

        auditLedger.append(
          toolCompletedEvent(trackId, "refine_search", {
            new_search_id: searchResult.search_id,
            total_results: searchResult.total_results,
          })
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...searchResult, refinements: truncatedRefinements }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        auditLedger.append(toolFailedEvent(trackId, "refine_search", errorMsg));
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: errorMsg }),
            },
          ],
        };
      }
    }
  );

  // ─── get_refinement_options ───────────────────────────────────────────────
  server.tool(
    "get_refinement_options",
    "Search or paginate through the full option list of a refinement whose options were truncated (has_more: true). Use when the agent needs a specific value not shown inline, e.g. query='sam' on the brand facet to find 'Samsung'.",
    {
      search_id: z.string().describe("search_id from the search/refine call that returned the refinement"),
      refinement_key: z.string().describe("The refinement `key` whose options to enumerate"),
      query: z.string().optional().describe("Case-insensitive substring filter on option value or label"),
      page: z.number().int().positive().optional().default(1).describe("Option list page (1-indexed)"),
      page_size: z.number().int().positive().max(100).optional().default(25).describe("Page size (max 100)"),
    },
    async (params) => {
      const trackId = `opt_tool_${Date.now()}`;
      auditLedger.append(toolInvokedEvent(trackId, "get_refinement_options", params));

      try {
        const state = searchStates.get(params.search_id);
        if (!state) {
          throw new Error(`Search session "${params.search_id}" not found or expired. Initiate a new search with search_products first.`);
        }

        const refinement = state.refinements?.find((r) => r.key === params.refinement_key);
        if (!refinement) {
          throw new Error(`Refinement "${params.refinement_key}" not part of search ${params.search_id}.`);
        }

        const page = params.page ?? 1;
        const pageSize = params.page_size ?? 25;

        // 1. Try merchant-side delegation (separate_endpoint + option_query_support)
        const delegated = await connector.searchRefinementOptions({
          searchParams: { query: state.query, filters: state.filters, page: state.page, parameters: state.parameters },
          refinementKey: params.refinement_key,
          query: params.query,
          page,
          pageSize,
        });

        if (delegated) {
          const q = params.query?.toLowerCase();
          const filtered = (delegated.options ?? []).filter(
            (o: RefinementOption) => !q || o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
          );
          const start = (page - 1) * pageSize;
          const slice = filtered.slice(start, start + pageSize);

          const responseData = {
            source: "merchant",
            refinement_key: params.refinement_key,
            total_options: filtered.length,
            page,
            page_size: pageSize,
            has_more: start + pageSize < filtered.length,
            options: slice,
          };

          auditLedger.append(
            refinementOptionsQueriedEvent(
              params.search_id,
              params.refinement_key,
              params.query,
              slice.length
            )
          );
          auditLedger.append(
            toolCompletedEvent(trackId, "get_refinement_options", {
              search_id: params.search_id,
              refinement_key: params.refinement_key,
              returned_count: slice.length,
              source: "merchant",
            })
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(responseData, null, 2),
              },
            ],
          };
        }

        // 2. MCP-side slice of cached full list
        const q = params.query?.toLowerCase();
        const filtered = (refinement.options ?? []).filter(
          (o) => !q || o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
        );
        const start = (page - 1) * pageSize;
        const slice = filtered.slice(start, start + pageSize);

        const responseData = {
          source: "mcp",
          refinement_key: params.refinement_key,
          total_options: filtered.length,
          page,
          page_size: pageSize,
          has_more: start + pageSize < filtered.length,
          options: slice,
        };

        auditLedger.append(
          refinementOptionsQueriedEvent(
            params.search_id,
            params.refinement_key,
            params.query,
            slice.length
          )
        );
        auditLedger.append(
          toolCompletedEvent(trackId, "get_refinement_options", {
            search_id: params.search_id,
            refinement_key: params.refinement_key,
            returned_count: slice.length,
            source: "mcp",
          })
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(responseData, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        auditLedger.append(toolFailedEvent(trackId, "get_refinement_options", errorMsg));
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: errorMsg }),
            },
          ],
        };
      }
    }
  );
}
