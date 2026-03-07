import type express from 'express';

const getNumberEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toTrimmedList = (raw: string) =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toOrigin = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).origin;
    }

    // Allow host-only values in env vars and assume HTTPS for production safety.
    if (/^[a-z0-9.-]+(?::\d+)?$/i.test(trimmed)) {
      return new URL(`https://${trimmed}`).origin;
    }
  } catch {
    return null;
  }

  return null;
};

const toOriginAllowlist = (raw: string) => {
  const allowlist = toTrimmedList(raw)
    .map((item) => toOrigin(item))
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(allowlist));
};

export const serverConfig = {
  authCookieName: process.env.AUTH_COOKIE_NAME || 'muel_auth',
  csrfCookieName: process.env.CSRF_COOKIE_NAME || 'csrf_token',
  oauthNonceCookieName: process.env.OAUTH_NONCE_COOKIE_NAME || 'oauth_nonce',
  jwtSecret: process.env.JWT_SECRET || 'local-dev-insecure-secret',
  oauthNonceMaxAgeMs: getNumberEnv(process.env.OAUTH_NONCE_MAX_AGE_MS, 10 * 60 * 1000),
  defaultDiscordTokenExpiresInSec: getNumberEnv(process.env.DEFAULT_DISCORD_TOKEN_EXPIRES_IN_SEC, 3600),
  presetHistoryDefaultLimit: getNumberEnv(process.env.PRESET_HISTORY_DEFAULT_LIMIT, 20),
  presetHistoryMinLimit: getNumberEnv(process.env.PRESET_HISTORY_MIN_LIMIT, 1),
  presetHistoryMaxLimit: getNumberEnv(process.env.PRESET_HISTORY_MAX_LIMIT, 50),
  botStatusViewBenchmarkIntervalMs: getNumberEnv(process.env.BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS, 60000),
  corsAllowlistRaw: process.env.CORS_ALLOWLIST || process.env.OAUTH_REDIRECT_ALLOWLIST || '',
  oauthRedirectAllowlistRaw: process.env.OAUTH_REDIRECT_ALLOWLIST || '',
  appBaseUrl: process.env.APP_BASE_URL || '',
};

export const buildCorsAllowlist = () => toOriginAllowlist(serverConfig.corsAllowlistRaw);

export const isAllowedRedirectUri = (redirectUri: string, req: express.Request) => {
  if (!redirectUri) return false;

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  const runtimeAllowed = new Set<string>(toOriginAllowlist(serverConfig.oauthRedirectAllowlistRaw));

  if (serverConfig.appBaseUrl) {
    const appBaseOrigin = toOrigin(serverConfig.appBaseUrl);
    if (appBaseOrigin) {
      runtimeAllowed.add(appBaseOrigin);
    }
  }

  const requestOrigin = req.get('origin');
  if (requestOrigin) {
    const requestOriginNormalized = toOrigin(requestOrigin);
    if (requestOriginNormalized) {
      runtimeAllowed.add(requestOriginNormalized);
    }
  }

  const forwardedProto = req.get('x-forwarded-proto') || req.protocol;
  const forwardedHost = req.get('x-forwarded-host') || req.get('host');
  if (forwardedHost) {
    runtimeAllowed.add(`${forwardedProto}://${forwardedHost}`);
  }

  if (runtimeAllowed.size === 0) {
    return true;
  }

  return runtimeAllowed.has(parsed.origin);
};
