/**
 * Audit Exporter for OpenTelemetry / SIEM Integrations
 * Subscribes to the immutable audit ledger and streams structured event logs
 * to OpenTelemetry collectors or enterprise SIEM endpoints.
 */

import { AuditEvent, AuditEventType } from "../types/index.js";
import { AuditLedger } from "./ledger.js";

export interface OTelLogRecord {
  timestamp: string;
  observedTimestamp: string;
  severityNumber: number;
  severityText: string;
  body: {
    message: string;
    event_type: AuditEventType;
    transaction_id: string;
    event_id: string;
    details?: Record<string, unknown>;
  };
  attributes: Record<string, string | number | boolean | undefined>;
}

export interface ExporterOptions {
  endpointUrl?: string;
  serviceName?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  headers?: Record<string, string>;
  customTransport?: (logs: OTelLogRecord[]) => Promise<void> | void;
}

export class AuditExporter {
  private endpointUrl?: string;
  private serviceName: string;
  private batchSize: number;
  private flushIntervalMs: number;
  private headers: Record<string, string>;
  private customTransport?: (logs: OTelLogRecord[]) => Promise<void> | void;
  private queue: OTelLogRecord[] = [];
  private flushTimer?: NodeJS.Timeout;
  private unsubscribe?: () => void;

  constructor(options: ExporterOptions = {}) {
    this.endpointUrl = options.endpointUrl;
    this.serviceName = options.serviceName || "merchant-mcp";
    this.batchSize = options.batchSize || 10;
    this.flushIntervalMs = options.flushIntervalMs || 2000;
    this.headers = options.headers || {};
    this.customTransport = options.customTransport;
  }

  /**
   * Attach exporter to an AuditLedger instance.
   */
  attach(ledger: AuditLedger): this {
    this.unsubscribe = ledger.onEvent((event) => this.handleEvent(event));
    if (this.flushIntervalMs > 0 && !this.flushTimer) {
      this.flushTimer = setInterval(() => {
        this.flush().catch((err) => {
          console.warn("[AuditExporter] Periodic flush error:", err);
        });
      }, this.flushIntervalMs);
    }
    return this;
  }

  /**
   * Stop timer and detach from ledger.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Convert an AuditEvent to an OpenTelemetry LogRecord.
   */
  formatLogRecord(event: AuditEvent): OTelLogRecord {
    const { severityNumber, severityText } = this.getSeverity(event);

    const attributes: Record<string, string | number | boolean | undefined> = {
      "service.name": this.serviceName,
      "merchantmcp.transaction_id": event.transaction_id,
      "merchantmcp.event_id": event.event_id,
      "merchantmcp.event_type": event.event_type,
      "merchantmcp.actor.type": event.actor.type,
      "merchantmcp.actor.component": event.actor.component,
      "merchantmcp.event_hash": event.integrity.event_hash,
      "merchantmcp.previous_event_hash": event.integrity.previous_event_hash,
    };

    if (event.policy) {
      attributes["merchantmcp.policy.decision"] = event.policy.decision;
    }
    if (event.state_transition) {
      attributes["merchantmcp.state_transition.from"] = event.state_transition.from;
      attributes["merchantmcp.state_transition.to"] = event.state_transition.to;
      attributes["merchantmcp.state_transition.trigger"] = event.state_transition.trigger;
    }

    const message = `[${event.actor.type.toUpperCase()}] ${event.event_type} on txn ${event.transaction_id}`;

    return {
      timestamp: event.timestamp,
      observedTimestamp: new Date().toISOString(),
      severityNumber,
      severityText,
      body: {
        message,
        event_type: event.event_type,
        transaction_id: event.transaction_id,
        event_id: event.event_id,
        details: (event.response || event.request || event.policy) as Record<string, unknown> | undefined,
      },
      attributes,
    };
  }

  /**
   * Maps AuditEventType to OTel log severity numbers & text.
   */
  private getSeverity(event: AuditEvent): { severityNumber: number; severityText: string } {
    switch (event.event_type) {
      case AuditEventType.LEDGER_CHECKPOINT:
        return { severityNumber: 21, severityText: "FATAL" }; // High severity checkpoint attestation

      case AuditEventType.TRANSACTION_FAILED:
      case AuditEventType.MANDATE_REJECTED:
      case AuditEventType.RATE_LIMITED:
      case AuditEventType.AGENT_FLAGGED:
      case AuditEventType.WEBHOOK_SIGNATURE_INVALID:
      case AuditEventType.REFUND_FAILED:
        return { severityNumber: 13, severityText: "WARN" };

      case AuditEventType.POLICY_EVALUATED:
        return event.policy?.decision === "DENY"
          ? { severityNumber: 13, severityText: "WARN" }
          : { severityNumber: 9, severityText: "INFO" };

      case AuditEventType.ORDER_CONFIRMED:
      case AuditEventType.PAYMENT_CAPTURED:
      case AuditEventType.REFUND_PROCESSED:
      case AuditEventType.CONSENT_GRANTED:
      case AuditEventType.MANDATE_CREATED:
        return { severityNumber: 9, severityText: "INFO" };

      default:
        return { severityNumber: 5, severityText: "DEBUG" };
    }
  }

  /**
   * Handle an event emitted from the ledger.
   */
  handleEvent(event: AuditEvent): void {
    const record = this.formatLogRecord(event);
    this.queue.push(record);

    if (this.queue.length >= this.batchSize) {
      this.flush().catch((err) => {
        console.warn("[AuditExporter] Batch flush error:", err);
      });
    }
  }

  /**
   * Flush queued log records to OTel HTTP endpoint or custom transport.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = [...this.queue];
    this.queue = [];

    if (this.customTransport) {
      try {
        await this.customTransport(batch);
      } catch (err) {
        console.error("[AuditExporter] Custom transport error:", err);
      }
      return;
    }

    if (!this.endpointUrl) {
      return;
    }

    try {
      const response = await fetch(this.endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify({ resourceLogs: [{ scopeLogs: [{ logRecords: batch }] }] }),
      });

      if (!response.ok) {
        console.warn(
          `[AuditExporter] Failed to export ${batch.length} logs: HTTP ${response.status}`
        );
      }
    } catch (err: any) {
      console.warn(`[AuditExporter] Failed to export logs to ${this.endpointUrl}: ${err.message}`);
    }
  }
}
