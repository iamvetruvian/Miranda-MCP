/**
 * User Session Store
 * Server-side persistent session store mapping opaque session IDs to OAuth2 tokens.
 * Persists to SQLite with merchant-declared TTL (days/months).
 */

import crypto from "crypto";
import { PersistenceStore } from "../persistence/store.js";
import { generateEcKeyPair, EcKeyPair, PublicJwk } from "../authz/crypto.js";

export interface UserSession {
  session_id: string;              // "sess_<UUIDv4>" — opaque, safe to expose to agent
  merchant_id?: string;            // Canonical merchant identifier (e.g. "skateshop", "proshop-electronics")
  access_token: string;            // OAuth2 access token (never exposed to agent)
  refresh_token?: string;          // OAuth2 refresh token (never exposed to agent)
  user_id?: string;                // Extracted user ID (optional)
  user_name?: string;              // Display name (optional)
  user_email?: string;             // User email from profile / auth
  user_contact?: string;           // User contact / phone number
  customer_id?: string;            // Associated payment gateway customer ID (e.g. "cust_...")
  recurring_token?: string;        // Associated vaulted payment token (e.g. "pm_...")
  shipping_address?: Record<string, unknown>; // Default shipping address from merchant profile
  shipping_addresses?: Array<Record<string, unknown>>; // List of saved shipping addresses
  authenticated_at: number;        // Unix timestamp ms
  token_expires_at?: number;       // When the access token expires (Unix ms)
  session_expires_at: number;      // When the entire session expires (Unix ms) — merchant TTL
  oauth2_state?: string;           // CSRF protection state for pending auth flows
  pkce_verifier?: string;          // PKCE code verifier for pending auth flows
  status?: "pending" | "authenticated" | "invalidated";
  agent_keypair?: {
    publicKeyPem: string;
    privateKeyPem: string;
    publicJwk: PublicJwk;
  };
}

export interface OAuth2Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;             // seconds
}

export interface UserInfo {
  user_id?: string;
  user_name?: string;
  user_email?: string;
  user_contact?: string;
  customer_id?: string;
  shipping_address?: Record<string, unknown>;
  shipping_addresses?: Array<Record<string, unknown>>;
}

export const DEFAULT_SESSION_TTL_SECONDS = 2592000; // 30 days default

export class SessionStore {
  private store: PersistenceStore;
  private defaultTtlSeconds: number;
  private merchantId: string;
  private sessions: Map<string, UserSession> = new Map();
  private agentKeyPairs: Map<string, EcKeyPair> = new Map();

  constructor(store: PersistenceStore, defaultTtlSeconds?: number, merchantId?: string) {
    this.store = store;
    this.defaultTtlSeconds = defaultTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.merchantId = merchantId || "default";
  }

  getMerchantId(): string {
    return this.merchantId;
  }

  /**
   * Get or generate the cryptographic ECDSA P-256 keypair for an agent session.
   * Acts as the agent's key custodian to satisfy AP2 cnf.jwk proof-of-possession.
   */
  getOrCreateAgentKeyPair(sessionId: string): EcKeyPair {
    const cached = this.agentKeyPairs.get(sessionId);
    if (cached) return cached;

    const session = this.sessions.get(sessionId);
    if (session?.agent_keypair) {
      const pubKey = crypto.createPublicKey(session.agent_keypair.publicKeyPem);
      const privKey = crypto.createPrivateKey(session.agent_keypair.privateKeyPem);
      const pair: EcKeyPair = {
        publicKey: pubKey,
        privateKey: privKey,
        publicKeyPem: session.agent_keypair.publicKeyPem,
        privateKeyPem: session.agent_keypair.privateKeyPem,
        publicJwk: session.agent_keypair.publicJwk,
      };
      this.agentKeyPairs.set(sessionId, pair);
      return pair;
    }

    const newPair = generateEcKeyPair(`agent_${sessionId}`);
    this.agentKeyPairs.set(sessionId, newPair);

    if (session) {
      session.agent_keypair = {
        publicKeyPem: newPair.publicKeyPem,
        privateKeyPem: newPair.privateKeyPem,
        publicJwk: newPair.publicJwk,
      };
      this.store.saveSession(session).catch((err) => {
        console.error("[SessionStore] Error saving agent keypair to session:", err);
      });
    }

    return newPair;
  }

  /**
   * Initialize a pending session before redirecting the user to merchant's OAuth2 login.
   */
  createPendingSession(
    state: string,
    pkceVerifier?: string,
    ttlSeconds?: number
  ): UserSession {
    const now = Date.now();
    const sessionId = `sess_${crypto.randomUUID()}`;
    const effectiveTtl = ttlSeconds ?? this.defaultTtlSeconds;
    const session: UserSession = {
      session_id: sessionId,
      merchant_id: this.merchantId,
      access_token: "",
      authenticated_at: now,
      session_expires_at: now + effectiveTtl * 1000,
      oauth2_state: state,
      pkce_verifier: pkceVerifier,
      status: "pending",
    };

    this.sessions.set(sessionId, session);
    this.store.saveSession(session).catch((err) => {
      console.error("[SessionStore] Error saving pending session:", err);
    });

    return { ...session };
  }

  /**
   * Complete a pending session after exchanging the OAuth2 authorization code for tokens.
   */
  completeSession(
    sessionId: string,
    tokens: OAuth2Tokens,
    userInfo?: UserInfo,
    ttlSeconds?: number
  ): UserSession {
    const existing = this.sessions.get(sessionId);
    const now = Date.now();
    const effectiveTtl = ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;

    const session: UserSession = {
      session_id: sessionId,
      merchant_id: existing?.merchant_id || this.merchantId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? existing?.refresh_token,
      user_id: userInfo?.user_id ?? existing?.user_id,
      user_name: userInfo?.user_name ?? existing?.user_name,
      user_email: userInfo?.user_email ?? existing?.user_email,
      user_contact: userInfo?.user_contact ?? existing?.user_contact,
      customer_id: userInfo?.customer_id ?? existing?.customer_id,
      shipping_address: userInfo?.shipping_address ?? existing?.shipping_address,
      shipping_addresses: userInfo?.shipping_addresses ?? existing?.shipping_addresses,
      authenticated_at: now,
      token_expires_at: tokens.expires_in ? now + tokens.expires_in * 1000 : undefined,
      session_expires_at: now + effectiveTtl * 1000,
      pkce_verifier: existing?.pkce_verifier,
      status: "authenticated",
    };

    this.sessions.set(sessionId, session);
    this.store.saveSession(session).catch((err) => {
      console.error("[SessionStore] Error saving completed session:", err);
    });

    return { ...session };
  }

  /**
   * Bind a payment gateway customer ID to a session.
   */
  attachCustomerId(sessionId: string, customerId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.customer_id = customerId;
      this.store.saveSession(session).catch((err) => {
        console.error("[SessionStore] Error updating session customer_id:", err);
      });
    }
  }

  /**
   * Bind a vaulted recurring payment token (and optional customer ID) to a session.
   */
  attachRecurringToken(sessionId: string, tokenId: string, customerId?: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.recurring_token = tokenId;
      if (customerId) session.customer_id = customerId;
      this.store.saveSession(session).catch((err) => {
        console.error("[SessionStore] Error updating session recurring_token:", err);
      });
    }
  }

  /**
   * Retrieve a session by its opaque session ID.
   * Returns null if not found, invalidated, or expired.
   */
  getSession(sessionId: string): UserSession | null {
    let session = this.sessions.get(sessionId);
    if (!session) {
      try {
        const persisted = this.store.loadSessionsSync?.() || [];
        for (const s of persisted) {
          if (s.session_id === sessionId) {
            this.sessions.set(s.session_id, s);
            session = s;
            break;
          }
        }
      } catch {}
    }
    if (!session) return null;

    // Strict merchant isolation check: reject foreign merchant sessions
    if (session.merchant_id && session.merchant_id !== this.merchantId) {
      return null;
    }

    if (session.status === "invalidated") return null;

    if (session.session_expires_at <= Date.now()) {
      this.invalidateSession(sessionId);
      return null;
    }

    return { ...session };
  }

  /**
   * Resolves the access token if the session is currently authenticated and valid.
   */
  resolveToken(sessionId: string): string | null {
    const session = this.getSession(sessionId);
    if (!session || session.status !== "authenticated" || !session.access_token) {
      return null;
    }
    return session.access_token;
  }

  /**
   * Updates access/refresh tokens after a token refresh.
   */
  updateTokens(sessionId: string, tokens: OAuth2Tokens): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const now = Date.now();
    session.access_token = tokens.access_token;
    if (tokens.refresh_token) {
      session.refresh_token = tokens.refresh_token;
    }
    if (tokens.expires_in) {
      session.token_expires_at = now + tokens.expires_in * 1000;
    }

    this.sessions.set(sessionId, session);
    this.store.saveSession(session).catch((err) => {
      console.error("[SessionStore] Error updating session tokens:", err);
    });
  }

  /**
   * Invalidates and deletes a session.
   */
  invalidateSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.store.deleteSession(sessionId).catch((err) => {
      console.error("[SessionStore] Error deleting session from store:", err);
    });
  }

  /**
   * Finds a session by its OAuth2 state string for callback validation.
   */
  findByState(state: string): UserSession | null {
    if (!state) return null;
    for (const session of this.sessions.values()) {
      if (session.oauth2_state === state) {
        if (session.merchant_id && session.merchant_id !== this.merchantId) continue;
        if (session.session_expires_at > Date.now()) {
          return { ...session };
        }
      }
    }
    try {
      const persisted = this.store.loadSessionsSync?.() || [];
      for (const session of persisted) {
        if (session.oauth2_state === state) {
          if (session.merchant_id && session.merchant_id !== this.merchantId) continue;
          if (session.session_expires_at > Date.now()) {
            this.sessions.set(session.session_id, session);
            return { ...session };
          }
        }
      }
    } catch {}
    return null;
  }

  /**
   * Finds an active authenticated session by merchant user ID.
   */
  findByUserId(userId: string): UserSession | null {
    if (!userId) return null;
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (
        session.user_id === userId &&
        session.status === "authenticated" &&
        session.session_expires_at > now &&
        (!session.merchant_id || session.merchant_id === this.merchantId)
      ) {
        return { ...session };
      }
    }
    try {
      const persisted = this.store.loadSessionsSync?.() || [];
      for (const session of persisted) {
        if (
          session.user_id === userId &&
          session.status === "authenticated" &&
          session.session_expires_at > now &&
          (!session.merchant_id || session.merchant_id === this.merchantId)
        ) {
          this.sessions.set(session.session_id, session);
          return { ...session };
        }
      }
    } catch {}
    return null;
  }

  /**
   * Finds an active authenticated session by customer email.
   */
  findByEmail(email: string): UserSession | null {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (
        session.user_email?.trim().toLowerCase() === normalized &&
        session.status === "authenticated" &&
        session.session_expires_at > now &&
        (!session.merchant_id || session.merchant_id === this.merchantId)
      ) {
        return { ...session };
      }
    }
    try {
      const persisted = this.store.loadSessionsSync?.() || [];
      for (const session of persisted) {
        if (
          session.user_email?.trim().toLowerCase() === normalized &&
          session.status === "authenticated" &&
          session.session_expires_at > now &&
          (!session.merchant_id || session.merchant_id === this.merchantId)
        ) {
          this.sessions.set(session.session_id, session);
          return { ...session };
        }
      }
    } catch {}
    return null;
  }

  /**
   * Returns the most recently authenticated valid session for this merchant.
   * @deprecated In multi-agent/multi-user environments, resolve session explicitly via sessionId or client connection transport.
   */
  getActiveSession(): UserSession | null {
    const now = Date.now();
    try {
      const persisted = this.store.loadSessionsSync?.() || [];
      for (const s of persisted) {
        if (s.merchant_id && s.merchant_id !== this.merchantId) continue;
        if (
          !this.sessions.has(s.session_id) ||
          (s.authenticated_at &&
            (!this.sessions.get(s.session_id)?.authenticated_at ||
              s.authenticated_at > (this.sessions.get(s.session_id)?.authenticated_at || 0)))
        ) {
          this.sessions.set(s.session_id, s);
        }
      }
    } catch {}

    let bestSession: UserSession | null = null;

    for (const session of this.sessions.values()) {
      if (session.merchant_id && session.merchant_id !== this.merchantId) {
        continue;
      }
      if (
        session.status === "authenticated" &&
        session.access_token &&
        session.session_expires_at > now
      ) {
        if (!bestSession || (session.authenticated_at || 0) > (bestSession.authenticated_at || 0)) {
          bestSession = session;
        }
      }
    }

    return bestSession ? { ...bestSession } : null;
  }

  /**
   * Removes all expired sessions from memory and store.
   */
  cleanExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (session.session_expires_at <= now) {
        this.invalidateSession(id);
      }
    }
  }

  /**
   * Hydrates sessions into memory from persistence store during server boot.
   */
  hydrate(sessions: UserSession[]): void {
    const now = Date.now();
    for (const session of sessions) {
      if (
        session.session_expires_at > now &&
        session.status !== "invalidated" &&
        (!session.merchant_id || session.merchant_id === this.merchantId)
      ) {
        this.sessions.set(session.session_id, session);
      }
    }
  }

  /**
   * Get all active in-memory sessions for this merchant.
   */
  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values())
      .filter((s) => !s.merchant_id || s.merchant_id === this.merchantId)
      .map((s) => ({ ...s }));
  }
}
