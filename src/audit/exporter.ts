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
  private ledger?: AuditLedger;
  private txnContextCache: Map<
    string,
    { amount?: number; currency?: string; reasoning?: string }
  > = new Map();

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
    this.ledger = ledger;
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
    this.ledger = undefined;
  }

  /**
   * Helper to extract amount, currency, and reasoning from event payloads or transaction history/cache.
   */
  private extractContext(event: AuditEvent): {
    amount?: number;
    currency?: string;
    reasoning?: string;
  } {
    const txnId = event.transaction_id;
    const isSpecialTxn = !txnId || txnId === "__ledger__";
    const cached = !isSpecialTxn ? this.txnContextCache.get(txnId) : undefined;

    const findAmountAndCurrency = (obj: any): { amount?: number; currency?: string } => {
      if (!obj || typeof obj !== "object") return {};
      let amount: number | undefined;
      let currency: string | undefined;

      if (typeof obj.amount === "number") {
        amount = obj.amount;
      }
      if (typeof obj.currency === "string") {
        currency = obj.currency;
      }

      // Check money objects like total, price, unit_price, or checkout
      for (const key of ["total", "price", "unit_price", "checkout"]) {
        if (obj[key] && typeof obj[key] === "object") {
          const nested = findAmountAndCurrency(obj[key]);
          if (amount === undefined && nested.amount !== undefined) amount = nested.amount;
          if (currency === undefined && nested.currency !== undefined) currency = nested.currency;
        }
      }
      return { amount, currency };
    };

    const findReasoning = (obj: any): string | undefined => {
      if (!obj || typeof obj !== "object") return undefined;
      if (typeof obj.reasoning === "string" && obj.reasoning.trim().length > 0) {
        return obj.reasoning.trim();
      }
      if (typeof obj.selection_reason === "string" && obj.selection_reason.trim().length > 0) {
        return obj.selection_reason.trim();
      }
      if (obj.params && typeof obj.params === "object") {
        const nested = findReasoning(obj.params);
        if (nested) return nested;
      }
      if (obj.checkout && typeof obj.checkout === "object") {
        const nested = findReasoning(obj.checkout);
        if (nested) return nested;
      }
      return undefined;
    };

    // Extract from current event
    const reqAmountCur = findAmountAndCurrency(event.request);
    const resAmountCur = findAmountAndCurrency(event.response);
    let amount = resAmountCur.amount ?? reqAmountCur.amount;
    let currency = resAmountCur.currency ?? reqAmountCur.currency;

    let reasoning =
      findReasoning(event.request) ??
      findReasoning(event.response) ??
      ((event as any).reasoning as string | undefined);

    // If not found in current event, use cache or ledger history
    if (amount === undefined && cached?.amount !== undefined) {
      amount = cached.amount;
    }
    if (currency === undefined && cached?.currency !== undefined) {
      currency = cached.currency;
    }
    if (reasoning === undefined && cached?.reasoning !== undefined) {
      reasoning = cached.reasoning;
    }

    // Fallback: check ledger history if attached
    if (
      (amount === undefined || currency === undefined || reasoning === undefined) &&
      this.ledger &&
      !isSpecialTxn
    ) {
      const history = this.ledger.getTransactionAudit(txnId);
      for (let i = history.length - 1; i >= 0; i--) {
        const prev = history[i];
        if (amount === undefined || currency === undefined) {
          const pRes = findAmountAndCurrency(prev.response);
          const pReq = findAmountAndCurrency(prev.request);
          if (amount === undefined) amount = pRes.amount ?? pReq.amount;
          if (currency === undefined) currency = pRes.currency ?? pReq.currency;
        }
        if (reasoning === undefined) {
          reasoning =
            findReasoning(prev.request) ??
            findReasoning(prev.response) ??
            ((prev as any).reasoning as string | undefined);
        }
        if (amount !== undefined && currency !== undefined && reasoning !== undefined) {
          break;
        }
      }
    }

    // Update cache
    if (!isSpecialTxn) {
      this.txnContextCache.set(txnId, {
        amount: amount ?? cached?.amount,
        currency: currency ?? cached?.currency,
        reasoning: reasoning ?? cached?.reasoning,
      });
    }

    return { amount, currency, reasoning };
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

    const { amount, currency, reasoning } = this.extractContext(event);
    if (typeof amount === "number") {
      attributes["merchantmcp.amount"] = amount;
    }
    if (typeof currency === "string") {
      attributes["merchantmcp.currency"] = currency;
    }
    if (typeof reasoning === "string" && reasoning.length > 0) {
      attributes["merchantmcp.reasoning"] = reasoning;
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
   * Helper to convert an arbitrary JS value into OpenTelemetry AnyValue protobuf-JSON format.
   */
  private toOtlpAnyValue(val: unknown): Record<string, unknown> {
    if (typeof val === "string") {
      return { stringValue: val };
    }
    if (typeof val === "boolean") {
      return { boolValue: val };
    }
    if (typeof val === "number") {
      return Number.isInteger(val) ? { intValue: String(val) } : { doubleValue: val };
    }
    if (Array.isArray(val)) {
      return { arrayValue: { values: val.map((item) => this.toOtlpAnyValue(item)) } };
    }
    if (typeof val === "object" && val !== null) {
      return {
        kvlistValue: {
          values: Object.entries(val).map(([k, v]) => ({
            key: k,
            value: this.toOtlpAnyValue(v),
          })),
        },
      };
    }
    return { stringValue: String(val) };
  }

  /**
   * Serializes a batch of OTelLogRecord objects into standard OpenTelemetry OTLP/HTTP JSON wire format.
   */
  formatOtlpPayload(batch: OTelLogRecord[]): Record<string, unknown> {
    return {
      resourceLogs: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: this.serviceName },
              },
            ],
          },
          scopeLogs: [
            {
              scope: {
                name: "merchant-mcp-audit",
              },
              logRecords: batch.map((record) => {
                const timeMs = record.timestamp ? new Date(record.timestamp).getTime() : Date.now();
                const observedMs = record.observedTimestamp
                  ? new Date(record.observedTimestamp).getTime()
                  : Date.now();

                const timeUnixNano = String((isNaN(timeMs) ? Date.now() : timeMs) * 1000000);
                const observedTimeUnixNano = String((isNaN(observedMs) ? Date.now() : observedMs) * 1000000);

                const attributes = Object.entries(record.attributes)
                  .filter(([_, v]) => v !== undefined)
                  .map(([k, v]) => ({
                    key: k,
                    value: this.toOtlpAnyValue(v),
                  }));

                if (record.body.details) {
                  attributes.push({
                    key: "merchantmcp.details",
                    value: { stringValue: JSON.stringify(record.body.details) },
                  });
                }

                return {
                  timeUnixNano,
                  observedTimeUnixNano,
                  severityNumber: record.severityNumber,
                  severityText: record.severityText,
                  body: {
                    stringValue: record.body.message || JSON.stringify(record.body),
                  },
                  attributes,
                };
              }),
            },
          ],
        },
      ],
    };
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
      const payload = this.formatOtlpPayload(batch);
      const response = await fetch(this.endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.warn(
          `[AuditExporter] Failed to export ${batch.length} logs: HTTP ${response.status}${
            errorText ? ` - ${errorText}` : ""
          }`
        );
      }
    } catch (err: any) {
      console.warn(`[AuditExporter] Failed to export logs to ${this.endpointUrl}: ${err.message}`);
    }
  }
}
