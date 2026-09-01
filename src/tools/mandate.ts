/**
 * MCP Mandate Tools (AP2-Style Authorization)
 * Exposes Intent Mandate creation to AI buyer agents and host surfaces.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MandateStore } from "../authz/mandate-store.js";
import { IntentMandate } from "../authz/types.js";
import { AuditLedger } from "../audit/ledger.js";
import { toolInvokedEvent, toolCompletedEvent, toolFailedEvent, mandateCreatedEvent } from "../audit/events.js";

export function registerMandateTools(
  server: McpServer,
  mandateStore: MandateStore,
  auditLedger: AuditLedger
): void {
  server.tool(
    "create_mandate",
    "Create an AP2 Intent Mandate that authorizes a class of purchases within explicit bounds (maximum amount, currency, domain, expiration). Returns an authorization reference to supply to prepare_purchase.",
    {
      user_ref: z.string().describe("Opaque user reference identifier (e.g. user_session_123)"),
      max_amount: z.number().int().positive().describe("Maximum allowed checkout total in currency sub-units (paise / cents), e.g. 8000000 for ₹80,000"),
      currency: z.string().default("INR").describe("Currency code, e.g. 'INR'"),
      allowed_domains: z.array(z.string()).optional().describe("Optional list of allowed commerce domains, e.g. ['retail', 'ticketing']"),
      requires_refundability: z.boolean().optional().default(false).describe("Whether the purchase must be refundable"),
      expires_in_seconds: z.number().int().positive().default(3600).describe("Mandate validity duration in seconds (default 1 hour)"),
      user_consent_token: z.string().optional().describe("Optional user consent token from host surface"),
    },
    async (params) => {
      const trackId = `man_tool_${Date.now()}`;
      auditLedger.append(toolInvokedEvent(trackId, "create_mandate", params));

      try {
        const expiresAt = new Date(Date.now() + params.expires_in_seconds * 1000).toISOString();

        const { authorization_reference, mandate } = await mandateStore.createIntentMandate({
          user_ref: params.user_ref,
          constraints: {
            max_amount: params.max_amount,
            currency: params.currency,
            allowed_domains: params.allowed_domains,
            requires_refundability: params.requires_refundability,
            expires_at: expiresAt,
          },
          user_consent_token: params.user_consent_token,
        });

        auditLedger.append(mandateCreatedEvent(authorization_reference, mandate));
        auditLedger.append(
          toolCompletedEvent(trackId, "create_mandate", {
            authorization_reference,
            mandate_id: mandate.mandate.mandate_id,
            expires_at: expiresAt,
          })
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  authorization_reference,
                  mandate_id: mandate.mandate.mandate_id,
                  kind: "intent",
                  constraints: (mandate.mandate as IntentMandate).constraints,
                  algorithm: mandate.algorithm,
                  signature: mandate.signature,
                  message: "Intent mandate active. Pass authorization_reference to prepare_purchase.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        auditLedger.append(toolFailedEvent(trackId, "create_mandate", errorMsg));
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: errorMsg }) }],
        };
      }
    }
  );
}
