/**
 * Marketplace Gateway Type Definitions
 * Strict separation: Discovery federation + proxying ONLY.
 * Zero shared credentials across merchants.
 */

import { Offer, Refinement, SearchResult, Money, MerchantVerifiedCheckout } from "../types/index.js";

export interface MarketplaceMerchantEntry {
  merchant_id: string;
  name: string;
  description: string;
  commerce_domain: string;
  currency: string;
  endpoint: string; // HTTP / SSE endpoint or local connector identifier
  enabled: boolean;
  display_metadata?: {
    logo_url?: string;
    badges?: string[];
    rating?: number;
  };
}

export interface MarketplaceConfig {
  name: string;
  description: string;
  merchants: MarketplaceMerchantEntry[];
}

export interface MarketplaceOffer extends Offer {
  merchant_id: string;
  merchant_name: string;
}

export interface MarketplaceSearchResult {
  search_id: string;
  query: string;
  total_results: number;
  offers: MarketplaceOffer[];
  refinements: Refinement[];
  merchants_queried: string[];
  merchants_failed?: string[];
  page_info: {
    page: number;
    page_size: number;
    has_more: boolean;
  };
}
