/**
 * MCP Authentication Tools
 * Exposes user authentication status inspection, login flow initiation,
 * and session termination tools to AI buyer agents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionStore } from "../auth/session-store.js";
import { OAuth2Handler } from "../auth/oauth2-handler.js";
import { AuthGuard } from "../auth/auth-guard.js";
import { IntegrationManifest } from "../types/manifest.js";
import { AuditLedger } from "../audit/ledger.js";
import { toolInvokedEvent, toolCompletedEvent } from "../audit/events.js";
import { reasoningSchema, withReasoning } from "./reasoning.js";

import { RecurringTokenStore } from "../payment/token-store.js";

export function registerAuthTools(
  server: McpServer,
  sessionStore: SessionStore,
  authGuard: AuthGuard,
  manifest: IntegrationManifest,
  oauth2Handler: OAuth2Handler | null,
  auditLedger?: AuditLedger,
  recurringTokenStore?: RecurringTokenStore
): void {
  // ─── check_auth_status ───────────────────────────────────────────────────────
  server.tool(
    "check_auth_status",
    "Check current user authentication status with this merchant. Returns whether an active user session exists, user profile info, whether a vaulted payment card exists, or an authorization URL if unauthenticated. CRITICAL: If an authorization_url is returned, the agent must NOT open or automate it; present the link directly to the human user in the response.",
    {
      session_id: z
        .string()
        .optional()
        .describe("Optional specific session ID to verify. If omitted, checks for any active session."),
      reasoning: reasoningSchema,
    },
    async (params) => {
      const trackId = `auth_status_${Date.now()}`;
      if (auditLedger) {
        auditLedger.append(toolInvokedEvent(trackId, "check_auth_status", params));
      }

      const session = params.session_id
        ? sessionStore.getSession(params.session_id)
        : sessionStore.getActiveSession();

      if (session && session.status === "authenticated") {
        // Check if token is valid or needs refresh
        const validToken = oauth2Handler
          ? await oauth2Handler.resolveValidToken(session.session_id)
          : sessionStore.resolveToken(session.session_id);

        if (validToken) {
          const freshSession = sessionStore.getSession(session.session_id);
          const hasSavedCard = Boolean(
            freshSession?.recurring_token ||
            (freshSession?.customer_id && recurringTokenStore?.get(freshSession.customer_id)) ||
            (freshSession?.user_email && recurringTokenStore?.getByEmail(freshSession.user_email)) ||
            (recurringTokenStore && recurringTokenStore.listAll().length > 0)
          );

          const response = withReasoning(
            {
              authenticated: true,
              session_id: session.session_id,
              user_id: freshSession?.user_id,
              user_name: freshSession?.user_name,
              user_email: freshSession?.user_email,
              user_contact: freshSession?.user_contact,
              has_saved_card: hasSavedCard,
              payment_mode: hasSavedCard ? "autonomous" : "user_action_required",
              session_expires_at: freshSession
                ? new Date(freshSession.session_expires_at).toISOString()
                : undefined,
              token_expires_at: freshSession?.token_expires_at
                ? new Date(freshSession.token_expires_at).toISOString()
                : undefined,
              instructions_for_agent: hasSavedCard
                ? "A saved payment card is securely vaulted in the Stripe PCI Vault for this user. When calling prepare_purchase, do NOT ask the user for payment details or present one-time payment links; purchases will execute autonomously via off-session S2S recurring charges."
                : "User is authenticated. On first purchase, present both one-time payment and card vault links returned by prepare_purchase.",
            },
            params.reasoning
          );

          if (auditLedger) {
            auditLedger.append(toolCompletedEvent(trackId, "check_auth_status", response));
          }

          return {
            content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          };
        }
      }

      // Not authenticated — provide login instructions if OAuth2 is supported
      if (oauth2Handler) {
        const login = oauth2Handler.initiateLogin();
        const response = withReasoning(
          {
            authenticated: false,
            authorization_url: login.authorization_url,
            session_id: login.session_id,
            instructions_for_agent:
              "CRITICAL: Do NOT attempt to visit, open, or automate this authorization_url yourself via browser tools. You MUST present this link directly to the human user in your response message so they can log in via their browser.",
            message: `User is not currently authenticated with ${manifest.merchant.name}. Do NOT open this URL yourself. Provide this authorization_url directly to the user in your message so they can authorize access in their browser.`,
          },
          params.reasoning
        );

        if (auditLedger) {
          auditLedger.append(toolCompletedEvent(trackId, "check_auth_status", response));
        }

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      const response = withReasoning(
        {
          authenticated: false,
          message: `User is not authenticated, and OAuth2 user login is not configured for ${manifest.merchant.name}.`,
        },
        params.reasoning
      );

      if (auditLedger) {
        auditLedger.append(toolCompletedEvent(trackId, "check_auth_status", response));
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // ─── request_login ──────────────────────────────────────────────────────────
  server.tool(
    "request_login",
    "Request a merchant OAuth2 authorization URL for the user to log in or link their account. Returns an authorization_url. CRITICAL: The agent must NOT open or automate this URL; present it directly to the human user in the response.",
    {
      reasoning: reasoningSchema,
    },
    async (params) => {
      const trackId = `auth_login_${Date.now()}`;
      if (auditLedger) {
        auditLedger.append(toolInvokedEvent(trackId, "request_login", params));
      }

      if (!oauth2Handler) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "OAuth2 user login is not configured for this merchant.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const login = oauth2Handler.initiateLogin();
      const response = withReasoning(
        {
          status: "login_initiated",
          authorization_url: login.authorization_url,
          session_id: login.session_id,
          instructions_for_agent:
            "CRITICAL: Do NOT attempt to visit, open, or automate this authorization_url yourself via browser tools. You MUST present this link directly to the human user in your response message so they can log in via their browser.",
          message: `Do NOT open this URL yourself. Provide this authorization_url directly to the human user in your response so they can log in to ${manifest.merchant.name} in their browser. Once completed, subsequent operations using session_id "${login.session_id}" will be authorized.`,
        },
        params?.reasoning
      );

      if (auditLedger) {
        auditLedger.append(toolCompletedEvent(trackId, "request_login", response));
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  // ─── logout ─────────────────────────────────────────────────────────────────
  server.tool(
    "logout",
    "Invalidate and terminate the active user session on this merchant.",
    {
      session_id: z
        .string()
        .optional()
        .describe(
          "Optional session ID to terminate. If omitted, terminates the current active session."
        ),
      reasoning: reasoningSchema,
    },
    async (params) => {
      const trackId = `auth_logout_${Date.now()}`;
      if (auditLedger) {
        auditLedger.append(toolInvokedEvent(trackId, "logout", params));
      }

      const targetId = params.session_id || sessionStore.getActiveSession()?.session_id;

      if (targetId) {
        sessionStore.invalidateSession(targetId);
      }

      const response = withReasoning(
        {
          status: "logged_out",
          session_id: targetId,
          message: targetId
            ? `User session "${targetId}" has been invalidated successfully.`
            : "No active session was found to invalidate.",
        },
        params.reasoning
      );

      if (auditLedger) {
        auditLedger.append(toolCompletedEvent(trackId, "logout", response));
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }
  );
}
