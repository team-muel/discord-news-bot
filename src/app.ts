import express from 'express';
import jwt from 'jsonwebtoken';
import { applyCommonMiddleware } from './middleware/common';
import { createAuthRouter } from './routes/auth';
import { createCrawlerRouter } from './routes/crawler';
import { createBenchmarkRouter } from './routes/benchmark';
import { createBotRouter } from './routes/bot';
import { createResearchRouter } from './routes/research';
import { createAppRouter } from './routes/app';
import { detectRuntimeEnvironment, getCookieSecurity } from './backend/runtimeEnvironment';
import { supabase, isSupabaseConfigured } from './backend/supabase';
import { client, createForumThread, logEvent, getBotRuntimeStatus, evaluateBotRuntimeStatus, getBotNextCheckInSec, forceBotReconnect } from './bot';
import { getResolvedResearchPreset, isResearchPresetKey } from './content/researchContent';
import { isResolvedResearchPreset } from './lib/researchPresetValidation';
import { getReconnectFailureReason, toReconnectResult } from './lib/reconnectTelemetry';
import { createCrawlerRuntimeRegistry } from './backend/registry/crawlerRuntimeRegistry';
import { summarizeBenchmarkEvents } from './backend/benchmark/types';
import { isBackendFeatureEnabled } from './backend/registry/externalFeatureRegistry';
import { JwtUser, AuthenticatedRequest } from './types';
import { imageUrlToBase64, truncateText, MAX_SOURCES_PER_GUILD, DEFAULT_PAGE_LIMIT, getSafeErrorMessage, validateYouTubeUrl } from './utils';
import { scrapeYouTubePost } from './scraper';

const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'muel_auth';
const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'csrf_token';
const OAUTH_NONCE_COOKIE_NAME = process.env.OAUTH_NONCE_COOKIE_NAME || 'oauth_nonce';
const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-insecure-secret';
const OAUTH_NONCE_MAX_AGE_MS = Number(process.env.OAUTH_NONCE_MAX_AGE_MS || 10 * 60 * 1000);
const DEFAULT_DISCORD_TOKEN_EXPIRES_IN_SEC = Number(process.env.DEFAULT_DISCORD_TOKEN_EXPIRES_IN_SEC || 3600);
const PRESET_HISTORY_DEFAULT_LIMIT = Number(process.env.PRESET_HISTORY_DEFAULT_LIMIT || 20);
const PRESET_HISTORY_MIN_LIMIT = Number(process.env.PRESET_HISTORY_MIN_LIMIT || 1);
const PRESET_HISTORY_MAX_LIMIT = Number(process.env.PRESET_HISTORY_MAX_LIMIT || 50);
const BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS = Number(process.env.BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS || 60000);

const isAllowedRedirectUri = (redirectUri: string, req: express.Request) => {
  if (!redirectUri) return false;

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  const allowlistRaw = process.env.OAUTH_REDIRECT_ALLOWLIST || '';
  const allowlist = allowlistRaw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const runtimeAllowed = new Set<string>(allowlist);
  if (process.env.APP_BASE_URL) {
    runtimeAllowed.add(process.env.APP_BASE_URL.trim());
  }

  const requestOrigin = req.get('origin');
  if (requestOrigin) {
    runtimeAllowed.add(requestOrigin);
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

export function createApp() {
  const app = express();
  const runtime = detectRuntimeEnvironment();
  const cookieSecurity = getCookieSecurity(runtime);
  const benchmarkMemoryStore = new Map<string, Array<{ id: string; name: string; payload?: Record<string, string | number | boolean | null | undefined>; path: string; ts: string }>>();
  const botStatusViewBenchmarkLastAt = new Map<string, number>();

  applyCommonMiddleware(app);

  app.use((req, res, next) => {
    const origin = req.get('origin');
    const allowlistRaw = process.env.CORS_ALLOWLIST || process.env.OAUTH_REDIRECT_ALLOWLIST || '';
    const allowlist = allowlistRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!origin || allowlist.length === 0 || allowlist.includes(origin)) {
      if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
      }
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Headers', 'Content-Type, x-csrf-token');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    next();
  });

  const issueAuthCookie = (res: express.Response, jwtPayload: JwtUser) => {
    const token = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: '7d' });
    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: cookieSecurity.secure,
      sameSite: cookieSecurity.sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    const csrfToken = jwt.sign({ t: 'csrf', u: jwtPayload.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      secure: cookieSecurity.secure,
      sameSite: cookieSecurity.sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  };

  const requireAuth: express.RequestHandler = (req, res, next) => {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtUser;
      (req as AuthenticatedRequest).user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Session expired' });
    }
  };

  const requireCsrf: express.RequestHandler = (req, res, next) => {
    const csrfCookie = req.cookies?.[CSRF_COOKIE_NAME];
    const csrfHeader = req.get('x-csrf-token');
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
  };

  const requireAuthAndCsrf: express.RequestHandler = (req, res, next) => {
    requireAuth(req, res, (authErr) => {
      if (authErr) return next(authErr);
      requireCsrf(req, res, next);
    });
  };

  const appendBenchmarkMemoryEvents = (userId: string, events: Array<{ id: string; name: string; payload?: Record<string, string | number | boolean | null | undefined>; path: string; ts: string }>) => {
    const existing = benchmarkMemoryStore.get(userId) || [];
    const merged = [...existing, ...events].slice(-1200);
    benchmarkMemoryStore.set(userId, merged);
  };

  const appendServerBenchmarkEvent = async ({
    userId,
    name,
    path,
    payload,
  }: {
    userId: string;
    name: string;
    path: string;
    payload?: Record<string, string | number | boolean | null | undefined>;
  }) => {
    const event = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name,
      payload,
      path,
      ts: new Date().toISOString(),
    };

    if (isSupabaseConfigured) {
      const { error } = await supabase.from('benchmark_events').insert({
        user_id: userId,
        event_id: event.id,
        name: event.name,
        payload: event.payload || {},
        path: event.path,
        created_at: event.ts,
      });

      if (!error) {
        return;
      }
    }

    appendBenchmarkMemoryEvents(userId, [event]);
  };

  const loadResearchPresetFromSupabase = async (presetKey: string) => {
    if (!isSupabaseConfigured) return null;

    const { data, error } = await supabase
      .from('research_presets')
      .select('payload')
      .eq('preset_key', presetKey)
      .maybeSingle<{ payload: unknown }>();

    if (error || !data?.payload) {
      return null;
    }

    return isResolvedResearchPreset(data.payload) ? data.payload : null;
  };

  const appendResearchPresetAudit = async (row: {
    preset_key: string;
    actor_user_id: string;
    actor_username: string;
    source: 'upsert' | 'restore';
    payload: ReturnType<typeof getResolvedResearchPreset>;
    metadata?: Record<string, string | number | boolean | null>;
    created_at: string;
  }) => {
    if (!isSupabaseConfigured) {
      return;
    }

    await supabase.from('research_preset_audit').insert(row);
  };

  const refreshDiscordTokenIfNeeded = async (user: JwtUser): Promise<JwtUser | null> => {
    const nowSec = Math.floor(Date.now() / 1000);
    if (!user.accessToken) return null;
    if (!user.tokenExpiresAt || user.tokenExpiresAt - nowSec > 60) return user;
    if (!user.refreshToken) return null;

    try {
      const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID || '',
          client_secret: process.env.DISCORD_CLIENT_SECRET || '',
          grant_type: 'refresh_token',
          refresh_token: user.refreshToken,
        }),
      });

      const body = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (!body.access_token) {
        return null;
      }

      return {
        ...user,
        accessToken: body.access_token,
        refreshToken: body.refresh_token || user.refreshToken,
        tokenExpiresAt: nowSec + Number(body.expires_in || DEFAULT_DISCORD_TOKEN_EXPIRES_IN_SEC),
      };
    } catch {
      return null;
    }
  };

  const crawlerRegistry = createCrawlerRuntimeRegistry({
    isSupabaseConfigured,
    supabase,
    client,
    scrapeYouTubePost,
    createForumThread,
    logEvent,
    imageUrlToBase64,
    truncateText,
    validateYouTubeUrl,
    getSafeErrorMessage,
    maxSourcesPerGuild: MAX_SOURCES_PER_GUILD,
    defaultPageLimit: DEFAULT_PAGE_LIMIT,
  });

  app.use(
    createAuthRouter({
      runtime,
      isSupabaseConfigured,
      requireAuth,
      requireCsrf,
      issueAuthCookie,
      isAllowedRedirectUri,
      authCookieName: AUTH_COOKIE_NAME,
      csrfCookieName: CSRF_COOKIE_NAME,
      oauthNonceCookieName: OAUTH_NONCE_COOKIE_NAME,
      oauthNonceMaxAgeMs: OAUTH_NONCE_MAX_AGE_MS,
      defaultDiscordTokenExpiresInSec: DEFAULT_DISCORD_TOKEN_EXPIRES_IN_SEC,
      discordOauthTokenUrl: 'https://discord.com/api/oauth2/token',
      discordApiMeUrl: 'https://discord.com/api/users/@me',
    }),
  );

  app.use(
    createAppRouter({
      requireAuth,
      requireAuthAndCsrf,
      isSupabaseConfigured,
      client,
      refreshDiscordTokenIfNeeded,
      issueAuthCookie,
      discordApiGuildsUrl: 'https://discord.com/api/users/@me/guilds',
      discordPermissionAdmin: BigInt(0x8),
      discordPermissionManageGuild: BigInt(0x20),
    }),
  );

  app.use(
    createCrawlerRouter({
      requireAuth,
      requireAuthAndCsrf,
      isBackendFeatureEnabled,
      crawlerRegistry,
    }),
  );

  app.use(
    createBenchmarkRouter({
      requireAuth,
      requireAuthAndCsrf,
      isSupabaseConfigured,
      benchmarkMemoryStore,
      appendBenchmarkMemoryEvents,
    }),
  );

  app.use(
    createResearchRouter({
      requireAuth,
      requireAuthAndCsrf,
      requirePresetAdmin: requireAuth,
      isSupabaseConfigured,
      isResearchPresetKey,
      getResolvedResearchPreset,
      loadResearchPresetFromSupabase,
      isResolvedResearchPreset,
      appendResearchPresetAudit,
      appendServerBenchmarkEvent,
      presetHistoryDefaultLimit: PRESET_HISTORY_DEFAULT_LIMIT,
      presetHistoryMinLimit: PRESET_HISTORY_MIN_LIMIT,
      presetHistoryMaxLimit: PRESET_HISTORY_MAX_LIMIT,
    }),
  );

  app.use(
    createBotRouter({
      requireAuth,
      requireAuthAndCsrf,
      requirePresetAdmin: requireAuth,
      getBotRuntimeStatus,
      evaluateBotRuntimeStatus,
      getBotNextCheckInSec,
      forceBotReconnect,
      getReconnectFailureReason,
      toReconnectResult,
      appendServerBenchmarkEvent,
      botStatusViewBenchmarkLastAt,
      botStatusBenchmarkMinIntervalMs: 5000,
      botStatusViewBenchmarkIntervalMs: BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS,
      defaultReconnectReason: 'manual',
      reconnectReasonMaxLength: 120,
      botReconnectFailureStatus: 503,
    }),
  );

  app.get('/health', (_req, res) => {
    const bot = getBotRuntimeStatus();
    const status = bot.tokenPresent && !bot.ready ? 'degraded' : 'ok';
    res.status(status === 'ok' ? 200 : 503).json({
      status,
      botReady: bot.ready,
      botStatusGrade: evaluateBotRuntimeStatus(bot).grade,
      uptimeSec: Math.floor(process.uptime()),
      now: new Date().toISOString(),
    });
  });

  app.get('/api/benchmark/memory-summary', requireAuth, (req: AuthenticatedRequest, res) => {
    const events = benchmarkMemoryStore.get(req.user.id) || [];
    return res.json({
      ...summarizeBenchmarkEvents(events),
      source: 'memory',
    });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const safeMsg = getSafeErrorMessage(err, 'express_error_handler');
    res.status(500).json({ error: safeMsg });
  });

  return app;
}
