/**
 * MerchantMCP Integration Manifest Schema (Manifest v2)
 * Declarative, zero-inference configuration that allows any merchant across any domain
 * to describe all capabilities across the 6 commerce lifecycle stages:
 * Intent → Discovery → Offer → Transaction → Payment → Outcome.
 */

import { FilterDefinition, DiscoveryParamSpec } from "./index.js";

// ─── Transforms ──────────────────────────────────────────────────────────────

export type TransformType =
  | "multiply"
  | "divide"
  | "enum"
  | "default"
  | "template"
  | "boolean_to_enum"
  | "foreach"
  | "conditional"
  | "date_format"
  | "concat"
  | "json_path"
  | "coalesce"
  | "substring"
  | "regex_extract"
  | "split"
  | "to_number"
  | "to_string"
  | "flatten";

export interface TransformConditionWhen {
  path?: string;
  equals?: unknown;
}

export interface TransformConditionItem {
  when?: TransformConditionWhen;
  then: unknown;
}

export interface TransformSpec {
  type: TransformType;
  value?: number | string | boolean | Record<string, unknown>;
  enum_map?: Record<string, string>;
  in_stock_value?: unknown;
  template?: string;
  format?: string;
  input_format?: string;
  output_format?: string;
  separator?: string;
  paths?: string[];
  fields?: string[];
  path?: string;
  start?: number;
  length?: number;
  end?: number;
  pattern?: string;
  regex?: string;
  flags?: string;
  group?: number;
  fallback?: unknown;
  sub_map?: Record<string, unknown>;
  otherwise?: unknown;
  conditions?: TransformConditionItem[];
  condition?: {
    field?: string;
    operator?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "exists";
    value?: unknown;
    then?: unknown;
    else?: unknown;
  };
}

// ─── Field Mappings ──────────────────────────────────────────────────────────

export interface FieldMapping {
  from: string | null;
  transform?: TransformSpec;
}

export type FieldMap = Record<string, FieldMapping>;

export interface FieldMappingsBlock {
  offer: FieldMap;
  checkout: FieldMap;
  order: FieldMap;
  cart_item?: FieldMap;
  add_on?: FieldMap;
  variant?: FieldMap;
  shipping_option?: FieldMap;
  return_request?: FieldMap;
  [key: string]: FieldMap | undefined;
}

// ─── Operation Configuration ─────────────────────────────────────────────────

export interface OperationMapping {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  request_mapping?: FieldMap;
  response_path?: string;
  total_path?: string;
  headers?: Record<string, string>;
  content_type?: string;
  graphql_query?: string;
  graphql_variables_mapping?: FieldMap;
  success_status_codes?: number[];
  idempotent?: boolean;
  timeout_ms?: number;
  async_completion?: {
    poll_path: string;
    poll_method?: "GET" | "POST";
    status_path: string;
    pending_statuses: string[];
    success_statuses: string[];
    failure_statuses: string[];
    poll_interval_ms?: number;
    max_polls?: number;
  };
  static_body?: Record<string, unknown>;
  static_query?: Record<string, string>;
  form_encoded?: boolean;
}

// ─── Stage 0: Infrastructure Configuration ───────────────────────────────────

export interface MerchantBlock {
  name: string;
  description: string;
  commerce_domain: string;
  currency: string;
  base_url: string;
  supported_currencies?: string[];
  logo_url?: string;
  terms_url?: string;
  support_contact?: string;
  timezone?: string;
  locale?: string;
  service_areas?: {
    type: "cities" | "coordinates" | "postal_codes" | "countries";
    values: string[];
  };
}

export type AuthType =
  | "none"
  | "api_key"
  | "bearer"
  | "basic"
  | "oauth2_client_credentials"
  | "oauth2_authorization_code"
  | "hmac_request_signing"
  | "custom_header";

export interface OAuth2Config {
  token_url: string;
  client_id_env: string;
  client_secret_env: string;
  scopes?: string[];
  token_refresh_buffer_seconds?: number;
  audience?: string;
}

export interface OAuth2UserFlowConfig {
  /** Merchant's OAuth2 authorization endpoint (user is redirected here) */
  authorization_url: string;

  /** Merchant's OAuth2 token exchange endpoint */
  token_url: string;

  /** Env var name for OAuth2 client ID */
  client_id_env?: string;

  /** Env var name for OAuth2 client secret */
  client_secret_env?: string;

  /** Direct client ID */
  client_id?: string;

  /** Direct client secret */
  client_secret?: string;

  /** Redirect URI callback */
  redirect_uri?: string;

  /** OAuth2 scopes to request */
  scopes?: string[];
  scope?: string[];

  /**
   * JSONPath to extract the user-scoped auth token from the token response.
   * Defaults to "$.access_token"
   */
  access_token_path?: string;

  /** JSONPath to extract refresh token. Defaults to "$.refresh_token" */
  refresh_token_path?: string;

  /** JSONPath to extract token expiry in seconds. Defaults to "$.expires_in" */
  expires_in_path?: string;

  /** JSONPath to extract user ID from token response or userinfo. Optional. */
  user_id_path?: string;

  /** JSONPath to extract user display name. Optional. */
  user_name_path?: string;

  /**
   * If the token response doesn't include user info, call this endpoint
   * with the access token to get it. Optional.
   */
  userinfo_url?: string;

  /**
   * Use PKCE (Proof Key for Code Exchange).
   * Recommended for public clients. Defaults to true.
   */
  use_pkce?: boolean;

  /**
   * Session TTL in seconds after successful authentication.
   * The MCP persists the session for this duration.
   * Defaults to 2592000 (30 days).
   */
  session_ttl_seconds?: number;

  /**
   * Additional query parameters to include in the authorization URL.
   * Useful for merchant-specific customizations.
   */
  additional_auth_params?: Record<string, string>;
}

export interface HmacSigningConfig {
  algorithm: "sha256" | "sha512";
  secret_env: string;
  signature_components: ("method" | "path" | "query" | "body" | "timestamp" | "nonce")[];
  signature_header: string;
  timestamp_header?: string;
  nonce_header?: string;
}

export interface AuthConfig {
  type: AuthType;
  header?: string;
  token_env_var?: string;
  token_prefix?: string;
  oauth2?: OAuth2Config;
  oauth2_user?: OAuth2UserFlowConfig;
  hmac?: HmacSigningConfig;
  operation_overrides?: Record<string, Partial<AuthConfig>>;
  protected_operations?: string[];
  public_operations?: string[];
}

export interface HttpConventions {
  content_type?: string;
  accept?: string;
  default_headers?: Record<string, string>;
  retry?: {
    max_retries: number;
    retryable_status_codes?: number[];
    initial_backoff_ms?: number;
    max_backoff_ms?: number;
    retry_after_header?: string;
  };
  timeout?: {
    request_timeout_ms?: number;
    operation_overrides?: Record<string, number>;
  };
  rate_limit_hint?: {
    requests_per_window?: number;
    window_seconds?: number;
    remaining_header?: string;
    reset_header?: string;
  };
  error_message_path?: string;
  error_code_path?: string;
  validation_errors_path?: string;
}

export type PaginationStrategy =
  | "page_number"
  | "offset_limit"
  | "cursor"
  | "link_header"
  | "token"
  | "none";

export interface PaginationConfig {
  strategy: PaginationStrategy;
  page_param?: string;
  page_size_param?: string;
  default_page_size?: number;
  first_page?: number;
  offset_param?: string;
  limit_param?: string;
  cursor_response_path?: string;
  cursor_request_param?: string;
  link_rel?: string;
  total_count_path?: string;
  has_more_path?: string;
  current_page_path?: string;
}

export interface ErrorMapping {
  code_map?: Record<
    string,
    {
      category:
        | "out_of_stock"
        | "invalid_input"
        | "payment_failed"
        | "not_found"
        | "rate_limited"
        | "auth_failed"
        | "server_error"
        | "checkout_expired"
        | "order_cancelled"
        | "refund_failed"
        | "variant_required"
        | "quantity_exceeded"
        | "region_unavailable"
        | "time_slot_unavailable"
        | "coupon_invalid"
        | "minimum_order_not_met"
        | "transient"
        | "unknown";
      retryable?: boolean;
      message?: string;
    }
  >;
  status_code_map?: Record<
    number,
    { category: string; retryable?: boolean; message?: string }
  >;
}

export interface MerchantWebhookEventMapping {
  event_type: string;
  event_type_path?: string;
  reference_id_path: string;
  maps_to: {
    transition_to?: string;
    audit_event_type?: string;
    data_mapping?: FieldMap;
  };
}

export interface WebhookConfig {
  merchant_webhook_auth?: {
    type: "hmac" | "shared_secret_header" | "ip_whitelist" | "none";
    secret_env?: string;
    signature_header?: string;
    algorithm?: string;
    ip_ranges?: string[];
  };
  merchant_events?: MerchantWebhookEventMapping[];
}

export interface IntegrationConfig {
  type: "rest_manifest" | "ucp_native" | "graphql_manifest";
  ucp_endpoint?: string;
  manifest_version?: string;
}

// ─── Stage 1: Intent Configuration ───────────────────────────────────────────

export interface IntentConfig {
  primary_mode?: "search" | "browse" | "structured_input" | "location_first";
  category_tree?: {
    operation: OperationMapping;
    categories_path: string;
    category_mapping: {
      id_path: string;
      name_path: string;
      children_path?: string;
      image_url_path?: string;
      product_count_path?: string;
    };
    max_depth?: number;
    usable_as_filter?: boolean;
    filter_key?: string;
  };
  location_requirement?: {
    type: "coordinates" | "address" | "city" | "postal_code" | "area_name";
    required_before_search: boolean;
    param_names: {
      latitude?: string;
      longitude?: string;
      address?: string;
      city?: string;
      postal_code?: string;
      radius_km?: string;
    };
    default_radius_km?: number;
    geocode_operation?: OperationMapping;
  };
  autocomplete?: {
    operation: OperationMapping;
    suggestions_path: string;
    suggestion_mapping: {
      text_path: string;
      type_path?: string;
      metadata_path?: string;
    };
    min_chars?: number;
    debounce_ms?: number;
  };
  recommendations?: {
    operation: OperationMapping;
    trigger: "product_view" | "cart_contents" | "user_history" | "standalone";
    items_path: string;
    uses_offer_mapping?: boolean;
  };
  reorder?: {
    past_orders_operation: OperationMapping;
    orders_path: string;
    user_id_param: string;
    reorder_operation?: OperationMapping;
  };
  constraints?: {
    operating_hours?: {
      timezone: string;
      windows: { day: string; open: string; close: string }[];
    };
    min_lead_time_minutes?: number;
    max_advance_days?: number;
  };
}

// ─── Stage 2: Discovery Configuration ────────────────────────────────────────

export type RefinementMode =
  | "static"
  | "search_response"
  | "separate_endpoint"
  | "derived";

export interface RefinementSchemaConfig {
  key_path: string;
  label_path: string;
  type_path?: string;
  options_path: string;
  option_value_path: string;
  option_label_path: string;
  option_count_path?: string;
}

export interface RefinementOptionPaginationConfig {
  max_options_in_search?: number;
  sort_by?: "count" | "native";
  option_query_support?: {
    query_param: string;
    page_param?: string;
    page_size_param?: string;
  };
}

export interface RefinementConfig {
  mode: RefinementMode;
  static_filters?: FilterDefinition[];
  refinements_path?: string;
  refinement_schema?: RefinementSchemaConfig;
  facet_operation?: OperationMapping;
  derive_from_attributes?: string[];
  option_pagination?: RefinementOptionPaginationConfig;
}

export interface SemanticVocabularyConfig {
  vocabulary: "schema.org";
  offer_type?: string;
  attribute_map?: Record<string, string>;
}

export interface DiscoveryConfig {
  input_schema?: DiscoveryParamSpec[];
  semantics?: SemanticVocabularyConfig;
  multi_entity_search?: boolean;
  heterogeneous_results?: boolean;
  comparison?: {
    operation: OperationMapping;
    product_ids_param: string;
    comparison_path: string;
    max_products?: number;
  };
  similar_products?: {
    operation: OperationMapping;
    product_id_param: string;
    items_path: string;
  };
  search_type?: "fulltext" | "keyword" | "fuzzy" | "semantic";
  empty_query_allowed?: boolean;
}

export interface SortConfig {
  options: { key: string; label: string; merchant_value: string }[];
  default?: string;
  sort_param?: string;
}

export interface AttributeDeclaration {
  key: string;
  label: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "enum"
    | "date"
    | "url"
    | "money"
    | "string[]";
  enum_values?: string[];
  filterable?: boolean;
  sortable?: boolean;
  display_in_search?: boolean;
  display_in_detail?: boolean;
  unit?: string;
  schema_org_property?: string;
}

export interface AttributeCatalog {
  attributes: AttributeDeclaration[];
}

// ─── Stage 3: Offer Configuration ────────────────────────────────────────────

export interface OfferConfig {
  variants?: {
    dimensions: {
      key: string;
      label: string;
      required: boolean;
      source: "static" | "per_product";
      static_options?: { value: string; label: string }[];
      options_path?: string;
      option_value_path?: string;
      option_label_path?: string;
      affects_price?: boolean;
      affects_availability?: boolean;
    }[];
    price_resolution?: "checkout_response" | "variant_endpoint" | "included_in_product";
    variant_detail_operation?: OperationMapping;
  };
  pricing?: {
    model: "fixed" | "dynamic" | "tiered" | "subscription" | "quote" | "per_unit_weight" | "auction";
    price_volatile?: boolean;
    tiers?: {
      min_quantity: number;
      max_quantity?: number;
      price_multiplier?: number;
      per_unit_amount?: number;
    }[];
    subscription?: {
      periods: ("monthly" | "quarterly" | "annual" | "weekly" | "custom")[];
      trial_days?: number;
      create_subscription_operation?: OperationMapping;
      period_param?: string;
    };
    quote?: {
      request_quote_operation: OperationMapping;
      quoted_price_path: string;
      quote_expires_path?: string;
      quote_id_path: string;
    };
    prices_include_tax?: boolean;
    tax_display?: "included" | "excluded_shown_separately" | "calculated_at_checkout";
  };
  bundles?: {
    supported: boolean;
    bundle_detail_operation?: OperationMapping;
    items_path?: string;
    customizable?: boolean;
  };
  add_ons?: {
    supported: boolean;
    source: "in_product_detail" | "separate_endpoint";
    add_ons_path?: string;
    operation?: OperationMapping;
    add_on_mapping?: {
      id_path: string;
      name_path: string;
      price_path: string;
      description_path?: string;
    };
    checkout_param?: string;
  };
  availability?: {
    model: "boolean" | "stock_count" | "seat_map" | "time_slots" | "calendar" | "capacity" | "always_available";
    stock_count_path?: string;
    low_stock_threshold?: number;
    seat_map_operation?: OperationMapping;
    seat_map_response_path?: string;
    time_slots_operation?: OperationMapping;
    date_param?: string;
    slots_response_path?: string;
    slot_mapping?: {
      id_path: string;
      start_time_path: string;
      end_time_path?: string;
      capacity_remaining_path?: string;
    };
    calendar_operation?: OperationMapping;
    range_param?: string;
    dates_response_path?: string;
    date_mapping?: {
      date_path: string;
      available_path: string;
      price_path?: string;
    };
    check_operation?: OperationMapping;
    check_params?: {
      product_id_param: string;
      variant_params?: Record<string, string>;
    };
  };
  restrictions?: {
    age_verification_required?: boolean;
    minimum_age?: number;
    geo_restricted?: boolean;
    geo_restriction_check_operation?: OperationMapping;
    max_quantity_per_item?: number;
    max_quantity_per_customer?: number;
    requires_membership?: boolean;
    minimum_order_amount?: number;
    minimum_order_currency?: string;
  };
  ephemeral_offers?: {
    offers_expire: boolean;
    default_ttl_seconds?: number;
    expires_at_path?: string;
    warn_before_expiry_seconds?: number;
  };
  media?: {
    images_path?: string;
    image_url_path?: string;
    thumbnail_path?: string;
    video_url_path?: string;
    spec_sheet_path?: string;
  };
}

// ─── Stage 4: Transaction Configuration ──────────────────────────────────────

export interface CustomerDataField {
  field:
    | "email"
    | "phone"
    | "first_name"
    | "last_name"
    | "full_name"
    | "shipping_address"
    | "billing_address"
    | "company_name"
    | "tax_id"
    | "id_number"
    | "passport"
    | "date_of_birth"
    | "gender"
    | string;
  label: string;
  type: "string" | "email" | "phone" | "address" | "date" | "enum";
  address_components?: (
    | "line1"
    | "line2"
    | "city"
    | "state"
    | "postal_code"
    | "country"
  )[];
  enum_values?: string[];
  validation?: {
    min_length?: number;
    max_length?: number;
    pattern?: string;
  };
}

export interface TransactionConfig {
  cart?: {
    model: "single_item" | "multi_item" | "no_cart";
    multi_item?: {
      create_cart_operation?: OperationMapping;
      add_item_operation: OperationMapping;
      remove_item_operation?: OperationMapping;
      update_quantity_operation?: OperationMapping;
      get_cart_operation: OperationMapping;
      cart_to_checkout_operation?: OperationMapping;
      cart_item_mapping: {
        item_id_path: string;
        product_id_path: string;
        quantity_path: string;
        unit_price_path: string;
        line_total_path?: string;
        variant_path?: string;
      };
      cart_total_path: string;
      item_count_path?: string;
      persistent: boolean;
      cart_ttl_seconds?: number;
      max_items?: number;
    };
  };
  checkout_flow?: {
    type:
      | "single_step"
      | "multi_step"
      | "quote_approve"
      | "hold_confirm"
      | "instant_purchase";
    steps?: {
      id: string;
      label: string;
      operation: OperationMapping;
      collects: string[];
      status_path?: string;
      response_data_path?: string;
      optional?: boolean;
    }[];
    hold?: {
      holds_inventory: boolean;
      ttl_seconds: number;
      extend_hold_operation?: OperationMapping;
      max_extensions?: number;
    };
    quote?: {
      request_operation: OperationMapping;
      approve_operation: OperationMapping;
      quote_id_path: string;
      price_path: string;
      validity_seconds?: number;
      negotiable?: boolean;
      counter_offer_operation?: OperationMapping;
    };
    modifiable_after_creation?: boolean;
    update_checkout_operation?: OperationMapping;
    allows_concurrent_checkouts?: boolean;
  };
  customer_data?: {
    required: CustomerDataField[];
    optional?: CustomerDataField[];
    mapping: Record<string, { merchant_param: string; nested_path?: string }>;
  };
  delivery?: {
    type:
      | "shipping"
      | "delivery"
      | "pickup"
      | "digital"
      | "service_at_location"
      | "no_fulfillment";
    options_available?: boolean;
    shipping_options?: {
      operation: OperationMapping;
      options_path: string;
      option_mapping: {
        id_path: string;
        name_path: string;
        price_path: string;
        estimated_days_path?: string;
        description_path?: string;
      };
      selection_param: string;
    };
    pickup_locations?: {
      operation: OperationMapping;
      locations_path: string;
      location_mapping: {
        id_path: string;
        name_path: string;
        address_path?: string;
        hours_path?: string;
      };
      selection_param: string;
    };
    delivery_slots?: {
      operation: OperationMapping;
      slots_path: string;
      slot_mapping: {
        id_path: string;
        start_time_path: string;
        end_time_path: string;
        available_path?: string;
      };
      selection_param: string;
    };
    instructions_supported?: boolean;
    instructions_param?: string;
    max_instructions_length?: number;
  };
  coupons?: {
    supported: boolean;
    apply_operation: OperationMapping;
    remove_operation?: OperationMapping;
    code_param: string;
    discount_amount_path?: string;
    message_path?: string;
    stackable?: boolean;
    list_available_operation?: OperationMapping;
  };
  fees?: {
    fee_types: {
      type: string;
      label: string;
      calculation: "included_in_checkout_total" | "separate_endpoint" | "static";
      operation?: OperationMapping;
      static_amount?: number;
      response_path?: string;
    }[];
    breakdown_path?: string;
    breakdown_mapping?: {
      type_path: string;
      label_path?: string;
      amount_path: string;
    };
  };
  special_instructions?: {
    supported: boolean;
    param: string;
    max_length?: number;
    predefined_options?: {
      key: string;
      label: string;
      type: "boolean" | "text" | "enum";
      enum_values?: string[];
      param: string;
      additional_cost?: number;
    }[];
  };
  confirmation?: {
    type: "synchronous" | "async_webhook" | "async_polling" | "manual_review";
    polling_interval_ms?: number;
    max_wait_ms?: number;
    review?: {
      accept_status: string;
      reject_status: string;
      typical_review_minutes?: number;
    };
    confirmation_number_path?: string;
    estimated_fulfillment_path?: string;
  };
  preorder?: {
    supported: boolean;
    preorder_flag_path?: string;
    available_date_path?: string;
    charge_timing: "at_order" | "at_fulfillment";
  };
}

// ─── Stage 5: Payment Configuration ──────────────────────────────────────────

export interface PaymentConfig {
  provider: "razorpay";
  razorpay_key_id_env: string;
  razorpay_key_secret_env: string;
  webhook_secret_env?: string;
  integration_type?:
    | "orders_and_links"
    | "orders_only"
    | "links_only"
    | "subscriptions"
    | "checkout_only";
  capture?: {
    mode: "auto_capture" | "manual_capture";
    capture_trigger?: "on_order_confirm" | "merchant_webhook" | "manual";
    auto_capture_timeout_seconds?: number;
  };
  allowed_methods?: {
    methods?: (
      | "card"
      | "upi"
      | "netbanking"
      | "wallet"
      | "emi"
      | "bank_transfer"
      | "paylater"
    )[];
    disabled_methods?: string[];
    international?: boolean;
  };
  emi?: {
    available: boolean;
    min_amount?: number;
    tenures?: number[];
    no_cost_emi?: boolean;
  };
  partial_payment?: {
    allowed: boolean;
    min_first_payment_percent?: number;
    remaining_collection: "on_delivery" | "before_shipping" | "installments";
  };
  payment_link?: {
    expire_after_seconds?: number;
    send_notification?: boolean;
    reminder_hours?: number[];
    callback_url?: string;
    prefill_customer?: boolean;
  };
  checkout_theme?: {
    color?: string;
    backdrop_color?: string;
    logo_url?: string;
    display_notes?: Record<string, string>;
  };
  amount_computation?: {
    source: "checkout_total" | "separate_calculation";
    compute_operation?: OperationMapping;
    compute_amount_path?: string;
  };
  subscriptions?: {
    plan_id_source: "manifest" | "product_attribute" | "merchant_api";
    default_plan_id?: string;
    plan_id_path?: string;
    plan_operation?: OperationMapping;
  };
}

// ─── Stage 6: Outcome Configuration ──────────────────────────────────────────

export type CanonicalOrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "ready_for_pickup"
  | "shipped"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "completed"
  | "cancelled"
  | "return_initiated"
  | "returned"
  | "refund_pending"
  | "refunded"
  | "failed"
  | "on_hold"
  | string;

export interface OutcomeConfig {
  status_mapping?: {
    merchant_to_canonical: Record<string, CanonicalOrderStatus>;
    status_path?: string;
  };
  fulfillment?: {
    type:
      | "physical_shipping"
      | "digital_delivery"
      | "service_delivery"
      | "pickup"
      | "mixed"
      | "none";
    shipping?: {
      tracking_operation?: OperationMapping;
      tracking_number_path?: string;
      carrier_path?: string;
      tracking_url_path?: string;
      estimated_delivery_path?: string;
      status_updates_path?: string;
      status_update_mapping?: {
        timestamp_path: string;
        status_path: string;
        location_path?: string;
        description_path?: string;
      };
    };
    digital?: {
      delivery_method:
        | "download_url"
        | "license_key"
        | "access_credential"
        | "email"
        | "in_app";
      artifact_path: string;
      available_at: "on_confirmation" | "after_processing" | "via_email";
      artifact_ttl_seconds?: number;
      max_downloads?: number;
    };
    service?: {
      confirmation_type:
        | "booking_code"
        | "qr_code"
        | "appointment_id"
        | "ticket"
        | "pnr"
        | "voucher";
      artifact_path: string;
      artifact_operation?: OperationMapping;
      checkin_operation?: OperationMapping;
    };
    pickup?: {
      location_path?: string;
      pickup_window_path?: string;
      pickup_code_path?: string;
    };
  };
  modifications?: {
    supported: boolean;
    modifiable_fields?: {
      field:
        | "delivery_address"
        | "delivery_date"
        | "delivery_slot"
        | "appointment_time"
        | "seat"
        | "room_type"
        | "quantity"
        | "variant"
        | string;
      operation: OperationMapping;
      modification_fee?: number;
      window_seconds?: number;
    }[];
  };
  cancellation?: {
    supported: boolean;
    policy?: {
      free_window_seconds: number;
      fee_after_window?: number;
      fee_type?: "fixed" | "percentage";
      fee_percentage?: number;
      partial_cancellation?: boolean;
      partial_cancel_operation?: OperationMapping;
      accepted_reasons?: { value: string; label: string }[];
    };
  };
  returns?: {
    supported: boolean;
    policy?: {
      window_days: number;
      conditions?: (
        | "unused"
        | "with_tags"
        | "in_original_packaging"
        | "defective_only"
        | "any"
      )[];
      return_shipping: "buyer_paid" | "merchant_paid" | "depends_on_reason";
      restocking_fee_percent?: number;
    };
    initiate_operation?: OperationMapping;
    label_operation?: OperationMapping;
    status_operation?: OperationMapping;
    return_id_path?: string;
    return_status_path?: string;
    exchange_supported?: boolean;
    exchange_operation?: OperationMapping;
  };
  merchant_refund?: {
    has_merchant_refund: boolean;
    request_operation?: OperationMapping;
    status_operation?: OperationMapping;
    refund_id_path?: string;
    partial_supported?: boolean;
    refund_to_wallet?: boolean;
    processing_days?: number;
  };
  invoice?: {
    available: boolean;
    operation?: OperationMapping;
    format?: "pdf_url" | "html" | "json";
    content_path?: string;
    available_at?: "on_confirmation" | "on_dispatch" | "on_demand";
  };
  notifications?: {
    merchant_sends_notifications?: boolean;
    channels?: ("email" | "sms" | "push" | "whatsapp")[];
    preferences_operation?: OperationMapping;
  };
}

// ─── Custom Hooks Escape Hatch ───────────────────────────────────────────────

export interface CustomHooksConfig {
  module: string;
  declared_hooks: string[];
}

// ─── Operations Block ────────────────────────────────────────────────────────

export interface OperationsBlock {
  search: OperationMapping;
  get_product: OperationMapping;
  create_checkout: OperationMapping;
  get_checkout: OperationMapping;
  confirm_order: OperationMapping;
  get_order_status: OperationMapping;
  cancel_order?: OperationMapping;
  check_availability?: OperationMapping;
  add_to_cart?: OperationMapping;
  apply_coupon?: OperationMapping;
  calculate_fees?: OperationMapping;
  request_refund?: OperationMapping;
  get_refund_status?: OperationMapping;
  custom?: Record<
    string,
    OperationMapping & {
      description: string;
      allowed_states?: string[];
      mutating?: boolean;
    }
  >;
}

// ─── Full Integration Manifest ───────────────────────────────────────────────

export interface IntegrationManifest {
  // Stage 0: Infrastructure
  merchant: MerchantBlock;
  auth?: AuthConfig;
  http_conventions?: HttpConventions;
  pagination?: PaginationConfig;
  error_mapping?: ErrorMapping;
  webhooks?: WebhookConfig;
  integration?: IntegrationConfig;

  // Stage 1: Intent
  intent?: IntentConfig;

  // Stage 2: Discovery
  operations: OperationsBlock;
  discovery?: DiscoveryConfig;
  refinements?: RefinementConfig;
  sort_options?: SortConfig;
  attribute_catalog?: AttributeCatalog;
  filters?: FilterDefinition[];

  // Stage 3: Offer
  offer?: OfferConfig;
  field_mappings: FieldMappingsBlock;

  // Stage 4: Transaction
  transaction?: TransactionConfig;

  // Stage 5: Payment
  payment: PaymentConfig;

  // Stage 6: Outcome
  outcome?: OutcomeConfig;

  // Escape Hatch
  custom_hooks?: CustomHooksConfig;

  // Legacy/Domain-Specific Extension
  discovery_schema?: DiscoveryParamSpec[];
}
