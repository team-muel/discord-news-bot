/* eslint-disable no-console */
import 'dotenv/config';

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const parseBool = (name, fallback = false) => {
  const raw = String(parseArg(name, fallback ? 'true' : 'false')).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const parseNum = (name, fallback) => {
  const raw = String(parseArg(name, '')).trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const printUsage = () => {
  console.log([
    'Usage: node scripts/check-runtime-control-plane.mjs [options]',
    '',
    'Options:',
    '  --base=<url>           API base URL (default: API_BASE or http://localhost:3000)',
    '  --cookie=<cookie>      Admin session cookie (name=value or raw token)',
    '  --guildId=<id>         Optional guildId for readiness/slo checks',
    '  --strict=<bool>        Fail if admin session cookie is missing (default: true)',
    '  --timeoutMs=<ms>       Per-request timeout (default: 15000)',
    '  --help=true            Show this usage text',
  ].join('\n'));
};

if (parseBool('help', false) || process.argv.includes('--help')) {
  printUsage();
  process.exit(0);
}

const base = String(parseArg('base', process.env.API_BASE || 'http://localhost:3000')).replace(/\/+$/, '');
const authCookieName = String(process.env.AUTH_COOKIE_NAME || 'muel_session').trim() || 'muel_session';
const adminCookieInput = String(parseArg('cookie', process.env.ADMIN_COOKIE || '')).trim();
const adminCookie = adminCookieInput
  ? (adminCookieInput.includes('=') ? adminCookieInput : `${authCookieName}=${adminCookieInput}`)
  : '';
const guildId = String(parseArg('guildId', process.env.RUNTIME_CHECK_GUILD_ID || '')).trim();
const strict = parseBool('strict', true);
const timeoutMs = Math.max(1000, parseNum('timeoutMs', 15000));

const failures = [];
const warnings = [];

const timedFetch = async (path, requiresAuth = false) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers();
    if (requiresAuth && adminCookie) {
      headers.set('cookie', adminCookie);
    }
    const response = await fetch(`${base}${path}`, { headers, signal: controller.signal });
    const raw = await response.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json, raw };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: null,
      raw: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const addFailure = (message) => failures.push(message);
const addWarning = (message) => warnings.push(message);

const expectObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addFailure(`${label}: object payload expected`);
    return false;
  }
  return true;
};

const main = async () => {
  console.log(`[runtime-check] base=${base} strict=${strict} guildId=${guildId || 'n/a'}`);

  const health = await timedFetch('/health');
  if (!health.ok) {
    addFailure(`/health failed: ${health.status || 'request-error'} ${health.error || health.raw}`.trim());
  } else if (!['ok', 'degraded'].includes(String(health.json?.status || ''))) {
    addFailure('/health missing expected status');
  }

  const ready = await timedFetch('/ready');
  if (!ready.ok) {
    addFailure(`/ready failed: ${ready.status || 'request-error'} ${ready.error || ready.raw}`.trim());
  }

  if (!adminCookie) {
    const message = 'admin session cookie missing; authenticated runtime control-plane checks cannot run';
    if (strict) {
      addFailure(message);
    } else {
      addWarning(message);
    }
  }

  if (adminCookie) {
    const botStatus = await timedFetch('/api/bot/status', true);
    if (!botStatus.ok) {
      addFailure(`/api/bot/status failed: ${botStatus.status} ${botStatus.raw}`.trim());
    } else if (!['healthy', 'degraded', 'offline'].includes(String(botStatus.json?.statusGrade || ''))) {
      addFailure('/api/bot/status missing statusGrade');
    }

    const scheduler = await timedFetch('/api/bot/agent/runtime/scheduler-policy', true);
    if (!scheduler.ok) {
      addFailure(`/api/bot/agent/runtime/scheduler-policy failed: ${scheduler.status} ${scheduler.raw}`.trim());
    } else if (expectObject(scheduler.json?.snapshot, 'scheduler snapshot')) {
      const snapshot = scheduler.json.snapshot;
      const items = Array.isArray(snapshot.items) ? snapshot.items : [];
      const byId = new Map(items.map((item) => [item.id, item]));
      const expectStartup = [
        ['opencode-publish-worker', 'service-init'],
        ['trading-engine', 'service-init'],
        ['runtime-alerts', 'service-init'],
        ['obsidian-sync-loop', 'discord-ready'],
        ['retrieval-eval-loop', 'discord-ready'],
        ['supabase-maintenance-cron', 'database'],
      ];

      for (const [id, startup] of expectStartup) {
        const item = byId.get(id);
        if (!item) {
          addFailure(`scheduler-policy missing item: ${id}`);
          continue;
        }
        if (item.startup !== startup) {
          addFailure(`scheduler-policy startup mismatch for ${id}: expected ${startup}, got ${item.startup}`);
        }
      }

      const memoryRunner = byId.get('memory-job-runner');
      if (!memoryRunner) {
        addFailure('scheduler-policy missing item: memory-job-runner');
      } else if (!['service-init', 'discord-ready'].includes(String(memoryRunner.startup || ''))) {
        addFailure(`scheduler-policy invalid startup for memory-job-runner: ${memoryRunner.startup}`);
      }

      const loginCleanup = byId.get('login-session-cleanup');
      if (!loginCleanup) {
        addFailure('scheduler-policy missing item: login-session-cleanup');
      } else if (!['discord-ready', 'database'].includes(String(loginCleanup.startup || ''))) {
        addFailure(`scheduler-policy invalid startup for login-session-cleanup: ${loginCleanup.startup}`);
      }

      if (!expectObject(snapshot.summary, 'scheduler summary')) {
        addFailure('scheduler-policy missing summary');
      }
    }

    const loops = await timedFetch('/api/bot/agent/runtime/loops', true);
    if (!loops.ok) {
      addFailure(`/api/bot/agent/runtime/loops failed: ${loops.status} ${loops.raw}`.trim());
    } else {
      const loopPayload = loops.json;
      if (!expectObject(loopPayload?.memoryJobRunner, 'memoryJobRunner')) {
        addFailure('loops missing memoryJobRunner');
      }
      if (!expectObject(loopPayload?.obsidianLoreSyncLoop, 'obsidianLoreSyncLoop')) {
        addFailure('loops missing obsidianLoreSyncLoop');
      }
      if (!expectObject(loopPayload?.retrievalEvalLoop, 'retrievalEvalLoop')) {
        addFailure('loops missing retrievalEvalLoop');
      }
    }

    const unattendedPath = guildId
      ? `/api/bot/agent/runtime/unattended-health?guildId=${encodeURIComponent(guildId)}`
      : '/api/bot/agent/runtime/unattended-health';
    const unattended = await timedFetch(unattendedPath, true);
    if (!unattended.ok) {
      addFailure(`/api/bot/agent/runtime/unattended-health failed: ${unattended.status} ${unattended.raw}`.trim());
    } else {
      if (!expectObject(unattended.json?.telemetry, 'unattended telemetry')) {
        addFailure('unattended-health missing telemetry');
      }
      if (guildId && unattended.json?.opencodeReadiness == null) {
        addWarning('unattended-health missing guild-scoped opencodeReadiness');
      }
    }

    if (guildId) {
      const readiness = await timedFetch(`/api/bot/agent/runtime/readiness?guildId=${encodeURIComponent(guildId)}`, true);
      if (!readiness.ok) {
        addFailure(`/api/bot/agent/runtime/readiness failed: ${readiness.status} ${readiness.raw}`.trim());
      }

      const slo = await timedFetch(`/api/bot/agent/runtime/slo/report?guildId=${encodeURIComponent(guildId)}`, true);
      if (!slo.ok) {
        addFailure(`/api/bot/agent/runtime/slo/report failed: ${slo.status} ${slo.raw}`.trim());
      }
    } else {
      addWarning('guildId not provided; readiness and SLO report checks were skipped');
    }
  }

  const result = {
    timestamp: new Date().toISOString(),
    base,
    strict,
    guildId: guildId || null,
    authCookieName,
    failures,
    warnings,
    ok: failures.length === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(failures.length > 0 ? 1 : 0);
};

main().catch((error) => {
  console.error('[runtime-check] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});