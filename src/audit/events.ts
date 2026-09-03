/**
 * Audit Event Factory
 * Standardized constructor functions for all commerce lifecycle audit events.
 */

import {
  AuditEvent,
  AuditEventType,
  AuditActor,
  TransactionState,
  Offer,
  Money,
  MerchantVerifiedCheckout,
  PolicyDecision,
  MerchantOrderBinding,
} from "../types/index.js";

export type EventPayload = Omit<AuditEvent, "event_id" | "integrity">;

export function toolInvokedEvent(
  transactionId: string,
  toolName: string,
  params: Record<string, unknown>,
  actor?: Partial<AuditActor>
): EventPayload {
  return {
    event_type: AuditEventType.MCP_TOOL_INVOKED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "buyer_agent",
      component: toolName,
      ...actor,
    },
    request: { tool: toolName, params },
  };
}

export function toolCompletedEvent(
  transactionId: string,
  toolName: string,
  response: Record<string, unknown>
): EventPayload {
  return {
    event_type: AuditEventType.MCP_TOOL_COMPLETED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: toolName,
    },
    response,
  };
}

export function toolFailedEvent(
  transactionId: string,
  toolName: string,
  error: string
): EventPayload {
  return {
    event_type: AuditEventType.MCP_TOOL_FAILED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: toolName,
    },
    response: { error },
  };
}

export function searchExecutedEvent(
  searchId: string,
  query: string,
  resultCount: number,
  filters?: Record<string, unknown>
): EventPayload {
  return {
    event_type: AuditEventType.SEARCH_EXECUTED,
    timestamp: new Date().toISOString(),
    transaction_id: searchId,
    actor: {
      type: "buyer_agent",
      component: "search_products",
    },
    request: { query, filters },
    response: { result_count: resultCount },
  };
}

export function refinementOptionsQueriedEvent(
  searchId: string,
  refinementKey: string,
  query?: string,
  returnedCount?: number
): EventPayload {
  return {
    event_type: AuditEventType.REFINEMENT_OPTIONS_QUERIED,
    timestamp: new Date().toISOString(),
    transaction_id: searchId,
    actor: {
      type: "buyer_agent",
      component: "get_refinement_options",
    },
    request: { refinement_key: refinementKey, query },
    response: { returned_count: returnedCount },
  };
}

export function productResolvedEvent(
  transactionId: string,
  offer: Offer
): EventPayload {
  return {
    event_type: AuditEventType.PRODUCT_RESOLVED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "merchant",
      component: "catalog_resolver",
    },
    response: {
      offer_id: offer.offer_id,
      title: offer.title,
      price: offer.price,
      availability: offer.availability,
    },
  };
}

export function checkoutCreatedEvent(
  transactionId: string,
  checkout: MerchantVerifiedCheckout
): EventPayload {
  return {
    event_type: AuditEventType.CHECKOUT_CREATED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "merchant",
      component: "checkout_engine",
    },
    response: {
      checkout_id: checkout.checkout_id,
      sku: checkout.sku,
      unit_price: checkout.unit_price,
      total: checkout.total,
      available: checkout.available,
      expires_at: checkout.expires_at,
    },
  };
}

export function policyEvaluatedEvent(
  transactionId: string,
  decision: PolicyDecision
): EventPayload {
  return {
    event_type: AuditEventType.POLICY_EVALUATED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "policy_engine",
    },
    policy: {
      decision: decision.decision,
      checks: decision.checks,
    },
    response: {
      gate_token: decision.gate_token,
    },
  };
}

export function paymentOrderCreatedEvent(
  transactionId: string,
  orderData: { order_id: string; amount: number; currency: string }
): EventPayload {
  return {
    event_type: AuditEventType.PAYMENT_ORDER_CREATED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "payment_adapter",
    },
    response: orderData,
  };
}

export function paymentLinkGeneratedEvent(
  transactionId: string,
  linkData: { payment_link_id: string; short_url: string; amount: number }
): EventPayload {
  return {
    event_type: AuditEventType.PAYMENT_LINK_GENERATED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "payment_adapter",
    },
    response: linkData,
  };
}

export function paymentWebhookReceivedEvent(
  transactionId: string,
  razorpayEvent: string,
  payload: Record<string, unknown>
): EventPayload {
  return {
    event_type: AuditEventType.PAYMENT_WEBHOOK_RECEIVED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "razorpay",
      component: "webhook_gateway",
    },
    request: {
      event: razorpayEvent,
      payment_id: (payload.payment as Record<string, unknown>)?.id ?? (payload.payment_link as Record<string, unknown>)?.id,
    },
  };
}

export function paymentCapturedEvent(
  transactionId: string,
  paymentData: { payment_id: string; amount: number; currency: string }
): EventPayload {
  return {
    event_type: AuditEventType.PAYMENT_CAPTURED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "razorpay",
      component: "payment_gateway",
    },
    response: paymentData,
  };
}

export function orderConfirmedEvent(
  transactionId: string,
  order: MerchantOrderBinding
): EventPayload {
  return {
    event_type: AuditEventType.ORDER_CONFIRMED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "merchant",
      component: "order_management",
    },
    response: {
      order_id: order.order_id,
      status: order.status,
      confirmed_at: order.confirmed_at,
    },
  };
}

export function stateTransitionEvent(
  transactionId: string,
  from: TransactionState,
  to: TransactionState,
  trigger: string
): EventPayload {
  return {
    event_type: AuditEventType.STATE_TRANSITION,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "transaction_state_machine",
    },
    state_transition: { from, to, trigger },
  };
}

export function transactionFailedEvent(
  transactionId: string,
  reason: string,
  component: string = "mcp"
): EventPayload {
  return {
    event_type: AuditEventType.TRANSACTION_FAILED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component,
    },
    response: { failure_reason: reason },
  };
}

export function idempotencyReplayEvent(
  transactionId: string,
  action: string
): EventPayload {
  return {
    event_type: AuditEventType.IDEMPOTENCY_REPLAY,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "policy_engine",
    },
    response: { replayed_action: action },
  };
}

export function webhookSignatureVerifiedEvent(signatureLength: number): EventPayload {
  return {
    event_type: AuditEventType.WEBHOOK_SIGNATURE_VERIFIED,
    timestamp: new Date().toISOString(),
    transaction_id: "system_webhook",
    actor: {
      type: "razorpay",
      component: "webhook_gateway",
    },
    request: { signature_length: signatureLength },
  };
}

export function webhookSignatureInvalidEvent(signature: string): EventPayload {
  return {
    event_type: AuditEventType.WEBHOOK_SIGNATURE_INVALID,
    timestamp: new Date().toISOString(),
    transaction_id: "system_webhook",
    actor: {
      type: "razorpay",
      component: "webhook_gateway",
    },
    request: { signature },
  };
}

export function webhookSignatureMissingEvent(): EventPayload {
  return {
    event_type: AuditEventType.WEBHOOK_SIGNATURE_MISSING,
    timestamp: new Date().toISOString(),
    transaction_id: "system_webhook",
    actor: {
      type: "razorpay",
      component: "webhook_gateway",
    },
    request: { headers: { "x-razorpay-signature": null } },
  };
}

export function transactionCancelledEvent(
  transactionId: string,
  reason?: string,
  refundOutcome?: string
): EventPayload {
  return {
    event_type: AuditEventType.TRANSACTION_CANCELLED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "transaction_manager",
    },
    request: { reason, refund_outcome: refundOutcome },
  };
}

export function refundRequestedEvent(
  transactionId: string,
  requestedAmount?: number,
  reason?: string
): EventPayload {
  return {
    event_type: AuditEventType.REFUND_REQUESTED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "buyer_agent",
    },
    request: { requested_amount: requestedAmount, reason },
  };
}

export function refundInitiatedEvent(
  transactionId: string,
  refund: { refund_id: string; amount: Money; status: string }
): EventPayload {
  return {
    event_type: AuditEventType.REFUND_INITIATED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "razorpay",
      component: "refunds",
    },
    response: {
      refund_id: refund.refund_id,
      amount: refund.amount,
      status: refund.status,
    },
  };
}

export function refundProcessedEvent(
  transactionId: string,
  refund: { refund_id: string; amount: number; currency: string }
): EventPayload {
  return {
    event_type: AuditEventType.REFUND_PROCESSED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "razorpay",
      component: "webhook_gateway",
    },
    response: {
      refund_id: refund.refund_id,
      amount: refund.amount,
      currency: refund.currency,
    },
  };
}

export function refundFailedEvent(
  transactionId: string,
  refundId: string,
  reason?: string
): EventPayload {
  return {
    event_type: AuditEventType.REFUND_FAILED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "razorpay",
      component: "webhook_gateway",
    },
    response: {
      refund_id: refundId,
      reason,
    },
  };
}

export function mandateCreatedEvent(
  mandateId: string,
  signedMandate: any
): EventPayload {
  return {
    event_type: AuditEventType.MANDATE_CREATED,
    timestamp: new Date().toISOString(),
    transaction_id: mandateId,
    actor: {
      type: "buyer_agent",
      component: "mandate_broker",
    },
    response: {
      mandate_id: mandateId,
      kind: signedMandate?.mandate?.kind,
      algorithm: signedMandate?.algorithm,
      constraints: signedMandate?.mandate?.constraints,
      binding: signedMandate?.mandate?.binding,
    },
  };
}

export function mandateEvaluatedEvent(
  transactionId: string,
  evaluation: { status: string; mandate_id?: string; approved_by?: string; reason?: string }
): EventPayload {
  return {
    event_type: AuditEventType.MANDATE_EVALUATED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "mandate_broker",
    },
    response: evaluation,
  };
}

export function mandateRejectedEvent(
  transactionId: string,
  reason: string
): EventPayload {
  return {
    event_type: AuditEventType.MANDATE_REJECTED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "mandate_broker",
    },
    response: { reason },
  };
}

export function consentChallengedEvent(
  transactionId: string,
  challenge: { challenge_id: string; consent_url: string; amount: number; currency: string }
): EventPayload {
  return {
    event_type: AuditEventType.CONSENT_CHALLENGED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "authorization_broker",
    },
    response: challenge,
  };
}

export function consentGrantedEvent(
  transactionId: string,
  challengeId: string,
  mandateId: string
): EventPayload {
  return {
    event_type: AuditEventType.CONSENT_GRANTED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "system",
      component: "user_consent_surface",
    },
    response: {
      challenge_id: challengeId,
      derived_mandate_id: mandateId,
    },
  };
}

export function rateLimitedEvent(
  transactionId: string,
  toolOrEndpoint: string,
  details: Record<string, unknown>
): EventPayload {
  return {
    event_type: AuditEventType.RATE_LIMITED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "rate_limiter",
    },
    response: {
      endpoint: toolOrEndpoint,
      ...details,
    },
  };
}

export function agentFlaggedEvent(
  transactionId: string,
  agentIdentity: string,
  reason: string,
  details?: Record<string, unknown>
): EventPayload {
  return {
    event_type: AuditEventType.AGENT_FLAGGED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "abuse_detector",
    },
    response: {
      agent_identity: agentIdentity,
      reason,
      ...details,
    },
  };
}

export function recurringTokenCapturedEvent(
  transactionId: string,
  data: {
    customer_id: string;
    token_id: string;
    method: string;
    max_amount?: number;
  }
): EventPayload {
  return {
    event_type: AuditEventType.RECURRING_TOKEN_CAPTURED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "recurring_token_capture",
    },
    response: data,
  };
}

export function recurringPaymentChargedEvent(
  transactionId: string,
  data: {
    payment_id: string;
    token_id: string;
    customer_id: string;
    amount: number;
    currency: string;
  }
): EventPayload {
  return {
    event_type: AuditEventType.RECURRING_PAYMENT_CHARGED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "autonomous_payment",
    },
    response: data,
  };
}

export function recurringPaymentFailedEvent(
  transactionId: string,
  data: {
    token_id: string;
    customer_id: string;
    error: string;
  }
): EventPayload {
  return {
    event_type: AuditEventType.RECURRING_PAYMENT_FAILED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "mcp",
      component: "autonomous_payment",
    },
    response: data,
  };
}

export function consentRejectedEvent(
  transactionId: string,
  data: {
    challenge_id: string;
    rejected_at: string;
    reason?: string;
  }
): EventPayload {
  return {
    event_type: AuditEventType.CONSENT_REJECTED,
    timestamp: new Date().toISOString(),
    transaction_id: transactionId,
    actor: {
      type: "buyer_agent",
      component: "consent_challenge",
    },
    response: data,
  };
}


