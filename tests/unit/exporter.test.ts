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
});
