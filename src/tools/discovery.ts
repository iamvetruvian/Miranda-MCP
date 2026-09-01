/**
 * MCP Discovery Tools
 * Exposes product search, lookup, and merchant metadata capabilities to AI buyer agents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConnectorRuntime } from "../connector/runtime.js";
import { AuditLedger } from "../audit/ledger.js";
import { IntegrationManifest } from "../types/manifest.js";
import { MerchantInfo, Refinement } from "../types/index.js";
import {
  toolInvokedEvent,
  toolCompletedEvent,
  toolFailedEvent,
  searchExecutedEvent,
} from "../audit/events.js";
import { searchStates, pruneSearchStates, recordSearchState } from "./refinement.js";
import { truncateRefinementOptions } from "../connector/refinements.js";
import { deriveCapabilityMatrix, classifyIntegrationLevel } from "../connector/capabilities.js";
import { ResponseMapper } from "../connector/mapper.js";
import { AuthGuard } from "../auth/auth-guard.js";

export function registerDiscoveryTools(
  server: McpServer,
  connector: ConnectorRuntime,
  manifest: IntegrationManifest,
  auditLedger: AuditLedger,
  authGuard?: AuthGuard
): void {
  const mapper = new ResponseMapper();

  // ─── search_products ────────────────────────────────────────────────────────
  server.tool(
    "search_products",
    "Search the merchant's catalog. Returns matching offers (any commerce domain: products, rides, " +
    "tickets, bookings...), pricing, availability, and dynamically discovered refinements. Supply " +
    "`parameters` as declared in get_merchant_info → discovery_schema for non-retail domains.",
    {
      query: z.string().describe("Search keywords or item description ('what')"),
      parameters: z
        .record(z.unknown())
        .optional()
        .describe(
          "Domain-specific discovery inputs ('where/when'), e.g. { city: 'Mumbai', date: '2026-09-01' }. Keys per discovery_schema."
        ),
      filters: z
        .record(z.unknown())
        .optional()
        .describe("Key-value filter selections, e.g. { category: 'laptop', brand: 'lenovo' }"),
      page: z.number().optional().default(1).describe("Page number (1-indexed)"),
      sort: z.string().optional().describe("Sort option key (e.g. 'price_asc', 'price_desc', 'relevance')"),
      session_id: z.string().optional().describe("Optional active session ID for authenticated search"),
    },
    async (params) => {
      pruneSearchStates();
      const searchTrackId = `srch_tool_${Date.now()}`;
      auditLedger.append(toolInvokedEvent(searchTrackId, "search_products", params));

      let sessionToken: string | undefined = undefined;
      if (authGuard) {
        const authResult = await authGuard.check("search", params.session_id);
        if (!authResult.authorized && authResult.auth_required_response) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(authResult.auth_required_response, null, 2),
              },
            ],
          };
        }
        sessionToken = authResult.access_token;
      }

      // Validate required discovery parameters declared in manifest
      const schema = manifest.discovery?.input_schema ?? [];
      const missing = schema
        .filter((s) => s.required)
        .filter((s) => params.parameters?.[s.name] === undefined)
        .map((s) => s.name);

      if (missing.length > 0) {
        auditLedger.append(
          toolFailedEvent(
            searchTrackId,
            "search_products",
            `Missing required discovery parameters: ${missing.join(", ")}`
          )
        );
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Missing required discovery parameters: ${missing.join(", ")}`,
                  discovery_schema: schema,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        const searchResult = await connector.search({ ...params, sessionToken });

        // Record search state for subsequent refine_search and get_refinement_options calls
        recordSearchState(searchResult.search_id, {
          query: params.query,
          parameters: params.parameters ?? {},
          filters: params.filters ?? {},
          page: params.page ?? 1,
          sort: params.sort,
          createdAt: new Date().toISOString(),
          refinements: searchResult.refinements,
        });

        // Truncate refinement options for agent-facing search responses
        const truncatedRefinements = truncateRefinementOptions(
          searchResult.refinements,
          manifest.refinements?.option_pagination
        );

        auditLedger.append(
          searchExecutedEvent(
            searchResult.search_id,
            params.query,
            searchResult.total_results,
            params.filters
          )
        );

        auditLedger.append(
          toolCompletedEvent(searchTrackId, "search_products", {
            search_id: searchResult.search_id,
            result_count: searchResult.total_results,
            refinement_count: searchResult.refinements.length,
          })
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...searchResult,
                  refinements: truncatedRefinements,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        auditLedger.append(toolFailedEvent(searchTrackId, "search_products", errorMsg));
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

  // ─── get_product ────────────────────────────────────────────────────────────
  server.tool(
    "get_product",
    "Retrieve full, canonical details of a specific product/offer by its ID.",
    {
      product_id: z.string().describe("The merchant's product or offer ID (e.g. SKU or ISBN)"),
      session_id: z.string().optional().describe("Optional active session ID for authenticated access"),
    },
    async (params) => {
      const trackId = `lookup_${params.product_id}`;
      auditLedger.append(toolInvokedEvent(trackId, "get_product", params));

      let sessionToken: string | undefined = undefined;
      if (authGuard) {
        const authResult = await authGuard.check("get_product", params.session_id);
        if (!authResult.authorized && authResult.auth_required_response) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(authResult.auth_required_response, null, 2),
              },
            ],
          };
        }
        sessionToken = authResult.access_token;
      }

      try {
        const offer = await connector.getProduct(params.product_id, sessionToken);
        auditLedger.append(toolCompletedEvent(trackId, "get_product", { offer_id: offer.offer_id }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(offer, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        auditLedger.append(toolFailedEvent(trackId, "get_product", errorMsg));
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
  // ─── browse_categories ──────────────────────────────────────────────────────
  server.tool(
    "browse_categories",
    "Browse the merchant's category hierarchy. Use for merchants where discovery starts by navigating categories rather than free-text search.",
    {
      parent_category_id: z
        .string()
        .optional()
        .describe("Parent category ID to browse children of. Omit for root categories."),
    },
    async (params) => {
      const trackId = `cat_${Date.now()}`;
      auditLedger.append(toolInvokedEvent(trackId, "browse_categories", params));

      const intent = manifest.intent;
      if (!intent?.category_tree) {
        auditLedger.append(toolFailedEvent(trackId, "browse_categories", "Category browsing not supported by this merchant"));
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "This merchant does not support category browsing.",
                suggestion: "Use search_products instead.",
              }),
            },
          ],
        };
      }

      try {
        const treeConfig = intent.category_tree;
        const requestParams: Record<string, unknown> = {};
        if (params.parent_category_id) {
          requestParams.parent_id = params.parent_category_id;
        }

        const rawResponse = await connector.executeOperationFromConfig(
          treeConfig.operation,
          requestParams,
          "browse_categories"
        );

        const rawCategories = (treeConfig.categories_path
          ? mapper.resolvePath(rawResponse, treeConfig.categories_path)
          : rawResponse) as unknown[];

        const categories = (Array.isArray(rawCategories) ? rawCategories : []).map((cat: unknown) => ({
          id: treeConfig.category_mapping?.id_path
            ? mapper.resolvePath(cat, treeConfig.category_mapping.id_path)
            : (cat as any)?.id,
          name: treeConfig.category_mapping?.name_path
            ? mapper.resolvePath(cat, treeConfig.category_mapping.name_path)
            : (cat as any)?.name,
          children: treeConfig.category_mapping?.children_path
            ? mapper.resolvePath(cat, treeConfig.category_mapping.children_path)
            : undefined,
          image_url: treeConfig.category_mapping?.image_url_path
            ? mapper.resolvePath(cat, treeConfig.category_mapping.image_url_path)
            : undefined,
          product_count: treeConfig.category_mapping?.product_count_path
            ? mapper.resolvePath(cat, treeConfig.category_mapping.product_count_path)
            : undefined,
        }));

        auditLedger.append(toolCompletedEvent(trackId, "browse_categories", { count: categories.length }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  categories,
                  usable_as_filter: treeConfig.usable_as_filter ?? true,
                  filter_key: treeConfig.filter_key ?? "category",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        auditLedger.append(toolFailedEvent(trackId, "browse_categories", errorMsg));
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: errorMsg }) }],
        };
      }
    }
  );

  // ─── autocomplete ───────────────────────────────────────────────────────────
  server.tool(
    "autocomplete",
    "Get search suggestions as the user types. Returns typeahead suggestions.",
    {
      query: z.string().describe("Partial search text"),
    },
    async (params) => {
      const trackId = `ac_${Date.now()}`;
      auditLedger.append(toolInvokedEvent(trackId, "autocomplete", params));

      const config = manifest.intent?.autocomplete;
      if (!config) {
        auditLedger.append(toolFailedEvent(trackId, "autocomplete", "Autocomplete not supported by this merchant"));
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "This merchant does not support autocomplete.",
              }),
            },
          ],
        };
      }

      if (params.query.length < (config.min_chars ?? 2)) {
        return { content: [{ type: "text", text: JSON.stringify({ suggestions: [] }) }] };
      }

      try {
        const rawResponse = await connector.executeOperationFromConfig(
          config.operation,
          { query: params.query },
          "autocomplete"
        );

        const rawSuggestions = (config.suggestions_path
          ? mapper.resolvePath(rawResponse, config.suggestions_path)
          : rawResponse) as unknown[];

        const suggestions = (Array.isArray(rawSuggestions) ? rawSuggestions : []).map((s: unknown) => ({
          text: config.suggestion_mapping?.text_path
            ? mapper.resolvePath(s, config.suggestion_mapping.text_path)
            : typeof s === "string"
            ? s
            : (s as any)?.text,
          type: config.suggestion_mapping?.type_path
            ? mapper.resolvePath(s, config.suggestion_mapping.type_path)
            : undefined,
        }));

        auditLedger.append(toolCompletedEvent(trackId, "autocomplete", { count: suggestions.length }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ suggestions }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        auditLedger.append(toolFailedEvent(trackId, "autocomplete", errorMsg));
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: errorMsg }) }],
        };
      }
    }
  );

  // ─── check_availability ────────────────────────────────────────────────────
  server.tool(
    "check_availability",
    "Check real-time availability for a product. Supports stock counts, time slots, " +
    "seat maps, and calendar availability depending on the merchant.",
    {
      product_id: z.string().describe("The product or offer ID to check availability for"),
      variant: z.record(z.string()).optional().describe("Selected variant options, e.g. { size: 'XL', color: 'red' }"),
      date: z.string().optional().describe("Date to check (ISO 8601, for time-slot/calendar merchants)"),
      session_id: z.string().optional().describe("Optional active session ID for authenticated availability check"),
    },
    async (params) => {
      const trackId = `avail_${Date.now()}`;
      auditLedger.append(toolInvokedEvent(trackId, "check_availability", params));

      let sessionToken: string | undefined = undefined;
      if (authGuard) {
        const authResult = await authGuard.check("check_availability", params.session_id);
        if (!authResult.authorized && authResult.auth_required_response) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(authResult.auth_required_response, null, 2),
              },
            ],
          };
        }
        sessionToken = authResult.access_token;
      }

      try {
        const result = await connector.checkAvailability(params.product_id, params.variant, params.date, sessionToken);
        auditLedger.append(
          toolCompletedEvent(trackId, "check_availability", {
            product_id: params.product_id,
            available: result.available,
          })
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        auditLedger.append(toolFailedEvent(trackId, "check_availability", errorMsg));
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

  // ─── get_merchant_info ──────────────────────────────────────────────────────
  server.tool(
    "get_merchant_info",
    "Get information about this merchant: name, description, commerce domain, currency, supported capabilities, and available search refinements.",
    {},
    async () => {
      const refinementConfig = manifest.refinements;
      const staticFilters = refinementConfig?.static_filters ?? manifest.filters ?? [];
      const matrix = deriveCapabilityMatrix(manifest);
      const level = classifyIntegrationLevel(matrix);

      const initialRefinements: Refinement[] = staticFilters.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type === "enum" ? "enum" : f.type === "range" ? "range" : "boolean",
        multi_select: f.type === "enum",
        options: f.options?.map((o) => ({
          value: o.value,
          label: o.label,
          count: o.count,
        })),
        min: f.min,
        max: f.max,
      }));

      const merchantInfo: MerchantInfo = {
        name: manifest.merchant.name,
        description: manifest.merchant.description,
        commerce_domain: manifest.merchant.commerce_domain,
        currency: manifest.merchant.currency,
        integration_level: level,
        capabilities: {
          search: matrix.discovery.supported,
          product_lookup: matrix.discovery.supported,
          checkout: matrix.transaction.supported,
          order_status: matrix.order_status.supported,
          refund: matrix.refunds.supported,
          cancel: matrix.cancellation.supported,
          dynamic_refinements: matrix.dynamic_refinements.supported,
          refinement_options: matrix.refinement_options.supported,
          availability_check: matrix.availability_check.supported,
        },
        discovery_schema: manifest.discovery?.input_schema,
        refinements: initialRefinements,
        refinement_mode: refinementConfig?.mode ?? "static",
        available_filters: staticFilters,
        intent_mode: manifest.intent?.primary_mode ?? "search",
        sort_options: manifest.sort_options?.options?.map((o) => ({
          key: o.key,
          label: o.label,
        })) ?? [],
        attribute_catalog: manifest.attribute_catalog?.attributes?.map((a) => ({
          key: a.key,
          label: a.label,
          type: a.type,
          filterable: a.filterable,
          sortable: a.sortable,
          enum_values: a.enum_values,
        })) ?? [],
        constraints: (manifest.intent?.constraints as any) ?? null,
        authentication: manifest.auth
          ? {
              type: manifest.auth.type,
              requires_login: manifest.auth.type === "oauth2_authorization_code",
              flow:
                manifest.auth.type === "oauth2_authorization_code"
                  ? "OAuth 2.0 Authorization Code (RFC 6749 + PKCE)"
                  : manifest.auth.type,
              instructions:
                "To purchase an item or checkout, call prepare_purchase directly. You do not need an existing session_id. If login is required, the server returns an authorization_url for the user.",
            }
          : undefined,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(merchantInfo, null, 2),
          },
        ],
      };
    }
  );
}
