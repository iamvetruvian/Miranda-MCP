/**
 * Tamper-Evident Audit Ledger
 * Provides append-only, SHA-256 hash-chained financial and security audit records,
 * and periodic HMAC-signed checkpoints.
 */

import crypto from "crypto";
import fs from "fs";
import { AuditEvent, AuditEventType } from "../types/index.js";
import { EventPayload } from "./events.js";
import { PersistenceStore } from "../persistence/store.js";

export const DEFAULT_REDACT_PATTERN =
  /(secret|token|password|authorization|bearer|cookie|signature|credit_card|cvv|private_key|api_key|secret_key|auth_key|access_key|signing_key|^key$)/i;

/**
 * Recursively redacts sensitive keys and values from objects before ledger storage.
 * Enforces Invariant 8: Secrets never enter the immutable audit ledger.
 */
export function redact<T>(data: T, pattern: RegExp = DEFAULT_REDACT_PATTERN): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    if (/bearer\s+[a-zA-Z0-9._~+/-]+=*/i.test(data)) {
      return data.replace(/bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, "Bearer [REDACTED]") as unknown as T;
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redact(item, pattern)) as unknown as T;
  }

  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (pattern.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redact(value, pattern);
      }
    }
    return result as T;
  }

  return data;
}

export interface ChainVerificationResult {
  valid: boolean;
  event_count: number;
  broken_at_event_id?: string;
  error?: string;
}

export interface LedgerCheckpoint {
  checkpoint_index: number;
  head_event_id: string;
  head_hash: string;
  signed_at: string;
  signature?: string;
  algorithm: "hmac-sha256" | "unsigned";
}

export interface LedgerOptions {
  checkpointInterval?: number; // events per checkpoint; default 100; 0 disables
  signingSecret?: string; // from LEDGER_SIGNING_SECRET env
  redactPattern?: RegExp; // custom deny-list regex for secret masking
  store?: PersistenceStore;
}

export class AuditLedger {
  private eventsByTxn: Map<string, AuditEvent[]> = new Map();
  private allEvents: AuditEvent[] = [];
  private logFilePath?: string;
  private appendCount = 0;
  private checkpoints: LedgerCheckpoint[] = [];
  private options: Required<Pick<LedgerOptions, "checkpointInterval">> & LedgerOptions;
  private store?: PersistenceStore;
  private listeners: ((event: AuditEvent) => void)[] = [];

  constructor(logFilePath?: string, options?: LedgerOptions) {
    this.logFilePath = logFilePath;
    this.store = options?.store;
    this.options = {
      checkpointInterval: options?.checkpointInterval ?? 100,
      signingSecret: options?.signingSecret,
      ...options,
    };
  }

  setStore(store: PersistenceStore): void {
    this.store = store;
  }

  /**
   * Hydrate in-memory ledger state from persisted events and checkpoints.
   */
  hydrate(events: AuditEvent[], checkpoints: LedgerCheckpoint[] = []): void {
    this.eventsByTxn.clear();
    this.allEvents = [];
    this.checkpoints = [...checkpoints];
    this.appendCount = events.length;

    for (const event of events) {
      const history = this.eventsByTxn.get(event.transaction_id) ?? [];
      history.push(event);
      this.eventsByTxn.set(event.transaction_id, history);
      this.allEvents.push(event);
    }
  }

  /**
   * Append an event to the ledger.
   * Automatically assigns a unique event_id, links to the previous event hash,
   * and computes the SHA-256 integrity hash.
   */
  append(payload: EventPayload): AuditEvent {
    const auditEvent = this.recordEvent(payload);
    this.appendCount += 1;

    // Periodic signed checkpoint anchored to the global chain head
    const interval = this.options.checkpointInterval ?? 100;
    if (interval > 0 && this.appendCount % interval === 0) {
      const head = auditEvent;
      const index = this.checkpoints.length;
      const signedAt = new Date().toISOString();
      const material = `${index}:${head.event_id}:${head.integrity.event_hash}`;
      const checkpoint: LedgerCheckpoint = {
        checkpoint_index: index,
        head_event_id: head.event_id,
        head_hash: head.integrity.event_hash,
        signed_at: signedAt,
        algorithm: this.options.signingSecret ? "hmac-sha256" : "unsigned",
        signature: this.options.signingSecret
          ? crypto.createHmac("sha256", this.options.signingSecret).update(material).digest("hex")
          : undefined,
      };
      this.checkpoints.push(checkpoint);
      if (this.store) {
        this.store.saveCheckpoint(checkpoint).catch((err) => {
          console.error(`[AuditLedger] Failed to persist checkpoint #${checkpoint.checkpoint_index}:`, err);
        });
      }

      // Record the checkpoint as an event in the __ledger__ stream
      this.recordEvent({
        event_type: AuditEventType.LEDGER_CHECKPOINT,
        timestamp: signedAt,
        transaction_id: "__ledger__",
        actor: { type: "system", component: "audit_ledger" },
        response: { ...checkpoint },
      });
    }

    return auditEvent;
  }

  /**
   * Subscribe to new audit ledger events (e.g. for OpenTelemetry / SIEM exporting).
   * Returns an unsubscribe function.
   */
  onEvent(listener: (event: AuditEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private recordEvent(rawPayload: EventPayload): AuditEvent {
    // 1. Redact all sensitive fields before hashing and persisting (Invariant 8)
    const payload = redact(rawPayload, this.options.redactPattern);

    const txnId = payload.transaction_id;
    const history = this.eventsByTxn.get(txnId) ?? [];

    const previousHash =
      history.length > 0
        ? history[history.length - 1].integrity.event_hash
        : "GENESIS";

    const eventId = `evt_${crypto.randomUUID()}`;

    const hashableData = {
      event_id: eventId,
      event_type: payload.event_type,
      timestamp: payload.timestamp,
      transaction_id: payload.transaction_id,
      actor: payload.actor,
      request: payload.request ?? null,
      response: payload.response ?? null,
      policy: payload.policy ?? null,
      state_transition: payload.state_transition ?? null,
      previous_event_hash: previousHash,
    };

    const eventHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(hashableData))
      .digest("hex");

    const auditEvent: AuditEvent = {
      ...payload,
      event_id: eventId,
      integrity: {
        previous_event_hash: previousHash,
        event_hash: eventHash,
      },
    };

    history.push(auditEvent);
    this.eventsByTxn.set(txnId, history);
    this.allEvents.push(auditEvent);

    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, JSON.stringify(auditEvent) + "\n", "utf-8");
      } catch (err) {
        console.error("Failed to write to audit log file:", err);
      }
    }

    if (this.store) {
      this.store.appendLedgerEvent(auditEvent).catch((err) => {
        console.error(`[AuditLedger] Failed to persist audit event ${auditEvent.event_id}:`, err);
      });
    }

    // 2. Notify subscribers (e.g. OTel exporter)
    for (const listener of this.listeners) {
      try {
        listener(auditEvent);
      } catch (err) {
        console.error(`[AuditLedger] Error in event listener:`, err);
      }
    }

    return auditEvent;
  }

  /**
   * Retrieve all audit events for a transaction in chronological order.
   */
  getTransactionAudit(transactionId: string): AuditEvent[] {
    return this.eventsByTxn.get(transactionId) ?? [];
  }

  /**
   * Retrieve all events across all transactions.
   */
  getAllEvents(): AuditEvent[] {
    return [...this.allEvents];
  }

  /**
   * Filter events by type.
   */
  getEventsByType(type: AuditEventType): AuditEvent[] {
    return this.allEvents.filter((e) => e.event_type === type);
  }

  /**
   * Retrieve all emitted checkpoints.
   */
  getCheckpoints(): LedgerCheckpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Retrieve the latest checkpoint if available.
   */
  getLastCheckpoint(): LedgerCheckpoint | undefined {
    return this.checkpoints.length > 0
      ? this.checkpoints[this.checkpoints.length - 1]
      : undefined;
  }

  /**
   * Verify all checkpoints and their HMAC signatures.
   */
  verifyCheckpoints(): {
    valid: boolean;
    checkpoints: LedgerCheckpoint[];
    first_invalid?: number;
    error?: string;
  } {
    for (let i = 0; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];

      // 1. Verify head event exists in ledger with matching hash
      const matchingEvent = this.allEvents.find((e) => e.event_id === cp.head_event_id);
      if (!matchingEvent || matchingEvent.integrity.event_hash !== cp.head_hash) {
        return {
          valid: false,
          checkpoints: this.checkpoints,
          first_invalid: i,
          error: `Checkpoint #${cp.checkpoint_index} head event ${cp.head_event_id} missing or hash mismatch`,
        };
      }

      // 2. If signed, verify HMAC-SHA256 signature
      if (cp.algorithm === "hmac-sha256" && this.options.signingSecret) {
        const material = `${cp.checkpoint_index}:${cp.head_event_id}:${cp.head_hash}`;
        const expectedSig = crypto
          .createHmac("sha256", this.options.signingSecret)
          .update(material)
          .digest("hex");
        if (cp.signature !== expectedSig) {
          return {
            valid: false,
            checkpoints: this.checkpoints,
            first_invalid: i,
            error: `Checkpoint #${cp.checkpoint_index} signature verification failed`,
          };
        }
      }
    }
    return { valid: true, checkpoints: this.checkpoints };
  }

  /**
   * Cryptographically verify the SHA-256 hash chain for a transaction.
   * Detects if any event was modified, deleted, or inserted out of order.
   */
  verifyChain(transactionId: string): ChainVerificationResult {
    const events = this.eventsByTxn.get(transactionId);
    if (!events || events.length === 0) {
      return { valid: true, event_count: 0 };
    }

    let expectedPreviousHash = "GENESIS";

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // 1. Check previous hash link
      if (event.integrity.previous_event_hash !== expectedPreviousHash) {
        return {
          valid: false,
          event_count: events.length,
          broken_at_event_id: event.event_id,
          error: `Broken chain link at index ${i}. Expected previous hash "${expectedPreviousHash}", found "${event.integrity.previous_event_hash}"`,
        };
      }

      // 2. Recompute the hash from content
      const hashableData = {
        event_id: event.event_id,
        event_type: event.event_type,
        timestamp: event.timestamp,
        transaction_id: event.transaction_id,
        actor: event.actor,
        request: event.request ?? null,
        response: event.response ?? null,
        policy: event.policy ?? null,
        state_transition: event.state_transition ?? null,
        previous_event_hash: expectedPreviousHash,
      };

      const calculatedHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(hashableData))
        .digest("hex");

      if (event.integrity.event_hash !== calculatedHash) {
        return {
          valid: false,
          event_count: events.length,
          broken_at_event_id: event.event_id,
          error: `Tampered event data at index ${i} (${event.event_id}). Expected hash "${calculatedHash}", stored hash "${event.integrity.event_hash}"`,
        };
      }

      expectedPreviousHash = event.integrity.event_hash;
    }

    return {
      valid: true,
      event_count: events.length,
    };
  }
}
