import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { InMemoryStore } from "../../src/persistence/store.js";
import { SqliteStore } from "../../src/persistence/sqlite.js";
import { createMerchantMcpServer } from "../../src/server.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { TransactionState, AuditEventType, Transaction, AuditEvent } from "../../src/types/index.js";
import { LedgerCheckpoint } from "../../src/audit/ledger.js";

const sampleManifest: IntegrationManifest = {
  merchant: {
    name: "TechBazaar",
    description: "Electronics retailer",
    commerce_domain: "retail",
    currency: "INR",
    base_url: "https://api.techbazaar.local",
  },
  operations: {
    search: { method: "GET", path: "/api/products" },
    get_product: { method: "GET", path: "/api/products/:product_id" },
    create_checkout: { method: "POST", path: "/api/checkout" },
    get_checkout: { method: "GET", path: "/api/checkout/:checkout_id" },
    confirm_order: { method: "POST", path: "/api/orders" },
    get_order_status: { method: "GET", path: "/api/orders/:order_id" },
  },
  field_mappings: {
    offer: {
      offer_id: { from: "$.id" },
      title: { from: "$.name" },
      description: { from: "$.description" },
      price: { from: "$.price" },
      availability: { from: "$.stock", transform: { type: "enum", enum_map: { in_stock: "in_stock" } } },
      attributes: { from: "$.specs" },
    },
    checkout: {
      checkout_id: { from: "$.checkout_id" },
      sku: { from: "$.sku" },
      total: { from: "$.total" },
      available: { from: "$.available" },
    },
    order: {
      order_id: { from: "$.order_id" },
      status: { from: "$.status" },
      confirmed_at: { from: "$.created_at" },
    },
  },
  payment: {
    provider: "razorpay",
    razorpay_key_id_env: "RAZORPAY_KEY_ID",
    razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
  },
};

describe("Persistence Layer Unit Tests", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-persistence-test-"));
    dbPath = path.join(tmpDir, "state.db");
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  describe("InMemoryStore", () => {
    it("should roundtrip transactions, ledger events, checkpoints, tokens, and search states", async () => {
      const store = new InMemoryStore();

      const txn: Transaction = {
        transaction_id: "txn_test_123",
        state: TransactionState.CREATED,
        created_at: new Date().toISOString(),
        agent_claim: {
          product_id: "p1",
          quantity: 1,
          selection_reason: "Test purchase",
        },
        audit_event_ids: ["evt_1"],
      };

      await store.saveTransaction(txn);
      const loadedTxns = await store.loadTransactions();
      expect(loadedTxns).toHaveLength(1);
      expect(loadedTxns[0].transaction_id).toBe("txn_test_123");

      const event: AuditEvent = {
        event_id: "evt_1",
        event_type: AuditEventType.MCP_TOOL_INVOKED,
        timestamp: new Date().toISOString(),
        transaction_id: "txn_test_123",
        actor: { type: "buyer_agent" },
        integrity: {
          previous_event_hash: "GENESIS",
          event_hash: "hash_123",
        },
      };

      await store.appendLedgerEvent(event);
      const loadedEvents = await store.loadLedgerEvents();
      expect(loadedEvents).toHaveLength(1);
      expect(loadedEvents[0].event_id).toBe("evt_1");

      const cp: LedgerCheckpoint = {
        checkpoint_index: 0,
        head_event_id: "evt_1",
        head_hash: "hash_123",
        signed_at: new Date().toISOString(),
        algorithm: "unsigned",
      };

      await store.saveCheckpoint(cp);
      const loadedCps = await store.loadCheckpoints();
      expect(loadedCps).toHaveLength(1);
      expect(loadedCps[0].checkpoint_index).toBe(0);

      const token = {
        token: "gate_123",
        transaction_id: "txn_test_123",
        action: "CREATE_PAYMENT",
        expires_at: Date.now() + 60000,
        consumed: false,
      };

      await store.saveGateToken(token);
      let loadedTokens = await store.loadGateTokens();
      expect(loadedTokens).toHaveLength(1);
      expect(loadedTokens[0].consumed).toBe(false);

      await store.consumeGateToken("gate_123");
      loadedTokens = await store.loadGateTokens();
      expect(loadedTokens[0].consumed).toBe(true);

      const searchState = {
        query: "laptop",
        filters: { brand: "Dell" },
        page: 1,
        createdAt: new Date().toISOString(),
        refinements: [],
      };

      await store.saveSearchState("srch_123", searchState);
      let loadedStates = await store.loadSearchStates();
      expect(loadedStates).toHaveLength(1);
      expect(loadedStates[0][0]).toBe("srch_123");

      await store.deleteSearchState("srch_123");
      loadedStates = await store.loadSearchStates();
      expect(loadedStates).toHaveLength(0);

      await store.close();
    });
  });

  describe("SqliteStore", () => {
    it("should persist and reload all entities across separate store instances", async () => {
      const store1 = new SqliteStore(dbPath);

      const txn: Transaction = {
        transaction_id: "txn_sqlite_1",
        state: TransactionState.CHECKOUT_CREATED,
        created_at: new Date().toISOString(),
        agent_claim: {
          product_id: "prod_456",
          quantity: 2,
          selection_reason: "High rating",
        },
        merchant_verified: {
          checkout_id: "chk_456",
          sku: "prod_456",
          unit_price: { amount: 150000, currency: "INR" },
          total: { amount: 300000, currency: "INR" },
          available: true,
        },
        audit_event_ids: ["evt_101", "evt_102"],
      };

      await store1.saveTransaction(txn);

      const evt1: AuditEvent = {
        event_id: "evt_101",
        event_type: AuditEventType.MCP_TOOL_INVOKED,
        timestamp: new Date().toISOString(),
        transaction_id: "txn_sqlite_1",
        actor: { type: "buyer_agent" },
        integrity: { previous_event_hash: "GENESIS", event_hash: "hash_101" },
      };

      const evt2: AuditEvent = {
        event_id: "evt_102",
        event_type: AuditEventType.CHECKOUT_CREATED,
        timestamp: new Date().toISOString(),
        transaction_id: "txn_sqlite_1",
        actor: { type: "mcp" },
        integrity: { previous_event_hash: "hash_101", event_hash: "hash_102" },
      };

      await store1.appendLedgerEvent(evt1);
      await store1.appendLedgerEvent(evt2);

      const checkpoint: LedgerCheckpoint = {
        checkpoint_index: 0,
        head_event_id: "evt_102",
        head_hash: "hash_102",
        signed_at: new Date().toISOString(),
        algorithm: "unsigned",
      };
      await store1.saveCheckpoint(checkpoint);

      await store1.saveGateToken({
        token: "gate_sqlite_1",
        transaction_id: "txn_sqlite_1",
        action: "CREATE_PAYMENT",
        expires_at: Date.now() + 300000,
        consumed: false,
      });

      await store1.saveSearchState("srch_sqlite_1", {
        query: "smartphones",
        filters: { ram: "8GB" },
        page: 1,
        createdAt: new Date().toISOString(),
        refinements: [],
      });

      await store1.saveMandate({
        mandate_id: "man_1",
        kind: "intent",
        constraints: { max_amount: 50000 },
      });

      await store1.close();

      // Open store2 from the same SQLite file
      const store2 = new SqliteStore(dbPath);

      const reloadedTxns = await store2.loadTransactions();
      expect(reloadedTxns).toHaveLength(1);
      expect(reloadedTxns[0].transaction_id).toBe("txn_sqlite_1");
      expect(reloadedTxns[0].merchant_verified?.total.amount).toBe(300000);

      const reloadedEvents = await store2.loadLedgerEvents();
      expect(reloadedEvents).toHaveLength(2);
      expect(reloadedEvents[0].event_id).toBe("evt_101");
      expect(reloadedEvents[1].event_id).toBe("evt_102");

      const reloadedCps = await store2.loadCheckpoints();
      expect(reloadedCps).toHaveLength(1);
      expect(reloadedCps[0].head_hash).toBe("hash_102");

      const reloadedTokens = await store2.loadGateTokens();
      expect(reloadedTokens).toHaveLength(1);
      expect(reloadedTokens[0].token).toBe("gate_sqlite_1");

      await store2.consumeGateToken("gate_sqlite_1");
      const updatedTokens = await store2.loadGateTokens();
      expect(updatedTokens[0].consumed).toBe(true);

      const reloadedStates = await store2.loadSearchStates();
      expect(reloadedStates).toHaveLength(1);
      expect(reloadedStates[0][0]).toBe("srch_sqlite_1");

      const reloadedMandates = await store2.loadMandates();
      expect(reloadedMandates).toHaveLength(1);
      expect(reloadedMandates[0].mandate_id).toBe("man_1");

      await store2.close();
    });
  });

  describe("Boot Verification & Tamper Detection", () => {
    it("should boot cleanly and hydrate server state from persisted SQLite db", () => {
      // Step 1: Create a server, perform actions that persist state
      const server1 = createMerchantMcpServer(sampleManifest, {
        dbPath,
        forceSimulation: true,
      });

      const txn = server1.txnManager.create({
        product_id: "laptop_1",
        quantity: 1,
        selection_reason: "Best price",
      });
      server1.txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "checkout");
      server1.txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_PENDING, "payment");

      // Verify server1 has state
      expect(server1.txnManager.has(txn.transaction_id)).toBe(true);
      expect(server1.auditLedger.getAllEvents().length).toBeGreaterThan(0);

      // Step 2: Boot a second server instance pointing to the same DB file
      const server2 = createMerchantMcpServer(sampleManifest, {
        dbPath,
        forceSimulation: true,
      });

      // Verify server2 successfully hydrated state
      expect(server2.txnManager.has(txn.transaction_id)).toBe(true);
      const reloadedTxn = server2.txnManager.get(txn.transaction_id);
      expect(reloadedTxn.state).toBe(TransactionState.PAYMENT_PENDING);
      expect(server2.auditLedger.getAllEvents().length).toBeGreaterThan(0);
      expect(server2.auditLedger.verifyChain(txn.transaction_id).valid).toBe(true);
    });

    it("should refuse to boot if audit events in SQLite were tampered with", () => {
      // Step 1: Create a server and write valid state
      const server1 = createMerchantMcpServer(sampleManifest, {
        dbPath,
        forceSimulation: true,
      });

      const txn = server1.txnManager.create({
        product_id: "laptop_1",
        quantity: 1,
        selection_reason: "Audit test",
      });
      server1.txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "checkout");
      server1.txnManager.transition(txn.transaction_id, TransactionState.PAYMENT_PENDING, "payment");

      // Step 2: Directly tamper with the SQLite audit_events table
      const store = new SqliteStore(dbPath);
      // Alter the payload of an event in the DB without updating hash
      const events = store.loadLedgerEventsSync();
      expect(events.length).toBeGreaterThan(0);

      // Modify the timestamp or payload inside the JSON
      const tamperedEvent = { ...events[0], timestamp: "1999-01-01T00:00:00.000Z" };
      // Force rewrite in SQLite
      const db = (store as any).db;
      db.prepare("UPDATE audit_events SET data = ? WHERE event_id = ?;").run(
        JSON.stringify(tamperedEvent),
        tamperedEvent.event_id
      );
      store.close();

      // Step 3: Boot server2 — must throw error refusing to start
      expect(() => {
        createMerchantMcpServer(sampleManifest, {
          dbPath,
          forceSimulation: true,
        });
      }).toThrow(/Audit ledger failed integrity verification at boot; refusing to start/);
    });

    it("should refuse to boot if checkpoint signature was tampered with", () => {
      const signingSecret = "super_secret_audit_key_123";

      process.env.LEDGER_SIGNING_SECRET = signingSecret;
      process.env.LEDGER_CHECKPOINT_INTERVAL = "1"; // Checkpoint on every event

      const server1 = createMerchantMcpServer(sampleManifest, {
        dbPath,
        forceSimulation: true,
      });

      const txn = server1.txnManager.create({
        product_id: "laptop_1",
        quantity: 1,
        selection_reason: "Checkpoint test",
      });
      server1.txnManager.transition(txn.transaction_id, TransactionState.CHECKOUT_CREATED, "checkout");

      // Tamper with the checkpoint in SQLite
      const store = new SqliteStore(dbPath);
      const db = (store as any).db;
      const cps = store.loadCheckpointsSync();
      expect(cps.length).toBeGreaterThan(0);

      // Invalidate the signature
      const tamperedCp = { ...cps[0], signature: "tampered_fake_signature" };
      db.prepare("UPDATE checkpoints SET data = ?, head_hash = ? WHERE checkpoint_index = ?;").run(
        JSON.stringify(tamperedCp),
        tamperedCp.head_hash,
        tamperedCp.checkpoint_index
      );
      store.close();

      // Boot server2 with the same secret — must fail verification
      expect(() => {
        createMerchantMcpServer(sampleManifest, {
          dbPath,
          forceSimulation: true,
        });
      }).toThrow(/Audit ledger failed integrity verification at boot; refusing to start/);

      delete process.env.LEDGER_SIGNING_SECRET;
      delete process.env.LEDGER_CHECKPOINT_INTERVAL;
    });
  });
});
