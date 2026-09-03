/**
 * Auth Guard
 * Intercepts operation execution and checks if the calling agent possesses
 * a valid, authenticated user session for protected merchant operations.
 */

import { IntegrationManifest } from "../types/manifest.js";
import { SessionStore } from "./session-store.js";
import { OAuth2Handler } from "./oauth2-handler.js";

export interface AuthRequiredResponse {
  status: "auth_required";
  authorization_url: string;
  session_id: string;
  instructions_for_agent?: string;
  message: string;
}

export interface AuthGuardResult {
  authorized: boolean;
  access_token?: string;
  session_id?: string;
  auth_required_response?: AuthRequiredResponse;
}

export class AuthGuard {
  private manifest: IntegrationManifest;
  private oauth2Handler: OAuth2Handler | null;
  private sessionStore: SessionStore;

  constructor(
    manifest: IntegrationManifest,
    oauth2Handler: OAuth2Handler | null,
    sessionStore: SessionStore
  ) {
    this.manifest = manifest;
    this.oauth2Handler = oauth2Handler;
    this.sessionStore = sessionStore;
  }

  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  /**
   * Evaluates if a given operation requires user authentication.
   */
  isProtected(operationName: string): boolean {
    const authConfig = this.manifest.auth;
    if (!authConfig) return false;

    // 1. Explicit protected list check
    if (authConfig.protected_operations && authConfig.protected_operations.length > 0) {
      return authConfig.protected_operations.includes(operationName);
    }

    // 2. Explicit public list check
    if (authConfig.public_operations && authConfig.public_operations.length > 0) {
      return !authConfig.public_operations.includes(operationName);
    }

    // 3. If OAuth2 user flow is not configured, treat operations as public
    if (!authConfig.oauth2_user) {
      return false;
    }

    // 4. Default inference when OAuth2 is configured but no explicit lists declared:
    // Mutating state operations require auth, read-only discovery operations do not.
    const defaultProtected = new Set([
      "create_checkout",
      "confirm_order",
      "cancel_order",
      "add_to_cart",
      "apply_coupon",
      "request_refund",
    ]);

    if (defaultProtected.has(operationName)) {
      return true;
    }

    if (operationName.startsWith("custom.")) {
      const customKey = operationName.slice(7);
      const customOp = this.manifest.operations.custom?.[customKey];
      if (customOp?.mutating) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks whether the agent is authorized to execute the operation.
   * If authorized, returns the valid access_token.
   * If unauthorized, returns auth_required_response with a generated login URL.
   */
  async check(operationName: string, sessionId?: string): Promise<AuthGuardResult> {
    if (!this.isProtected(operationName)) {
      return { authorized: true };
    }

    // 1. If explicit sessionId is provided, try resolving token
    if (sessionId) {
      const token = this.oauth2Handler
        ? await this.oauth2Handler.resolveValidToken(sessionId)
        : this.sessionStore.resolveToken(sessionId);

      if (token) {
        return {
          authorized: true,
          access_token: token,
          session_id: sessionId,
        };
      }
    }

    // 2. If no sessionId provided (or invalid/expired), check active user session
    const activeSession = this.sessionStore.getActiveSession();
    if (activeSession) {
      const token = this.oauth2Handler
        ? await this.oauth2Handler.resolveValidToken(activeSession.session_id)
        : this.sessionStore.resolveToken(activeSession.session_id);

      if (token) {
        return {
          authorized: true,
          access_token: token,
          session_id: activeSession.session_id,
        };
      }
    }

    // 3. No valid session — generate authorization URL and return auth_required
    if (this.oauth2Handler) {
      const login = this.oauth2Handler.initiateLogin();
      return {
        authorized: false,
        auth_required_response: {
          status: "auth_required",
          authorization_url: login.authorization_url,
          session_id: login.session_id,
          instructions_for_agent:
            "CRITICAL: Do NOT attempt to visit, open, or automate this authorization_url yourself. You MUST present this link directly to the human user in your response so they can log in via their browser. Once the user completes login, re-invoke this operation with the provided session_id.",
          message: `User authentication is required to execute "${operationName}" on ${this.manifest.merchant.name}. Do NOT open this link yourself. Provide the authorization_url directly to the user in your response so they can log in via their browser. Once completed, re-run with session_id "${login.session_id}".`,
        },
      };
    }

    return {
      authorized: false,
      auth_required_response: {
        status: "auth_required",
        authorization_url: "",
        session_id: "",
        message: `User authentication is required for "${operationName}", but OAuth2 user flow is not configured in the manifest.`,
      },
    };
  }
}
