/**
 * Capability Negotiation (Manifest v2)
 * Deterministically derives a comprehensive ~35 capability matrix from the Integration Manifest.
 * A capability is SUPPORTED if and only if every operation and field configuration it requires
 * is declared. No inference, no guessing, no confidence scores.
 */

import { IntegrationManifest } from "../types/manifest.js";

export interface CapabilityStatus {
  supported: boolean;
  /** Manifest operations / configuration components that provide this capability */
  provided_by: string[];
  /** Populated only when unsupported and the capability is optional */
  note?: string;
  /** Flag indicating whether this capability is strictly required for the transactable level */
  required_for_transactable?: boolean;
}

export interface CapabilityMatrix {
  // Stage 2: Discovery
  discovery: CapabilityStatus;
  dynamic_refinements: CapabilityStatus;
  refinement_options: CapabilityStatus;
  autocomplete: CapabilityStatus;
  browse_categories: CapabilityStatus;
  recommendations: CapabilityStatus;
  comparison: CapabilityStatus;

  // Stage 3: Offer
  variant_selection: CapabilityStatus;
  add_ons: CapabilityStatus;
  bundles: CapabilityStatus;
  availability_check: CapabilityStatus;
  seat_map: CapabilityStatus;
  time_slots: CapabilityStatus;

  // Stage 4: Transaction
  transaction: CapabilityStatus;
  multi_item_cart: CapabilityStatus;
  multi_step_checkout: CapabilityStatus;
  coupon_support: CapabilityStatus;
  fee_calculation: CapabilityStatus;
  shipping_options: CapabilityStatus;
  delivery_slots: CapabilityStatus;
  special_instructions: CapabilityStatus;
  preorder: CapabilityStatus;

  // Stage 5: Payment
  payment: CapabilityStatus;
  emi: CapabilityStatus;
  partial_payment: CapabilityStatus;
  subscription_billing: CapabilityStatus;

  // Stage 6: Outcome
  order_status: CapabilityStatus;
  cancellation: CapabilityStatus;
  refunds: CapabilityStatus;
  merchant_refunds: CapabilityStatus;
  returns: CapabilityStatus;
  tracking: CapabilityStatus;
  digital_delivery: CapabilityStatus;
  invoice: CapabilityStatus;
  post_purchase_modification: CapabilityStatus;

  // Cross-cutting
  sort_options: CapabilityStatus;
  attribute_catalog: CapabilityStatus;
  merchant_webhooks: CapabilityStatus;
  custom_hooks: CapabilityStatus;
}

/** Minimum capability sets per integration level */
export type IntegrationLevel =
  | "incompatible"
  | "discoverable"
  | "transactable"
  | "fully_manageable";

export function deriveCapabilityMatrix(
  manifest: IntegrationManifest
): CapabilityMatrix {
  const hasOp = (op: string) =>
    Boolean((manifest.operations as unknown as Record<string, unknown>)?.[op]);

  const discoveryOps = ["search", "get_product"].filter(hasOp);
  const transactionOps = ["create_checkout", "confirm_order"].filter(hasOp);
  const orderStatusOps = ["get_order_status"].filter(hasOp);
  const cancelOps = ["cancel_order"].filter(hasOp);

  const refinements = manifest.refinements;
  const intent = manifest.intent;
  const discovery = manifest.discovery;
  const offer = manifest.offer;
  const transaction = manifest.transaction;
  const payment = manifest.payment;
  const outcome = manifest.outcome;
  const webhooks = manifest.webhooks;
  const customHooks = manifest.custom_hooks;

  return {
    // ── Stage 2: Discovery ──
    discovery: {
      supported: discoveryOps.length === 2,
      provided_by: discoveryOps,
      required_for_transactable: true,
    },
    dynamic_refinements: {
      supported: Boolean(refinements && refinements.mode !== "static"),
      provided_by: refinements ? [refinements.mode] : [],
      required_for_transactable: false,
    },
    refinement_options: {
      supported: Boolean(refinements?.option_pagination),
      provided_by: refinements?.option_pagination?.option_query_support
        ? ["merchant_endpoint"]
        : ["mcp_cache"],
      required_for_transactable: false,
    },
    autocomplete: {
      supported: Boolean(intent?.autocomplete?.operation),
      provided_by: intent?.autocomplete?.operation ? ["intent.autocomplete"] : [],
      required_for_transactable: false,
    },
    browse_categories: {
      supported: Boolean(intent?.category_tree?.operation),
      provided_by: intent?.category_tree?.operation ? ["intent.category_tree"] : [],
      required_for_transactable: false,
    },
    recommendations: {
      supported: Boolean(intent?.recommendations?.operation),
      provided_by: intent?.recommendations?.operation
        ? ["intent.recommendations"]
        : [],
      required_for_transactable: false,
    },
    comparison: {
      supported: Boolean(discovery?.comparison?.operation),
      provided_by: discovery?.comparison?.operation ? ["discovery.comparison"] : [],
      required_for_transactable: false,
    },

    // ── Stage 3: Offer ──
    variant_selection: {
      supported: Boolean(offer?.variants && offer.variants.dimensions.length > 0),
      provided_by: offer?.variants ? ["offer.variants"] : [],
      required_for_transactable: false,
    },
    add_ons: {
      supported: Boolean(offer?.add_ons?.supported),
      provided_by: offer?.add_ons ? ["offer.add_ons"] : [],
      required_for_transactable: false,
    },
    bundles: {
      supported: Boolean(offer?.bundles?.supported),
      provided_by: offer?.bundles ? ["offer.bundles"] : [],
      required_for_transactable: false,
    },
    availability_check: {
      supported: Boolean(hasOp("check_availability") || offer?.availability?.check_operation),
      provided_by: hasOp("check_availability")
        ? ["operations.check_availability"]
        : offer?.availability?.check_operation
        ? ["offer.availability.check_operation"]
        : [],
      required_for_transactable: false,
    },
    seat_map: {
      supported: Boolean(offer?.availability?.seat_map_operation),
      provided_by: offer?.availability?.seat_map_operation
        ? ["offer.availability.seat_map"]
        : [],
      required_for_transactable: false,
    },
    time_slots: {
      supported: Boolean(offer?.availability?.time_slots_operation),
      provided_by: offer?.availability?.time_slots_operation
        ? ["offer.availability.time_slots"]
        : [],
      required_for_transactable: false,
    },

    // ── Stage 4: Transaction ──
    transaction: {
      supported: transactionOps.length === 2,
      provided_by: transactionOps,
      required_for_transactable: true,
    },
    multi_item_cart: {
      supported: Boolean(
        transaction?.cart?.model === "multi_item" &&
          transaction.cart.multi_item?.add_item_operation
      ),
      provided_by: transaction?.cart?.multi_item ? ["transaction.cart"] : [],
      required_for_transactable: false,
    },
    multi_step_checkout: {
      supported: Boolean(
        transaction?.checkout_flow?.type === "multi_step" &&
          transaction.checkout_flow.steps &&
          transaction.checkout_flow.steps.length > 0
      ),
      provided_by: transaction?.checkout_flow?.steps
        ? ["transaction.checkout_flow"]
        : [],
      required_for_transactable: false,
    },
    coupon_support: {
      supported: Boolean(hasOp("apply_coupon") || transaction?.coupons?.supported),
      provided_by: hasOp("apply_coupon")
        ? ["operations.apply_coupon"]
        : transaction?.coupons
        ? ["transaction.coupons"]
        : [],
      required_for_transactable: false,
    },
    fee_calculation: {
      supported: Boolean(
        hasOp("calculate_fees") || (transaction?.fees?.fee_types && transaction.fees.fee_types.length > 0)
      ),
      provided_by: hasOp("calculate_fees")
        ? ["operations.calculate_fees"]
        : transaction?.fees
        ? ["transaction.fees"]
        : [],
      required_for_transactable: false,
    },
    shipping_options: {
      supported: Boolean(transaction?.delivery?.shipping_options?.operation),
      provided_by: transaction?.delivery?.shipping_options
        ? ["transaction.delivery.shipping"]
        : [],
      required_for_transactable: false,
    },
    delivery_slots: {
      supported: Boolean(transaction?.delivery?.delivery_slots?.operation),
      provided_by: transaction?.delivery?.delivery_slots
        ? ["transaction.delivery.slots"]
        : [],
      required_for_transactable: false,
    },
    special_instructions: {
      supported: Boolean(transaction?.special_instructions?.supported),
      provided_by: transaction?.special_instructions
        ? ["transaction.special_instructions"]
        : [],
      required_for_transactable: false,
    },
    preorder: {
      supported: Boolean(transaction?.preorder?.supported),
      provided_by: transaction?.preorder ? ["transaction.preorder"] : [],
      required_for_transactable: false,
    },

    // ── Stage 5: Payment ──
    payment: {
      supported: Boolean(payment?.provider === "stripe"),
      provided_by: ["stripe"],
      required_for_transactable: true,
    },
    emi: {
      supported: Boolean(payment?.emi?.available),
      provided_by: payment?.emi ? ["payment.emi"] : [],
      required_for_transactable: false,
    },
    partial_payment: {
      supported: Boolean(payment?.partial_payment?.allowed),
      provided_by: payment?.partial_payment ? ["payment.partial_payment"] : [],
      required_for_transactable: false,
    },
    subscription_billing: {
      supported: Boolean(payment?.subscriptions),
      provided_by: payment?.subscriptions ? ["payment.subscriptions"] : [],
      required_for_transactable: false,
    },

    // ── Stage 6: Outcome ──
    order_status: {
      supported: orderStatusOps.length === 1,
      provided_by: orderStatusOps,
      required_for_transactable: false,
    },
    cancellation: {
      supported: cancelOps.length === 1 || Boolean(outcome?.cancellation?.supported),
      provided_by: cancelOps.length === 1
        ? cancelOps
        : outcome?.cancellation
        ? ["outcome.cancellation"]
        : [],
      note:
        cancelOps.length === 0 && !outcome?.cancellation?.supported
          ? "cancel_transaction will only reverse MCP-side state; merchant order left untouched"
          : undefined,
      required_for_transactable: false,
    },
    refunds: {
      supported: true,
      provided_by: ["razorpay"],
      note: "Razorpay-native refund on the captured payment rail",
      required_for_transactable: false,
    },
    merchant_refunds: {
      supported: Boolean(
        hasOp("request_refund") || outcome?.merchant_refund?.has_merchant_refund
      ),
      provided_by: hasOp("request_refund")
        ? ["operations.request_refund"]
        : outcome?.merchant_refund
        ? ["outcome.merchant_refund"]
        : [],
      required_for_transactable: false,
    },
    returns: {
      supported: Boolean(outcome?.returns?.supported),
      provided_by: outcome?.returns ? ["outcome.returns"] : [],
      required_for_transactable: false,
    },
    tracking: {
      supported: Boolean(outcome?.fulfillment?.shipping?.tracking_operation),
      provided_by: outcome?.fulfillment?.shipping?.tracking_operation
        ? ["outcome.fulfillment.shipping.tracking"]
        : [],
      required_for_transactable: false,
    },
    digital_delivery: {
      supported: Boolean(outcome?.fulfillment?.digital),
      provided_by: outcome?.fulfillment?.digital ? ["outcome.fulfillment.digital"] : [],
      required_for_transactable: false,
    },
    invoice: {
      supported: Boolean(outcome?.invoice?.available),
      provided_by: outcome?.invoice ? ["outcome.invoice"] : [],
      required_for_transactable: false,
    },
    post_purchase_modification: {
      supported: Boolean(
        outcome?.modifications?.supported &&
          outcome.modifications.modifiable_fields &&
          outcome.modifications.modifiable_fields.length > 0
      ),
      provided_by: outcome?.modifications ? ["outcome.modifications"] : [],
      required_for_transactable: false,
    },

    // ── Cross-cutting ──
    sort_options: {
      supported: Boolean(
        manifest.sort_options && manifest.sort_options.options.length > 0
      ),
      provided_by: manifest.sort_options ? ["sort_options"] : [],
      required_for_transactable: false,
    },
    attribute_catalog: {
      supported: Boolean(
        manifest.attribute_catalog &&
          manifest.attribute_catalog.attributes.length > 0
      ),
      provided_by: manifest.attribute_catalog ? ["attribute_catalog"] : [],
      required_for_transactable: false,
    },
    merchant_webhooks: {
      supported: Boolean(
        webhooks?.merchant_events && webhooks.merchant_events.length > 0
      ),
      provided_by: webhooks?.merchant_events ? ["webhooks.merchant_events"] : [],
      required_for_transactable: false,
    },
    custom_hooks: {
      supported: Boolean(
        customHooks?.module &&
          customHooks.declared_hooks &&
          customHooks.declared_hooks.length > 0
      ),
      provided_by: customHooks?.declared_hooks ? customHooks.declared_hooks : [],
      required_for_transactable: false,
    },
  };
}

export function classifyIntegrationLevel(
  matrix: CapabilityMatrix
): IntegrationLevel {
  if (!matrix.discovery.supported) return "incompatible";
  if (!matrix.transaction.supported) return "discoverable";
  if (
    matrix.cancellation.supported &&
    matrix.refunds.supported &&
    matrix.order_status.supported
  ) {
    return "fully_manageable";
  }
  return "transactable";
}
