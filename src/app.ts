import express from 'express';
import { applyCommonMiddleware } from './middleware/common';
import { createCorsMiddleware } from './middleware/cors';
import { createSessionAuth } from './auth/session';
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
import { serverConfig, buildCorsAllowlist, isAllowedRedirectUri } from './config/serverConfig';
import { createBenchmarkMemoryStore } from './lib/benchmarkStore';

export function createApp() {
  const app = express();
  const runtime = detectRuntimeEnvironment();
  const cookieSecurity = getCookieSecurity(runtime);
  const { store: benchmarkMemoryStore, appendBenchmarkMemoryEvents, getUserBenchmarkEvents } = createBenchmarkMemoryStore();
  const botStatusViewBenchmarkLastAt = new Map<string, number>();
  const corsAllowlist = buildCorsAllowlist();

  applyCommonMiddleware(app);
  app.use(createCorsMiddleware(corsAllowlist));

  const { issueAuthCookie, requireAuth, requireCsrf, requireAuthAndCsrf } = createSessionAuth({
    authCookieName: serverConfig.authCookieName,
    csrfCookieName: serverConfig.csrfCookieName,
    jwtSecret: serverConfig.jwtSecret,
    cookieSecurity,
  });

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
        tokenExpiresAt: nowSec + Number(body.expires_in || serverConfig.defaultDiscordTokenExpiresInSec),
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
      authCookieName: serverConfig.authCookieName,
      csrfCookieName: serverConfig.csrfCookieName,
      oauthNonceCookieName: serverConfig.oauthNonceCookieName,
      oauthNonceMaxAgeMs: serverConfig.oauthNonceMaxAgeMs,
      defaultDiscordTokenExpiresInSec: serverConfig.defaultDiscordTokenExpiresInSec,
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
      presetHistoryDefaultLimit: serverConfig.presetHistoryDefaultLimit,
      presetHistoryMinLimit: serverConfig.presetHistoryMinLimit,
      presetHistoryMaxLimit: serverConfig.presetHistoryMaxLimit,
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
      botStatusViewBenchmarkIntervalMs: serverConfig.botStatusViewBenchmarkIntervalMs,
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
    const events = getUserBenchmarkEvents(req.user.id);
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
