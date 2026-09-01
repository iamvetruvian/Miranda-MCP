/**
 * Multi-Type Authentication Provider
 * Handles API Keys, Bearer Tokens, Basic Auth, OAuth2 Client Credentials,
 * HMAC Request Signing, and Custom Headers declared in the manifest.
 */

import crypto from "crypto";
import { AuthConfig } from "../types/manifest.js";

export interface RequestAuthContext {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  operationName?: string;
}

export class AuthProvider {
  private config?: AuthConfig;
  private cachedOAuthToken?: { token: string; expiresAt: number };

  constructor(config?: AuthConfig) {
    this.config = config;
  }

  /**
   * Applies session-scoped authentication token (e.g. from OAuth2 user login) to an outbound request.
   */
  async applyAuthWithSessionToken(
    headers: Record<string, string> = {},
    sessionToken: string,
    context?: RequestAuthContext
  ): Promise<Record<string, string>> {
    const result = { ...headers };
    const effectiveConfig =
      context?.operationName && this.config?.operation_overrides?.[context.operationName]
        ? { ...this.config, ...this.config.operation_overrides[context.operationName] }
        : this.config;

    const headerName = effectiveConfig?.header || "Authorization";
    const prefix = effectiveConfig?.token_prefix !== undefined
      ? (effectiveConfig.token_prefix ? `${effectiveConfig.token_prefix} ` : "")
      : "Bearer ";

    result[headerName] = `${prefix}${sessionToken}`;
    return result;
  }

  /**
   * Applies authentication headers to an outbound request.
   */
  async applyAuth(
    headers: Record<string, string> = {},
    context?: RequestAuthContext
  ): Promise<Record<string, string>> {
    if (!this.config || this.config.type === "none") {
      return headers;
    }

    const effectiveConfig =
      context?.operationName && this.config.operation_overrides?.[context.operationName]
        ? { ...this.config, ...this.config.operation_overrides[context.operationName] }
        : this.config;

    const result = { ...headers };

    switch (effectiveConfig.type) {
      case "api_key": {
        const token = effectiveConfig.token_env_var
          ? process.env[effectiveConfig.token_env_var]
          : undefined;
        if (token) {
          const headerName = effectiveConfig.header || "X-API-Key";
          const prefix = effectiveConfig.token_prefix ? `${effectiveConfig.token_prefix} ` : "";
          result[headerName] = `${prefix}${token}`;
        }
        break;
      }

      case "bearer": {
        const token = effectiveConfig.token_env_var
          ? process.env[effectiveConfig.token_env_var]
          : undefined;
        if (token) {
          result["Authorization"] = `Bearer ${token}`;
        }
        break;
      }

      case "basic": {
        const token = effectiveConfig.token_env_var
          ? process.env[effectiveConfig.token_env_var]
          : undefined;
        if (token) {
          const encoded = Buffer.from(token).toString("base64");
          result["Authorization"] = `Basic ${encoded}`;
        }
        break;
      }

      case "custom_header": {
        const token = effectiveConfig.token_env_var
          ? process.env[effectiveConfig.token_env_var]
          : undefined;
        if (token && effectiveConfig.header) {
          const prefix = effectiveConfig.token_prefix ? `${effectiveConfig.token_prefix} ` : "";
          result[effectiveConfig.header] = `${prefix}${token}`;
        }
        break;
      }

      case "oauth2_client_credentials": {
        const token = await this.getOAuth2Token(effectiveConfig);
        if (token) {
          result["Authorization"] = `Bearer ${token}`;
        }
        break;
      }

      case "hmac_request_signing": {
        this.applyHmacSignature(result, effectiveConfig, context);
        break;
      }

      default:
        break;
    }

    return result;
  }

  private async getOAuth2Token(config: AuthConfig): Promise<string | null> {
    if (!config.oauth2) return null;

    const now = Date.now();
    const buffer = (config.oauth2.token_refresh_buffer_seconds ?? 60) * 1000;

    if (this.cachedOAuthToken && this.cachedOAuthToken.expiresAt > now + buffer) {
      return this.cachedOAuthToken.token;
    }

    const clientId = process.env[config.oauth2.client_id_env];
    const clientSecret = process.env[config.oauth2.client_secret_env];
    if (!clientId || !clientSecret) {
      return null;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (config.oauth2.scopes && config.oauth2.scopes.length > 0) {
      body.set("scope", config.oauth2.scopes.join(" "));
    }
    if (config.oauth2.audience) {
      body.set("audience", config.oauth2.audience);
    }

    try {
      const res = await fetch(config.oauth2.token_url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        throw new Error(`OAuth2 token request failed: HTTP ${res.status}`);
      }

      const data = (await res.json()) as any;
      const accessToken = data.access_token;
      const expiresIn = Number(data.expires_in || 3600);

      this.cachedOAuthToken = {
        token: accessToken,
        expiresAt: now + expiresIn * 1000,
      };

      return accessToken;
    } catch (err) {
      console.error("OAuth2 client_credentials token retrieval failed:", err);
      return null;
    }
  }

  private applyHmacSignature(
    headers: Record<string, string>,
    config: AuthConfig,
    context?: RequestAuthContext
  ): void {
    if (!config.hmac) return;

    const secret = process.env[config.hmac.secret_env];
    if (!secret) return;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID();

    if (config.hmac.timestamp_header) {
      headers[config.hmac.timestamp_header] = timestamp;
    }
    if (config.hmac.nonce_header) {
      headers[config.hmac.nonce_header] = nonce;
    }

    const components: string[] = [];
    for (const comp of config.hmac.signature_components) {
      switch (comp) {
        case "method":
          components.push(context?.method?.toUpperCase() || "GET");
          break;
        case "path":
          components.push(context?.path || "");
          break;
        case "query":
          components.push(
            context?.query ? new URLSearchParams(context.query as any).toString() : ""
          );
          break;
        case "body":
          components.push(
            context?.body
              ? typeof context.body === "string"
                ? context.body
                : JSON.stringify(context.body)
              : ""
          );
          break;
        case "timestamp":
          components.push(timestamp);
          break;
        case "nonce":
          components.push(nonce);
          break;
      }
    }

    const payloadToSign = components.join("\n");
    const hmac = crypto.createHmac(config.hmac.algorithm, secret);
    hmac.update(payloadToSign);
    const signature = hmac.digest("hex");

    headers[config.hmac.signature_header] = signature;
  }
}
