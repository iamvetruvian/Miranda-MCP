/**
 * Persistence Seam
 * All process-local state goes through this interface. Default impl is
 * in-memory (current behavior). MERCHANTMCP_DB_PATH selects the SQLite impl.
 * Design rule: stores stay authoritative for logic; the persistence store only
 * loads/saves snapshots. No query logic migrates into the persistence layer.
 */

import { Transaction, AuditEvent } from "../types/index.js";
import { LedgerCheckpoint } from "../audit/ledger.js";
import { SearchStateRecord } from "../tools/refinement.js";

export interface ActiveGateToken {
  token: string;
  transaction_id: string;
  action: string;
  expires_at: number;
  consumed: boolean;
}

export interface PersistenceStore {
  // Transactions
  loadTransactions(): Promise<Transaction[]>;
  saveTransaction(txn: Transaction): Promise<void>;

  // Audit ledger (append-only; also written to the JSONL file as today)
  loadLedgerEvents(): Promise<AuditEvent[]>;
  appendLedgerEvent(event: AuditEvent): Promise<void>;
  loadCheckpoints(): Promise<LedgerCheckpoint[]>;
  saveCheckpoint(cp: LedgerCheckpoint): Promise<void>;

  // Policy engine tokens
  loadGateTokens(): Promise<ActiveGateToken[]>;
  saveGateToken(token: ActiveGateToken): Promise<void>;
  consumeGateToken(token: string): Promise<void>;

  // Search states (best-effort)
  loadSearchStates(): Promise<[string, SearchStateRecord][]>;
  saveSearchState(id: string, state: SearchStateRecord): Promise<void>;
  deleteSearchState(id: string): Promise<void>;

  // Mandates (Component 2 forward-compatible)
  loadMandates(): Promise<any[]>;
  saveMandate(mandate: any): Promise<void>;

  // User sessions (OAuth2 persistent auth)
  loadSessions(): Promise<import("../auth/session-store.js").UserSession[]>;
  saveSession(session: import("../auth/session-store.js").UserSession): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  loadSessionsSync(): import("../auth/session-store.js").UserSession[];

  close(): Promise<void>;
}

/**
 * In-Memory Persistence Store (Default)
 * Provides synchronous-speed no-op or in-memory snapshot persistence
 * ensuring zero overhead and complete backward compatibility with existing tests.
 */
export class InMemoryStore implements PersistenceStore {
  private transactions: Map<string, Transaction> = new Map();
  private ledgerEvents: AuditEvent[] = [];
  private checkpoints: LedgerCheckpoint[] = [];
  private gateTokens: Map<string, ActiveGateToken> = new Map();
  private searchStates: Map<string, SearchStateRecord> = new Map();
  private mandates: Map<string, any> = new Map();
  private sessions: Map<string, import("../auth/session-store.js").UserSession> = new Map();

  async loadTransactions(): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).map((t) => JSON.parse(JSON.stringify(t)));
  }

  async saveTransaction(txn: Transaction): Promise<void> {
    this.transactions.set(txn.transaction_id, JSON.parse(JSON.stringify(txn)));
  }

  async loadLedgerEvents(): Promise<AuditEvent[]> {
    return this.ledgerEvents.map((e) => JSON.parse(JSON.stringify(e)));
  }

  async appendLedgerEvent(event: AuditEvent): Promise<void> {
    this.ledgerEvents.push(JSON.parse(JSON.stringify(event)));
  }

  async loadCheckpoints(): Promise<LedgerCheckpoint[]> {
    return this.checkpoints.map((c) => JSON.parse(JSON.stringify(c)));
  }

  async saveCheckpoint(cp: LedgerCheckpoint): Promise<void> {
    const existingIdx = this.checkpoints.findIndex((c) => c.checkpoint_index === cp.checkpoint_index);
    const cloned = JSON.parse(JSON.stringify(cp));
    if (existingIdx !== -1) {
      this.checkpoints[existingIdx] = cloned;
    } else {
      this.checkpoints.push(cloned);
    }
  }

  async loadGateTokens(): Promise<ActiveGateToken[]> {
    return Array.from(this.gateTokens.values()).map((t) => ({ ...t }));
  }

  async saveGateToken(token: ActiveGateToken): Promise<void> {
    this.gateTokens.set(token.token, { ...token });
  }

  async consumeGateToken(token: string): Promise<void> {
    const entry = this.gateTokens.get(token);
    if (entry) {
      entry.consumed = true;
    }
  }

  async loadSearchStates(): Promise<[string, SearchStateRecord][]> {
    return Array.from(this.searchStates.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]);
  }

  async saveSearchState(id: string, state: SearchStateRecord): Promise<void> {
    this.searchStates.set(id, JSON.parse(JSON.stringify(state)));
  }

  async deleteSearchState(id: string): Promise<void> {
    this.searchStates.delete(id);
  }

  async loadMandates(): Promise<any[]> {
    return Array.from(this.mandates.values()).map((m) => JSON.parse(JSON.stringify(m)));
  }

  async saveMandate(mandate: any): Promise<void> {
    const id = mandate?.mandate?.mandate_id || mandate?.mandate_id || `mandate_${Date.now()}`;
    this.mandates.set(id, JSON.parse(JSON.stringify(mandate)));
  }

  async loadSessions(): Promise<import("../auth/session-store.js").UserSession[]> {
    return Array.from(this.sessions.values()).map((s) => JSON.parse(JSON.stringify(s)));
  }

  async saveSession(session: import("../auth/session-store.js").UserSession): Promise<void> {
    this.sessions.set(session.session_id, JSON.parse(JSON.stringify(session)));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  loadTransactionsSync(): Transaction[] {
    return Array.from(this.transactions.values()).map((t) => JSON.parse(JSON.stringify(t)));
  }

  loadLedgerEventsSync(): AuditEvent[] {
    return this.ledgerEvents.map((e) => JSON.parse(JSON.stringify(e)));
  }

  loadCheckpointsSync(): LedgerCheckpoint[] {
    return this.checkpoints.map((c) => JSON.parse(JSON.stringify(c)));
  }

  loadGateTokensSync(): ActiveGateToken[] {
    return Array.from(this.gateTokens.values()).map((t) => ({ ...t }));
  }

  loadSearchStatesSync(): [string, SearchStateRecord][] {
    return Array.from(this.searchStates.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]);
  }

  loadMandatesSync(): any[] {
    return Array.from(this.mandates.values()).map((m) => JSON.parse(JSON.stringify(m)));
  }

  loadSessionsSync(): import("../auth/session-store.js").UserSession[] {
    return Array.from(this.sessions.values()).map((s) => JSON.parse(JSON.stringify(s)));
  }

  async close(): Promise<void> {
    // No-op for in-memory store
  }
}
