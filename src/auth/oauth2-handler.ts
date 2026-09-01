/**
 * OAuth2 Authorization Code Handler
 * Manages OAuth2 Authorization Code flow with PKCE, code-for-token exchange,
 * token refreshes, and user information extraction.
 */

import crypto from "crypto";
import { OAuth2UserFlowConfig } from "../types/manifest.js";
import { SessionStore, UserSession, OAuth2Tokens, UserInfo } from "./session-store.js";
import { ResponseMapper } from "../connector/mapper.js";

export class OAuth2Handler {
  private config: OAuth2UserFlowConfig;
  private sessionStore: SessionStore;
  private callbackUrl: string;
  private mapper = new ResponseMapper();

  constructor(
    config: OAuth2UserFlowConfig,
    sessionStore: SessionStore,
    callbackUrl?: string
  ) {
    this.config = config;
    this.sessionStore = sessionStore;
    this.callbackUrl = callbackUrl || config.redirect_uri || "http://localhost:3000/auth/callback";
  }

  /**
   * Generates the authorization URL and creates a pending session.
   * Agent shares this authorization URL with the user.
   */
  initiateLogin(options?: { ttlSeconds?: number }): {
    authorization_url: string;
    session_id: string;
    state: string;
  } {
    const state = crypto.randomBytes(16).toString("hex");
    let codeVerifier: string | undefined = undefined;
    let codeChallenge: string | undefined = undefined;

    if (this.config.use_pkce !== false) {
      codeVerifier = crypto.randomBytes(32).toString("base64url");
      codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
    }

    const pendingSession = this.sessionStore.createPendingSession(
      state,
      codeVerifier,
      options?.ttlSeconds ?? this.config.session_ttl_seconds
    );

    const authUrl = new URL(this.config.authorization_url);
    authUrl.searchParams.set("response_type", "code");

    const clientId =
      (this.config.client_id_env ? process.env[this.config.client_id_env] : undefined) ||
      (this.config as any).client_id ||
      "";
    if (clientId) {
      authUrl.searchParams.set("client_id", clientId);
    }
    authUrl.searchParams.set("redirect_uri", this.callbackUrl);
    authUrl.searchParams.set("state", state);

    if (this.config.scopes && this.config.scopes.length > 0) {
      authUrl.searchParams.set("scope", this.config.scopes.join(" "));
    }

    if (codeChallenge) {
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
    }

    if (this.config.additional_auth_params) {
      for (const [k, v] of Object.entries(this.config.additional_auth_params)) {
        authUrl.searchParams.set(k, v);
      }
    }

    return {
      authorization_url: authUrl.toString(),
      session_id: pendingSession.session_id,
      state,
    };
  }

  /**
   * Handles the redirect callback from the merchant OAuth2 authorization server.
   * Validates CSRF state, exchanges authorization code for tokens, and completes session.
   */
  async handleCallback(code: string, state: string): Promise<UserSession> {
    if (!code || !state) {
      throw new Error("Missing code or state parameter in OAuth2 callback");
    }

    const pendingSession = this.sessionStore.findByState(state);
    if (!pendingSession) {
      throw new Error(
        "Invalid or expired OAuth2 state parameter. If you restarted your server or clicked an outdated link, please ask the AI assistant to initiate a fresh purchase or login request."
      );
    }

    if (pendingSession.status === "authenticated" && pendingSession.access_token) {
      return pendingSession;
    }

    const clientId =
      (this.config.client_id_env ? process.env[this.config.client_id_env] : undefined) ||
      (this.config as any).client_id ||
      "";
    const clientSecret =
      (this.config.client_secret_env ? process.env[this.config.client_secret_env] : undefined) ||
      (this.config as any).client_secret ||
      "";

    const bodyParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.callbackUrl,
    });
    if (clientId) bodyParams.set("client_id", clientId);
    if (clientSecret) bodyParams.set("client_secret", clientSecret);

    if (pendingSession.pkce_verifier) {
      bodyParams.set("code_verifier", pendingSession.pkce_verifier);
    }

    const response = await fetch(this.config.token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `OAuth2 token exchange failed with HTTP ${response.status}: ${errText || response.statusText}`
      );
    }

    const tokenData = await response.json();
    const tokens = this.extractTokens(tokenData);

    if (!tokens.access_token) {
      throw new Error("OAuth2 token endpoint response did not contain a valid access_token");
    }

    let userInfo = this.extractUserInfo(tokenData);

    // If user info is not present in token response and userinfo_url is declared, fetch it
    if ((!userInfo.user_id || !userInfo.user_name) && this.config.userinfo_url) {
      try {
        const userRes = await fetch(this.config.userinfo_url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: "application/json",
          },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          const fetchedInfo = this.extractUserInfo(userData);
          userInfo = {
            user_id: userInfo.user_id || fetchedInfo.user_id,
            user_name: userInfo.user_name || fetchedInfo.user_name,
          };
        }
      } catch (err) {
        console.warn("[OAuth2Handler] Failed to fetch userinfo endpoint:", err);
      }
    }

    const completed = this.sessionStore.completeSession(
      pendingSession.session_id,
      tokens,
      userInfo,
      this.config.session_ttl_seconds
    );

    return completed;
  }

  /**
   * Refreshes an expired access token using the refresh token.
   */
  async refreshAccessToken(sessionId: string): Promise<string | null> {
    const session = this.sessionStore.getSession(sessionId);
    if (!session || !session.refresh_token) {
      return null;
    }

    const clientId =
      (this.config.client_id_env ? process.env[this.config.client_id_env] : undefined) ||
      (this.config as any).client_id ||
      "";
    const clientSecret =
      (this.config.client_secret_env ? process.env[this.config.client_secret_env] : undefined) ||
      (this.config as any).client_secret ||
      "";

    const bodyParams = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refresh_token,
    });
    if (clientId) bodyParams.set("client_id", clientId);
    if (clientSecret) bodyParams.set("client_secret", clientSecret);

    try {
      const response = await fetch(this.config.token_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: bodyParams.toString(),
      });

      if (!response.ok) {
        console.warn(`[OAuth2Handler] Token refresh failed with HTTP ${response.status}`);
        return null;
      }

      const tokenData = await response.json();
      const tokens = this.extractTokens(tokenData);

      if (!tokens.access_token) {
        return null;
      }

      this.sessionStore.updateTokens(sessionId, tokens);
      return tokens.access_token;
    } catch (err) {
      console.error("[OAuth2Handler] Error during token refresh:", err);
      return null;
    }
  }

  /**
   * Resolves a valid access token for a session.
   * Auto-refreshes if expired and refresh token is present.
   */
  async resolveValidToken(sessionId: string): Promise<string | null> {
    const session = this.sessionStore.getSession(sessionId);
    if (!session || !session.access_token) {
      return null;
    }

    const now = Date.now();
    // If token does not expire or has > 30 seconds remaining
    if (!session.token_expires_at || session.token_expires_at > now + 30000) {
      return session.access_token;
    }

    // Access token expired, attempt auto-refresh
    if (session.refresh_token) {
      const refreshed = await this.refreshAccessToken(sessionId);
      if (refreshed) {
        return refreshed;
      }
    }

    // Token expired and refresh failed
    return null;
  }

  private extractTokens(data: unknown): OAuth2Tokens {
    const accessTokenPath = this.config.access_token_path || "$.access_token";
    const refreshTokenPath = this.config.refresh_token_path || "$.refresh_token";
    const expiresInPath = this.config.expires_in_path || "$.expires_in";

    const accessToken =
      (this.mapper.resolvePath(data, accessTokenPath) as string) ??
      (data as any)?.access_token ??
      (data as any)?.token ??
      "";

    const refreshToken =
      (this.mapper.resolvePath(data, refreshTokenPath) as string) ??
      (data as any)?.refresh_token;

    const rawExpiresIn =
      this.mapper.resolvePath(data, expiresInPath) ??
      (data as any)?.expires_in;

    const expiresIn = typeof rawExpiresIn === "number" ? rawExpiresIn : undefined;

    return {
      access_token: String(accessToken),
      refresh_token: refreshToken ? String(refreshToken) : undefined,
      expires_in: expiresIn,
    };
  }

  private extractUserInfo(data: unknown): UserInfo {
    let userId: string | undefined = undefined;
    let userName: string | undefined = undefined;

    if (this.config.user_id_path) {
      const val = this.mapper.resolvePath(data, this.config.user_id_path);
      if (val !== undefined && val !== null) userId = String(val);
    } else {
      userId =
        (data as any)?.user_id ??
        (data as any)?.user?._id ??
        (data as any)?.user?.id ??
        (data as any)?.id ??
        (data as any)?._id ??
        (data as any)?.sub;
      if (userId) userId = String(userId);
    }

    if (this.config.user_name_path) {
      const val = this.mapper.resolvePath(data, this.config.user_name_path);
      if (val !== undefined && val !== null) userName = String(val);
    } else {
      userName =
        (data as any)?.user_name ??
        (data as any)?.name ??
        (data as any)?.user?.name ??
        (data as any)?.email ??
        (data as any)?.user?.email;
      if (userName) userName = String(userName);
    }

    return { user_id: userId, user_name: userName };
  }
}
