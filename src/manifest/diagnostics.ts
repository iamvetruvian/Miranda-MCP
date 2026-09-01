/**
 * Static Manifest Diagnostics & Gap Analysis (Zero LLM, Zero Inference)
 * Analyzes manifest structure and field declarations to produce actionable diagnostic reports.
 */

import { IntegrationManifest } from "../types/manifest.js";
import { IntegrationManifestSchema } from "./schema.js";
import {
  CapabilityMatrix,
  deriveCapabilityMatrix,
  classifyIntegrationLevel,
  IntegrationLevel,
} from "../connector/capabilities.js";

export interface DiagnosticIssue {
  severity: "error" | "warning" | "info";
  field: string;
  code: string;
  message: string;
  suggestion?: string;
}

export interface UnexposedCapability {
  capability: string;
  missing_fields: string[];
  suggestion: string;
}

export interface DiagnosticReport {
  manifest_version: string;
  validation_passed: boolean;
  capability_matrix: CapabilityMatrix;
  integration_level: IntegrationLevel;
  issues: DiagnosticIssue[];
  unexposed_capabilities: UnexposedCapability[];
}

/**
 * Performs comprehensive static validation and capability gap analysis on a manifest.
 */
export function diagnoseManifest(manifestInput: unknown): DiagnosticReport {
  const issues: DiagnosticIssue[] = [];
  const unexposed: UnexposedCapability[] = [];

  const parseResult = IntegrationManifestSchema.safeParse(manifestInput);
  if (!parseResult.success) {
    for (const error of parseResult.error.issues) {
      const fieldPath = error.path.join(".");
      issues.push({
        severity: "error",
        field: fieldPath || "root",
        code: "SCHEMA_VALIDATION_ERROR",
        message: error.message,
        suggestion: `Check field "${fieldPath}" and ensure it matches the schema specification.`,
      });
    }
  }

  const manifest = (manifestInput || {}) as IntegrationManifest;
  const matrix = deriveCapabilityMatrix(manifest);
  const level = classifyIntegrationLevel(matrix);

  // ─── Semantic Integrity Checks ─────────────────────────────────────────────

  // Check Currency Consistency
  if (manifest.merchant?.currency) {
    const offerCurrTransform =
      manifest.field_mappings?.offer?.["price.currency"]?.transform?.value;
    if (offerCurrTransform && offerCurrTransform !== manifest.merchant.currency) {
      issues.push({
        severity: "warning",
        field: "field_mappings.offer.price.currency",
        code: "CURRENCY_MISMATCH",
        message: `Offer currency default transform "${offerCurrTransform}" does not match merchant currency "${manifest.merchant.currency}".`,
        suggestion: `Update the transform value to "${manifest.merchant.currency}".`,
      });
    }
  }

  // Check Dynamic Refinements configuration
  if (manifest.refinements) {
    if (
      manifest.refinements.mode === "search_response" &&
      !manifest.refinements.refinements_path
    ) {
      issues.push({
        severity: "error",
        field: "refinements.refinements_path",
        code: "MISSING_REFINEMENTS_PATH",
        message:
          'Refinement mode is "search_response" but "refinements_path" is not specified.',
        suggestion:
          'Specify the dot-path to extract facets from search responses (e.g. "$.facets").',
      });
    }
  }

  // Check Cart configuration
  if (manifest.transaction?.cart?.model === "multi_item") {
    if (!manifest.transaction.cart.multi_item?.add_item_operation) {
      issues.push({
        severity: "error",
        field: "transaction.cart.multi_item.add_item_operation",
        code: "MISSING_ADD_ITEM_OPERATION",
        message:
          'Cart model is "multi_item" but "add_item_operation" is missing.',
        suggestion:
          "Declare the add_item_operation mapping in transaction.cart.multi_item.",
      });
    }
  }

  // ─── Unexposed Capability Gap Analysis ─────────────────────────────────────

  if (!matrix.cancellation.supported) {
    unexposed.push({
      capability: "shopping.order.cancel",
      missing_fields: ["operations.cancel_order", "outcome.cancellation"],
      suggestion:
        "Declare operations.cancel_order or outcome.cancellation to enable automated cancellation of merchant orders.",
    });
  }

  if (!matrix.autocomplete.supported && !manifest.intent?.autocomplete) {
    unexposed.push({
      capability: "intent.autocomplete",
      missing_fields: ["intent.autocomplete.operation", "intent.autocomplete.suggestions_path"],
      suggestion:
        "Declare intent.autocomplete to expose typeahead and search suggestions to buyer agents.",
    });
  }

  if (!matrix.browse_categories.supported && !manifest.intent?.category_tree) {
    unexposed.push({
      capability: "intent.browse_categories",
      missing_fields: ["intent.category_tree.operation", "intent.category_tree.categories_path"],
      suggestion:
        "Declare intent.category_tree to enable category navigation and hierarchical browsing.",
    });
  }

  if (!matrix.multi_item_cart.supported && manifest.transaction?.cart?.model !== "multi_item") {
    unexposed.push({
      capability: "transaction.multi_item_cart",
      missing_fields: ["transaction.cart.multi_item"],
      suggestion:
        'Declare transaction.cart.model = "multi_item" to allow multi-item shopping carts and basket checkout.',
    });
  }

  if (!matrix.shipping_options.supported && !manifest.transaction?.delivery?.shipping_options) {
    unexposed.push({
      capability: "transaction.shipping_options",
      missing_fields: ["transaction.delivery.shipping_options"],
      suggestion:
        "Declare transaction.delivery.shipping_options to let buyer agents choose shipping speed and couriers.",
    });
  }

  if (!matrix.coupon_support.supported && !manifest.transaction?.coupons) {
    unexposed.push({
      capability: "transaction.coupons",
      missing_fields: ["transaction.coupons", "operations.apply_coupon"],
      suggestion:
        "Declare transaction.coupons to enable promo codes and discount vouchers.",
    });
  }

  if (!matrix.tracking.supported && !manifest.outcome?.fulfillment?.shipping?.tracking_operation) {
    unexposed.push({
      capability: "outcome.tracking",
      missing_fields: ["outcome.fulfillment.shipping.tracking_operation"],
      suggestion:
        "Declare outcome.fulfillment.shipping.tracking_operation to support parcel tracking updates.",
    });
  }

  const validationPassed = parseResult.success && issues.filter((i) => i.severity === "error").length === 0;

  return {
    manifest_version: manifest.integration?.manifest_version ?? "2",
    validation_passed: validationPassed,
    capability_matrix: matrix,
    integration_level: level,
    issues,
    unexposed_capabilities: unexposed,
  };
}
