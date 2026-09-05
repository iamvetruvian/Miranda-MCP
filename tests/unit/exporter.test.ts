/**
 * Audit Exporter (OpenTelemetry / SIEM) Unit Tests
 * Tests log record formatting, severity mappings, event streaming, and custom transport dispatch.
 */

import { describe, it, expect } from "vitest";
import { AuditExporter, OTelLogRecord } from "../../src/audit/exporter.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import {
  toolInvokedEvent,
  orderConfirmedEvent,
  transactionFailedEvent,
} from "../../src/audit/events.js";
import { AuditEventType } from "../../src/types/index.js";

describe("AuditExporter", () => {
  it("should correctly format an AuditEvent into standard OpenTelemetry attributes", () => {
    const exporter = new AuditExporter({ serviceName: "custom-merchant-mcp" });

    const mockEvent = {
      event_id: "evt_12345",
      event_type: AuditEventType.ORDER_CONFIRMED,
      timestamp: "2026-08-31T10:00:00.000Z",
      transaction_id: "txn_otel_1",
      actor: { type: "merchant" as const, component: "order_api" },
      response: { order_id: "ORD-999", status: "CONFIRMED" },
      integrity: { previous_event_hash: "GENESIS", event_hash: "hash_xyz_789" },
    };

    const record = exporter.formatLogRecord(mockEvent);

    expect(record.timestamp).toBe("2026-08-31T10:00:00.000Z");
    expect(record.severityNumber).toBe(9); // INFO
    expect(record.severityText).toBe("INFO");
    expect(record.attributes["service.name"]).toBe("custom-merchant-mcp");
    expect(record.attributes["merchantmcp.transaction_id"]).toBe("txn_otel_1");
    expect(record.attributes["merchantmcp.event_type"]).toBe(AuditEventType.ORDER_CONFIRMED);
    expect(record.attributes["merchantmcp.event_hash"]).toBe("hash_xyz_789");
  });

  it("should stream emitted ledger events to custom transport callback", async () => {
    const exportedRecords: OTelLogRecord[] = [];
    const exporter = new AuditExporter({
      batchSize: 2,
      customTransport: (logs) => {
        exportedRecords.push(...logs);
      },
    });

    const ledger = new AuditLedger();
    exporter.attach(ledger);

    ledger.append(toolInvokedEvent("txn_1", "search_products", { q: "shoes" }));
    ledger.append(orderConfirmedEvent("txn_1", { order_id: "ORD-1", status: "CONFIRMED" }));

    // Batch size of 2 should trigger auto-flush immediately
    expect(exportedRecords.length).toBe(2);
    expect(exportedRecords[0].body.event_type).toBe(AuditEventType.MCP_TOOL_INVOKED);
    expect(exportedRecords[1].body.event_type).toBe(AuditEventType.ORDER_CONFIRMED);

    exporter.stop();
  });

  it("should generate standard OpenTelemetry OTLP JSON wire format with AnyValue attributes", () => {
    const exporter = new AuditExporter({ serviceName: "honeycomb-test-mcp" });

    const mockEvent = {
      event_id: "evt_wire_1",
      event_type: AuditEventType.ORDER_CONFIRMED,
      timestamp: "2026-08-31T12:00:00.000Z",
      transaction_id: "txn_wire_1",
      actor: { type: "merchant" as const, component: "order_api" },
      response: { order_id: "ORD-WIRE" },
      integrity: { previous_event_hash: "GENESIS", event_hash: "wire_hash_1" },
    };

    const record = exporter.formatLogRecord(mockEvent);
    const payload = exporter.formatOtlpPayload([record]) as any;

    expect(payload.resourceLogs).toBeDefined();
    expect(payload.resourceLogs[0].resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "honeycomb-test-mcp" } },
    ]);

    const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(logRecord.timeUnixNano).toBeDefined();
    expect(logRecord.severityNumber).toBe(9);
    expect(logRecord.severityText).toBe("INFO");
    expect(logRecord.body.stringValue).toContain("ORDER_CONFIRMED");

    // Attributes should be an array of { key, value: AnyValue }
    expect(Array.isArray(logRecord.attributes)).toBe(true);
    const txnAttr = logRecord.attributes.find((a: any) => a.key === "merchantmcp.transaction_id");
    expect(txnAttr).toEqual({ key: "merchantmcp.transaction_id", value: { stringValue: "txn_wire_1" } });
  });

  it("should extract merchantmcp.amount, merchantmcp.currency, and merchantmcp.reasoning", () => {
    const exporter = new AuditExporter({ serviceName: "test-mcp" });

    const mockEvent = {
      event_id: "evt_amount_1",
      event_type: AuditEventType.CHECKOUT_CREATED,
      timestamp: "2026-08-31T12:00:00.000Z",
      transaction_id: "txn_amt_1",
      actor: { type: "merchant" as const, component: "checkout_engine" },
      request: {
        params: {
          reasoning: "Buying laptop for office deployment",
        },
      },
      response: {
        checkout_id: "chk_123",
        total: { amount: 68999, currency: "INR" },
      },
      integrity: { previous_event_hash: "GENESIS", event_hash: "hash_amt_1" },
    };

    const record = exporter.formatLogRecord(mockEvent as any);
    expect(record.attributes["merchantmcp.amount"]).toBe(68999);
    expect(record.attributes["merchantmcp.currency"]).toBe("INR");
    expect(record.attributes["merchantmcp.reasoning"]).toBe("Buying laptop for office deployment");

    // Wire format verification
    const payload = exporter.formatOtlpPayload([record]) as any;
    const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
    const amountAttr = logRecord.attributes.find((a: any) => a.key === "merchantmcp.amount");
    const currencyAttr = logRecord.attributes.find((a: any) => a.key === "merchantmcp.currency");
    const reasoningAttr = logRecord.attributes.find((a: any) => a.key === "merchantmcp.reasoning");

    expect(amountAttr).toEqual({ key: "merchantmcp.amount", value: { intValue: "68999" } });
    expect(currencyAttr).toEqual({ key: "merchantmcp.currency", value: { stringValue: "INR" } });
    expect(reasoningAttr).toEqual({ key: "merchantmcp.reasoning", value: { stringValue: "Buying laptop for office deployment" } });
  });

  it("should propagate transaction amount, currency, and reasoning across all lifecycle events (STATE_TRANSITION, CONSENT_GRANTED)", async () => {
    const exportedRecords: OTelLogRecord[] = [];
    const exporter = new AuditExporter({
      batchSize: 10,
      customTransport: (logs) => {
        exportedRecords.push(...logs);
      },
    });

    const ledger = new AuditLedger();
    exporter.attach(ledger);

    const txnId = "txn_lifecycle_full";

    // 1. Tool invoked with selection_reason
    ledger.append({
      event_type: AuditEventType.MCP_TOOL_INVOKED,
      timestamp: "2026-09-03T19:41:29.901Z",
      transaction_id: txnId,
      actor: { type: "buyer_agent", component: "prepare_purchase" },
      request: {
        tool: "prepare_purchase",
        params: {
          product_id: "prod_iphone_13",
          selection_reason: "User requested best price iPhone 13 within budget",
        },
      },
    });

    // 2. Product resolved
    ledger.append({
      event_type: AuditEventType.PRODUCT_RESOLVED,
      timestamp: "2026-09-03T19:41:29.912Z",
      transaction_id: txnId,
      actor: { type: "merchant", component: "catalog_resolver" },
      response: {
        offer_id: "prod_iphone_13",
        price: { amount: 59999, currency: "INR" },
      },
    });

    // 3. State transition
    ledger.append({
      event_type: AuditEventType.STATE_TRANSITION,
      timestamp: "2026-09-03T19:41:31.076Z",
      transaction_id: txnId,
      actor: { type: "mcp", component: "transaction_state_machine" },
      state_transition: {
        from: "CREATED" as any,
        to: "CHECKOUT_CREATED" as any,
        trigger: "checkout_initialized",
      },
    });

    // 4. Checkout created
    ledger.append({
      event_type: AuditEventType.CHECKOUT_CREATED,
      timestamp: "2026-09-03T19:41:31.077Z",
      transaction_id: txnId,
      actor: { type: "merchant", component: "checkout_engine" },
      response: {
        checkout_id: "chk_987",
        total: { amount: 68999, currency: "INR" },
      },
    });

    // 5. Consent challenged
    ledger.append({
      event_type: AuditEventType.CONSENT_CHALLENGED,
      timestamp: "2026-09-03T19:41:31.079Z",
      transaction_id: txnId,
      actor: { type: "mcp", component: "authorization_broker" },
      response: {
        challenge_id: "chn_123",
        amount: 68999,
        currency: "INR",
      },
    });

    // 6. Consent granted (bare event without amount payload)
    ledger.append({
      event_type: AuditEventType.CONSENT_GRANTED,
      timestamp: "2026-09-03T19:42:57.112Z",
      transaction_id: txnId,
      actor: { type: "system", component: "user_consent_surface" },
      response: {
        challenge_id: "chn_123",
        derived_mandate_id: "man_456",
      },
    });

    await exporter.flush();

    expect(exportedRecords.length).toBe(6);

    // All events on txnId should carry reasoning
    for (const rec of exportedRecords) {
      expect(rec.attributes["merchantmcp.reasoning"]).toBe(
        "User requested best price iPhone 13 within budget"
      );
    }

    // Check that CONSENT_GRANTED (which had no inline amount) received amount and currency from transaction context
    const consentGrantedRec = exportedRecords.find(
      (r) => r.body.event_type === AuditEventType.CONSENT_GRANTED
    );
    expect(consentGrantedRec).toBeDefined();
    expect(consentGrantedRec!.attributes["merchantmcp.amount"]).toBe(68999);
    expect(consentGrantedRec!.attributes["merchantmcp.currency"]).toBe("INR");

    // Check that STATE_TRANSITION also inherited amount, currency, and reasoning
    const stateTransitionRec = exportedRecords.find(
      (r) => r.body.event_type === AuditEventType.STATE_TRANSITION
    );
    expect(stateTransitionRec).toBeDefined();
    expect(stateTransitionRec!.attributes["merchantmcp.amount"]).toBe(59999);
    expect(stateTransitionRec!.attributes["merchantmcp.currency"]).toBe("INR");

    exporter.stop();
  });
});

