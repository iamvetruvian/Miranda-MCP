/**
 * Zod Schema for Manifest v2 Validation
 * Validates the complete declarative field inventory with zero inference.
 */

import { z } from "zod";

export const TransformSpecSchema = z.object({
  type: z.enum([
    "multiply",
    "divide",
    "enum",
    "default",
    "template",
    "boolean_to_enum",
    "foreach",
    "conditional",
    "date_format",
    "concat",
    "json_path",
    "coalesce",
    "substring",
    "regex_extract",
    "split",
    "to_number",
    "to_string",
    "flatten",
  ]),
  value: z.union([z.number(), z.string(), z.boolean(), z.record(z.unknown())]).optional(),
  enum_map: z.record(z.string()).optional(),
  in_stock_value: z.unknown().optional(),
  template: z.string().optional(),
  format: z.string().optional(),
  input_format: z.string().optional(),
  output_format: z.string().optional(),
  separator: z.string().optional(),
  paths: z.array(z.string()).optional(),
  fields: z.array(z.string()).optional(),
  path: z.string().optional(),
  start: z.number().optional(),
  length: z.number().optional(),
  end: z.number().optional(),
  pattern: z.string().optional(),
  regex: z.string().optional(),
  flags: z.string().optional(),
  group: z.number().optional(),
  fallback: z.unknown().optional(),
  sub_map: z.record(z.unknown()).optional(),
  otherwise: z.unknown().optional(),
  conditions: z
    .array(
      z.object({
        when: z
          .object({
            path: z.string().optional(),
            equals: z.unknown().optional(),
          })
          .optional(),
        then: z.unknown(),
      })
    )
    .optional(),
  condition: z
    .object({
      field: z.string().optional(),
      operator: z
        .enum([
          "eq",
          "neq",
          "gt",
          "gte",
          "lt",
          "lte",
          "in",
          "contains",
          "exists",
        ])
        .optional(),
      value: z.unknown().optional(),
      then: z.unknown().optional(),
      else: z.unknown().optional(),
    })
    .optional(),
});

export const FieldMappingSchema = z.object({
  from: z.string().nullable(),
  transform: TransformSpecSchema.optional(),
});

export const FieldMapSchema = z.record(FieldMappingSchema);

export const OperationMappingSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  request_mapping: FieldMapSchema.optional(),
  response_path: z.string().optional(),
  total_path: z.string().optional(),
  headers: z.record(z.string()).optional(),
  content_type: z.string().optional(),
  graphql_query: z.string().optional(),
  graphql_variables_mapping: FieldMapSchema.optional(),
  success_status_codes: z.array(z.number()).optional(),
  idempotent: z.boolean().optional(),
  timeout_ms: z.number().optional(),
  async_completion: z
    .object({
      poll_path: z.string(),
      poll_method: z.enum(["GET", "POST"]).optional(),
      status_path: z.string(),
      pending_statuses: z.array(z.string()),
      success_statuses: z.array(z.string()),
      failure_statuses: z.array(z.string()),
      poll_interval_ms: z.number().optional(),
      max_polls: z.number().optional(),
    })
    .optional(),
  static_body: z.record(z.unknown()).optional(),
  static_query: z.record(z.string()).optional(),
  form_encoded: z.boolean().optional(),
});

export const MerchantBlockSchema = z.object({
  name: z.string().min(1, "Merchant name is required"),
  description: z.string().min(1, "Merchant description is required"),
  commerce_domain: z.string().min(1, "Commerce domain is required"),
  currency: z.string().length(3, "Currency must be a 3-letter ISO code"),
  base_url: z.string().url("base_url must be a valid URL"),
  supported_currencies: z.array(z.string()).optional(),
  logo_url: z.string().url().optional(),
  terms_url: z.string().url().optional(),
  support_contact: z.string().optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  service_areas: z
    .object({
      type: z.enum(["cities", "coordinates", "postal_codes", "countries"]),
      values: z.array(z.string()),
    })
    .optional(),
});

export const OAuth2UserFlowConfigSchema = z.object({
  authorization_url: z.string().url("authorization_url must be a valid URL"),
  token_url: z.string().url("token_url must be a valid URL"),
  client_id_env: z.string().min(1).optional(),
  client_secret_env: z.string().min(1).optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  redirect_uri: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  scope: z.array(z.string()).optional(),
  access_token_path: z.string().optional(),
  refresh_token_path: z.string().optional(),
  expires_in_path: z.string().optional(),
  user_id_path: z.string().optional(),
  user_name_path: z.string().optional(),
  userinfo_url: z.string().url().optional(),
  use_pkce: z.boolean().optional(),
  session_ttl_seconds: z.number().positive().optional(),
  additional_auth_params: z.record(z.string()).optional(),
});

export const AuthConfigSchema: z.ZodType<any> = z.object({
  type: z.enum([
    "none",
    "api_key",
    "bearer",
    "basic",
    "oauth2_client_credentials",
    "oauth2_authorization_code",
    "hmac_request_signing",
    "custom_header",
  ]),
  header: z.string().optional(),
  token_env_var: z.string().optional(),
  token_prefix: z.string().optional(),
  oauth2: z
    .object({
      token_url: z.string(),
      client_id_env: z.string(),
      client_secret_env: z.string(),
      scopes: z.array(z.string()).optional(),
      token_refresh_buffer_seconds: z.number().optional(),
      audience: z.string().optional(),
    })
    .optional(),
  oauth2_user: OAuth2UserFlowConfigSchema.optional(),
  hmac: z
    .object({
      algorithm: z.enum(["sha256", "sha512"]),
      secret_env: z.string(),
      signature_components: z.array(
        z.enum(["method", "path", "query", "body", "timestamp", "nonce"])
      ),
      signature_header: z.string(),
      timestamp_header: z.string().optional(),
      nonce_header: z.string().optional(),
    })
    .optional(),
  operation_overrides: z.record(z.record(z.unknown())).optional(),
  protected_operations: z.array(z.string()).optional(),
  public_operations: z.array(z.string()).optional(),
});

export const HttpConventionsSchema = z.object({
  content_type: z.string().optional(),
  accept: z.string().optional(),
  default_headers: z.record(z.string()).optional(),
  retry: z
    .object({
      max_retries: z.number(),
      retryable_status_codes: z.array(z.number()).optional(),
      initial_backoff_ms: z.number().optional(),
      max_backoff_ms: z.number().optional(),
      retry_after_header: z.string().optional(),
    })
    .optional(),
  timeout: z
    .object({
      request_timeout_ms: z.number().optional(),
      operation_overrides: z.record(z.number()).optional(),
    })
    .optional(),
  rate_limit_hint: z
    .object({
      requests_per_window: z.number().optional(),
      window_seconds: z.number().optional(),
      remaining_header: z.string().optional(),
      reset_header: z.string().optional(),
    })
    .optional(),
  error_message_path: z.string().optional(),
  error_code_path: z.string().optional(),
  validation_errors_path: z.string().optional(),
});

export const PaginationConfigSchema = z.object({
  strategy: z.enum([
    "page_number",
    "offset_limit",
    "cursor",
    "link_header",
    "token",
    "none",
  ]),
  page_param: z.string().optional(),
  page_size_param: z.string().optional(),
  default_page_size: z.number().optional(),
  first_page: z.number().optional(),
  offset_param: z.string().optional(),
  limit_param: z.string().optional(),
  cursor_response_path: z.string().optional(),
  cursor_request_param: z.string().optional(),
  link_rel: z.string().optional(),
  total_count_path: z.string().optional(),
  has_more_path: z.string().optional(),
  current_page_path: z.string().optional(),
});

export const ErrorMappingSchema = z.object({
  code_map: z
    .record(
      z.object({
        category: z.enum([
          "out_of_stock",
          "invalid_input",
          "payment_failed",
          "not_found",
          "rate_limited",
          "auth_failed",
          "server_error",
          "checkout_expired",
          "order_cancelled",
          "refund_failed",
          "variant_required",
          "quantity_exceeded",
          "region_unavailable",
          "time_slot_unavailable",
          "coupon_invalid",
          "minimum_order_not_met",
          "transient",
          "unknown",
        ]),
        retryable: z.boolean().optional(),
        message: z.string().optional(),
      })
    )
    .optional(),
  status_code_map: z
    .record(
      z.string().or(z.number()),
      z.object({
        category: z.string(),
        retryable: z.boolean().optional(),
        message: z.string().optional(),
      })
    )
    .optional(),
});

export const WebhookConfigSchema = z.object({
  merchant_webhook_auth: z
    .object({
      type: z.enum(["hmac", "shared_secret_header", "ip_whitelist", "none"]),
      secret_env: z.string().optional(),
      signature_header: z.string().optional(),
      algorithm: z.string().optional(),
      ip_ranges: z.array(z.string()).optional(),
    })
    .optional(),
  merchant_events: z
    .array(
      z.object({
        event_type: z.string(),
        event_type_path: z.string().optional(),
        reference_id_path: z.string(),
        maps_to: z.object({
          transition_to: z.string().optional(),
          audit_event_type: z.string().optional(),
          data_mapping: FieldMapSchema.optional(),
        }),
      })
    )
    .optional(),
});

export const IntegrationConfigSchema = z.object({
  type: z.enum(["rest_manifest", "ucp_native", "graphql_manifest"]),
  ucp_endpoint: z.string().optional(),
  manifest_version: z.string().optional(),
});

export const PaymentConfigSchema = z.object({
  provider: z.literal("razorpay"),
  razorpay_key_id_env: z.string().min(1, "Razorpay Key ID env name is required"),
  razorpay_key_secret_env: z.string().min(1, "Razorpay Key Secret env name is required"),
  webhook_secret_env: z.string().optional(),
  integration_type: z
    .enum([
      "orders_and_links",
      "orders_only",
      "links_only",
      "subscriptions",
      "checkout_only",
    ])
    .optional(),
  capture: z
    .object({
      mode: z.enum(["auto_capture", "manual_capture"]),
      capture_trigger: z
        .enum(["on_order_confirm", "merchant_webhook", "manual"])
        .optional(),
      auto_capture_timeout_seconds: z.number().optional(),
    })
    .optional(),
  allowed_methods: z
    .object({
      methods: z
        .array(
          z.enum([
            "card",
            "upi",
            "netbanking",
            "wallet",
            "emi",
            "bank_transfer",
            "paylater",
          ])
        )
        .optional(),
      disabled_methods: z.array(z.string()).optional(),
      international: z.boolean().optional(),
    })
    .optional(),
  emi: z
    .object({
      available: z.boolean(),
      min_amount: z.number().optional(),
      tenures: z.array(z.number()).optional(),
      no_cost_emi: z.boolean().optional(),
    })
    .optional(),
  partial_payment: z
    .object({
      allowed: z.boolean(),
      min_first_payment_percent: z.number().optional(),
      remaining_collection: z.enum([
        "on_delivery",
        "before_shipping",
        "installments",
      ]),
    })
    .optional(),
  payment_link: z
    .object({
      expire_after_seconds: z.number().optional(),
      send_notification: z.boolean().optional(),
      reminder_hours: z.array(z.number()).optional(),
      callback_url: z.string().optional(),
      prefill_customer: z.boolean().optional(),
    })
    .optional(),
  checkout_theme: z
    .object({
      color: z.string().optional(),
      backdrop_color: z.string().optional(),
      logo_url: z.string().optional(),
      display_notes: z.record(z.string()).optional(),
    })
    .optional(),
  amount_computation: z
    .object({
      source: z.enum(["checkout_total", "separate_calculation"]),
      compute_operation: OperationMappingSchema.optional(),
      compute_amount_path: z.string().optional(),
    })
    .optional(),
  subscriptions: z
    .object({
      plan_id_source: z.enum(["manifest", "product_attribute", "merchant_api"]),
      default_plan_id: z.string().optional(),
      plan_id_path: z.string().optional(),
      plan_operation: OperationMappingSchema.optional(),
    })
    .optional(),
});

export const CustomHooksConfigSchema = z.object({
  module: z.string(),
  declared_hooks: z.array(z.string()),
});

export const IntegrationManifestSchema = z.object({
  merchant: MerchantBlockSchema,
  auth: AuthConfigSchema.optional(),
  http_conventions: HttpConventionsSchema.optional(),
  pagination: PaginationConfigSchema.optional(),
  error_mapping: ErrorMappingSchema.optional(),
  webhooks: WebhookConfigSchema.optional(),
  integration: IntegrationConfigSchema.optional(),
  intent: z.record(z.unknown()).optional(),
  operations: z.object({
    search: OperationMappingSchema,
    get_product: OperationMappingSchema,
    create_checkout: OperationMappingSchema,
    get_checkout: OperationMappingSchema,
    confirm_order: OperationMappingSchema,
    get_order_status: OperationMappingSchema,
    cancel_order: OperationMappingSchema.optional(),
    check_availability: OperationMappingSchema.optional(),
    add_to_cart: OperationMappingSchema.optional(),
    apply_coupon: OperationMappingSchema.optional(),
    calculate_fees: OperationMappingSchema.optional(),
    request_refund: OperationMappingSchema.optional(),
    get_refund_status: OperationMappingSchema.optional(),
    custom: z.record(OperationMappingSchema.extend({
      description: z.string(),
      allowed_states: z.array(z.string()).optional(),
      mutating: z.boolean().optional(),
    })).optional(),
  }),
  discovery: z.record(z.unknown()).optional(),
  refinements: z.record(z.unknown()).optional(),
  sort_options: z
    .object({
      options: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          merchant_value: z.string(),
        })
      ),
      default: z.string().optional(),
      sort_param: z.string().optional(),
    })
    .optional(),
  attribute_catalog: z
    .object({
      attributes: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          type: z.enum([
            "string",
            "number",
            "boolean",
            "enum",
            "date",
            "url",
            "money",
            "string[]",
          ]),
          enum_values: z.array(z.string()).optional(),
          filterable: z.boolean().optional(),
          sortable: z.boolean().optional(),
          display_in_search: z.boolean().optional(),
          display_in_detail: z.boolean().optional(),
          unit: z.string().optional(),
          schema_org_property: z.string().optional(),
        })
      ),
    })
    .optional(),
  filters: z.array(z.unknown()).optional(),
  offer: z.record(z.unknown()).optional(),
  field_mappings: z.object({
    offer: FieldMapSchema,
    checkout: FieldMapSchema,
    order: FieldMapSchema,
  }).and(z.record(FieldMapSchema.optional())),
  transaction: z.record(z.unknown()).optional(),
  payment: PaymentConfigSchema,
  outcome: z.record(z.unknown()).optional(),
  custom_hooks: CustomHooksConfigSchema.optional(),
  discovery_schema: z.array(z.unknown()).optional(),
});
