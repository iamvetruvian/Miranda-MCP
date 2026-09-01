/**
 * User Session Store Unit Tests
 * Tests lifecycle (pending -> authenticated), token resolution, auto-refresh updates,
 * TTL expiration, active session retrieval, and SQLite persistence round-tripping.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore, UserSession } from "../../src/auth/session-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { SqliteStore } from "../../src/persistence/sqlite.js";
import fs from "fs";
import path from "path";

describe("SessionStore (InMemoryStore)", () => {
  let store: InMemoryStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    store = new InMemoryStore();
    sessionStore = new SessionStore(store);
  });

  it("should create a pending session with CSRF state and PKCE verifier", () => {
    const pending = sessionStore.createPendingSession("random_state_123", "pkce_verifier_abc");

    expect(pending.session_id).toMatch(/^sess_/);
    expect(pending.status).toBe("pending");
    expect(pending.oauth2_state).toBe("random_state_123");
    expect(pending.pkce_verifier).toBe("pkce_verifier_abc");
    expect(pending.access_token).toBe("");

    const retrieved = sessionStore.findByState("random_state_123");
    expect(retrieved?.session_id).toBe(pending.session_id);
  });

  it("should complete a pending session with OAuth2 tokens and user info", () => {
    const pending = sessionStore.createPendingSession("state_xyz");
    const completed = sessionStore.completeSession(
      pending.session_id,
      {
        access_token: "access_token_jwt_123",
        refresh_token: "refresh_token_jwt_456",
        expires_in: 3600,
      },
      {
        user_id: "user_789",
        user_name: "Jane Doe",
      },
      86400 // 1 day session TTL
    );

    expect(completed.status).toBe("authenticated");
    expect(completed.access_token).toBe("access_token_jwt_123");
    expect(completed.refresh_token).toBe("refresh_token_jwt_456");
    expect(completed.user_id).toBe("user_789");
    expect(completed.user_name).toBe("Jane Doe");
    expect(completed.token_expires_at).toBeGreaterThan(Date.now());
    expect(completed.session_expires_at).toBeGreaterThan(Date.now());

    // Resolves token
    const token = sessionStore.resolveToken(pending.session_id);
    expect(token).toBe("access_token_jwt_123");
  });

  it("should update tokens upon token refresh", () => {
    const pending = sessionStore.createPendingSession("state_1");
    sessionStore.completeSession(pending.session_id, {
      access_token: "old_token",
      refresh_token: "ref_1",
      expires_in: 3600,
    });

    sessionStore.updateTokens(pending.session_id, {
      access_token: "new_refreshed_token",
      expires_in: 7200,
    });

    const session = sessionStore.getSession(pending.session_id);
    expect(session?.access_token).toBe("new_refreshed_token");
    expect(session?.refresh_token).toBe("ref_1");
  });

  it("should return null for expired sessions", () => {
    const pending = sessionStore.createPendingSession("state_exp", undefined, -10); // expired 10s ago
    sessionStore.completeSession(
      pending.session_id,
      { access_token: "exp_token" },
      undefined,
      -10 // expired session TTL
    );

    const session = sessionStore.getSession(pending.session_id);
    expect(session).toBeNull();

    const token = sessionStore.resolveToken(pending.session_id);
    expect(token).toBeNull();
  });

  it("should get active session (1 session = 1 user)", () => {
    expect(sessionStore.getActiveSession()).toBeNull();

    const s1 = sessionStore.createPendingSession("s1");
    sessionStore.completeSession(s1.session_id, { access_token: "token_1" });

    const active = sessionStore.getActiveSession();
    expect(active?.session_id).toBe(s1.session_id);
    expect(active?.access_token).toBe("token_1");
  });

  it("should invalidate sessions cleanly", () => {
    const s = sessionStore.createPendingSession("s_inv");
    sessionStore.completeSession(s.session_id, { access_token: "tok_inv" });

    sessionStore.invalidateSession(s.session_id);
    expect(sessionStore.getSession(s.session_id)).toBeNull();
    expect(sessionStore.resolveToken(s.session_id)).toBeNull();
  });

  it("should clean expired sessions", () => {
    const sValid = sessionStore.createPendingSession("valid", undefined, 3600);
    sessionStore.completeSession(sValid.session_id, { access_token: "valid_token" }, undefined, 3600);

    const sExpired = sessionStore.createPendingSession("exp", undefined, -5);
    sessionStore.completeSession(sExpired.session_id, { access_token: "exp_token" }, undefined, -5);

    sessionStore.cleanExpired();

    expect(sessionStore.getSession(sValid.session_id)).not.toBeNull();
    expect(sessionStore.getSession(sExpired.session_id)).toBeNull();
  });
});

describe("SessionStore (SqliteStore Persistence)", () => {
  const testDbPath = path.resolve(process.cwd(), "scratch_test_sessions.db");
  let sqliteStore: SqliteStore;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    sqliteStore = new SqliteStore(testDbPath);
  });

  afterEach(async () => {
    await sqliteStore.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("should persist session across store reboots via SQLite", async () => {
    const sessionStore1 = new SessionStore(sqliteStore);
    const pending = sessionStore1.createPendingSession("state_sqlite");
    sessionStore1.completeSession(
      pending.session_id,
      {
        access_token: "sqlite_access_token",
        refresh_token: "sqlite_refresh_token",
        expires_in: 7200,
      },
      {
        user_id: "usr_42",
        user_name: "Alice",
      },
      86400 * 30 // 30 days
    );

    // Wait 50ms for SQLite save to flush
    await new Promise((r) => setTimeout(r, 50));

    // Simulate server reboot: load sessions from sqliteStore into a fresh SessionStore instance
    const hydratedSessions = sqliteStore.loadSessionsSync();
    expect(hydratedSessions.length).toBe(1);
    expect(hydratedSessions[0].session_id).toBe(pending.session_id);
    expect(hydratedSessions[0].user_name).toBe("Alice");

    const sessionStore2 = new SessionStore(sqliteStore);
    sessionStore2.hydrate(hydratedSessions);

    const resolved = sessionStore2.resolveToken(pending.session_id);
    expect(resolved).toBe("sqlite_access_token");

    const active = sessionStore2.getActiveSession();
    expect(active?.user_id).toBe("usr_42");
    expect(active?.user_name).toBe("Alice");
  });
});
