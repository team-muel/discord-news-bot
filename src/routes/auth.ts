import crypto from 'crypto';
import { Router } from 'express';
import {
  AUTH_CSRF_COOKIE_NAME,
  AUTH_CSRF_HEADER_NAME,
  AUTH_COOKIE_NAME,
  DEV_AUTH_ENABLED,
  DISCORD_OAUTH_API_BASE,
  DISCORD_OAUTH_CLIENT_ID,
  DISCORD_OAUTH_CLIENT_SECRET,
  DISCORD_OAUTH_REDIRECT_URI,
  DISCORD_OAUTH_SCOPE,
  DISCORD_INVITE_PERMISSIONS,
  DISCORD_INVITE_SCOPES,
  DISCORD_OAUTH_STATE_COOKIE_NAME,
  DISCORD_OAUTH_STATE_TTL_SEC,
  FRONTEND_ORIGIN,
  NODE_ENV,
} from '../config';
import { buildDevUserFromCode, clearSessionCookie, getCookieOptions, issueSessionToken, clearCsrfCookie, issueCsrfToken, setCsrfCookie } from '../services/authService';
import { requireAuth } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient';
import type { JwtUser } from '../types/auth';
import { encryptToken } from '../utils/tokenEncryption';

function renderAuthCallbackPage(ok: boolean): string {
  const eventType = ok ? 'OAUTH_AUTH_SUCCESS' : 'OAUTH_AUTH_ERROR';
  const targetOrigin = (FRONTEND_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)[0] || null;
  if (!targetOrigin) {
    return `<!doctype html><html><body><p>OAuth configuration error: FRONTEND_ORIGIN not set.</p></body></html>`;
  }
  const serializedOrigin = JSON.stringify(targetOrigin);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Authentication Complete</title>
  </head>
  <body>
    <script>
      (function () {
        if (window.opener) {
          window.opener.postMessage({ type: '${eventType}' }, ${serializedOrigin});
        }
        window.close();
      })();
    </script>
    <p>Authentication complete. You can close this window.</p>
  </body>
</html>`;
}

function isDiscordOAuthConfigured(): boolean {
  return Boolean(DISCORD_OAUTH_CLIENT_ID && DISCORD_OAUTH_CLIENT_SECRET && DISCORD_OAUTH_REDIRECT_URI);
}

function getOauthStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: NODE_ENV === 'production',
    maxAge: Math.max(60, DISCORD_OAUTH_STATE_TTL_SEC) * 1000,
    path: '/api/auth',
  };
}

function buildDiscordAuthorizeUrl(state: string): string {
  const base = DISCORD_OAUTH_API_BASE.replace(/\/+$/, '');
  const params = new URLSearchParams({
    client_id: DISCORD_OAUTH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: DISCORD_OAUTH_REDIRECT_URI,
    scope: DISCORD_OAUTH_SCOPE,
    state,
    prompt: 'none',
  });
  return `${base}/oauth2/authorize?${params.toString()}`;
}

function buildDiscordBotInviteUrl(guildId?: string): string {
  const appId = DISCORD_OAUTH_CLIENT_ID;
  if (!appId) {
    throw new Error('DISCORD_CLIENT_ID_MISSING');
  }

  const base = DISCORD_OAUTH_API_BASE.replace(/\/api\/?$/, '').replace(/\/$/, '');
  const params = new URLSearchParams({
    client_id: appId,
    scope: DISCORD_INVITE_SCOPES,
    permissions: DISCORD_INVITE_PERMISSIONS,
    disable_guild_select: guildId ? 'true' : 'false',
  });

  if (guildId) {
    params.set('guild_id', guildId);
  }

  return `${base}/oauth2/authorize?${params.toString()}`;
}

type DiscordTokenExchange = {
  accessToken: string;
  refreshToken: string | null;
};

const parseResponseJsonObject = async (
  response: Response,
  errorCode: string,
): Promise<Record<string, unknown>> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${errorCode}:INVALID_JSON`);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error(`${errorCode}:INVALID_PAYLOAD`);
  }

  return payload as Record<string, unknown>;
};

async function exchangeDiscordCodeForToken(code: string): Promise<DiscordTokenExchange> {
  const base = DISCORD_OAUTH_API_BASE.replace(/\/+$/, '');
  const body = new URLSearchParams({
    client_id: DISCORD_OAUTH_CLIENT_ID,
    client_secret: DISCORD_OAUTH_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: DISCORD_OAUTH_REDIRECT_URI,
  });

  const response = await fetch(`${base}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = await parseResponseJsonObject(response, 'DISCORD_TOKEN_EXCHANGE_FAILED');
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error('DISCORD_TOKEN_EXCHANGE_FAILED');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
  };
}

async function fetchDiscordUser(accessToken: string): Promise<JwtUser> {
  const base = DISCORD_OAUTH_API_BASE.replace(/\/+$/, '');
  const response = await fetch(`${base}/users/@me`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await parseResponseJsonObject(response, 'DISCORD_USER_FETCH_FAILED');
  if (!response.ok) {
    throw new Error('DISCORD_USER_FETCH_FAILED');
  }

  const id = typeof payload.id === 'string' ? payload.id : '';
  const usernameRaw = typeof payload.global_name === 'string' && payload.global_name
    ? payload.global_name
    : typeof payload.username === 'string'
      ? payload.username
      : '';
  const avatar = typeof payload.avatar === 'string' ? payload.avatar : null;

  if (!id || !usernameRaw) {
    throw new Error('DISCORD_USER_PAYLOAD_INVALID');
  }

  return {
    id,
    username: usernameRaw,
    avatar,
  };
}

async function loginWithDiscordCode(code: string): Promise<JwtUser> {
  const { accessToken, refreshToken } = await exchangeDiscordCodeForToken(code);
  const user = await fetchDiscordUser(accessToken);

  if (!isSupabaseConfigured()) {
    return user;
  }

  try {
    const client = getSupabaseClient();
    await client.from('users').upsert(
      {
        id: user.id,
        username: user.username,
        avatar: user.avatar ?? null,
        discord_access_token: encryptToken(accessToken),
        discord_refresh_token: refreshToken ? encryptToken(refreshToken) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
  } catch {
    // Login should not fail if profile persistence is unavailable.
  }

  return user;
}

export function createAuthRouter(): Router {
  const router = Router();
  const oauthRateLimiter = createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'auth-oauth', store: 'supabase' });
  const devAuthRateLimiter = createRateLimiter({ windowMs: 60_000, max: 12, keyPrefix: 'auth-dev', store: 'supabase' });

  const denyDevAuth = (res: { status: (code: number) => { json: (payload: Record<string, unknown>) => void } }) =>
    res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'DEV auth endpoints are disabled' });

  router.get('/me', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const csrfToken = issueCsrfToken(req.user.id);
    setCsrfCookie(res, csrfToken);

    return res.json({ user: req.user, csrfToken, csrfHeaderName: AUTH_CSRF_HEADER_NAME });
  });

  router.post('/sdk', devAuthRateLimiter, (req, res) => {
    if (!DEV_AUTH_ENABLED) {
      return denyDevAuth(res);
    }

    const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
    const user = buildDevUserFromCode(code);
    const token = issueSessionToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions());
    setCsrfCookie(res, issueCsrfToken(user.id));
    return res.json({ ok: true, user });
  });

  router.post('/logout', requireAuth, (_req, res) => {
    clearSessionCookie(res);
    clearCsrfCookie(res);
    res.clearCookie(DISCORD_OAUTH_STATE_COOKIE_NAME, { path: '/api/auth' });
    return res.status(204).send();
  });

  router.get('/login', oauthRateLimiter, (req, res) => {
    if (!isDiscordOAuthConfigured()) {
      return res.status(503).json({ ok: false, error: 'CONFIG', message: 'Discord OAuth is not configured' });
    }

    const state = crypto.randomBytes(24).toString('hex');
    res.cookie(DISCORD_OAUTH_STATE_COOKIE_NAME, state, getOauthStateCookieOptions());

    const authorizeUrl = buildDiscordAuthorizeUrl(state);
    if (String(req.query.mode || '').toLowerCase() === 'json') {
      return res.json({ authorizeUrl });
    }

    return res.redirect(authorizeUrl);
  });

  router.get('/invite', (req, res) => {
    try {
      const guildId = typeof req.query.guild_id === 'string' ? req.query.guild_id.trim() : '';
      const inviteUrl = buildDiscordBotInviteUrl(guildId || undefined);
      return res.json({ inviteUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'INVITE_URL_BUILD_FAILED';
      return res.status(503).json({ ok: false, error: 'INVITE_URL_BUILD_FAILED', message });
    }
  });

  router.get('/callback', oauthRateLimiter, async (req, res) => {
    const code = typeof req.query?.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query?.state === 'string' ? req.query.state : undefined;

    if (isDiscordOAuthConfigured()) {
      if (!code || !state) {
        return res.status(400).type('html').send(renderAuthCallbackPage(false));
      }

      const expectedState = req.cookies?.[DISCORD_OAUTH_STATE_COOKIE_NAME] as string | undefined;
      res.clearCookie(DISCORD_OAUTH_STATE_COOKIE_NAME, { path: '/api/auth' });

      if (!expectedState || expectedState !== state) {
        return res.status(400).type('html').send(renderAuthCallbackPage(false));
      }

      try {
        const user = await loginWithDiscordCode(code);
        const token = issueSessionToken(user);
        res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions());
        setCsrfCookie(res, issueCsrfToken(user.id));
        return res.type('html').send(renderAuthCallbackPage(true));
      } catch {
        return res.status(400).type('html').send(renderAuthCallbackPage(false));
      }
    }

    if (!DEV_AUTH_ENABLED) {
      return denyDevAuth(res);
    }

    if (!code) {
      return res.status(400).type('html').send(renderAuthCallbackPage(false));
    }

    const user = buildDevUserFromCode(code);
    const token = issueSessionToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions());
    setCsrfCookie(res, issueCsrfToken(user.id));
    return res.type('html').send(renderAuthCallbackPage(true));
  });

  return router;
}
