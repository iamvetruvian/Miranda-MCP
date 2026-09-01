/**
 * Merchant Connector Runtime (Manifest v2)
 * Interprets the declarative Integration Manifest and orchestrates HTTP calls
 * across all 6 stages of the commerce lifecycle with zero inference.
 */

import crypto from "crypto";
import { IntegrationManifest, OperationMapping } from "../types/manifest.js";
import {
  Offer,
  SearchResult,
  Refinement,
  MerchantVerifiedCheckout,
  MerchantOrderBinding,
  Money,
  Cart,
  CartItem,
  SortOption,
  RefinementOption,
} from "../types/index.js";
import { RequestMapper, ResponseMapper } from "./mapper.js";
import { RefinementExtractor } from "./refinements.js";
import { AuthProvider } from "./auth-provider.js";
import { RetryHandler } from "./retry.js";
import { PaginationHandler } from "./pagination-handler.js";
import { ErrorParser, MerchantApiError, type ParsedError } from "./error-parser.js";
import { MerchantAdapterHooks, loadHooks } from "./hooks.js";
import {
  OfferSchema,
  CheckoutResponseSchema,
  OrderConfirmationSchema,
} from "./validator.js";

export { MerchantApiError, type ParsedError };

export class ConnectorRuntime {
  private manifest: IntegrationManifest;
  private requestMapper = new RequestMapper();
  private responseMapper = new ResponseMapper();
  private refinementExtractor = new RefinementExtractor();
  private authProvider: AuthProvider;
  private retryHandler: RetryHandler;
  private paginationHandler: PaginationHandler;
  private errorParser: ErrorParser;
  private hooks: MerchantAdapterHooks | null = null;

  constructor(manifest: IntegrationManifest, hooks?: MerchantAdapterHooks | null) {
    this.manifest = manifest;
    this.authProvider = new AuthProvider(manifest.auth);
    this.retryHandler = new RetryHandler(manifest.http_conventions?.retry);
    this.paginationHandler = new PaginationHandler(manifest.pagination);
    this.errorParser = new ErrorParser(manifest.error_mapping, manifest.http_conventions);
    this.hooks = hooks ?? null;
  }

  /**
   * Asynchronously initialize custom hooks if declared in manifest.
   */
  async init(): Promise<void> {
    if (!this.hooks && this.manifest.custom_hooks) {
      this.hooks = await loadHooks(this.manifest.custom_hooks);
    }
  }

  /**
   * Get merchant metadata and capabilities.
   */
  getManifest(): IntegrationManifest {
    return this.manifest;
  }

  /**
   * Execute a search query against the merchant's search endpoint
   * and normalize the results into canonical Offers, SearchResult structure,
   * and dynamic refinements.
   */
  async search(params: {
    query: string;
    filters?: Record<string, unknown>;
    page?: number;
    pageSize?: number;
    sort?: string;
    cursor?: string;
    parameters?: Record<string, unknown>;
    sessionToken?: string;
  }): Promise<SearchResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    let canonicalParams: Record<string, unknown> = {
      query: params.query ?? "",
      filters: params.filters ?? {},
      page,
      sort: params.sort ?? "",
      parameters: params.parameters ?? {},
      ...this.paginationHandler.buildParams({ page, pageSize, cursor: params.cursor }),
    };

    if (params.sort && this.manifest.sort_options) {
      const sortOption = this.manifest.sort_options.options?.find((o) => o.key === params.sort);
      if (sortOption) {
        canonicalParams[this.manifest.sort_options.sort_param ?? "sort"] =
          sortOption.merchant_value ?? params.sort;
      }
    }

    if (this.hooks?.transform_search_request) {
      canonicalParams = this.hooks.transform_search_request(canonicalParams);
    }

    const opConfig = this.manifest.operations.search;
    const fullRawResponse = params.sessionToken
      ? await this.executeOperationRaw("search", canonicalParams, params.sessionToken)
      : await this.executeOperationRaw("search", canonicalParams);

    // Extract list of items using response_path or fallback
    const rawItems = opConfig.response_path
      ? ((this.responseMapper.resolvePath(
          fullRawResponse,
          opConfig.response_path
        ) as unknown[]) ?? [])
      : Array.isArray(fullRawResponse)
      ? fullRawResponse
      : typeof fullRawResponse === "object" && fullRawResponse !== null
      ? (fullRawResponse as Record<string, unknown>).items ??
        (fullRawResponse as Record<string, unknown>).results ??
        (fullRawResponse as Record<string, unknown>).products ??
        (fullRawResponse as Record<string, unknown>).books ??
        (fullRawResponse as Record<string, unknown>).showtimes ??
        []
      : [];

    const rawArray = Array.isArray(rawItems) ? rawItems : [];

    const offers: Offer[] = rawArray.map((item) => {
      const mapped = this.responseMapper.mapOne<Offer>(
        this.manifest.field_mappings.offer,
        item
      );
      // Validate schema
      const parseResult = OfferSchema.safeParse(mapped);
      let offer: Offer = !parseResult.success
        ? {
            offer_id: String(mapped.offer_id ?? "unknown"),
            title: String(mapped.title ?? "Untitled Offer"),
            description: String(mapped.description ?? ""),
            price:
              mapped.price?.amount !== undefined
                ? mapped.price
                : {
                    amount: 0,
                    currency: this.manifest.merchant.currency,
                  },
            availability: mapped.availability ?? "in_stock",
            attributes: mapped.attributes ?? {},
          }
        : parseResult.data;

      if (this.hooks?.normalize_offer) {
        offer = this.hooks.normalize_offer(item, offer);
      }

      return this.applySemantics(offer);
    });

    // Extract dynamic refinements based on configured mode
    let dynamicRefinements: Refinement[] = [];
    const refConfig = this.manifest.refinements;
    if (refConfig) {
      dynamicRefinements = await this.refinementExtractor.extract(
        refConfig,
        fullRawResponse,
        rawArray,
        (op, p) =>
          params.sessionToken
            ? this.executeOperationFromMapping(op, p, params.sessionToken)
            : this.executeOperationFromMapping(op, p),
        canonicalParams
      );
    }

    const sortOptions: SortOption[] = this.manifest.sort_options?.options
      ? this.manifest.sort_options.options.map((s) => ({ key: s.key, label: s.label }))
      : [
          { key: "price_asc", label: "Price: Low to High" },
          { key: "price_desc", label: "Price: High to Low" },
          { key: "relevance", label: "Relevance" },
        ];

    const paginationMeta = this.paginationHandler.extractMetadata(
      fullRawResponse,
      offers.length,
      page
    );

    let total = offers.length;
    if (opConfig.total_path) {
      const extractedTotal = this.responseMapper.resolvePath(fullRawResponse, opConfig.total_path);
      if (typeof extractedTotal === "number") {
        total = extractedTotal;
      }
    } else if (paginationMeta.total_count !== undefined) {
      total = paginationMeta.total_count;
    }

    const effectivePageSize = params.pageSize ?? this.manifest.pagination?.default_page_size ?? offers.length;
    const hasMore = opConfig.total_path
      ? total > page * effectivePageSize
      : paginationMeta.has_more;

    return {
      search_id: `srch_${crypto.randomUUID()}`,
      offers,
      total_results: total,
      refinements: dynamicRefinements,
      sort_options: sortOptions,
      page_info: {
        page: paginationMeta.page,
        page_size: effectivePageSize,
        has_more: hasMore,
      },
    };
  }

  /**
   * Delegates refinement options search/pagination to merchant endpoint if supported.
   */
  async searchRefinementOptions(params: {
    searchParams: Record<string, unknown>;
    refinementKey: string;
    query?: string;
    page?: number;
    pageSize?: number;
    sessionToken?: string;
  }): Promise<{ options: RefinementOption[]; total?: number; has_more?: boolean } | null> {
    const refConfig = this.manifest.refinements;
    if (
      refConfig?.mode === "separate_endpoint" &&
      refConfig.facet_operation &&
      refConfig.option_pagination?.option_query_support
    ) {
      const qSupport = refConfig.option_pagination.option_query_support;
      const merchantParams: Record<string, unknown> = {
        ...params.searchParams,
        refinement_key: params.refinementKey,
        [qSupport.query_param]: params.query ?? "",
      };
      if (qSupport.page_param) merchantParams[qSupport.page_param] = params.page ?? 1;
      if (qSupport.page_size_param) merchantParams[qSupport.page_size_param] = params.pageSize ?? 25;

      const facetRaw = params.sessionToken
        ? await this.executeOperationFromMapping(refConfig.facet_operation, merchantParams, params.sessionToken)
        : await this.executeOperationFromMapping(refConfig.facet_operation, merchantParams);
      const facets = await this.refinementExtractor.extract(refConfig, facetRaw, []);
      const target = facets.find((f: Refinement) => f.key === params.refinementKey);
      if (target?.options) {
        return {
          options: target.options,
          total: target.option_count ?? target.options.length,
          has_more: target.has_more ?? false,
        };
      }
    }
    return null;
  }

  /**
   * Retrieve a single offer by its product ID.
   */
  async getProduct(productId: string, sessionToken?: string): Promise<Offer> {
    const rawResponse = sessionToken
      ? await this.executeOperation("get_product", { product_id: productId }, sessionToken)
      : await this.executeOperation("get_product", { product_id: productId });
    const mapped = this.responseMapper.mapOne<Offer>(
      this.manifest.field_mappings.offer,
      rawResponse
    );
    const parsed = OfferSchema.safeParse(mapped);
    if (!parsed.success) {
      throw new Error(`Merchant returned invalid product schema: ${parsed.error.message}`);
    }
    let offer = parsed.data;
    if (this.hooks?.normalize_offer) {
      offer = this.hooks.normalize_offer(rawResponse, offer);
    }
    return this.applySemantics(offer);
  }

  /**
   * Check real-time availability for a product/variant/date.
   */
  async checkAvailability(
    productId: string,
    variant?: Record<string, string>,
    date?: string,
    sessionToken?: string
  ): Promise<{
    available: boolean;
    stock_count?: number;
    time_slots?: Array<{ id: string; start_time: string; end_time?: string; remaining?: number }>;
    next_available_date?: string;
  }> {
    const avail = this.manifest.offer?.availability;
    if (!avail?.check_operation) {
      throw new Error("Availability check not supported — manifest.offer.availability.check_operation not declared.");
    }

    const params: Record<string, unknown> = {
      product_id: productId,
      ...(variant ?? {}),
      ...(date ? { date } : {}),
    };

    const rawResponse = sessionToken
      ? await this.executeOperationFromConfig(avail.check_operation, params, "check_availability", sessionToken)
      : await this.executeOperationFromConfig(avail.check_operation, params, "check_availability");

    switch (avail.model) {
      case "boolean":
        return { available: Boolean(rawResponse) };

      case "stock_count": {
        const count = avail.stock_count_path
          ? Number(this.responseMapper.resolvePath(rawResponse, avail.stock_count_path))
          : typeof rawResponse === "number"
          ? rawResponse
          : Number((rawResponse as any)?.stock_count ?? (rawResponse as any)?.count ?? 0);
        return {
          available: count > 0,
          stock_count: count,
        };
      }

      case "time_slots": {
        const rawSlots = (avail.slots_response_path
          ? this.responseMapper.resolvePath(rawResponse, avail.slots_response_path)
          : rawResponse) as unknown[];
        const slots = (Array.isArray(rawSlots) ? rawSlots : []).map((s: unknown) => ({
          id: String(
            avail.slot_mapping?.id_path
              ? this.responseMapper.resolvePath(s, avail.slot_mapping.id_path)
              : (s as any)?.id ?? ""
          ),
          start_time: String(
            avail.slot_mapping?.start_time_path
              ? this.responseMapper.resolvePath(s, avail.slot_mapping.start_time_path)
              : (s as any)?.start_time ?? ""
          ),
          end_time: avail.slot_mapping?.end_time_path
            ? String(this.responseMapper.resolvePath(s, avail.slot_mapping.end_time_path))
            : (s as any)?.end_time,
          remaining: avail.slot_mapping?.capacity_remaining_path
            ? Number(this.responseMapper.resolvePath(s, avail.slot_mapping.capacity_remaining_path))
            : (s as any)?.remaining,
        }));
        return { available: slots.length > 0, time_slots: slots };
      }

      case "calendar": {
        const rawDates = (avail.dates_response_path
          ? this.responseMapper.resolvePath(rawResponse, avail.dates_response_path)
          : rawResponse) as unknown[];
        const available = (Array.isArray(rawDates) ? rawDates : []).some((d: unknown) =>
          avail.date_mapping?.available_path
            ? Boolean(this.responseMapper.resolvePath(d, avail.date_mapping.available_path))
            : Boolean((d as any)?.available)
        );
        return { available };
      }

      default:
        return { available: true };
    }
  }

  /**
   * Create an authoritative checkout session on the merchant's platform.
   */
  async createCheckout(
    productId: string,
    quantity: number,
    variant?: Record<string, string>,
    customerData?: Record<string, unknown>,
    sessionToken?: string
  ): Promise<MerchantVerifiedCheckout> {
    let canonicalParams: Record<string, unknown> = {
      product_id: productId,
      quantity,
      ...(variant ? { variant } : {}),
      ...(customerData ? { customer_data: customerData, ...customerData } : {}),
    };

    const customerConfig = this.manifest.transaction?.customer_data;
    if (customerConfig?.mapping && customerData) {
      for (const [canonical, config] of Object.entries(customerConfig.mapping)) {
        if (customerData[canonical] !== undefined) {
          canonicalParams[config.merchant_param] = customerData[canonical];
        }
      }
    }

    if (this.hooks?.transform_checkout_request) {
      canonicalParams = this.hooks.transform_checkout_request(canonicalParams);
    }

    const rawResponse = sessionToken
      ? await this.executeOperation("create_checkout", canonicalParams, sessionToken)
      : await this.executeOperation("create_checkout", canonicalParams);
    const mapped = this.responseMapper.mapOne<MerchantVerifiedCheckout>(
      this.manifest.field_mappings.checkout,
      rawResponse
    );
    const parsed = CheckoutResponseSchema.safeParse(mapped);
    if (!parsed.success) {
      throw new Error(`Merchant returned invalid checkout schema: ${parsed.error.message}`);
    }
    const defaultUnitPrice: Money = {
      amount: Math.round((parsed.data.total.amount || 0) / quantity),
      currency: parsed.data.total.currency || this.manifest.merchant.currency,
    };
    let checkout: MerchantVerifiedCheckout = {
      checkout_id: parsed.data.checkout_id,
      sku: parsed.data.sku || productId,
      title: parsed.data.title,
      unit_price: parsed.data.unit_price || defaultUnitPrice,
      total: parsed.data.total,
      available: parsed.data.available,
      expires_at: parsed.data.expires_at,
      raw_merchant_data:
        typeof rawResponse === "object" && rawResponse !== null
          ? (rawResponse as Record<string, unknown>)
          : {},
    };

    if (this.hooks?.normalize_checkout) {
      checkout = this.hooks.normalize_checkout(rawResponse, checkout);
    }

    return checkout;
  }

  /**
   * Retrieve an existing checkout session by its checkout ID.
   */
  async getCheckout(checkoutId: string, sessionToken?: string): Promise<MerchantVerifiedCheckout> {
    const rawResponse = sessionToken
      ? await this.executeOperation("get_checkout", { checkout_id: checkoutId }, sessionToken)
      : await this.executeOperation("get_checkout", { checkout_id: checkoutId });
    const mapped = this.responseMapper.mapOne<MerchantVerifiedCheckout>(
      this.manifest.field_mappings.checkout,
      rawResponse
    );
    const parsed = CheckoutResponseSchema.safeParse(mapped);
    if (!parsed.success) {
      throw new Error(`Merchant returned invalid checkout schema: ${parsed.error.message}`);
    }
    const defaultUnitPrice: Money = {
      amount: parsed.data.total.amount || 0,
      currency: parsed.data.total.currency || this.manifest.merchant.currency,
    };
    let checkout: MerchantVerifiedCheckout = {
      checkout_id: parsed.data.checkout_id,
      sku: parsed.data.sku || "unknown",
      title: parsed.data.title,
      unit_price: parsed.data.unit_price || defaultUnitPrice,
      total: parsed.data.total,
      available: parsed.data.available,
      expires_at: parsed.data.expires_at,
      raw_merchant_data:
        typeof rawResponse === "object" && rawResponse !== null
          ? (rawResponse as Record<string, unknown>)
          : {},
    };

    if (this.hooks?.normalize_checkout) {
      checkout = this.hooks.normalize_checkout(rawResponse, checkout);
    }

    return checkout;
  }

  /**
   * Confirm the order on the merchant's platform after payment authorization.
   */
  async confirmOrder(
    checkoutId: string,
    paymentId: string,
    options?: { customer?: Record<string, unknown>; sessionToken?: string }
  ): Promise<MerchantOrderBinding> {
    let canonicalParams: Record<string, unknown> = {
      checkout_id: checkoutId,
      payment_id: paymentId,
      razorpay_payment_id: paymentId,
      customer: options?.customer,
    };

    if (this.hooks?.transform_confirm_request) {
      canonicalParams = this.hooks.transform_confirm_request(canonicalParams);
    }

    const rawResponse = options?.sessionToken
      ? await this.executeOperation("confirm_order", canonicalParams, options.sessionToken)
      : await this.executeOperation("confirm_order", canonicalParams);
    const mapped = this.responseMapper.mapOne<MerchantOrderBinding>(
      this.manifest.field_mappings.order,
      rawResponse
    );
    const parsed = OrderConfirmationSchema.safeParse(mapped);
    if (!parsed.success) {
      throw new Error(`Merchant returned invalid order confirmation response: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /**
   * Poll real-time order status from the merchant's platform.
   */
  async getOrderStatus(orderId: string, sessionToken?: string): Promise<MerchantOrderBinding> {
    const rawResponse = sessionToken
      ? await this.executeOperation("get_order_status", { order_id: orderId }, sessionToken)
      : await this.executeOperation("get_order_status", { order_id: orderId });
    const mapped = this.responseMapper.mapOne<MerchantOrderBinding>(
      this.manifest.field_mappings.order,
      rawResponse
    );
    const parsed = OrderConfirmationSchema.safeParse(mapped);
    if (!parsed.success) {
      throw new Error(`Merchant returned invalid order status response: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /**
   * Cancel an order on the merchant platform.
   */
  async cancelOrder(
    orderId: string,
    reason?: string,
    sessionToken?: string
  ): Promise<{ order_id: string; status: string; cancelled_at: string; reason?: string }> {
    const opConfig = this.manifest.operations.cancel_order;
    if (!opConfig) {
      throw new Error("Merchant does not expose a cancel_order operation (see capability matrix)");
    }
    const rawResponse = sessionToken
      ? await this.executeOperation("cancel_order", {
          order_id: orderId,
          reason: reason ?? "user_cancelled",
        }, sessionToken)
      : await this.executeOperation("cancel_order", {
          order_id: orderId,
          reason: reason ?? "user_cancelled",
        });
    const mapped = this.responseMapper.mapOne<{ order_id: string; status: string; cancelled_at?: string }>(
      this.manifest.field_mappings.order,
      rawResponse
    );
    return {
      order_id: mapped.order_id || orderId,
      status: mapped.status || "CANCELLED",
      cancelled_at: mapped.cancelled_at || new Date().toISOString(),
      reason,
    };
  }

  /**
   * Add an item to a multi-item cart.
   */
  async addToCart(
    cartId: string | null,
    productId: string,
    quantity: number,
    variant?: Record<string, string>,
    sessionToken?: string
  ): Promise<{
    cart_id: string;
    items: CartItem[];
    cart_total: Money;
    item_count: number;
  }> {
    const cartConfig = this.manifest.transaction?.cart?.multi_item;
    if (!cartConfig) {
      throw new Error("Multi-item cart not supported — manifest.transaction.cart.multi_item not declared.");
    }

    let activeCartId = cartId;
    if (!activeCartId && cartConfig.create_cart_operation) {
      const createResponse = await this.executeOperationFromConfig(
        cartConfig.create_cart_operation,
        {},
        "create_cart",
        sessionToken
      );
      activeCartId = String(
        this.responseMapper.resolvePath(createResponse, "$.cart_id") ??
          this.responseMapper.resolvePath(createResponse, "$.id") ??
          createResponse
      );
    }

    if (!activeCartId) {
      activeCartId = `cart_${crypto.randomUUID()}`;
    }

    const addParams: Record<string, unknown> = {
      cart_id: activeCartId,
      product_id: productId,
      quantity,
      ...(variant ?? {}),
    };
    await this.executeOperationFromConfig(cartConfig.add_item_operation, addParams, "add_item", sessionToken);

    return this.getCart(activeCartId, sessionToken);
  }

  /**
   * Retrieve a multi-item cart state.
   */
  async getCart(cartId: string, sessionToken?: string): Promise<{
    cart_id: string;
    items: CartItem[];
    cart_total: Money;
    item_count: number;
  }> {
    const cartConfig = this.manifest.transaction?.cart?.multi_item;
    if (!cartConfig) {
      throw new Error("Multi-item cart not supported — manifest.transaction.cart.multi_item not declared.");
    }

    const rawResponse = await this.executeOperationFromConfig(
      cartConfig.get_cart_operation,
      { cart_id: cartId },
      "get_cart",
      sessionToken
    );

    const rawItems = (this.responseMapper.resolvePath(rawResponse, "$.items") ??
      (rawResponse as any)?.items ??
      (Array.isArray(rawResponse) ? rawResponse : [])) as unknown[];

    const items: CartItem[] = (Array.isArray(rawItems) ? rawItems : []).map((item: unknown) => ({
      item_id: String(
        this.responseMapper.resolvePath(item, cartConfig.cart_item_mapping.item_id_path) ??
          (item as any)?.item_id ??
          (item as any)?.id ??
          ""
      ),
      product_id: String(
        this.responseMapper.resolvePath(item, cartConfig.cart_item_mapping.product_id_path) ??
          (item as any)?.product_id ??
          ""
      ),
      quantity: Number(
        this.responseMapper.resolvePath(item, cartConfig.cart_item_mapping.quantity_path) ??
          (item as any)?.quantity ??
          1
      ),
      unit_price: {
        amount: Number(
          this.responseMapper.resolvePath(item, cartConfig.cart_item_mapping.unit_price_path) ??
            (item as any)?.unit_price?.amount ??
            (item as any)?.price ??
            0
        ),
        currency: this.manifest.merchant.currency,
      },
    }));

    const totalAmount = Number(
      this.responseMapper.resolvePath(rawResponse, cartConfig.cart_total_path) ??
        (rawResponse as any)?.total ??
        items.reduce((sum, it) => sum + (it.unit_price?.amount ?? 0) * it.quantity, 0)
    );

    return {
      cart_id: cartId,
      items,
      cart_total: { amount: totalAmount, currency: this.manifest.merchant.currency },
      item_count: items.length,
    };
  }

  /**
   * Checkout an existing multi-item cart.
   */
  async checkoutCart(
    cartId: string,
    customerData?: Record<string, unknown>,
    sessionToken?: string
  ): Promise<MerchantVerifiedCheckout> {
    const cartConfig = this.manifest.transaction?.cart?.multi_item;
    const op = cartConfig?.cart_to_checkout_operation || this.manifest.operations.create_checkout;
    if (!op) {
      throw new Error("Cart checkout operation is not configured in integration manifest.");
    }

    const rawResponse = await this.executeOperationFromConfig(
      op,
      { cart_id: cartId, ...(customerData ?? {}) },
      "checkout_cart",
      sessionToken
    );

    const mapped = this.responseMapper.mapOne<MerchantVerifiedCheckout>(
      this.manifest.field_mappings.checkout,
      rawResponse
    );
    const parsed = CheckoutResponseSchema.safeParse(mapped);
    if (!parsed.success) {
      throw new Error(`Merchant returned invalid checkout schema: ${parsed.error.message}`);
    }

    return {
      checkout_id: parsed.data.checkout_id,
      sku: parsed.data.sku || `CART-${cartId}`,
      title: parsed.data.title || "Multi-Item Cart Checkout",
      unit_price: parsed.data.unit_price || parsed.data.total,
      total: parsed.data.total,
      available: parsed.data.available,
      expires_at: parsed.data.expires_at,
      raw_merchant_data:
        typeof rawResponse === "object" && rawResponse !== null
          ? (rawResponse as Record<string, unknown>)
          : undefined,
    };
  }

  /**
   * Retrieve available shipping / delivery options for a checkout.
   */
  async getDeliveryOptions(
    checkoutId: string,
    sessionToken?: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      price: Money;
      estimated_days?: number;
      description?: string;
    }>
  > {
    const delivery = this.manifest.transaction?.delivery;
    if (!delivery?.shipping_options?.operation) {
      throw new Error("Delivery options not supported by this merchant.");
    }

    const shipConfig = delivery.shipping_options;
    const rawResponse = await this.executeOperationFromConfig(
      shipConfig.operation,
      { checkout_id: checkoutId },
      "get_delivery_options",
      sessionToken
    );

    const rawOptions = (this.responseMapper.resolvePath(rawResponse, shipConfig.options_path) ??
      rawResponse) as unknown[];

    return (Array.isArray(rawOptions) ? rawOptions : []).map((opt: unknown) => ({
      id: String(
        this.responseMapper.resolvePath(opt, shipConfig.option_mapping.id_path) ??
          (opt as any)?.id ??
          ""
      ),
      name: String(
        this.responseMapper.resolvePath(opt, shipConfig.option_mapping.name_path) ??
          (opt as any)?.name ??
          ""
      ),
      price: {
        amount: Number(
          this.responseMapper.resolvePath(opt, shipConfig.option_mapping.price_path) ??
            (opt as any)?.price ??
            0
        ),
        currency: this.manifest.merchant.currency,
      },
      estimated_days: shipConfig.option_mapping.estimated_days_path
        ? Number(this.responseMapper.resolvePath(opt, shipConfig.option_mapping.estimated_days_path))
        : undefined,
      description: shipConfig.option_mapping.description_path
        ? String(this.responseMapper.resolvePath(opt, shipConfig.option_mapping.description_path))
        : undefined,
    }));
  }

  /**
   * Select a delivery option for a checkout.
   */
  async selectDeliveryOption(
    checkoutId: string,
    optionId: string,
    sessionToken?: string
  ): Promise<{ success: boolean; checkout_id: string; selected_option: string }> {
    const delivery = this.manifest.transaction?.delivery;
    if (!delivery?.shipping_options?.operation) {
      throw new Error("Delivery option selection not supported by this merchant.");
    }

    const shipConfig = delivery.shipping_options;
    await this.executeOperationFromConfig(
      shipConfig.operation,
      {
        checkout_id: checkoutId,
        [shipConfig.selection_param || "shipping_option_id"]: optionId,
      },
      "select_delivery_option",
      sessionToken
    );

    return {
      success: true,
      checkout_id: checkoutId,
      selected_option: optionId,
    };
  }

  /**
   * Apply coupon or promo code to a checkout.
   */
  async applyCoupon(
    checkoutId: string,
    code: string,
    sessionToken?: string
  ): Promise<{ success: boolean; discount_amount?: Money; message?: string }> {
    const couponConfig = this.manifest.transaction?.coupons;
    const op = this.manifest.operations.apply_coupon || couponConfig?.apply_operation;
    if (!op) {
      throw new Error("Coupon application is not configured for this merchant.");
    }

    const codeParam = couponConfig?.code_param || "code";
    const raw = await this.executeOperationFromConfig(
      op,
      {
        checkout_id: checkoutId,
        [codeParam]: code,
      },
      "apply_coupon",
      sessionToken
    );

    const discountAmount = this.responseMapper.resolvePath(
      raw,
      couponConfig?.discount_amount_path || "$.discount"
    );
    const message = this.responseMapper.resolvePath(
      raw,
      couponConfig?.message_path || "$.message"
    );

    return {
      success: true,
      discount_amount:
        typeof discountAmount === "number"
          ? { amount: discountAmount, currency: this.manifest.merchant.currency }
          : undefined,
      message: typeof message === "string" ? message : undefined,
    };
  }

  // ─── Private Execution Pipeline ──────────────────────────────────────────

  private async executeOperation(
    opName: keyof IntegrationManifest["operations"],
    canonicalParams: Record<string, unknown>,
    sessionToken?: string
  ): Promise<unknown> {
    const opConfig = this.manifest.operations[opName] as OperationMapping | undefined;
    if (!opConfig) {
      throw new Error(`Operation "${String(opName)}" is not configured in integration manifest.`);
    }

    const jsonResponse = await this.executeHttpCall(opConfig, canonicalParams, String(opName), sessionToken);

    if (opConfig.response_path) {
      return this.responseMapper.resolvePath(jsonResponse, opConfig.response_path) ?? jsonResponse;
    }

    return jsonResponse;
  }

  private async executeOperationRaw(
    opName: keyof IntegrationManifest["operations"],
    canonicalParams: Record<string, unknown>,
    sessionToken?: string
  ): Promise<unknown> {
    const opConfig = this.manifest.operations[opName] as OperationMapping | undefined;
    if (!opConfig) {
      throw new Error(`Operation "${String(opName)}" is not configured in integration manifest.`);
    }
    return this.executeHttpCall(opConfig, canonicalParams, String(opName), sessionToken);
  }

  /**
   * Execute an operation directly from an OperationMapping configuration.
   */
  async executeOperationFromConfig(
    opConfig: OperationMapping,
    canonicalParams: Record<string, unknown>,
    operationName?: string,
    sessionToken?: string
  ): Promise<unknown> {
    return this.executeHttpCall(opConfig, canonicalParams, operationName, sessionToken);
  }

  private async executeOperationFromMapping(
    opConfig: OperationMapping,
    canonicalParams: Record<string, unknown>,
    sessionToken?: string
  ): Promise<unknown> {
    const raw = await this.executeHttpCall(opConfig, canonicalParams, undefined, sessionToken);
    if (opConfig.response_path) {
      return this.responseMapper.resolvePath(raw, opConfig.response_path) ?? raw;
    }
    return raw;
  }

  private async executeHttpCall(
    opConfig: OperationMapping,
    canonicalParams: Record<string, unknown>,
    operationName?: string,
    sessionToken?: string
  ): Promise<unknown> {
    const { url, unusedParams } = this.buildUrlAndQueryParams(opConfig.path, canonicalParams);
    const mappedPayload = opConfig.request_mapping
      ? this.requestMapper.map(opConfig.request_mapping, canonicalParams)
      : unusedParams;

    let headers: Record<string, string> = {
      Accept: this.manifest.http_conventions?.accept || "application/json",
      ...(this.manifest.http_conventions?.default_headers || {}),
      ...(opConfig.headers || {}),
    };

    let finalUrl = url;
    let requestBody: string | undefined = undefined;

    if (opConfig.method === "GET") {
      const queryParams = new URLSearchParams();
      for (const [k, v] of Object.entries(mappedPayload)) {
        if (v !== undefined && v !== null && typeof v !== "object") {
          queryParams.append(k, String(v));
        } else if (typeof v === "object" && v !== null) {
          for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
            if (subV !== undefined && subV !== null) {
              queryParams.append(`${k}.${subK}`, String(subV));
            }
          }
        }
      }
      const qs = queryParams.toString();
      if (qs) {
        finalUrl += (finalUrl.includes("?") ? "&" : "?") + qs;
      }
    } else if (opConfig.form_encoded) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const formParams = new URLSearchParams();
      const combined = { ...(opConfig.static_body || {}), ...mappedPayload };
      for (const [k, v] of Object.entries(combined)) {
        if (v !== undefined && v !== null) {
          formParams.append(k, String(v));
        }
      }
      requestBody = formParams.toString();
    } else {
      headers["Content-Type"] =
        opConfig.content_type ||
        this.manifest.http_conventions?.content_type ||
        "application/json";
      const fullBody = { ...(opConfig.static_body || {}), ...mappedPayload };
      requestBody = JSON.stringify(fullBody);
    }

    if (opConfig.static_query) {
      const staticQs = new URLSearchParams();
      for (const [k, v] of Object.entries(opConfig.static_query)) {
        if (v !== undefined && v !== null) {
          staticQs.append(k, String(v));
        }
      }
      const qsStr = staticQs.toString();
      if (qsStr) {
        finalUrl += (finalUrl.includes("?") ? "&" : "?") + qsStr;
      }
    }

    if (sessionToken) {
      headers = await this.authProvider.applyAuthWithSessionToken(headers, sessionToken, {
        method: opConfig.method,
        path: opConfig.path,
        query: opConfig.method === "GET" ? mappedPayload : undefined,
        body: opConfig.method !== "GET" ? mappedPayload : undefined,
        operationName,
      });
    } else {
      headers = await this.authProvider.applyAuth(headers, {
        method: opConfig.method,
        path: opConfig.path,
        query: opConfig.method === "GET" ? mappedPayload : undefined,
        body: opConfig.method !== "GET" ? mappedPayload : undefined,
        operationName,
      });
    }

    const timeoutMs =
      opConfig.timeout_ms ??
      (operationName
        ? this.manifest.http_conventions?.timeout?.operation_overrides?.[operationName]
        : undefined) ??
      this.manifest.http_conventions?.timeout?.request_timeout_ms;

    const response = (await this.retryHandler.execute(async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(), timeoutMs);
      }
      try {
        return await fetch(finalUrl, {
          method: opConfig.method,
          headers,
          body: requestBody,
          signal: controller.signal,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    })) as Response;

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(errorBody);
      } catch {
        parsedBody = errorBody;
      }

      if (this.hooks?.map_error) {
        const mappedError = this.hooks.map_error(response.status, parsedBody);
        if (mappedError) {
          throw new MerchantApiError({
            category: (mappedError.category as any) || "unknown",
            message: mappedError.message,
            retryable: response.status === 429 || response.status >= 500,
            raw: parsedBody,
          });
        }
      }

      const parsedError = this.errorParser.parse(response.status, parsedBody);
      throw new MerchantApiError(parsedError);
    }

    return response.json();
  }

  private buildUrlAndQueryParams(
    pathTemplate: string,
    params: Record<string, unknown>
  ): { url: string; unusedParams: Record<string, unknown> } {
    const unusedParams = { ...params };
    let resolvedPath = pathTemplate;

    const pathParamRegex = /:([a-zA-Z0-9_]+)/g;
    resolvedPath = resolvedPath.replace(pathParamRegex, (_, paramName) => {
      if (paramName in unusedParams) {
        const val = unusedParams[paramName];
        delete unusedParams[paramName];
        return encodeURIComponent(String(val));
      }
      return `:${paramName}`;
    });

    const baseUrl = this.manifest.merchant.base_url.replace(/\/$/, "");
    const cleanPath = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;

    return {
      url: `${baseUrl}${cleanPath}`,
      unusedParams,
    };
  }

  private applySemantics(offer: Offer): Offer {
    const semanticsConfig = this.manifest.discovery?.semantics;
    if (!semanticsConfig || semanticsConfig.vocabulary !== "schema.org") {
      return offer;
    }

    const defaultType =
      this.manifest.merchant.commerce_domain === "ticketing"
        ? "Event"
        : this.manifest.merchant.commerce_domain === "food"
        ? "FoodEstablishment"
        : "Product";

    const schemaType = semanticsConfig.offer_type ?? defaultType;
    const properties: Record<string, unknown> = {
      "@type": schemaType,
      name: offer.title,
      description: offer.description,
      offers: {
        "@type": "Offer",
        price: (offer.price.amount / 100).toFixed(2),
        priceCurrency: offer.price.currency,
        availability:
          offer.availability === "in_stock"
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
      },
    };

    if (semanticsConfig.attribute_map) {
      for (const [attrName, schemaProp] of Object.entries(semanticsConfig.attribute_map)) {
        if (offer.attributes && attrName in offer.attributes) {
          properties[schemaProp] = offer.attributes[attrName];
        }
      }
    }

    return {
      ...offer,
      semantic: {
        type: schemaType,
        properties,
      },
    };
  }
}
