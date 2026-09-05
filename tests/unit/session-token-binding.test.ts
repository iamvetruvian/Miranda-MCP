import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionStore } from "../../src/auth/session-store.js";
import { MandateStore } from "../../src/authz/mandate-store.js";
import { RecurringTokenStore } from "../../src/payment/token-store.js";
import { SqliteStore } from "../../src/persistence/sqlite.js";
import { registerAuthTools } from "../../src/tools/auth.js";
import { registerTransactionTools } from "../../src/tools/transaction.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { PolicyEngine } from "../../src/policy/engine.js";
import { StripeAdapter } from "../../src/payment/stripe.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import fs from "fs";
import path from "path";

function createMockServer() {
  const tools = new Map<string, { description: string; schema: any; handler: Function }>();
  const server = {
    tool: (name: string, description: string, schema: any, handler: Function) => {
      tools.set(name, { description, schema, handler });
    },
  } as unknown as McpServer;

  return { server, tools };
}

describe("Session-Bound Card Token Persistence & Advertising", () => {
  const TEST_DB = path.join(process.cwd(), "data", "test_session_binding.db");
  let sqliteStore: SqliteStore;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
    sqliteStore = new SqliteStore(TEST_DB);
  });

  afterEach(async () => {
    await sqliteStore.close();
    if (fs.existsSync(TEST_DB)) {
      try { fs.unlinkSync(TEST_DB); } catch {}
    }
  });

  it("attaches recurring_token to UserSession and persists across database reloads", async () => {
    const sessionStore1 = new SessionStore(sqliteStore);
    const session = sessionStore1.createPendingSession("mock_state");
    sessionStore1.completeSession(session.session_id, {
      access_token: "mock_at_123",
      expires_in: 3600,
    }, {
      user_id: "usr_john",
      user_name: "John Doe",
      user_email: "john@example.com",
    });

    // Vault card and attach token
    sessionStore1.attachRecurringToken(session.session_id, "pm_card_vault_999", "cus_stripe_123");

    const loaded1 = sessionStore1.getSession(session.session_id);
    expect(loaded1?.recurring_token).toBe("pm_card_vault_999");
    expect(loaded1?.customer_id).toBe("cus_stripe_123");
    expect(loaded1?.user_email).toBe("john@example.com");

    // Simulate server restart: new SessionStore reading from SQLite
    const sessionStore2 = new SessionStore(sqliteStore);
    const loaded2 = sessionStore2.getSession(session.session_id);
    expect(loaded2).not.toBeNull();
    expect(loaded2?.recurring_token).toBe("pm_card_vault_999");
    expect(loaded2?.customer_id).toBe("cus_stripe_123");
    expect(loaded2?.user_email).toBe("john@example.com");
  });

  it("persists RecurringTokenStore entries to SqliteStore and hydrates them", async () => {
    const tokenStore1 = new RecurringTokenStore(sqliteStore);
    tokenStore1.save({
      customer_id: "cus_test_555",
      token_id: "pm_card_555",
      method: "card",
      email: "test@example.com",
      created_at: new Date().toISOString(),
    });

    expect(tokenStore1.get("cus_test_555")?.token_id).toBe("pm_card_555");
    expect(tokenStore1.getByEmail("test@example.com")?.token_id).toBe("pm_card_555");

    // Simulate server restart: new RecurringTokenStore hydrating from SQLite
    const tokenStore2 = new RecurringTokenStore(sqliteStore);
    const persisted = sqliteStore.loadRecurringTokensSync();
    tokenStore2.hydrate(persisted);

    expect(tokenStore2.get("cus_test_555")?.token_id).toBe("pm_card_555");
    expect(tokenStore2.getByEmail("test@example.com")?.token_id).toBe("pm_card_555");
  });

  it("advertises has_saved_card: true and payment_mode: autonomous in check_auth_status", async () => {
    const sessionStore = new SessionStore(sqliteStore);
    const tokenStore = new RecurringTokenStore(sqliteStore);
    const session = sessionStore.createPendingSession("mock_state");
    sessionStore.completeSession(session.session_id, {
      access_token: "mock_at_auth_test",
      expires_in: 3600,
    }, {
      user_id: "usr_auth_1",
      user_name: "Alice",
      user_email: "alice@example.com",
    });

    sessionStore.attachRecurringToken(session.session_id, "pm_alice_vault", "cus_alice");

    const manifest: IntegrationManifest = {
      merchant: { name: "TestStore", description: "Store", commerce_domain: "retail", currency: "INR" },
      operations: {},
      field_mappings: {},
    };

    const { server, tools } = createMockServer();
    registerAuthTools(server, sessionStore, null as any, manifest, null, undefined, tokenStore);

    const checkHandler = tools.get("check_auth_status")!.handler;
    const res = await checkHandler({ session_id: session.session_id });
    const data = JSON.parse(res.content[0].text);

    expect(data.authenticated).toBe(true);
    expect(data.has_saved_card).toBe(true);
    expect(data.payment_mode).toBe("autonomous");
    expect(data.instructions_for_agent).toContain("saved payment card is securely vaulted");
  });

  it("prepare_purchase resolves session-bound card token and avoids manual payment links", async () => {
    const sessionStore = new SessionStore(sqliteStore);
    const tokenStore = new RecurringTokenStore(sqliteStore);
    const session = sessionStore.createPendingSession("mock_state");
    sessionStore.completeSession(session.session_id, {
      access_token: "mock_at_checkout_test",
      expires_in: 3600,
    }, {
      user_id: "usr_bob",
      user_name: "Bob",
      user_email: "bob@example.com",
    });

    sessionStore.attachRecurringToken(session.session_id, "pm_bob_vault_token", "cus_bob_123");

    const manifest: IntegrationManifest = {
      merchant: { name: "TestStore", description: "Store", commerce_domain: "retail", currency: "INR" },
      operations: {
        get_product: { method: "GET", path: "/products/:product_id" },
        create_checkout: { method: "POST", path: "/checkout" },
      },
      field_mappings: {
        offer: { offer_id: { from: "$.id" }, title: { from: "$.name" }, "price.amount": { from: "$.price" } },
        checkout: { checkout_id: { from: "$.id" }, "total.amount": { from: "$.total" } },
      },
      payment: {
        provider: "stripe",
      },
    };

    const connector = {
      getManifest: () => manifest,
      getProduct: async () => ({
        offer_id: "prod_1",
        title: "Test Item",
        price: { amount: 5000, currency: "INR" },
        availability: "in_stock",
      }),
      createCheckout: async () => ({
        checkout_id: "chk_1",
        sku: "prod_1",
        total: { amount: 5000, currency: "INR" },
        available: true,
      }),
    } as unknown as ConnectorRuntime;

    const auditLedger = new AuditLedger(undefined, { store: sqliteStore });
    const txnManager = new TransactionManager(auditLedger);
    const policyEngine = new PolicyEngine();
    const paymentAdapter = new StripeAdapter("mock_key", "pk_mock", true);
    const mandateStore = new MandateStore(sqliteStore, undefined, "mandates");

    const { server, tools } = createMockServer();
    registerTransactionTools(
      server,
      connector,
      txnManager,
      policyEngine,
      paymentAdapter,
      auditLedger,
      mandateStore,
      { getSessionStore: () => sessionStore, check: async () => ({ authorized: true }) } as any,
      tokenStore
    );

    const prepareHandler = tools.get("prepare_purchase")!.handler;
    const res = await prepareHandler({
      product_id: "prod_1",
      quantity: 1,
      selection_reason: "Autonomous purchase with vaulted card",
      session_id: session.session_id,
    });

    const data = JSON.parse(res.content[0].text);
    expect(data.error).toBeUndefined();
    expect(data.state).toBe("MANDATE_EVALUATED");
    expect(data.payment.status).toBe("consent_required");
    expect(data.payment.one_time_payment_url).toBeUndefined();
    expect(data.payment.card_vault_setup_url).toBeUndefined();
    expect(data.payment.consent_url).toBeDefined();
  });
});
