/**
 * User Session Store
 * Server-side persistent session store mapping opaque session IDs to OAuth2 tokens.
 * Persists to SQLite with merchant-declared TTL (days/months).
 */

import crypto from "crypto";
import { PersistenceStore } from "../persistence/store.js";

export interface UserSession {
  session_id: string;              // "sess_<UUIDv4>" — opaque, safe to expose to agent
  access_token: string;            // OAuth2 access token (never exposed to agent)
  refresh_token?: string;          // OAuth2 refresh token (never exposed to agent)
  user_id?: string;                // Extracted user ID (optional)
  user_name?: string;              // Display name (optional)
  authenticated_at: number;        // Unix timestamp ms
  token_expires_at?: number;       // When the access token expires (Unix ms)
  session_expires_at: number;      // When the entire session expires (Unix ms) — merchant TTL
  oauth2_state?: string;           // CSRF protection state for pending auth flows
  pkce_verifier?: string;          // PKCE code verifier for pending auth flows
  status?: "pending" | "authenticated" | "invalidated";
}

export interface OAuth2Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;             // seconds
}

export interface UserInfo {
  user_id?: string;
  user_name?: string;
}

export const DEFAULT_SESSION_TTL_SECONDS = 2592000; // 30 days default

export class SessionStore {
  private store: PersistenceStore;
  private defaultTtlSeconds: number;
  private sessions: Map<string, UserSession> = new Map();

  constructor(store: PersistenceStore, defaultTtlSeconds?: number) {
    this.store = store;
    this.defaultTtlSeconds = defaultTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
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
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? existing?.refresh_token,
      user_id: userInfo?.user_id ?? existing?.user_id,
      user_name: userInfo?.user_name ?? existing?.user_name,
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
        if (session.session_expires_at > Date.now()) {
          return { ...session };
        }
      }
    }
    try {
      const persisted = this.store.loadSessionsSync?.() || [];
      for (const session of persisted) {
        if (session.oauth2_state === state) {
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
   * Returns the most recently authenticated valid session (1 session = 1 user model).
   */
  getActiveSession(): UserSession | null {
    const now = Date.now();
    try {
      const persisted = this.store.loadSessionsSync?.() || [];
      for (const s of persisted) {
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
      if (session.session_expires_at > now && session.status !== "invalidated") {
        this.sessions.set(session.session_id, session);
      }
    }
  }

  /**
   * Get all active in-memory sessions (for diagnostics/testing).
   */
  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s }));
  }
}
