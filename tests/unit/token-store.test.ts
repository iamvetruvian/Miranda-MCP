import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { RecurringTokenStore, RecurringToken } from "../../src/payment/token-store.js";
import { InMemoryStore } from "../../src/persistence/store.js";
import { SqliteStore } from "../../src/persistence/sqlite.js";

describe("RecurringTokenStore & Persistence Tests", () => {
  describe("RecurringTokenStore in-memory operations", () => {
    let tokenStore: RecurringTokenStore;

    beforeEach(() => {
      tokenStore = new RecurringTokenStore();
    });

    it("should save and retrieve a token by customer_id", () => {
      const token: RecurringToken = {
        customer_id: "cust_123456",
        token_id: "token_abcxyz",
        method: "upi",
        max_amount: 500000,
        email: "buyer@example.com",
        contact: "+919876543210",
        created_at: new Date().toISOString(),
      };

      tokenStore.save(token);

      expect(tokenStore.has("cust_123456")).toBe(true);
      expect(tokenStore.has("cust_nonexistent")).toBe(false);

      const retrieved = tokenStore.get("cust_123456");
      expect(retrieved).toBeDefined();
      expect(retrieved?.token_id).toBe("token_abcxyz");
      expect(retrieved?.method).toBe("upi");
      expect(retrieved?.max_amount).toBe(500000);
      expect(retrieved?.email).toBe("buyer@example.com");
    });

    it("should retrieve a token by token_id", () => {
      const token: RecurringToken = {
        customer_id: "cust_654321",
        token_id: "token_target_999",
        method: "card",
        created_at: new Date().toISOString(),
      };

      tokenStore.save(token);

      const found = tokenStore.getByTokenId("token_target_999");
      expect(found).toBeDefined();
      expect(found?.customer_id).toBe("cust_654321");

      expect(tokenStore.getByTokenId("token_unknown")).toBeUndefined();
    });

    it("should delete a token by customer_id", () => {
      const token: RecurringToken = {
        customer_id: "cust_to_delete",
        token_id: "token_delete_me",
        method: "upi",
        created_at: new Date().toISOString(),
      };

      tokenStore.save(token);
      expect(tokenStore.has("cust_to_delete")).toBe(true);

      const deleted = tokenStore.delete("cust_to_delete");
      expect(deleted).toBe(true);
      expect(tokenStore.has("cust_to_delete")).toBe(false);
      expect(tokenStore.get("cust_to_delete")).toBeUndefined();
    });

    it("should list all tokens and support clear", () => {
      tokenStore.save({
        customer_id: "cust_1",
        token_id: "tok_1",
        method: "upi",
        created_at: new Date().toISOString(),
      });
      tokenStore.save({
        customer_id: "cust_2",
        token_id: "tok_2",
        method: "card",
        created_at: new Date().toISOString(),
      });

      const list = tokenStore.listAll();
      expect(list).toHaveLength(2);

      tokenStore.clear();
      expect(tokenStore.listAll()).toHaveLength(0);
    });

    it("should hydrate from snapshot", () => {
      const tokens: RecurringToken[] = [
        {
          customer_id: "cust_hydrated_1",
          token_id: "tok_h1",
          method: "upi",
          created_at: new Date().toISOString(),
        },
        {
          customer_id: "cust_hydrated_2",
          token_id: "tok_h2",
          method: "card",
          created_at: new Date().toISOString(),
        },
      ];

      tokenStore.hydrate(tokens);
      expect(tokenStore.has("cust_hydrated_1")).toBe(true);
      expect(tokenStore.has("cust_hydrated_2")).toBe(true);
      expect(tokenStore.listAll()).toHaveLength(2);
    });
  });

  describe("InMemoryStore RecurringToken Persistence", () => {
    it("should save, load and delete tokens in InMemoryStore", async () => {
      const store = new InMemoryStore();
      const token: RecurringToken = {
        customer_id: "cust_in_mem",
        token_id: "tok_in_mem",
        method: "upi",
        created_at: new Date().toISOString(),
      };

      await store.saveRecurringToken(token);

      const loaded = await store.loadRecurringTokens();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].customer_id).toBe("cust_in_mem");
      expect(loaded[0].token_id).toBe("tok_in_mem");

      const syncLoaded = store.loadRecurringTokensSync();
      expect(syncLoaded).toHaveLength(1);

      await store.deleteRecurringToken("cust_in_mem");
      const afterDelete = await store.loadRecurringTokens();
      expect(afterDelete).toHaveLength(0);
    });
  });

  describe("SqliteStore RecurringToken Persistence", () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-token-test-"));
      dbPath = path.join(tmpDir, "store.db");
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should persist tokens across SqliteStore instances", async () => {
      const store1 = new SqliteStore(dbPath);
      const token1: RecurringToken = {
        customer_id: "cust_sqlite_1",
        token_id: "tok_sqlite_1",
        method: "upi",
        max_amount: 1000000,
        email: "user1@example.com",
        contact: "9988776655",
        created_at: new Date().toISOString(),
      };
      const token2: RecurringToken = {
        customer_id: "cust_sqlite_2",
        token_id: "tok_sqlite_2",
        method: "card",
        created_at: new Date().toISOString(),
      };

      await store1.saveRecurringToken(token1);
      await store1.saveRecurringToken(token2);
      await store1.close();

      // Open new instance on same SQLite DB
      const store2 = new SqliteStore(dbPath);
      const loaded = await store2.loadRecurringTokens();
      expect(loaded).toHaveLength(2);

      const found1 = loaded.find((t) => t.customer_id === "cust_sqlite_1");
      expect(found1).toBeDefined();
      expect(found1?.token_id).toBe("tok_sqlite_1");
      expect(found1?.max_amount).toBe(1000000);
      expect(found1?.email).toBe("user1@example.com");

      const syncLoaded = store2.loadRecurringTokensSync();
      expect(syncLoaded).toHaveLength(2);

      // Test update on conflict
      const updatedToken1: RecurringToken = {
        ...token1,
        token_id: "tok_sqlite_1_updated",
        last_used_at: new Date().toISOString(),
      };
      await store2.saveRecurringToken(updatedToken1);

      const reloaded = await store2.loadRecurringTokens();
      expect(reloaded).toHaveLength(2);
      const foundUpdated = reloaded.find((t) => t.customer_id === "cust_sqlite_1");
      expect(foundUpdated?.token_id).toBe("tok_sqlite_1_updated");
      expect(foundUpdated?.last_used_at).toBeDefined();

      // Test delete
      await store2.deleteRecurringToken("cust_sqlite_2");
      const afterDelete = await store2.loadRecurringTokens();
      expect(afterDelete).toHaveLength(1);
      expect(afterDelete[0].customer_id).toBe("cust_sqlite_1");

      await store2.close();
    });
  });
});
