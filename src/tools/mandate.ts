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
import { reasoningSchema, withReasoning } from "./reasoning.js";

export function registerMandateTools(
  server: McpServer,
  mandateStore: MandateStore,
  auditLedger: AuditLedger
): void {
  server.tool(
    "create_mandate",
    "Create an AP2 Intent Mandate for advance budgetary spending limits (e.g. daily/weekly spending caps). " +
    "CRITICAL: Do NOT invoke this tool for standard purchases when an autopay recurring token is already registered. " +
    "Instead, call prepare_purchase directly without an authorization_reference — the MCP server will automatically issue an AP2 consent challenge (consent_url) for the user to review and authorize the purchase in their browser.",
    {
      user_ref: z.string().describe("Opaque user reference identifier (e.g. user_session_123)"),
      max_amount: z.number().int().positive().describe("Maximum allowed checkout total in currency sub-units (paise / cents), e.g. 8000000 for ₹80,000"),
      currency: z.string().default(process.env.DEFAULT_CURRENCY || "USD").describe("Currency code, e.g. 'USD' or 'INR'"),
      allowed_domains: z.array(z.string()).optional().describe("Optional list of allowed commerce domains, e.g. ['retail', 'ticketing']"),
      requires_refundability: z.boolean().optional().default(false).describe("Whether the purchase must be refundable"),
      expires_in_seconds: z.number().int().positive().default(3600).describe("Mandate validity duration in seconds (default 1 hour)"),
      user_consent_token: z.string().optional().describe("Optional user consent token from host surface"),
      algorithm: z.enum(["ES256", "hmac-sha256"]).optional().default("ES256").describe("Signature algorithm (default ES256 per AP2 standard)"),
      payment_instrument: z.object({
        id: z.string(),
        type: z.string(),
        description: z.string(),
        last4: z.string().optional(),
      }).optional().describe("Optional payment instrument to bind to the mandate"),
      reasoning: reasoningSchema,
    },
    async (params) => {
      const trackId = `man_tool_${Date.now()}`;
      auditLedger.append(toolInvokedEvent(trackId, "create_mandate", params));

      try {
        const expiresInSeconds = params.expires_in_seconds ?? 3600;
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

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
          payment_instrument: params.payment_instrument,
          algorithm: params.algorithm,
        });

        auditLedger.append(mandateCreatedEvent(authorization_reference, mandate));
        auditLedger.append(
          toolCompletedEvent(
            trackId,
            "create_mandate",
            withReasoning(
              {
                authorization_reference,
                mandate_id: mandate.mandate.mandate_id,
                expires_at: expiresAt,
              },
              params.reasoning
            )
          )
        );

        const openMandate = (mandate.mandate as any).open_mandate;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                withReasoning(
                  {
                    authorization_reference,
                    mandate_id: mandate.mandate.mandate_id,
                    kind: "intent",
                    vct: openMandate?.vct || "mandate.payment.open.1",
                    constraints: (mandate.mandate as IntentMandate).constraints,
                    cnf: openMandate?.cnf,
                    payment_instrument: openMandate?.payment_instrument,
                    algorithm: mandate.algorithm,
                    signature: mandate.signature,
                    jws: mandate.jws,
                    message: "Intent mandate active. Pass authorization_reference to prepare_purchase.",
                  },
                  params.reasoning
                ),
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
