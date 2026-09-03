/**
 * Recurring Token Store
 * Manages storage and retrieval of Razorpay recurring payment tokens per customer.
 */

export interface RecurringToken {
  /** Razorpay customer ID (e.g. "cust_...") */
  customer_id: string;
  /** Razorpay token ID (e.g. "token_...") */
  token_id: string;
  /** Underlying payment rail used for the mandate/token */
  method: "upi" | "card";
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

export class RecurringTokenStore {
  private tokens: Map<string, RecurringToken> = new Map();

  /**
   * Store or update a recurring token by customer_id.
   */
  save(token: RecurringToken): void {
    this.tokens.set(token.customer_id, { ...token });
  }

  /**
   * Retrieve a recurring token by customer_id.
   */
  get(customerId: string): RecurringToken | undefined {
    const t = this.tokens.get(customerId);
    return t ? { ...t } : undefined;
  }

  /**
   * Retrieve a recurring token by token_id.
   */
  getByTokenId(tokenId: string): RecurringToken | undefined {
    for (const t of this.tokens.values()) {
      if (t.token_id === tokenId) {
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
      if (t.email && t.email.trim().toLowerCase() === normalized) {
        return { ...t };
      }
    }
    return undefined;
  }

  /**
   * Check if a token exists for the given customer_id.
   */
  has(customerId: string): boolean {
    return this.tokens.has(customerId);
  }

  /**
   * Remove a token for a customer.
   */
  delete(customerId: string): boolean {
    return this.tokens.delete(customerId);
  }

  /**
   * List all stored recurring tokens.
   */
  listAll(): RecurringToken[] {
    return Array.from(this.tokens.values()).map((t) => ({ ...t }));
  }

  /**
   * Hydrate in-memory token store from persistence snapshot.
   */
  hydrate(tokens: RecurringToken[]): void {
    this.tokens.clear();
    for (const t of tokens) {
      if (t && t.customer_id) {
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
