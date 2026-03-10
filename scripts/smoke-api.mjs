/* eslint-disable no-console */

const base = process.env.API_BASE || 'http://localhost:3000';

async function assertOk(response, label) {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${label} failed: ${response.status} ${response.statusText} ${body}`.trim());
  }
}

async function main() {
  console.log(`[smoke] base=${base}`);

  const cookieJar = [];
  const fetchWithCookie = async (path, init = {}) => {
    const headers = new Headers(init.headers || {});
    if (cookieJar.length) {
      headers.set('cookie', cookieJar.join('; '));
    }
    const res = await fetch(`${base}${path}`, { ...init, headers, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const token = setCookie.split(';')[0];
      const [name] = token.split('=');
      const filtered = cookieJar.filter((item) => !item.startsWith(`${name}=`));
      filtered.push(token);
      cookieJar.length = 0;
      cookieJar.push(...filtered);
    }
    return res;
  };

  const unauthMe = await fetch(`${base}/api/auth/me`);
  if (unauthMe.status !== 401) {
    throw new Error(`GET /api/auth/me expected 401 before login, got ${unauthMe.status}`);
  }

  const unauthBotStatus = await fetch(`${base}/api/bot/status`);
  if (unauthBotStatus.status !== 401) {
    throw new Error(`GET /api/bot/status expected 401 before login, got ${unauthBotStatus.status}`);
  }

  const health = await fetch(`${base}/health`);
  await assertOk(health, 'GET /health');
  const healthJson = await health.json();
  if (!healthJson || typeof healthJson !== 'object') {
    throw new Error('GET /health invalid payload');
  }
  if (!['ok', 'degraded'].includes(healthJson.status)) {
    throw new Error('GET /health missing status');
  }
  if (!['healthy', 'degraded', 'offline'].includes(healthJson.botStatusGrade)) {
    throw new Error('GET /health missing botStatusGrade');
  }

  await assertOk(await fetch(`${base}/api/status`), 'GET /api/status');

  const fred = await fetch(`${base}/api/fred/playground?ids=UNRATE,CPIAUCSL,FEDFUNDS&range=3Y`);
  await assertOk(fred, 'GET /api/fred/playground');
  const fredJson = await fred.json();
  if (fredJson?.source !== 'backend') {
    throw new Error('GET /api/fred/playground missing source=backend');
  }
  if (!Array.isArray(fredJson?.catalog) || fredJson.catalog.length < 1) {
    throw new Error('GET /api/fred/playground missing catalog');
  }
  if (!Array.isArray(fredJson?.series) || fredJson.series.length < 1) {
    throw new Error('GET /api/fred/playground missing series');
  }
  const firstSeries = fredJson.series[0];
  if (!Array.isArray(firstSeries?.points) || firstSeries.points.length < 2) {
    throw new Error('GET /api/fred/playground missing series points');
  }

  const sdk = await fetchWithCookie('/api/auth/sdk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'smoke-user' }),
  });
  await assertOk(sdk, 'POST /api/auth/sdk');

  const me = await fetchWithCookie('/api/auth/me');
  await assertOk(me, 'GET /api/auth/me');
  const meJson = await me.json();
  const csrfToken = String(meJson?.csrfToken || '');
  const csrfHeaderName = String(meJson?.csrfHeaderName || 'x-csrf-token');
  if (!csrfToken) {
    throw new Error('GET /api/auth/me missing csrfToken');
  }

  const logoutWithoutCsrf = await fetchWithCookie('/api/auth/logout', { method: 'POST' });
  if (logoutWithoutCsrf.status !== 403) {
    throw new Error(`POST /api/auth/logout without csrf expected 403, got ${logoutWithoutCsrf.status}`);
  }

  await assertOk(await fetchWithCookie('/api/research/preset/embedded'), 'GET /api/research/preset/embedded');
  const botStatus = await fetchWithCookie('/api/bot/status');
  await assertOk(botStatus, 'GET /api/bot/status');
  const botJson = await botStatus.json();
  if (!['healthy', 'degraded', 'offline'].includes(botJson.statusGrade)) {
    throw new Error('GET /api/bot/status missing statusGrade');
  }
  if (!Array.isArray(botJson.recommendations)) {
    throw new Error('GET /api/bot/status missing recommendations');
  }
  if (typeof botJson.outageDurationMs !== 'number') {
    throw new Error('GET /api/bot/status missing outageDurationMs');
  }

  await assertOk(await fetchWithCookie('/api/benchmark/summary'), 'GET /api/benchmark/summary');

  const logout = await fetchWithCookie('/api/auth/logout', {
    method: 'POST',
    headers: {
      [csrfHeaderName]: csrfToken,
    },
  });
  if (logout.status !== 204) {
    throw new Error(`POST /api/auth/logout expected 204, got ${logout.status}`);
  }

  console.log('[smoke] OK');
}

main().catch((error) => {
  console.error('[smoke] FAIL', error.message);
  process.exit(1);
});
