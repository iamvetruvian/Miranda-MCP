/**
 * UCP-Native Merchant Connector (Integration Tier 0 / Method 1)
 * Direct passthrough connector for merchants that natively expose
 * standard Universal Commerce Protocol (UCP) capability endpoints.
 */

import { IntegrationManifest } from "../types/manifest.js";
import {
  Offer,
  SearchResult,
  MerchantVerifiedCheckout,
  MerchantOrderBinding,
  RefinementOption,
} from "../types/index.js";

export class UcpNativeConnector {
  private manifest: IntegrationManifest;
  private baseUrl: string;

  constructor(manifest: IntegrationManifest) {
    this.manifest = manifest;
    this.baseUrl = (manifest as any).integration?.endpoint || manifest.merchant.base_url.replace(/\/$/, "");
  }

  getManifest(): IntegrationManifest {
    return this.manifest;
  }

  /**
   * Search UCP-native catalog
   */
  async search(params: {
    query: string;
    filters?: Record<string, unknown>;
    page?: number;
    sort?: string;
    parameters?: Record<string, unknown>;
  }): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/catalog/search`);
    if (params.query) url.searchParams.set("q", params.query);
    if (params.page) url.searchParams.set("page", String(params.page));
    if (params.sort) url.searchParams.set("sort", params.sort);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: params.query,
        filters: params.filters,
        parameters: params.parameters,
      }),
    });

    if (!response.ok) {
      // Fallback to GET /catalog
      const getUrl = new URL(`${this.baseUrl}/catalog`);
      if (params.query) getUrl.searchParams.set("q", params.query);
      const getRes = await fetch(getUrl.toString());
      if (!getRes.ok) {
        throw new Error(`UCP catalog search failed with HTTP ${getRes.status}: ${getRes.statusText}`);
      }
      const data = (await getRes.json()) as any;
      const items: any[] = Array.isArray(data) ? data : data.items || data.products || [];
      return {
        search_id: `ucp_search_${Date.now()}`,
        offers: items.map(this.normalizeOffer.bind(this)),
        total_results: items.length,
        refinements: [],
        sort_options: [],
        page_info: { page: params.page ?? 1, page_size: items.length, has_more: false },
      };
    }

    const data = (await response.json()) as any;
    const items: any[] = Array.isArray(data) ? data : data.items || data.offers || [];

    return {
      search_id: data.search_id || `ucp_search_${Date.now()}`,
      offers: items.map(this.normalizeOffer.bind(this)),
      total_results: data.total_results || items.length,
      refinements: data.refinements || [],
      sort_options: data.sort_options || [],
      page_info: data.page_info || { page: params.page ?? 1, page_size: items.length, has_more: false },
    };
  }

  /**
   * Get single offer from UCP-native merchant
   */
  async getProduct(productId: string): Promise<Offer> {
    const res = await fetch(`${this.baseUrl}/catalog/${encodeURIComponent(productId)}`);
    if (!res.ok) {
      throw new Error(`UCP product resolution failed for "${productId}": ${res.statusText}`);
    }
    const data = await res.json();
    return this.normalizeOffer(data);
  }

  /**
   * Create UCP checkout session
   */
  async createCheckout(
    productId: string,
    quantity: number,
    variant?: Record<string, string>
  ): Promise<MerchantVerifiedCheckout> {
    const res = await fetch(`${this.baseUrl}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        line_items: [
          {
            item_id: productId,
            quantity,
            variant,
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`UCP checkout creation failed: ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    return {
      checkout_id: data.checkout_id || data.id,
      sku: data.sku || productId,
      title: data.title,
      unit_price: data.unit_price || {
        amount: Math.round((data.total?.amount || 0) / quantity),
        currency: data.total?.currency || this.manifest.merchant.currency,
      },
      total: data.total || {
        amount: data.amount || 0,
        currency: data.currency || this.manifest.merchant.currency,
      },
      available: data.available !== false && data.stock !== "out_of_stock",
      expires_at: data.expires_at,
      raw_merchant_data: data,
    };
  }

  async getCheckout(checkoutId: string): Promise<MerchantVerifiedCheckout> {
    const res = await fetch(`${this.baseUrl}/checkout/${encodeURIComponent(checkoutId)}`);
    if (!res.ok) {
      throw new Error(`UCP getCheckout failed: ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    return {
      checkout_id: data.checkout_id || data.id,
      sku: data.sku || "unknown",
      title: data.title,
      unit_price: data.unit_price,
      total: data.total,
      available: data.available !== false,
      expires_at: data.expires_at,
      raw_merchant_data: data,
    };
  }

  /**
   * Confirm UCP order
   */
  async confirmOrder(
    checkoutId: string,
    paymentId: string,
    options?: { customer?: Record<string, unknown> }
  ): Promise<MerchantOrderBinding> {
    const res = await fetch(`${this.baseUrl}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkout_id: checkoutId,
        payment_id: paymentId,
        customer: options?.customer,
      }),
    });

    if (!res.ok) {
      throw new Error(`UCP order confirmation failed: ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    return {
      order_id: data.order_id || data.id,
      status: data.status || "CONFIRMED",
      confirmed_at: data.confirmed_at || new Date().toISOString(),
      tracking_reference: data.tracking_reference || data.tracking_number,
    };
  }

  async getOrderStatus(orderId: string): Promise<MerchantOrderBinding> {
    const res = await fetch(`${this.baseUrl}/orders/${encodeURIComponent(orderId)}`);
    if (!res.ok) {
      throw new Error(`UCP getOrderStatus failed: ${res.statusText}`);
    }
    const data = (await res.json()) as any;
    return {
      order_id: data.order_id || data.id,
      status: data.status,
      confirmed_at: data.confirmed_at,
      tracking_reference: data.tracking_reference,
    };
  }

  async cancelOrder(
    orderId: string,
    reason?: string
  ): Promise<{ order_id: string; status: string; cancelled_at: string; reason?: string }> {
    const res = await fetch(`${this.baseUrl}/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });

    if (!res.ok) {
      throw new Error(`UCP cancelOrder failed: ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    return {
      order_id: orderId,
      status: data.status || "CANCELLED",
      cancelled_at: data.cancelled_at || new Date().toISOString(),
      reason,
    };
  }

  async getRefinementOptions(params: {
    refinement_key: string;
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    refinement_key: string;
    query?: string;
    options: RefinementOption[];
    total_matching?: number;
    has_more?: boolean;
  }> {
    const url = new URL(`${this.baseUrl}/catalog/facets/${encodeURIComponent(params.refinement_key)}`);
    if (params.query) url.searchParams.set("q", params.query);
    if (params.limit) url.searchParams.set("limit", String(params.limit));
    if (params.offset) url.searchParams.set("offset", String(params.offset));

    const res = await fetch(url.toString());
    if (!res.ok) {
      return {
        refinement_key: params.refinement_key,
        query: params.query,
        options: [],
        total_matching: 0,
        has_more: false,
      };
    }

    const data = (await res.json()) as any;
    const options: RefinementOption[] = data.options || data.values || [];
    return {
      refinement_key: params.refinement_key,
      query: params.query,
      options,
      total_matching: data.total_matching || options.length,
      has_more: data.has_more || false,
    };
  }

  private normalizeOffer(item: any): Offer {
    return {
      offer_id: item.offer_id || item.id || "unknown",
      title: item.title || item.name || "Untitled Offer",
      description: item.description || "",
      price: item.price?.amount !== undefined
        ? item.price
        : { amount: Number(item.price || 0), currency: this.manifest.merchant.currency },
      availability: item.availability || (item.stock === "out_of_stock" ? "out_of_stock" : "in_stock"),
      attributes: item.attributes || item.specs || {},
      expires_at: item.expires_at,
    };
  }
}
