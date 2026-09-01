import { describe, it, expect, vi } from "vitest";
import {
  deriveCapabilityMatrix,
  classifyIntegrationLevel,
  CapabilityMatrix,
} from "../../src/connector/capabilities.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { createMerchantMcpServer } from "../../src/server.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDiscoveryTools } from "../../src/tools/discovery.js";
import { AuditLedger } from "../../src/audit/ledger.js";

describe("Capability Negotiation Subsystem", () => {
  const baseManifest: IntegrationManifest = {
    merchant: {
      name: "AcmeStore",
      description: "Test Store",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "http://localhost:5000",
    },
    operations: {
      search: { method: "POST", path: "/search" },
      get_product: { method: "GET", path: "/products/:product_id" },
      create_checkout: { method: "POST", path: "/checkout" },
      get_checkout: { method: "GET", path: "/checkout/:checkout_id" },
      confirm_order: { method: "POST", path: "/orders" },
      get_order_status: { method: "GET", path: "/orders/:order_id" },
      cancel_order: { method: "POST", path: "/orders/:order_id/cancel" },
    },
    refinements: {
      mode: "search_response",
      option_pagination: {
        max_options_in_search: 20,
      },
    },
    field_mappings: {
      offer: {
        offer_id: { from: "$.id" },
        title: { from: "$.name" },
        description: { from: "$.desc" },
        "price.amount": { from: "$.price" },
        "price.currency": { from: null, transform: { type: "default", value: "INR" } },
        availability: { from: null, transform: { type: "default", value: "in_stock" } },
      },
      checkout: {
        checkout_id: { from: "$.cart_id" },
        sku: { from: "$.item_sku" },
        "total.amount": { from: "$.total" },
        "total.currency": { from: null, transform: { type: "default", value: "INR" } },
        available: { from: null, transform: { type: "default", value: true } },
      },
      order: {
        order_id: { from: "$.order_number" },
        status: { from: "$.status" },
      },
    },
    payment: {
      provider: "razorpay",
      razorpay_key_id_env: "RAZORPAY_KEY_ID",
      razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
    },
  };

  describe("deriveCapabilityMatrix", () => {
    it("should derive full capability matrix for complete manifest with cancel_order", () => {
      const matrix = deriveCapabilityMatrix(baseManifest);

      expect(matrix.discovery.supported).toBe(true);
      expect(matrix.discovery.provided_by).toEqual(["search", "get_product"]);

      expect(matrix.transaction.supported).toBe(true);
      expect(matrix.transaction.provided_by).toEqual(["create_checkout", "confirm_order"]);

      expect(matrix.order_status.supported).toBe(true);
      expect(matrix.order_status.provided_by).toEqual(["get_order_status"]);

      expect(matrix.cancellation.supported).toBe(true);
      expect(matrix.cancellation.provided_by).toEqual(["cancel_order"]);
      expect(matrix.cancellation.note).toBeUndefined();

      expect(matrix.refunds.supported).toBe(true);
      expect(matrix.refunds.provided_by).toEqual(["razorpay"]);

      expect(matrix.dynamic_refinements.supported).toBe(true);
      expect(matrix.dynamic_refinements.provided_by).toEqual(["search_response"]);

      expect(matrix.refinement_options.supported).toBe(true);
      expect(matrix.refinement_options.provided_by).toEqual(["mcp_cache"]);
    });

    it("should report cancellation as unsupported when cancel_order is absent", () => {
      const { cancel_order, ...opsWithoutCancel } = baseManifest.operations;
      const manifestWithoutCancel: IntegrationManifest = {
        ...baseManifest,
        operations: opsWithoutCancel as typeof baseManifest.operations,
      };

      const matrix = deriveCapabilityMatrix(manifestWithoutCancel);
      expect(matrix.cancellation.supported).toBe(false);
      expect(matrix.cancellation.provided_by).toEqual([]);
      expect(matrix.cancellation.note).toContain("cancel_transaction will only reverse MCP-side state");
    });

    it("should report refinement_options provided_by as merchant_endpoint when option_query_support is configured", () => {
      const manifestWithQuerySupport: IntegrationManifest = {
        ...baseManifest,
        refinements: {
          mode: "separate_endpoint",
          option_pagination: {
            option_query_support: {
              query_param: "q",
            },
          },
        },
      };

      const matrix = deriveCapabilityMatrix(manifestWithQuerySupport);
      expect(matrix.refinement_options.supported).toBe(true);
      expect(matrix.refinement_options.provided_by).toEqual(["merchant_endpoint"]);
    });
  });

  describe("classifyIntegrationLevel", () => {
    it("should classify complete manifest with cancellation as fully_manageable", () => {
      const matrix = deriveCapabilityMatrix(baseManifest);
      const level = classifyIntegrationLevel(matrix);
      expect(level).toBe("fully_manageable");
    });

    it("should classify manifest without cancel_order as transactable", () => {
      const { cancel_order, ...opsWithoutCancel } = baseManifest.operations;
      const manifestWithoutCancel: IntegrationManifest = {
        ...baseManifest,
        operations: opsWithoutCancel as typeof baseManifest.operations,
      };

      const matrix = deriveCapabilityMatrix(manifestWithoutCancel);
      const level = classifyIntegrationLevel(matrix);
      expect(level).toBe("transactable");
    });

    it("should classify manifest missing create_checkout as discoverable", () => {
      const { create_checkout, ...opsWithoutCheckout } = baseManifest.operations;
      const manifestWithoutCheckout: IntegrationManifest = {
        ...baseManifest,
        operations: opsWithoutCheckout as unknown as typeof baseManifest.operations,
      };

      const matrix = deriveCapabilityMatrix(manifestWithoutCheckout);
      const level = classifyIntegrationLevel(matrix);
      expect(level).toBe("discoverable");
    });

    it("should classify manifest missing search or get_product as incompatible", () => {
      const { search, ...opsWithoutSearch } = baseManifest.operations;
      const manifestWithoutSearch: IntegrationManifest = {
        ...baseManifest,
        operations: opsWithoutSearch as unknown as typeof baseManifest.operations,
      };

      const matrix = deriveCapabilityMatrix(manifestWithoutSearch);
      const level = classifyIntegrationLevel(matrix);
      expect(level).toBe("incompatible");
    });
  });

  describe("Server Startup Fail-Fast Validation", () => {
    it("should start cleanly for transactable or fully_manageable manifests", () => {
      expect(() => createMerchantMcpServer(baseManifest, undefined, true)).not.toThrow();
    });

    it("should throw a descriptive error when manifest is discoverable (missing confirm_order)", () => {
      const { confirm_order, ...partialOps } = baseManifest.operations;
      const discoverableManifest: IntegrationManifest = {
        ...baseManifest,
        operations: partialOps as unknown as typeof baseManifest.operations,
      };

      expect(() => createMerchantMcpServer(discoverableManifest, undefined, true)).toThrowError(
        /Integration manifest is only "discoverable"/
      );
    });

    it("should throw a descriptive error when manifest is incompatible (missing get_product)", () => {
      const { get_product, ...incompatibleOps } = baseManifest.operations;
      const incompatibleManifest: IntegrationManifest = {
        ...baseManifest,
        operations: incompatibleOps as unknown as typeof baseManifest.operations,
      };

      expect(() => createMerchantMcpServer(incompatibleManifest, undefined, true)).toThrowError(
        /Integration manifest is only "incompatible"/
      );
    });
  });

  describe("get_merchant_info tool with derived capabilities", () => {
    it("should return truthful capabilities and integration level", async () => {
      const server = new McpServer({ name: "TestMCP", version: "1.0.0" });
      const connector = new ConnectorRuntime(baseManifest);
      const auditLedger = new AuditLedger();

      registerDiscoveryTools(server, connector, baseManifest, auditLedger);

      const handler = (
        server as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: unknown) => Promise<{ content: [{ text: string }] }> }
          >;
        }
      )._registeredTools["get_merchant_info"].handler;

      const res = await handler({});
      const info = JSON.parse(res.content[0].text);

      expect(info.name).toBe("AcmeStore");
      expect(info.integration_level).toBe("fully_manageable");
      expect(info.capabilities.search).toBe(true);
      expect(info.capabilities.product_lookup).toBe(true);
      expect(info.capabilities.checkout).toBe(true);
      expect(info.capabilities.order_status).toBe(true);
      expect(info.capabilities.refund).toBe(true);
      expect(info.capabilities.cancel).toBe(true);
      expect(info.capabilities.dynamic_refinements).toBe(true);
      expect(info.capabilities.refinement_options).toBe(true);
    });
  });

  describe("ConnectorRuntime.cancelOrder", () => {
    it("should throw when cancel_order is not configured in manifest", async () => {
      const { cancel_order, ...opsWithoutCancel } = baseManifest.operations;
      const runtimeWithoutCancel = new ConnectorRuntime({
        ...baseManifest,
        operations: opsWithoutCancel as typeof baseManifest.operations,
      });

      await expect(runtimeWithoutCancel.cancelOrder("ORD-123")).rejects.toThrow(
        "Merchant does not expose a cancel_order operation (see capability matrix)"
      );
    });

    it("should execute cancel_order operation when declared", async () => {
      const runtime = new ConnectorRuntime(baseManifest);
      const executeSpy = vi
        .spyOn(runtime as unknown as { executeOperation: (op: string, params: unknown) => Promise<unknown> }, "executeOperation")
        .mockResolvedValue({
          order_number: "ORD-999",
          status: "CANCELLED",
        });

      const result = await runtime.cancelOrder("ORD-999", "user_change_of_mind");

      expect(executeSpy).toHaveBeenCalledWith("cancel_order", {
        order_id: "ORD-999",
        reason: "user_change_of_mind",
      });
      expect(result.order_id).toBe("ORD-999");
      expect(result.status).toBe("CANCELLED");
    });
  });
});
