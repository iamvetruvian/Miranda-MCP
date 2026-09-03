/**
 * SQLite Persistence Implementation
 * Implements PersistenceStore backed by SQLite with WAL mode and table-per-aggregate schema.
 */

import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { Transaction, AuditEvent } from "../types/index.js";
import { LedgerCheckpoint } from "../audit/ledger.js";
import { SearchStateRecord } from "../tools/refinement.js";
import { UserSession } from "../auth/session-store.js";
import { RecurringToken } from "../payment/token-store.js";
import { PersistenceStore, type ActiveGateToken } from "./store.js";

export class SqliteStore implements PersistenceStore {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    if (dbPath !== ":memory:") {
      const dir = path.dirname(path.resolve(dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    // Enable WAL mode for high concurrency
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");

    // Transactions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        transaction_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
    `);

    // Audit events table (monotonic seq_id guarantees insertion order replay)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE NOT NULL,
        event_type TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_txn ON audit_events(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(timestamp);
    `);

    // Checkpoints table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_index INTEGER PRIMARY KEY,
        head_event_id TEXT NOT NULL,
        head_hash TEXT NOT NULL,
        signed_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);

    // Policy gate tokens table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gate_tokens (
        token TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        action TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gate_tokens_txn ON gate_tokens(transaction_id);
    `);

    // Search states table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_states (
        search_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);

    // Mandates table (for AP2 / Component 2)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mandates (
        mandate_id TEXT PRIMARY KEY,
        kind TEXT,
        data TEXT NOT NULL
      );
    `);

    // User sessions table (OAuth2 persistent auth)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        session_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        authenticated_at INTEGER,
        session_expires_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(session_expires_at);
    `);

    // Recurring tokens table (Razorpay autonomous payment tokens)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recurring_tokens (
        customer_id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        method TEXT NOT NULL,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recurring_tokens_token_id ON recurring_tokens(token_id);
    `);
  }

  async loadTransactions(): Promise<Transaction[]> {
    const stmt = this.db.prepare("SELECT data FROM transactions ORDER BY created_at ASC;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async saveTransaction(txn: Transaction): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO transactions (transaction_id, state, created_at, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(transaction_id) DO UPDATE SET
        state = excluded.state,
        data = excluded.data;
    `);
    stmt.run(txn.transaction_id, txn.state, txn.created_at, JSON.stringify(txn));
  }

  async loadLedgerEvents(): Promise<AuditEvent[]> {
    const stmt = this.db.prepare("SELECT data FROM audit_events ORDER BY seq_id ASC;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async appendLedgerEvent(event: AuditEvent): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO audit_events (event_id, event_type, transaction_id, timestamp, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING;
    `);
    stmt.run(
      event.event_id,
      event.event_type,
      event.transaction_id,
      event.timestamp,
      JSON.stringify(event)
    );
  }

  async loadCheckpoints(): Promise<LedgerCheckpoint[]> {
    const stmt = this.db.prepare("SELECT data FROM checkpoints ORDER BY checkpoint_index ASC;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async saveCheckpoint(cp: LedgerCheckpoint): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (checkpoint_index, head_event_id, head_hash, signed_at, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(checkpoint_index) DO UPDATE SET
        head_event_id = excluded.head_event_id,
        head_hash = excluded.head_hash,
        signed_at = excluded.signed_at,
        data = excluded.data;
    `);
    stmt.run(cp.checkpoint_index, cp.head_event_id, cp.head_hash, cp.signed_at, JSON.stringify(cp));
  }

  async loadGateTokens(): Promise<ActiveGateToken[]> {
    const stmt = this.db.prepare("SELECT data FROM gate_tokens;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async saveGateToken(token: ActiveGateToken): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO gate_tokens (token, transaction_id, action, expires_at, consumed, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET
        consumed = excluded.consumed,
        data = excluded.data;
    `);
    stmt.run(
      token.token,
      token.transaction_id,
      token.action,
      token.expires_at,
      token.consumed ? 1 : 0,
      JSON.stringify(token)
    );
  }

  async consumeGateToken(token: string): Promise<void> {
    const selectStmt = this.db.prepare("SELECT data FROM gate_tokens WHERE token = ?;");
    const row = selectStmt.get(token) as { data: string } | undefined;
    if (row) {
      const parsed: ActiveGateToken = JSON.parse(row.data);
      parsed.consumed = true;
      const updateStmt = this.db.prepare(`
        UPDATE gate_tokens SET consumed = 1, data = ? WHERE token = ?;
      `);
      updateStmt.run(JSON.stringify(parsed), token);
    }
  }

  async loadSearchStates(): Promise<[string, SearchStateRecord][]> {
    const stmt = this.db.prepare("SELECT search_id, data FROM search_states ORDER BY created_at ASC;");
    const rows = stmt.all() as Array<{ search_id: string; data: string }>;
    return rows.map((r) => [r.search_id, JSON.parse(r.data)]);
  }

  async saveSearchState(id: string, state: SearchStateRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO search_states (search_id, created_at, data)
      VALUES (?, ?, ?)
      ON CONFLICT(search_id) DO UPDATE SET
        data = excluded.data;
    `);
    stmt.run(id, state.createdAt, JSON.stringify(state));
  }

  async deleteSearchState(id: string): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM search_states WHERE search_id = ?;");
    stmt.run(id);
  }

  async loadMandates(): Promise<any[]> {
    const stmt = this.db.prepare("SELECT data FROM mandates;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async saveMandate(mandate: any): Promise<void> {
    const id = mandate?.mandate?.mandate_id || mandate?.mandate_id || `mandate_${Date.now()}`;
    const kind = mandate?.mandate?.kind || mandate?.kind || "unknown";
    const stmt = this.db.prepare(`
      INSERT INTO mandates (mandate_id, kind, data)
      VALUES (?, ?, ?)
      ON CONFLICT(mandate_id) DO UPDATE SET
        kind = excluded.kind,
        data = excluded.data;
    `);
    stmt.run(id, kind, JSON.stringify(mandate));
  }

  async loadSessions(): Promise<UserSession[]> {
    const stmt = this.db.prepare("SELECT data FROM user_sessions WHERE session_expires_at > ?;");
    const rows = stmt.all(Date.now()) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async saveSession(session: UserSession): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO user_sessions (session_id, status, authenticated_at, session_expires_at, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        status = excluded.status,
        authenticated_at = excluded.authenticated_at,
        session_expires_at = excluded.session_expires_at,
        data = excluded.data;
    `);
    stmt.run(
      session.session_id,
      session.status || "authenticated",
      session.authenticated_at ?? null,
      session.session_expires_at,
      JSON.stringify(session)
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM user_sessions WHERE session_id = ?;");
    stmt.run(sessionId);
  }

  async loadRecurringTokens(): Promise<RecurringToken[]> {
    const stmt = this.db.prepare("SELECT data FROM recurring_tokens;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async saveRecurringToken(token: RecurringToken): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO recurring_tokens (customer_id, token_id, method, created_at, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(customer_id) DO UPDATE SET
        token_id = excluded.token_id,
        method = excluded.method,
        data = excluded.data;
    `);
    stmt.run(
      token.customer_id,
      token.token_id,
      token.method,
      token.created_at,
      JSON.stringify(token)
    );
  }

  async deleteRecurringToken(customerId: string): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM recurring_tokens WHERE customer_id = ?;");
    stmt.run(customerId);
  }

  loadTransactionsSync(): Transaction[] {
    const stmt = this.db.prepare("SELECT data FROM transactions ORDER BY created_at ASC;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  loadLedgerEventsSync(): AuditEvent[] {
    const stmt = this.db.prepare("SELECT data FROM audit_events ORDER BY seq_id ASC;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  loadCheckpointsSync(): LedgerCheckpoint[] {
    const stmt = this.db.prepare("SELECT data FROM checkpoints ORDER BY checkpoint_index ASC;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  loadGateTokensSync(): ActiveGateToken[] {
    const stmt = this.db.prepare("SELECT data FROM gate_tokens;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  loadSearchStatesSync(): [string, SearchStateRecord][] {
    const stmt = this.db.prepare("SELECT search_id, data FROM search_states ORDER BY created_at ASC;");
    const rows = stmt.all() as Array<{ search_id: string; data: string }>;
    return rows.map((r) => [r.search_id, JSON.parse(r.data)]);
  }

  loadMandatesSync(): any[] {
    const stmt = this.db.prepare("SELECT data FROM mandates;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  loadSessionsSync(): UserSession[] {
    const stmt = this.db.prepare("SELECT data FROM user_sessions WHERE session_expires_at > ?;");
    const rows = stmt.all(Date.now()) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  loadRecurringTokensSync(): RecurringToken[] {
    const stmt = this.db.prepare("SELECT data FROM recurring_tokens;");
    const rows = stmt.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
