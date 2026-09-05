import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * In-memory store for short-lived authorization codes & refresh tokens.
 * Standard RFC 6749 authorization servers store authorization codes with short TTLs (~5 mins).
 */
const authCodes = new Map();
const refreshTokens = new Map();

// Helper to cleanup expired codes
const cleanExpiredCodes = () => {
  const now = Date.now();
  for (const [code, record] of authCodes.entries()) {
    if (record.expiresAt <= now) {
      authCodes.delete(code);
    }
  }
};

/**
 * @desc    OAuth2 Authorization Endpoint (RFC 6749 Section 4.1.1)
 * @route   GET /oauth/authorize
 * @access  Public
 */
router.get('/authorize', async (req, res) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    scope,
    state,
    code_challenge,
    code_challenge_method,
  } = req.query;

  if (response_type !== 'code') {
    return res.status(400).send('Unsupported response_type. ProShop OAuth2 server only supports "code".');
  }

  if (!redirect_uri) {
    return res.status(400).send('Missing required parameter: redirect_uri');
  }

  // Check if user is already logged in via cookie JWT
  let existingUser = null;
  if (req.cookies && req.cookies.jwt) {
    try {
      const decoded = jwt.verify(req.cookies.jwt, process.env.JWT_SECRET);
      existingUser = await User.findById(decoded.userId).select('-password');
    } catch {
      existingUser = null;
    }
  }

  // If already logged in, show one-click approval; otherwise show login form
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ProShop - Authorize Application</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        body { background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
        .card { background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); width: 100%; max-width: 440px; padding: 2rem; }
        .brand { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; }
        .brand-icon { width: 36px; height: 36px; background: #2563eb; color: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.2rem; }
        .brand-name { font-size: 1.35rem; font-weight: 700; color: #0f172a; }
        h1 { font-size: 1.15rem; font-weight: 600; margin-bottom: 0.5rem; color: #334155; }
        p.desc { font-size: 0.875rem; color: #64748b; margin-bottom: 1.5rem; line-height: 1.4; }
        .badge { background: #eff6ff; color: #1d4ed8; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.5rem; border-radius: 4px; display: inline-block; margin-bottom: 1rem; }
        .form-group { margin-bottom: 1rem; text-align: left; }
        label { display: block; font-size: 0.825rem; font-weight: 500; color: #475569; margin-bottom: 0.25rem; }
        input[type="email"], input[type="password"] { width: 100%; padding: 0.65rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.9rem; outline: none; transition: border-color 0.2s; }
        input[type="email"]:focus, input[type="password"]:focus { border-color: #2563eb; }
        .btn-primary { width: 100%; padding: 0.75rem; background: #2563eb; color: white; border: none; border-radius: 6px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: background 0.2s; margin-top: 0.5rem; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-secondary { width: 100%; padding: 0.65rem; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; margin-top: 0.5rem; text-decoration: none; display: inline-block; text-align: center; }
        .btn-secondary:hover { background: #e2e8f0; }
        .active-user { background: #f1f5f9; padding: 0.75rem; border-radius: 6px; font-size: 0.875rem; color: #334155; margin-bottom: 1.25rem; border: 1px solid #e2e8f0; }
        .demo-creds { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #f1f5f9; font-size: 0.75rem; color: #94a3b8; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">
          <div class="brand-icon">P</div>
          <span class="brand-name">ProShop</span>
        </div>
        <h1>Authorize Application Access</h1>
        <p class="desc">A client application is requesting permission to access your ProShop account and manage orders on your behalf.</p>
        <span class="badge">OAuth 2.0 Authorization</span>

        ${existingUser ? `
          <div class="active-user">
            Logged in as: <strong>${existingUser.name}</strong> (${existingUser.email})
          </div>
          <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="user_id" value="${existingUser._id}">
            <input type="hidden" name="client_id" value="${client_id || ''}">
            <input type="hidden" name="redirect_uri" value="${redirect_uri}">
            <input type="hidden" name="state" value="${state || ''}">
            <input type="hidden" name="code_challenge" value="${code_challenge || ''}">
            <input type="hidden" name="code_challenge_method" value="${code_challenge_method || ''}">
            <input type="hidden" name="scope" value="${scope || ''}">
            <button type="submit" class="btn-primary">Authorize Access</button>
            <a href="${redirect_uri}?error=access_denied&state=${state || ''}" class="btn-secondary">Cancel</a>
          </form>
        ` : `
          <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="client_id" value="${client_id || ''}">
            <input type="hidden" name="redirect_uri" value="${redirect_uri}">
            <input type="hidden" name="state" value="${state || ''}">
            <input type="hidden" name="code_challenge" value="${code_challenge || ''}">
            <input type="hidden" name="code_challenge_method" value="${code_challenge_method || ''}">
            <input type="hidden" name="scope" value="${scope || ''}">
            <div class="form-group">
              <label for="email">ProShop Account Email</label>
              <input type="email" id="email" name="email" value="john@email.com" required autocomplete="email">
            </div>
            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" value="123456" required autocomplete="current-password">
            </div>
            <button type="submit" class="btn-primary">Log In & Authorize</button>
            <a href="${redirect_uri}?error=access_denied&state=${state || ''}" class="btn-secondary">Cancel</a>
          </form>
          <div class="demo-creds">
            Demo Account: <strong>john@email.com</strong> / <strong>123456</strong>
          </div>
        `}
      </div>
    </body>
    </html>
  `);
});

/**
 * @desc    Handle Authorization Consent / Login Form Submission
 * @route   POST /oauth/authorize
 * @access  Public
 */
router.post('/authorize', async (req, res) => {
  const {
    user_id,
    email,
    password,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    scope,
  } = req.body;

  if (!redirect_uri) {
    return res.status(400).send('Missing redirect_uri');
  }

  let authenticatedUser = null;

  if (user_id) {
    authenticatedUser = await User.findById(user_id);
  } else if (email && password) {
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
      authenticatedUser = user;
    }
  }

  if (!authenticatedUser) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 2rem;">
          <h2 style="color: #ef4444;">Authentication Failed</h2>
          <p>Invalid email or password.</p>
          <a href="javascript:history.back()" style="display:inline-block; margin-top:1rem; padding:0.5rem 1rem; background:#2563eb; color:white; text-decoration:none; border-radius:4px;">Try Again</a>
        </body>
      </html>
    `);
  }

  cleanExpiredCodes();

  // Generate 32-byte cryptographically secure authorization code
  const code = crypto.randomBytes(32).toString('hex');
  authCodes.set(code, {
    code,
    userId: String(authenticatedUser._id),
    clientId: client_id || '',
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method || 'S256',
    scope: scope || 'read_profile orders',
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes TTL
  });

  // Redirect back to client redirect_uri with code & state
  const targetUrl = new URL(redirect_uri);
  targetUrl.searchParams.set('code', code);
  if (state) {
    targetUrl.searchParams.set('state', state);
  }

  res.redirect(targetUrl.toString());
});

/**
 * @desc    OAuth2 Token Exchange Endpoint (RFC 6749 Section 4.1.3 & RFC 7636 PKCE)
 * @route   POST /oauth/token
 * @access  Public
 */
router.post('/token', async (req, res) => {
  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    client_secret,
    code_verifier,
    refresh_token,
  } = req.body;

  // 1. Authorization Code Grant
  if (grant_type === 'authorization_code') {
    if (!code) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing code parameter' });
    }

    cleanExpiredCodes();
    const record = authCodes.get(code);
    if (!record) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
    }

    // Immediately consume the authorization code (single use)
    authCodes.delete(code);

    // Verify PKCE code_verifier if code_challenge was provided
    if (record.codeChallenge) {
      if (!code_verifier) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Missing code_verifier for PKCE' });
      }

      if (record.codeChallengeMethod === 'S256') {
        const computedChallenge = crypto
          .createHash('sha256')
          .update(code_verifier)
          .digest('base64url');

        if (computedChallenge !== record.codeChallenge) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE code_verifier verification failed' });
        }
      } else if (record.codeChallengeMethod === 'plain') {
        if (code_verifier !== record.codeChallenge) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE code_verifier mismatch' });
        }
      }
    }

    // Verify redirect_uri matches
    if (record.redirectUri && redirect_uri && record.redirectUri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    }

    // Lookup user
    const user = await User.findById(record.userId);
    if (!user) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'User not found' });
    }

    // Issue standard ProShop JWT access token (valid for 30 days)
    const accessToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });

    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    refreshTokens.set(newRefreshToken, {
      userId: String(user._id),
      expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000, // 60 days
    });

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 30 * 24 * 60 * 60, // 30 days (in seconds)
      refresh_token: newRefreshToken,
      scope: record.scope || 'read_profile orders',
    });
  }

  // 2. Refresh Token Grant
  if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing refresh_token parameter' });
    }

    const record = refreshTokens.get(refresh_token);
    if (!record || record.expiresAt <= Date.now()) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(record.userId);
    if (!user) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'User not found' });
    }

    const accessToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '30d',
    });

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 30 * 24 * 60 * 60,
      refresh_token,
      scope: 'read_profile orders',
    });
  }

  return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Grant type not supported' });
});

/**
 * @desc    OAuth2 UserInfo Endpoint (OIDC / OAuth2 standard profile lookup)
 * @route   GET /oauth/userinfo
 * @access  Private (Bearer token)
 */
router.get('/userinfo', protect, (req, res) => {
  res.json({
    id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    isAdmin: req.user.isAdmin,
  });
});

export default router;
