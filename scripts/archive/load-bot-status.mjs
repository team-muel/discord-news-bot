/* eslint-disable no-console */
import 'dotenv/config';
import jwt from 'jsonwebtoken';

const base = String(process.env.API_BASE || 'http://localhost:3000').replace(/\/+$/, '');
const totalRequests = Math.max(1, Number(process.env.STATUS_LOAD_TOTAL || 200));
const concurrency = Math.max(1, Number(process.env.STATUS_LOAD_CONCURRENCY || 20));
const timeoutMs = Math.max(1000, Number(process.env.STATUS_LOAD_TIMEOUT_MS || 20000));
const authCookieName = String(process.env.AUTH_COOKIE_NAME || 'muel_session').trim() || 'muel_session';
const jwtSecret = String(process.env.JWT_SECRET || process.env.SESSION_SECRET || 'dev-jwt-secret-change-in-production').trim();
const authUserId = String(process.env.STATUS_LOAD_USER_ID || 'status-load-tester').trim();
const authUsername = String(process.env.STATUS_LOAD_USERNAME || 'status_load_tester').trim();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const timedFetch = async (url, init = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, latencyMs: Math.max(0, Date.now() - startedAt), aborted: false };
  } catch (error) {
    return { response: null, latencyMs: Math.max(0, Date.now() - startedAt), aborted: true, error };
  } finally {
    clearTimeout(timer);
  }
};

function createSessionCookie() {
  const token = jwt.sign({
    user: {
      id: authUserId,
      username: authUsername,
      avatar: null,
    },
  }, jwtSecret, {
    expiresIn: 60 * 60,
  });
  return `${authCookieName}=${token}`;
}

async function run() {
  console.log(`[status-load] base=${base} total=${totalRequests} concurrency=${concurrency} timeoutMs=${timeoutMs}`);

  const cookie = await createSessionCookie();
  const queue = Array.from({ length: totalRequests }, (_, i) => i + 1);

  const latencies = [];
  let okCount = 0;
  let failCount = 0;
  let rateLimitedCount = 0;
  let abortedCount = 0;
  const statusCounts = {};

  const worker = async () => {
    while (queue.length > 0) {
      const idx = queue.shift();
      if (!idx) break;

      const { response, latencyMs, aborted } = await timedFetch(`${base}/api/bot/status`, {
        headers: { cookie },
      });

      latencies.push(latencyMs);

      if (aborted || !response) {
        abortedCount += 1;
        failCount += 1;
        continue;
      }

      statusCounts[response.status] = Number(statusCounts[response.status] || 0) + 1;

      if (response.status === 429) {
        rateLimitedCount += 1;
        failCount += 1;
        await sleep(25);
        continue;
      }

      if (!response.ok) {
        failCount += 1;
        continue;
      }

      okCount += 1;
    }
  };

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = Math.max(1, Date.now() - startedAt);

  const result = {
    timestamp: new Date().toISOString(),
    base,
    totalRequests,
    concurrency,
    timeoutMs,
    okCount,
    failCount,
    statusCounts,
    rateLimitedCount,
    abortedCount,
    successRatePct: Number(((okCount / totalRequests) * 100).toFixed(2)),
    throughputRps: Number(((totalRequests / elapsedMs) * 1000).toFixed(2)),
    latency: {
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
      maxMs: latencies.length > 0 ? Math.max(...latencies) : 0,
      avgMs: latencies.length > 0 ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : 0,
    },
  };

  console.log(JSON.stringify(result, null, 2));

  if (result.okCount === 0) {
    process.exit(2);
  }
}

run().catch((error) => {
  console.error('[status-load] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
