/**
 * Marketplace Gateway (Federation & Proxy Façade)
 * Fans out discovery searches across N independent MerchantMCP instances
 * and proxies transaction calls strictly to the target merchant.
 *
 * Strict Design Invariant:
 * Zero credential aggregation — each merchant manages its own keys, policy gates, and audit ledger.
 */

import crypto from "crypto";
import { ConnectorRuntime } from "../connector/runtime.js";
import {
  MarketplaceConfig,
  MarketplaceMerchantEntry,
  MarketplaceOffer,
  MarketplaceSearchResult,
} from "./types.js";
import { Refinement, RefinementOption, MerchantOrderBinding } from "../types/index.js";

export class MarketplaceGateway {
  private config: MarketplaceConfig;
  private connectors: Map<string, ConnectorRuntime> = new Map();
  private merchantMeta: Map<string, MarketplaceMerchantEntry> = new Map();

  constructor(config: MarketplaceConfig) {
    this.config = config;
    for (const m of config.merchants) {
      this.merchantMeta.set(m.merchant_id, m);
    }
  }

  /**
   * Register a live ConnectorRuntime for a specific merchant ID.
   */
  registerConnector(merchantId: string, connector: ConnectorRuntime): void {
    this.connectors.set(merchantId, connector);
  }

  /**
   * Get all registered and active merchants in the marketplace.
   */
  listMerchants(): MarketplaceMerchantEntry[] {
    return Array.from(this.merchantMeta.values()).filter((m) => m.enabled !== false);
  }

  /**
   * Federated multi-merchant discovery search.
   * Fans out search query to all active merchant endpoints in parallel.
   */
  async search(params: {
    query: string;
    merchant_id?: string;
    filters?: Record<string, unknown>;
    page?: number;
    pageSize?: number;
    sort?: "price_asc" | "price_desc" | "relevance";
  }): Promise<MarketplaceSearchResult> {
    const activeMerchants = this.listMerchants().filter(
      (m) => !params.merchant_id || m.merchant_id === params.merchant_id
    );

    const merchantsQueried: string[] = [];
    const merchantsFailed: string[] = [];
    const allOffers: MarketplaceOffer[] = [];
    const allRefinements: Refinement[] = [];

    // Parallel fan-out across merchants
    const searchPromises = activeMerchants.map(async (m) => {
      merchantsQueried.push(m.merchant_id);
      const connector = this.connectors.get(m.merchant_id);
      if (!connector) {
        throw new Error(`Connector for merchant "${m.merchant_id}" is not connected.`);
      }

      // Filter out merchant-specific namespaced filters if any
      const merchantFilters: Record<string, unknown> = {};
      if (params.filters) {
        for (const [k, v] of Object.entries(params.filters)) {
          if (k.startsWith(`${m.merchant_id}:`)) {
            merchantFilters[k.replace(`${m.merchant_id}:`, "")] = v;
          } else {
            merchantFilters[k] = v;
          }
        }
      }

      const result = await connector.search({
        query: params.query,
        filters: merchantFilters,
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 20,
        sort: params.sort,
      });

      // Tag offers with merchant metadata
      const taggedOffers: MarketplaceOffer[] = result.offers.map((offer) => ({
        ...offer,
        merchant_id: m.merchant_id,
        merchant_name: m.name,
      }));

      // Tag refinements with merchant namespace
      const taggedRefinements: Refinement[] = result.refinements.map((ref) => ({
        ...ref,
        key: `${m.merchant_id}:${ref.key}`,
        label: `${m.name} - ${ref.label}`,
      }));

      return {
        merchant_id: m.merchant_id,
        offers: taggedOffers,
        refinements: taggedRefinements,
        total: result.total_results,
      };
    });

    const results = await Promise.allSettled(searchPromises);
    const merchantBuckets: MarketplaceOffer[][] = [];

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const merchantId = activeMerchants[i].merchant_id;
      if (res.status === "fulfilled") {
        merchantBuckets.push(res.value.offers);
        allRefinements.push(...res.value.refinements);
      } else {
        console.warn(`[MarketplaceGateway] Search on merchant "${merchantId}" failed:`, res.reason);
        merchantsFailed.push(merchantId);
      }
    }

    // Sort or fair-interleave combined offers
    if (params.sort === "price_asc") {
      for (const bucket of merchantBuckets) {
        allOffers.push(...bucket);
      }
      allOffers.sort((a, b) => a.price.amount - b.price.amount);
    } else if (params.sort === "price_desc") {
      for (const bucket of merchantBuckets) {
        allOffers.push(...bucket);
      }
      allOffers.sort((a, b) => b.price.amount - a.price.amount);
    } else {
      // Fair round-robin interleaving across merchants so each store is represented
      let maxLen = 0;
      for (const bucket of merchantBuckets) {
        if (bucket.length > maxLen) maxLen = bucket.length;
      }
      for (let idx = 0; idx < maxLen; idx++) {
        for (const bucket of merchantBuckets) {
          if (idx < bucket.length) {
            allOffers.push(bucket[idx]);
          }
        }
      }
    }

    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const startIdx = (page - 1) * pageSize;
    const pagedOffers = allOffers.slice(startIdx, startIdx + pageSize);

    return {
      search_id: `mkt_srch_${crypto.randomUUID()}`,
      query: params.query,
      total_results: allOffers.length,
      offers: pagedOffers,
      refinements: allRefinements,
      merchants_queried: merchantsQueried,
      merchants_failed: merchantsFailed.length > 0 ? merchantsFailed : undefined,
      page_info: {
        page,
        page_size: pageSize,
        has_more: startIdx + pageSize < allOffers.length,
      },
    };
  }

  /**
   * Retrieve product details from a specific merchant.
   */
  async getProduct(merchantId: string, productId: string): Promise<MarketplaceOffer> {
    const connector = this.getConnectorOrThrow(merchantId);
    const merchant = this.merchantMeta.get(merchantId)!;
    const offer = await connector.getProduct(productId);

    return {
      ...offer,
      merchant_id: merchantId,
      merchant_name: merchant.name,
    };
  }

  /**
   * Create an authoritative checkout directly on the specific merchant's backend.
   */
  async createCheckout(
    merchantId: string,
    productId: string,
    quantity: number,
    variant?: Record<string, string>
  ) {
    const connector = this.getConnectorOrThrow(merchantId);
    const checkout = await connector.createCheckout(productId, quantity, variant);

    return {
      merchant_id: merchantId,
      merchant_name: this.merchantMeta.get(merchantId)!.name,
      ...checkout,
    };
  }

  /**
   * Confirm an order on the specific merchant's backend.
   */
  async confirmOrder(
    merchantId: string,
    checkoutId: string,
    paymentId: string,
    options?: { customer?: Record<string, unknown> }
  ): Promise<MerchantOrderBinding> {
    const connector = this.getConnectorOrThrow(merchantId);
    return connector.confirmOrder(checkoutId, paymentId, options);
  }

  /**
   * Poll real-time order status on the specific merchant's backend.
   */
  async getOrderStatus(merchantId: string, orderId: string): Promise<MerchantOrderBinding> {
    const connector = this.getConnectorOrThrow(merchantId);
    return connector.getOrderStatus(orderId);
  }

  /**
   * Cancel an order on the specific merchant's backend.
   */
  async cancelOrder(merchantId: string, orderId: string, reason?: string) {
    const connector = this.getConnectorOrThrow(merchantId);
    return connector.cancelOrder(orderId, reason);
  }

  /**
   * Retrieve refinement options from a specific merchant.
   */
  async getRefinementOptions(params: {
    merchant_id: string;
    refinement_key: string;
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ options: RefinementOption[]; total?: number; has_more?: boolean }> {
    const connector = this.getConnectorOrThrow(params.merchant_id);
    const cleanKey = params.refinement_key.replace(`${params.merchant_id}:`, "");

    const result = await connector.searchRefinementOptions({
      searchParams: {},
      refinementKey: cleanKey,
      query: params.query,
      page: Math.floor((params.offset ?? 0) / (params.limit ?? 25)) + 1,
      pageSize: params.limit ?? 25,
    });

    if (result) {
      return result;
    }

    return { options: [], total: 0, has_more: false };
  }

  private getConnectorOrThrow(merchantId: string): ConnectorRuntime {
    const connector = this.connectors.get(merchantId);
    if (!connector) {
      throw new Error(`Merchant "${merchantId}" is not connected to this marketplace gateway.`);
    }
    return connector;
  }
}
