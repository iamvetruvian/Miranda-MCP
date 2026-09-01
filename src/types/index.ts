/**
 * MerchantMCP Core Type Definitions
 * Canonical data structures for the drop-in agentic commerce MCP gateway.
 */

// ─── Money & Pricing ─────────────────────────────────────────────────────────

export interface Money {
  /** Amount in smallest currency sub-unit (e.g., paise for INR, cents for USD) */
  amount: number;
  /** Currency code in ISO 4217 format (e.g., "INR") */
  currency: string;
}

export interface VariantDimension {
  key: string;
  label: string;
  required: boolean;
  options: Array<{ value: string; label: string; available?: boolean }>;
  affects_price?: boolean;
  affects_availability?: boolean;
}

export interface OfferPricingInfo {
  model: "fixed" | "dynamic" | "tiered" | "subscription" | "quote" | "per_unit_weight" | "auction" | string;
  tiers?: Array<{ min_quantity: number; max_quantity?: number; per_unit_amount?: number }>;
  subscription_periods?: string[];
  prices_include_tax?: boolean;
  tax_display?: string;
}

export interface AddOn {
  id: string;
  name: string;
  price: Money;
  description?: string;
}

/**
 * Offer is the universal abstraction of anything a merchant can sell
 * (physical goods, digital products, rides, tickets, appointments, meals, etc.).
 */
export interface Offer {
  /** Merchant-unique identifier for this offer/SKU */
  offer_id: string;
  /** Display title or name */
  title: string;
  /** Summary or detailed description */
  description: string;
  /** Canonical price object */
  price: Money;
  /** Real-time stock / fulfillment availability */
  availability: "in_stock" | "out_of_stock" | "limited" | "available" | "sold_out" | string;
  /** Arbitrary domain-specific attributes (brand, specs, rating, author, origin, etc.) */
  attributes: Record<string, unknown>;
  /** Optional media / images */
  images?: string[];
  /** Optional expiration timestamp for ephemeral offers (e.g. cab fare quotes, seat locks) */
  expires_at?: string;
  /** Optional Schema.org semantic projection — descriptive metadata ONLY.
   *  Never used in policy, pricing, or audit decisions. */
  semantic?: { type: string; properties: Record<string, unknown> };
  /** Variant dimensions (e.g. size, color, storage) */
  variants?: VariantDimension[];
  /** Detailed pricing model info */
  pricing_info?: OfferPricingInfo;
  /** Available add-ons or optional extras */
  add_ons?: AddOn[];
  /** Available stock count */
  stock_count?: number;
  /** Rich media */
  media?: { images?: string[]; video_url?: string; thumbnail?: string };
}

// ─── Discovery & Filtering ───────────────────────────────────────────────────

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterDefinition {
  key: string;
  label: string;
  type: "enum" | "range" | "boolean";
  options?: FilterOption[];
  min?: number;
  max?: number;
}

export interface SortOption {
  key: string;
  label: string;
}

/**
 * Refinement — a dynamically discovered filter/facet applicable to
 * the current search state. Richer than FilterDefinition: supports
 * multi_select, hierarchical types, result counts, and pagination.
 */
export interface RefinementOption {
  value: string;
  label: string;
  count?: number;
}

export interface Refinement {
  key: string;              // e.g. "brand" — used as the filter key in subsequent searches
  label: string;            // e.g. "Brand" — human/agent-readable display label
  type: "enum" | "multi_enum" | "range" | "boolean" | "hierarchical";
  multi_select?: boolean;   // Can agent select multiple values? Default: true for enum
  options?: RefinementOption[];
  option_count?: number;    // Total options available
  has_more?: boolean;       // More options available beyond what's returned
  min?: number;             // For range type
  max?: number;             // For range type
  currency?: string;        // For price-type ranges
}

export interface SearchResult {
  /** Stateful search identifier for tracking query sessions & refinements */
  search_id: string;
  /** List of normalized canonical offers */
  offers: Offer[];
  /** Total matching results count reported by merchant */
  total_results: number;
  /** Dynamically discovered refinements valid for this search state */
  refinements: Refinement[];
  /** Legacy alias for backward compatibility */
  available_filters?: FilterDefinition[];
  /** Available sort keys */
  sort_options: SortOption[];
  /** Pagination metadata */
  page_info: {
    page: number;
    page_size: number;
    has_more: boolean;
  };
}

// ─── Merchant Metadata ────────────────────────────────────────────────────────

/**
 * Domain-specific discovery input declared by the merchant.
 * e.g. transportation: origin/destination/departure_time;
 *      ticketing: event/city/date; retail: (none — query+filters suffice).
 */
export interface DiscoveryParamSpec {
  name: string;              // canonical parameter name, e.g. "origin"
  type: "string" | "number" | "boolean" | "date" | "datetime" | "location" | "enum";
  required?: boolean;        // enforced MCP-side before executing the search
  description?: string;      // agent-facing explanation
  example?: string | number | boolean;
  enum_values?: string[];    // for type: "enum"
}

export interface MerchantCapabilities {
  search: boolean;
  product_lookup: boolean;
  checkout: boolean;
  order_status: boolean;
  refund: boolean;
  cancel?: boolean;
  dynamic_refinements?: boolean;
  refinement_options?: boolean;
  availability_check?: boolean;
}

export interface MerchantInfo {
  name: string;
  description: string;
  commerce_domain: string;
  currency: string;
  /** Deterministic compatibility classification (Component 2) */
  integration_level: "incompatible" | "discoverable" | "transactable" | "fully_manageable";
  capabilities: MerchantCapabilities;
  /** Domain-specific discovery inputs the agent should supply (Component 4) */
  discovery_schema?: DiscoveryParamSpec[];
  /** Discovered / initial refinements */
  refinements: Refinement[];
  /** Refinement mode configured by merchant */
  refinement_mode?: string;
  /** Legacy alias */
  available_filters?: FilterDefinition[];
  /** Primary discovery intent mode */
  intent_mode?: string;
  /** Declared sort options */
  sort_options?: Array<{ key: string; label: string }>;
  /** Full attribute catalog */
  attribute_catalog?: Array<{
    key: string;
    label: string;
    type: string;
    filterable?: boolean;
    sortable?: boolean;
    enum_values?: string[];
  }>;
  /** Domain constraints */
  constraints?: Record<string, unknown> | null;
  /** User authentication & login instructions for buyer agents */
  authentication?: {
    type: string;
    flow?: string;
    requires_login?: boolean;
    instructions?: string;
  };
}

// ─── Transaction Lifecycle ────────────────────────────────────────────────────

export enum TransactionState {
  CREATED            = "CREATED",
  CHECKOUT_CREATED   = "CHECKOUT_CREATED",
  MANDATE_EVALUATED  = "MANDATE_EVALUATED",
  PAYMENT_PENDING    = "PAYMENT_PENDING",
  PAYMENT_AUTHORIZED = "PAYMENT_AUTHORIZED",
  ORDER_CONFIRMED    = "ORDER_CONFIRMED",
  REFUND_PENDING     = "REFUND_PENDING",
  REFUNDED           = "REFUNDED",
  FAILED             = "FAILED",
  CANCELLED          = "CANCELLED",
}

export interface AgentClaim {
  product_id: string;
  title?: string;
  quantity: number;
  variant?: Record<string, string>;
  selection_reason: string;
}

export interface CartItem {
  item_id?: string;
  product_id: string;
  quantity: number;
  unit_price?: Money;
  line_total?: Money;
  variant?: Record<string, string>;
}

export interface Cart {
  cart_id?: string;
  items: CartItem[];
  total: Money;
  item_count: number;
}

export interface DeliveryOption {
  id: string;
  name: string;
  price: Money;
  estimated_days?: string;
  description?: string;
}

export interface DeliverySlot {
  id: string;
  start_time: string;
  end_time: string;
  available: boolean;
}

export interface PickupLocation {
  id: string;
  name: string;
  address?: string;
  hours?: string;
}

export interface CustomerData {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  shipping_address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  billing_address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  [key: string]: unknown;
}

export interface MerchantVerifiedCheckout {
  checkout_id: string;
  sku: string;
  title?: string;
  unit_price: Money;
  total: Money;
  available: boolean;
  expires_at?: string;
  raw_merchant_data?: Record<string, unknown>;
}

export interface RefundRecord {
  refund_id: string;
  amount: Money;
  status: "initiated" | "processed" | "failed";
  reason?: string;
  created_at: string;
  processed_at?: string;
}

export interface PaymentBinding {
  provider: "razorpay";
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  payment_link_url?: string;
  payment_link_id?: string;
  payment_status: "pending" | "authorized" | "captured" | "failed";
  refunds?: RefundRecord[];
  refunded_amount?: number;
}

export interface MerchantOrderBinding {
  order_id: string;
  status: string;
  confirmed_at?: string;
  tracking_reference?: string;
}

export interface Transaction {
  /** MCP-generated unique transaction ID (never trusted from agent) */
  transaction_id: string;
  /** Current state machine state */
  state: TransactionState;
  /** Timestamp when transaction was initiated */
  created_at: string;
  /** Untrusted purchase intent claimed by the buyer agent */
  agent_claim: AgentClaim;
  /** Authoritative merchant checkout facts */
  merchant_verified?: MerchantVerifiedCheckout;
  /** Payment orchestration data */
  payment?: PaymentBinding;
  /** Authoritative merchant order confirmation */
  merchant_order?: MerchantOrderBinding;
  /** Deterministic policy evaluation record */
  policy_decision?: PolicyDecision;
  /** Mandate authorization reference (AP2) */
  authorization_reference?: string;
  /** Ordered list of audit event IDs associated with this transaction */
  audit_event_ids: string[];
}

// ─── Policy Engine ───────────────────────────────────────────────────────────

export interface PolicyCheck {
  gate: string;
  result: "PASS" | "FAIL";
  detail: string;
}

export interface PolicyDecision {
  decision: "ALLOW" | "DENY";
  gate_token?: string;
  checks: PolicyCheck[];
  evaluated_at: string;
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────

export enum AuditEventType {
  MCP_TOOL_INVOKED         = "MCP_TOOL_INVOKED",
  MCP_TOOL_COMPLETED       = "MCP_TOOL_COMPLETED",
  MCP_TOOL_FAILED          = "MCP_TOOL_FAILED",
  SEARCH_EXECUTED          = "SEARCH_EXECUTED",
  PRODUCT_RESOLVED         = "PRODUCT_RESOLVED",
  CHECKOUT_CREATED         = "CHECKOUT_CREATED",
  POLICY_EVALUATED         = "POLICY_EVALUATED",
  PAYMENT_ORDER_CREATED    = "PAYMENT_ORDER_CREATED",
  PAYMENT_LINK_GENERATED   = "PAYMENT_LINK_GENERATED",
  PAYMENT_WEBHOOK_RECEIVED = "PAYMENT_WEBHOOK_RECEIVED",
  PAYMENT_CAPTURED         = "PAYMENT_CAPTURED",
  ORDER_SUBMITTED          = "ORDER_SUBMITTED",
  ORDER_CONFIRMED          = "ORDER_CONFIRMED",
  STATE_TRANSITION           = "STATE_TRANSITION",
  TRANSACTION_FAILED         = "TRANSACTION_FAILED",
  TRANSACTION_CANCELLED      = "TRANSACTION_CANCELLED",
  REFUND_REQUESTED           = "REFUND_REQUESTED",
  REFUND_INITIATED           = "REFUND_INITIATED",
  REFUND_PROCESSED           = "REFUND_PROCESSED",
  REFUND_FAILED              = "REFUND_FAILED",
  IDEMPOTENCY_REPLAY         = "IDEMPOTENCY_REPLAY",
  SEARCH_REFINED             = "SEARCH_REFINED",
  WEBHOOK_SIGNATURE_VERIFIED = "WEBHOOK_SIGNATURE_VERIFIED",
  WEBHOOK_SIGNATURE_INVALID  = "WEBHOOK_SIGNATURE_INVALID",
  WEBHOOK_SIGNATURE_MISSING  = "WEBHOOK_SIGNATURE_MISSING",
  REFINEMENT_OPTIONS_QUERIED = "REFINEMENT_OPTIONS_QUERIED",
  LEDGER_CHECKPOINT          = "LEDGER_CHECKPOINT",
  MANDATE_CREATED            = "MANDATE_CREATED",
  MANDATE_EVALUATED          = "MANDATE_EVALUATED",
  MANDATE_REJECTED           = "MANDATE_REJECTED",
  CONSENT_CHALLENGED         = "CONSENT_CHALLENGED",
  CONSENT_GRANTED            = "CONSENT_GRANTED",
  RATE_LIMITED               = "RATE_LIMITED",
  AGENT_FLAGGED              = "AGENT_FLAGGED",
}

export interface AuditActor {
  type: "buyer_agent" | "mcp" | "merchant" | "razorpay" | "system";
  component?: string;
  instance_id?: string;
}

export interface AuditIntegrity {
  previous_event_hash: string;
  event_hash: string;
}

export interface AuditEvent {
  event_id: string;
  event_type: AuditEventType;
  timestamp: string;
  transaction_id: string;
  actor: AuditActor;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  policy?: {
    decision: "ALLOW" | "DENY";
    checks: PolicyCheck[];
  };
  state_transition?: {
    from: TransactionState;
    to: TransactionState;
    trigger: string;
  };
  integrity: AuditIntegrity;
}
