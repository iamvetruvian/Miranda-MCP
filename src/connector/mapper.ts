/**
 * Declarative Field Mapper Engine (Manifest v2)
 * Translates between merchant-specific JSON schemas and canonical commerce structures
 * with an expanded library of pure transformations.
 */

import { FieldMap, FieldMapping, TransformSpec } from "../types/manifest.js";

export class ResponseMapper {
  /**
   * Map a source object into a target canonical object according to a FieldMap.
   */
  mapOne<T = Record<string, unknown>>(fieldMap: FieldMap, source: unknown): T {
    if (!source || typeof source !== "object") {
      return {} as T;
    }

    const result: Record<string, unknown> = {};

    for (const [targetKey, mapping] of Object.entries(fieldMap)) {
      let rawValue: unknown = undefined;

      if (mapping.from !== null && mapping.from !== undefined) {
        rawValue = this.resolvePath(source, mapping.from);
      }

      // Apply transform if specified
      const finalValue = mapping.transform
        ? this.applyTransform(rawValue, mapping.transform, source)
        : rawValue;

      if (finalValue !== undefined) {
        this.setDeepValue(result, targetKey, finalValue);
      }
    }

    return result as T;
  }

  /**
   * Map an array of source objects into canonical objects.
   */
  mapArray<T = Record<string, unknown>>(fieldMap: FieldMap, sources: unknown[]): T[] {
    if (!Array.isArray(sources)) {
      return [];
    }
    return sources.map((item) => this.mapOne<T>(fieldMap, item));
  }

  /**
   * Apply data transformations.
   */
  applyTransform(value: unknown, spec: TransformSpec, rootContext?: unknown): unknown {
    switch (spec.type) {
      case "multiply": {
        const num = Number(value);
        if (isNaN(num)) return 0;
        const factor = typeof spec.value === "number" ? spec.value : 1;
        return Math.round(num * factor);
      }

      case "divide": {
        const num = Number(value);
        if (isNaN(num)) return 0;
        const divisor = typeof spec.value === "number" && spec.value !== 0 ? spec.value : 1;
        return num / divisor;
      }

      case "enum": {
        if (spec.enum_map && value !== undefined && value !== null) {
          const strVal = String(value);
          return spec.enum_map[strVal] ?? spec.enum_map["*"] ?? strVal;
        }
        return value;
      }

      case "boolean_to_enum": {
        if (spec.enum_map) {
          const boolKey = String(Boolean(value));
          return spec.enum_map[boolKey] ?? boolKey;
        }
        if (spec.in_stock_value !== undefined) {
          return value === spec.in_stock_value ? "in_stock" : "out_of_stock";
        }
        return value ? "in_stock" : "out_of_stock";
      }

      case "default": {
        return value !== undefined && value !== null && value !== "" ? value : spec.value;
      }

      case "template": {
        const tpl = spec.template ?? (typeof spec.value === "string" ? spec.value : "");
        if (tpl) {
          return tpl.replace(/\{value\}/g, String(value ?? ""));
        }
        return value;
      }

      case "concat": {
        const separator = (spec.separator as string) ?? " ";
        if (Array.isArray(value)) {
          return value.filter((v) => v !== undefined && v !== null).join(separator);
        }
        const fieldPaths = (spec.paths as string[]) || spec.fields;
        if (fieldPaths && rootContext && typeof rootContext === "object") {
          const parts = fieldPaths
            .map((f) => this.resolvePath(rootContext, f))
            .filter((v) => v !== undefined && v !== null)
            .map(String);
          return parts.join(separator);
        }
        return String(value ?? "");
      }

      case "coalesce": {
        if (value !== undefined && value !== null && value !== "") return value;
        const fieldPaths = (spec.paths as string[]) || spec.fields;
        if (fieldPaths && rootContext && typeof rootContext === "object") {
          for (const f of fieldPaths) {
            const resolved = this.resolvePath(rootContext, f);
            if (resolved !== undefined && resolved !== null && resolved !== "") {
              return resolved;
            }
          }
        }
        return spec.fallback ?? spec.value ?? undefined;
      }

      case "json_path": {
        const pathExpr = (spec.value as string) || (spec.path as string);
        if (typeof pathExpr === "string") {
          return this.resolvePath(value, pathExpr);
        }
        return value;
      }

      case "split": {
        const sep = (spec.separator as string) ?? ",";
        if (typeof value === "string") {
          return value.split(sep).map((s) => s.trim());
        }
        return [];
      }

      case "substring": {
        if (typeof value === "string") {
          const start = (spec.start as number) ?? 0;
          const end =
            spec.end !== undefined
              ? (spec.end as number)
              : spec.length !== undefined
              ? start + (spec.length as number)
              : undefined;
          return value.substring(start, end);
        }
        return value;
      }

      case "regex_extract": {
        const strVal = String(value ?? "");
        const pattern = (spec.pattern as string) || spec.regex;
        if (pattern) {
          try {
            const re = new RegExp(pattern, spec.flags);
            const match = strVal.match(re);
            if (!match) return value;
            const group = (spec.group as number) ?? 1;
            return match[group] !== undefined ? match[group] : match[0];
          } catch {
            return value;
          }
        }
        return value;
      }

      case "to_number": {
        const num = Number(value);
        return isNaN(num) ? (spec.value ?? 0) : num;
      }

      case "to_string": {
        return value !== undefined && value !== null ? String(value) : "";
      }

      case "flatten": {
        if (Array.isArray(value)) {
          return (value as unknown[][]).flat();
        }
        return value;
      }

      case "conditional": {
        // Support array-based spec.conditions
        if (spec.conditions && Array.isArray(spec.conditions)) {
          for (const cond of spec.conditions) {
            const testValue = cond.when?.path
              ? this.resolvePath(rootContext ?? value, cond.when.path)
              : value;
            if (testValue === cond.when?.equals) return cond.then;
          }
          return spec.otherwise ?? value;
        }

        // Support object-based spec.condition
        if (!spec.condition) return value;
        const targetVal = spec.condition.field && rootContext
          ? this.resolvePath(rootContext, spec.condition.field)
          : value;

        let conditionMet = false;
        switch (spec.condition.operator) {
          case "eq":
            conditionMet = targetVal === spec.condition.value;
            break;
          case "neq":
            conditionMet = targetVal !== spec.condition.value;
            break;
          case "gt":
            conditionMet = Number(targetVal) > Number(spec.condition.value);
            break;
          case "gte":
            conditionMet = Number(targetVal) >= Number(spec.condition.value);
            break;
          case "lt":
            conditionMet = Number(targetVal) < Number(spec.condition.value);
            break;
          case "lte":
            conditionMet = Number(targetVal) <= Number(spec.condition.value);
            break;
          case "in":
            conditionMet = Array.isArray(spec.condition.value) && spec.condition.value.includes(targetVal);
            break;
          case "contains":
            conditionMet = String(targetVal).includes(String(spec.condition.value));
            break;
          case "exists":
            conditionMet = targetVal !== undefined && targetVal !== null;
            break;
          default:
            conditionMet = Boolean(targetVal);
        }

        return conditionMet ? spec.condition.then : spec.condition.else;
      }

      case "date_format": {
        try {
          const date = this.parseDateWithFormat(value, spec.input_format as string);
          if (isNaN(date.getTime())) return value;

          if (spec.output_format === "unix_seconds") {
            return Math.floor(date.getTime() / 1000);
          }
          if (spec.output_format === "unix_ms") {
            return date.getTime();
          }
          if (spec.output_format === "iso8601" || !spec.output_format) {
            return date.toISOString();
          }
          return date.toISOString();
        } catch {
          return value;
        }
      }

      case "foreach": {
        if (Array.isArray(value)) {
          const subMap = (spec.value as FieldMap) || (spec.sub_map as FieldMap);
          if (subMap && typeof subMap === "object") {
            return value.map((item) => this.mapOne(subMap, item));
          }
        }
        return value;
      }

      default:
        return value;
    }
  }

  private parseDateWithFormat(value: unknown, inputFormat?: string): Date {
    if (value instanceof Date) return value;
    if (typeof value === "number") {
      return value < 1e11 ? new Date(value * 1000) : new Date(value);
    }
    const str = String(value ?? "").trim();
    if (!str) return new Date(NaN);

    if (inputFormat) {
      const upperFormat = inputFormat.toUpperCase();
      if (upperFormat === "DD/MM/YYYY" || upperFormat === "DD-MM-YYYY") {
        const parts = str.split(/[\/\-]/);
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const year = parseInt(parts[2], 10);
          return new Date(Date.UTC(year, month, day));
        }
      } else if (upperFormat === "MM/DD/YYYY" || upperFormat === "MM-DD-YYYY") {
        const parts = str.split(/[\/\-]/);
        if (parts.length === 3) {
          const month = parseInt(parts[0], 10) - 1;
          const day = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          return new Date(Date.UTC(year, month, day));
        }
      } else if (upperFormat === "UNIX_SECONDS") {
        const sec = Number(str);
        return new Date(sec * 1000);
      } else if (upperFormat === "UNIX_MS") {
        const ms = Number(str);
        return new Date(ms);
      }
    }

    return new Date(str);
  }

  /**
   * Resolves a dot-path expression like "$.product_name", "$.data.items[0].price" from a source object.
   */
  resolvePath(source: unknown, path: string): unknown {
    if (!path) return undefined;

    const cleanPath = path.startsWith("$.") ? path.slice(2) : path.startsWith("$") ? path.slice(1) : path;
    if (!cleanPath) return source;

    const segments = cleanPath
      .replace(/\[(\d+)\]/g, ".$1")
      .split(".")
      .filter(Boolean);

    let current: unknown = source;
    for (const segment of segments) {
      if (current === null || current === undefined || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }

    return current;
  }

  /**
   * Sets a nested property on an object based on a dot-path (e.g. "price.amount").
   */
  setDeepValue(target: Record<string, unknown>, path: string, value: unknown): void {
    const segments = path
      .replace(/\[(\d+)\]/g, ".$1")
      .split(".")
      .filter(Boolean);

    let current = target;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const nextSegment = segments[i + 1];
      const isNextNumeric = /^\d+$/.test(nextSegment);

      if (!(segment in current) || typeof current[segment] !== "object" || current[segment] === null) {
        current[segment] = isNextNumeric ? [] : {};
      }

      current = current[segment] as Record<string, unknown>;
    }

    const lastSegment = segments[segments.length - 1];
    current[lastSegment] = value;
  }
}

export class RequestMapper {
  private responseMapper = new ResponseMapper();

  /**
   * Maps canonical request parameters to merchant's expected request body or query parameters.
   */
  map(
    requestMapping: FieldMap | undefined,
    canonicalParams: Record<string, unknown>
  ): Record<string, unknown> {
    if (!requestMapping) {
      return { ...canonicalParams };
    }

    const result: Record<string, unknown> = {};

    for (const [targetKey, mapping] of Object.entries(requestMapping)) {
      let rawValue: unknown = undefined;

      if (mapping.from !== null && mapping.from !== undefined) {
        rawValue = this.responseMapper.resolvePath(canonicalParams, mapping.from);
      }

      const finalValue = mapping.transform
        ? this.responseMapper.applyTransform(rawValue, mapping.transform, canonicalParams)
        : rawValue;

      if (finalValue !== undefined) {
        this.responseMapper.setDeepValue(result, targetKey, finalValue);
      }
    }

    return result;
  }
}
