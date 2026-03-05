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

  const sdk = await fetchWithCookie('/api/auth/sdk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'smoke-user' }),
  });
  await assertOk(sdk, 'POST /api/auth/sdk');

  await assertOk(await fetchWithCookie('/api/auth/me'), 'GET /api/auth/me');
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

  console.log('[smoke] OK');
}

main().catch((error) => {
  console.error('[smoke] FAIL', error.message);
  process.exit(1);
});
