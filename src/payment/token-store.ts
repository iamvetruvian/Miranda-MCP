/**
 * Recurring Token Store
 * Manages storage and retrieval of Stripe payment method tokens per customer.
 */

export interface RecurringToken {
  /** Stripe customer ID (e.g. "cus_...") */
  customer_id: string;
  /** Canonical merchant identifier (e.g. "skateshop", "proshop-electronics") */
  merchant_id?: string;
  /** Stripe PaymentMethod ID (e.g. "pm_...") */
  token_id: string;
  /** Underlying payment rail used for the mandate/token */
  method: "upi" | "card";
  /** Merchant authenticated user ID if bound to an OAuth profile */
  user_id?: string;
  /** Optional NPCI mandate ceiling in smallest currency sub-unit (paise) */
  max_amount?: number;
  /** Customer email for notifications and token registration */
  email?: string;
  /** Customer contact number for notifications and token registration */
  contact?: string;
  /** ISO 8601 timestamp when token was captured */
  created_at: string;
  /** ISO 8601 timestamp when token was last used for an autonomous charge */
  last_used_at?: string;
}

import type { PersistenceStore } from "../persistence/store.js";

export class RecurringTokenStore {
  private tokens: Map<string, RecurringToken> = new Map();
  private store?: PersistenceStore;
  private merchantId: string;

  constructor(store?: PersistenceStore, merchantId?: string) {
    this.store = store;
    this.merchantId = merchantId || "default";
  }

  getMerchantId(): string {
    return this.merchantId;
  }

  /**
   * Store or update a recurring token by customer_id for this merchant.
   */
  save(token: RecurringToken): void {
    const toSave: RecurringToken = {
      ...token,
      merchant_id: token.merchant_id || this.merchantId,
    };
    this.tokens.set(toSave.customer_id, toSave);
    if (this.store) {
      this.store.saveRecurringToken(toSave).catch((err) => {
        console.error("[RecurringTokenStore] Error persisting recurring token:", err);
      });
    }
  }

  /**
   * Retrieve a recurring token by customer_id.
   */
  get(customerId: string): RecurringToken | undefined {
    const t = this.tokens.get(customerId);
    if (t && (!t.merchant_id || t.merchant_id === this.merchantId)) {
      return { ...t };
    }
    return undefined;
  }

  /**
   * Retrieve a recurring token by token_id.
   */
  getByTokenId(tokenId: string): RecurringToken | undefined {
    for (const t of this.tokens.values()) {
      if (t.token_id === tokenId && (!t.merchant_id || t.merchant_id === this.merchantId)) {
        return { ...t };
      }
    }
    return undefined;
  }

  /**
   * Retrieve a recurring token by customer email.
   */
  getByEmail(email: string): RecurringToken | undefined {
    const normalized = email.trim().toLowerCase();
    for (const t of this.tokens.values()) {
      if (t.email && t.email.trim().toLowerCase() === normalized && (!t.merchant_id || t.merchant_id === this.merchantId)) {
        return { ...t };
      }
    }
    return undefined;
  }

  /**
   * Retrieve a recurring token by merchant user ID.
   */
  getByUserId(userId: string): RecurringToken | undefined {
    for (const t of this.tokens.values()) {
      if (t.user_id === userId && (!t.merchant_id || t.merchant_id === this.merchantId)) {
        return { ...t };
      }
    }
    return undefined;
  }

  /**
   * Check if a token exists for the given customer_id.
   */
  has(customerId: string): boolean {
    const t = this.tokens.get(customerId);
    return !!(t && (!t.merchant_id || t.merchant_id === this.merchantId));
  }

  /**
   * Remove a token for a customer.
   */
  delete(customerId: string): boolean {
    const res = this.tokens.delete(customerId);
    if (this.store) {
      this.store.deleteRecurringToken(customerId).catch((err) => {
        console.error("[RecurringTokenStore] Error deleting recurring token from store:", err);
      });
    }
    return res;
  }

  /**
   * List all stored recurring tokens for this merchant.
   */
  listAll(): RecurringToken[] {
    return Array.from(this.tokens.values())
      .filter((t) => !t.merchant_id || t.merchant_id === this.merchantId)
      .map((t) => ({ ...t }));
  }

  /**
   * Hydrate in-memory token store from persistence snapshot for this merchant.
   */
  hydrate(tokens: RecurringToken[]): void {
    this.tokens.clear();
    for (const t of tokens) {
      if (t && t.customer_id && (!t.merchant_id || t.merchant_id === this.merchantId)) {
        this.tokens.set(t.customer_id, { ...t });
      }
    }
  }

  /**
   * Clear all stored tokens (primarily for test resets).
   */
  clear(): void {
    this.tokens.clear();
  }
}
