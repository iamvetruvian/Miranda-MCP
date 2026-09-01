/**
 * Custom Adapter Hooks Loader
 * Allows merchants with niche userflows to supply pure data transformation hooks
 * over canonical types without running LLMs or altering core engine security.
 */

import path from "path";
import { CustomHooksConfig } from "../types/manifest.js";
import {
  Offer,
  MerchantVerifiedCheckout,
  Money,
} from "../types/index.js";

export interface MerchantAdapterHooks {
  transform_search_request?(canonical: Record<string, unknown>): Record<string, unknown>;
  transform_checkout_request?(canonical: Record<string, unknown>): Record<string, unknown>;
  transform_confirm_request?(canonical: Record<string, unknown>): Record<string, unknown>;
  normalize_offer?(raw: unknown, draft: Offer): Offer;
  normalize_checkout?(raw: unknown, draft: MerchantVerifiedCheckout): MerchantVerifiedCheckout;
  map_error?(status: number, body: unknown): { message: string; recoverable?: boolean; category?: string };
  compute_fees?(checkout: MerchantVerifiedCheckout): { fees: Money[]; total: Money };
  validate_variant?(product: Offer, variant: Record<string, string>): { valid: boolean; error?: string };
}

/**
 * Loads custom adapter hooks declared in the manifest.
 */
export async function loadHooks(
  config?: CustomHooksConfig,
  baseDir: string = process.cwd()
): Promise<MerchantAdapterHooks | null> {
  if (!config || !config.module) {
    return null;
  }

  try {
    const modulePath = config.module.startsWith(".")
      ? path.resolve(baseDir, config.module)
      : config.module;

    const loaded = await import(modulePath);
    const hooksObj = (loaded.default || loaded) as MerchantAdapterHooks;

    // Return the hooks instance
    return hooksObj;
  } catch (err) {
    console.warn(`Failed to load custom hooks from "${config.module}":`, err);
    return null;
  }
}
