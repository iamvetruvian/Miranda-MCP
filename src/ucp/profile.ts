/**
 * UCP Capability Profile Projection (/.well-known/ucp)
 * Pure transformation from MerchantMCP's CapabilityMatrix and IntegrationManifest
 * into the Universal Commerce Protocol (UCP) capability profile format.
 */

import { CapabilityMatrix, classifyIntegrationLevel, IntegrationLevel } from "../connector/capabilities.js";
import { IntegrationManifest } from "../types/manifest.js";

export interface UcpCapabilityEntry {
  capability: string;
  status: "supported" | "unsupported";
  transports?: string[];
  note?: string;
}

export interface UcpProfileResponse {
  ucp_version: string;
  profile: {
    merchant: {
      name: string;
      commerce_domain: string;
    };
    capabilities: UcpCapabilityEntry[];
    integration_level: IntegrationLevel;
    extensions: Record<string, string>;
  };
}

/**
 * Builds standard UCP capability profile for a merchant integration.
 */
export function buildUcpProfile(
  matrix: CapabilityMatrix,
  manifest: IntegrationManifest,
  customExtensions?: Record<string, string>
): UcpProfileResponse {
  const level = classifyIntegrationLevel(matrix);

  const capabilities: UcpCapabilityEntry[] = [
    {
      capability: "com.merchantmcp.discovery",
      status: matrix.discovery.supported ? "supported" : "unsupported",
      transports: ["mcp"],
    },
    {
      capability: "shopping.checkout",
      status: matrix.transaction.supported ? "supported" : "unsupported",
      transports: ["mcp"],
    },
    {
      capability: "shopping.order",
      status: matrix.order_status.supported ? "supported" : "unsupported",
      transports: ["mcp"],
    },
    {
      capability: "shopping.catalog",
      status: matrix.discovery.supported ? "supported" : "unsupported",
      note: (manifest as any).discovery_schema
        ? "domain discovery via discovery_schema"
        : "retail-style catalog",
    },
    {
      capability: "shopping.order.cancel",
      status: matrix.cancellation.supported ? "supported" : "unsupported",
    },
    {
      capability: "payment.refunds",
      status: matrix.refunds.supported ? "supported" : "unsupported",
      transports: ["mcp", "razorpay"],
    },
  ];

  const extensions: Record<string, string> = {
    refinements: "com.merchantmcp.refinements.v1",
    mandates: "com.merchantmcp.mandates.v1",
    ...customExtensions,
  };

  return {
    ucp_version: "2026-01-11",
    profile: {
      merchant: {
        name: manifest.merchant.name,
        commerce_domain: manifest.merchant.commerce_domain,
      },
      capabilities,
      integration_level: level,
      extensions,
    },
  };
}
