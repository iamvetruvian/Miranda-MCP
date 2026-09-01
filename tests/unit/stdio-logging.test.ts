import { describe, it, expect, vi } from "vitest";
import { startWebhookServer } from "../../src/payment/webhook.js";
import { TransactionManager } from "../../src/transaction/manager.js";
import { AuditLedger } from "../../src/audit/ledger.js";
import { InMemoryStore } from "../../src/persistence/store.js";

describe("Stdio stdout pollution prevention", () => {
  it("startWebhookServer logs startup diagnostic info to stderr, not stdout", async () => {
    const store = new InMemoryStore();
    const ledger = new AuditLedger(undefined, { store });
    const txnManager = new TransactionManager(ledger, store);

    const stdoutSpy = vi.spyOn(process.stdout, "write");
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const server = startWebhookServer(txnManager, ledger, 0);

    try {
      // Wait for listen callback
      await new Promise((r) => setTimeout(r, 50));

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("[MerchantMCP-Webhook] Razorpay webhook server listening on port")
      );
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });
});
