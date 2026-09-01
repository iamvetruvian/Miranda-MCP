/**
 * Refinement Extractor
 * Extracts dynamic refinements and search facets from merchant search responses
 * across static, search_response, separate_endpoint, and derived modes.
 */

import { Refinement, RefinementOption, FilterDefinition } from "../types/index.js";
import { RefinementConfig, OperationMapping, RefinementOptionPaginationConfig } from "../types/manifest.js";
import { ResponseMapper } from "./mapper.js";

export const DEFAULT_MAX_OPTIONS_IN_SEARCH = 20;

/**
 * Truncate refinement option lists for agent-facing search responses.
 * Sets has_more / option_count truthfully. The FULL lists remain in the
 * search state store for get_refinement_options.
 */
export function truncateRefinementOptions(
  refinements: Refinement[],
  config?: RefinementOptionPaginationConfig
): Refinement[] {
  const max = config?.max_options_in_search ?? DEFAULT_MAX_OPTIONS_IN_SEARCH;

  return refinements.map((r) => {
    if (!r.options || r.options.length <= max) {
      return { ...r, option_count: r.options?.length ?? r.option_count ?? 0, has_more: false };
    }

    const sorted =
      config?.sort_by === "native"
        ? [...r.options]
        : [...r.options].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

    return {
      ...r,
      options: sorted.slice(0, max),
      option_count: r.options.length,
      has_more: true,
    };
  });
}

export class RefinementExtractor {
  private responseMapper = new ResponseMapper();

  /**
   * Extract refinements based on the configured mode.
   *
   * @param config             - Refinement configuration from manifest
   * @param rawSearchResponse  - Complete un-extracted raw response from merchant search
   * @param extractedProducts  - Extracted products array (used in 'derived' mode)
   * @param executeOperation   - Callback to execute separate facet endpoint if mode is 'separate_endpoint'
   * @param searchParams       - Canonical search parameters
   */
  async extract(
    config: RefinementConfig | undefined,
    rawSearchResponse: unknown,
    extractedProducts: unknown[],
    executeOperation?: (op: OperationMapping, params: Record<string, unknown>) => Promise<unknown>,
    searchParams?: Record<string, unknown>
  ): Promise<Refinement[]> {
    if (!config) {
      return [];
    }

    switch (config.mode) {
      case "static":
        return this.fromStaticFilters(config.static_filters ?? []);

      case "search_response":
        return this.fromSearchResponse(config, rawSearchResponse);

      case "separate_endpoint":
        if (executeOperation && config.facet_operation && searchParams) {
          try {
            const facetRaw = await executeOperation(config.facet_operation, searchParams);
            return this.fromSearchResponse(config, facetRaw);
          } catch {
            return this.fromStaticFilters(config.static_filters ?? []);
          }
        }
        return this.fromStaticFilters(config.static_filters ?? []);

      case "derived":
        return this.deriveFromProducts(config, extractedProducts);

      default:
        return this.fromStaticFilters(config.static_filters ?? []);
    }
  }

  /**
   * Convert static filter definitions to Refinement[].
   */
  fromStaticFilters(filters: FilterDefinition[]): Refinement[] {
    return filters.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type === "enum" ? "enum" : f.type === "range" ? "range" : "boolean",
      multi_select: f.type === "enum",
      options: f.options?.map((o) => ({
        value: o.value,
        label: o.label,
        count: o.count,
      })),
      option_count: f.options?.length,
      has_more: false,
      min: f.min,
      max: f.max,
    }));
  }

  /**
   * Extract dynamic refinements from search response using schema configuration.
   */
  private fromSearchResponse(config: RefinementConfig, rawResponse: unknown): Refinement[] {
    if (!rawResponse || typeof rawResponse !== "object") {
      return [];
    }

    const refinementsPath = config.refinements_path ?? "$.facets";
    const rawRefinements = this.responseMapper.resolvePath(rawResponse, refinementsPath);

    if (!Array.isArray(rawRefinements)) {
      // Handle key-value map format e.g. { "brand": [{ value: "Nike", count: 10 }], "color": [...] }
      if (rawRefinements && typeof rawRefinements === "object") {
        return this.fromFacetMap(rawRefinements as Record<string, unknown>);
      }
      return [];
    }

    const schema = config.refinement_schema;
    if (!schema) {
      // Fallback: try standard keys (id/name/options or key/label/values)
      return rawRefinements.map((item) => this.normalizeGenericRefinement(item));
    }

    return rawRefinements.map((raw: unknown) => {
      const key = String(this.responseMapper.resolvePath(raw, schema.key_path) ?? "");
      const label = String(this.responseMapper.resolvePath(raw, schema.label_path) ?? key);
      const typeRaw = schema.type_path
        ? String(this.responseMapper.resolvePath(raw, schema.type_path) ?? "enum")
        : "enum";

      const rawOptions = this.responseMapper.resolvePath(raw, schema.options_path);
      const options: RefinementOption[] = Array.isArray(rawOptions)
        ? rawOptions.map((opt: unknown) => ({
            value: String(this.responseMapper.resolvePath(opt, schema.option_value_path) ?? ""),
            label: String(this.responseMapper.resolvePath(opt, schema.option_label_path) ?? ""),
            count: schema.option_count_path
              ? Number(this.responseMapper.resolvePath(opt, schema.option_count_path) ?? 0)
              : undefined,
          }))
        : [];

      return {
        key,
        label,
        type: (["enum", "multi_enum", "range", "boolean", "hierarchical"].includes(typeRaw)
          ? typeRaw
          : "enum") as Refinement["type"],
        multi_select: true,
        options,
        option_count: options.length,
        has_more: false,
        min: typeof (raw as Record<string, unknown>).min === "number" ? (raw as Record<string, unknown>).min as number : undefined,
        max: typeof (raw as Record<string, unknown>).max === "number" ? (raw as Record<string, unknown>).max as number : undefined,
      };
    });
  }

  /**
   * Normalize an object-map of facets like { "brand": [{ "value": "Nike", "count": 5 }] }.
   */
  private fromFacetMap(facetMap: Record<string, unknown>): Refinement[] {
    const refinements: Refinement[] = [];

    for (const [key, val] of Object.entries(facetMap)) {
      if (Array.isArray(val)) {
        const options: RefinementOption[] = val.map((opt: unknown) => {
          if (typeof opt === "string") {
            return { value: opt, label: opt };
          }
          if (typeof opt === "object" && opt !== null) {
            const o = opt as Record<string, unknown>;
            return {
              value: String(o.value ?? o.id ?? o.name ?? ""),
              label: String(o.label ?? o.name ?? o.value ?? ""),
              count: typeof o.count === "number" ? o.count : undefined,
            };
          }
          return { value: String(opt), label: String(opt) };
        });

        refinements.push({
          key,
          label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " "),
          type: "enum",
          multi_select: true,
          options,
          option_count: options.length,
          has_more: false,
        });
      }
    }

    return refinements;
  }

  /**
   * Normalize a generic refinement item when no specific schema is configured.
   */
  private normalizeGenericRefinement(raw: unknown): Refinement {
    if (!raw || typeof raw !== "object") {
      return { key: "unknown", label: "Unknown", type: "enum" };
    }
    const r = raw as Record<string, unknown>;
    const key = String(r.id ?? r.key ?? r.field ?? "facet");
    const label = String(r.name ?? r.label ?? r.displayName ?? key);
    const type = (String(r.type ?? "enum")) as Refinement["type"];

    const rawOptions = Array.isArray(r.options)
      ? r.options
      : Array.isArray(r.bins)
      ? r.bins
      : Array.isArray(r.values)
      ? r.values
      : [];

    const options: RefinementOption[] = rawOptions.map((opt: unknown) => {
      if (typeof opt === "string") {
        return { value: opt, label: opt };
      }
      if (typeof opt === "object" && opt !== null) {
        const o = opt as Record<string, unknown>;
        return {
          value: String(o.value ?? o.id ?? o.name ?? ""),
          label: String(o.label ?? o.displayName ?? o.name ?? o.value ?? ""),
          count: typeof o.count === "number" ? o.count : undefined,
        };
      }
      return { value: String(opt), label: String(opt) };
    });

    return {
      key,
      label,
      type: ["enum", "multi_enum", "range", "boolean", "hierarchical"].includes(type) ? type : "enum",
      multi_select: true,
      options,
      option_count: options.length,
      has_more: false,
      min: typeof r.min === "number" ? r.min : undefined,
      max: typeof r.max === "number" ? r.max : undefined,
    };
  }

  /**
   * Derive facets by aggregating product attributes from the result set.
   */
  private deriveFromProducts(config: RefinementConfig, products: unknown[]): Refinement[] {
    const attributes = config.derive_from_attributes ?? ["brand", "category"];
    const refinements: Refinement[] = [];

    for (const attrPath of attributes) {
      const valueCounts = new Map<string, number>();

      for (const product of products) {
        if (!product || typeof product !== "object") continue;
        const val =
          this.responseMapper.resolvePath(product, `$.${attrPath}`) ??
          this.responseMapper.resolvePath(product, `$.attributes.${attrPath}`) ??
          (product as Record<string, unknown>)[attrPath];

        if (val !== undefined && val !== null) {
          const strVal = String(val);
          valueCounts.set(strVal, (valueCounts.get(strVal) ?? 0) + 1);
        }
      }

      if (valueCounts.size > 0) {
        refinements.push({
          key: attrPath,
          label: attrPath.charAt(0).toUpperCase() + attrPath.slice(1).replace(/_/g, " "),
          type: "enum",
          multi_select: true,
          options: Array.from(valueCounts.entries()).map(([value, count]) => ({
            value,
            label: value.charAt(0).toUpperCase() + value.slice(1),
            count,
          })),
          option_count: valueCounts.size,
          has_more: false,
        });
      }
    }

    return refinements;
  }
}
