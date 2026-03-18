/* eslint-disable no-console */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const base = String(process.env.API_BASE || 'http://localhost:3000').replace(/\/+$/, '');
const idempotencyKey = String(process.env.ROLLBACK_REHEARSAL_IDEMPOTENCY_KEY || `rollback-rehearsal-${Date.now()}`).trim();
const authCookieName = String(process.env.AUTH_COOKIE_NAME || 'muel_session').trim() || 'muel_session';
const jwtSecret = String(process.env.JWT_SECRET || process.env.SESSION_SECRET || 'dev-jwt-secret-change-in-production').trim();
const explicitAdminUserId = String(process.env.ROLLBACK_REHEARSAL_USER_ID || '').trim();
const authUsername = String(process.env.ROLLBACK_REHEARSAL_USERNAME || 'rollback_rehearsal').trim();
const csrfCookieName = String(process.env.AUTH_CSRF_COOKIE_NAME || 'muel_csrf').trim() || 'muel_csrf';

const parseSetCookie = (headers) => {
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  return raw
    .split(/,(?=\s*[^;]+=)/g)
    .map((entry) => entry.split(';')[0].trim())
    .filter(Boolean);
};

const resolveAdminUserId = async () => {
  if (explicitAdminUserId) {
    return explicitAdminUserId;
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
  const allowlistTable = String(process.env.ADMIN_ALLOWLIST_TABLE || 'user_roles').trim();
  const adminRole = String(process.env.ADMIN_ALLOWLIST_ROLE_VALUE || 'admin').trim().toLowerCase();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('ROLLBACK_REHEARSAL_USER_ID_REQUIRED');
  }

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data, error } = await db.from(allowlistTable).select('*').limit(20);
  if (error) {
    throw new Error(`ADMIN_ALLOWLIST_QUERY_FAILED:${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    const role = typeof row.role === 'string' ? row.role.trim().toLowerCase() : adminRole;
    if (role !== adminRole) {
      continue;
    }
    if (row.active === false) {
      continue;
    }

    const candidates = [row.user_id, row.discord_user_id, row.id];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return String(candidate);
      }
    }
  }

  throw new Error('ROLLBACK_REHEARSAL_USER_ID_REQUIRED');
};

const createSessionCookie = (userId) => {
  const token = jwt.sign({
    user: {
      id: userId,
      username: authUsername,
      avatar: null,
    },
  }, jwtSecret, {
    expiresIn: 60 * 60,
  });
  return `${authCookieName}=${token}`;
};

const mergeCookie = (cookieHeader, setCookieEntries) => {
  const map = new Map();
  for (const item of String(cookieHeader || '').split(';').map((v) => v.trim()).filter(Boolean)) {
    const [name, ...rest] = item.split('=');
    if (!name || rest.length === 0) continue;
    map.set(name, `${name}=${rest.join('=')}`);
  }
  for (const entry of setCookieEntries) {
    const [name, ...rest] = String(entry).split('=');
    if (!name || rest.length === 0) continue;
    map.set(name, `${name}=${rest.join('=')}`);
  }
  return [...map.values()].join('; ');
};

const fetchJson = async (url, init = {}) => {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, json, text };
};

async function run() {
  const adminUserId = await resolveAdminUserId();
  let cookie = createSessionCookie(adminUserId);

  const me = await fetchJson(`${base}/api/auth/me`, {
    headers: { cookie },
  });
  if (!me.response.ok) {
    throw new Error(`AUTH_ME_FAILED ${me.response.status}`);
  }

  cookie = mergeCookie(cookie, parseSetCookie(me.response.headers));
  const csrfHeaderName = String(me.json?.csrfHeaderName || process.env.AUTH_CSRF_HEADER_NAME || 'x-csrf-token').trim();
  const csrfTokenFromBody = String(me.json?.csrfToken || '').trim();
  const csrfTokenFromCookie = String(cookie.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${csrfCookieName}=`)) || '').split('=')[1] || '';
  const csrfToken = csrfTokenFromBody || csrfTokenFromCookie;
  if (!csrfToken) {
    throw new Error('CSRF_TOKEN_MISSING');
  }

  const before = await fetchJson(`${base}/api/bot/status`, {
    headers: { cookie },
  });
  if (!before.response.ok) {
    throw new Error(`STATUS_BEFORE_FAILED ${before.response.status}`);
  }

  const reconnect = await fetchJson(`${base}/api/bot/reconnect`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      [csrfHeaderName]: csrfToken,
    },
    body: JSON.stringify({ reason: 'stage-rollback-rehearsal' }),
  });

  if (![202, 409].includes(reconnect.response.status)) {
    throw new Error(`RECONNECT_UNEXPECTED_STATUS ${reconnect.response.status}`);
  }

  const replay = await fetchJson(`${base}/api/bot/reconnect`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      [csrfHeaderName]: csrfToken,
    },
    body: JSON.stringify({ reason: 'stage-rollback-rehearsal' }),
  });

  if (![202, 409].includes(replay.response.status)) {
    throw new Error(`RECONNECT_REPLAY_UNEXPECTED_STATUS ${replay.response.status}`);
  }

  const after = await fetchJson(`${base}/api/bot/status`, {
    headers: { cookie },
  });
  if (!after.response.ok) {
    throw new Error(`STATUS_AFTER_FAILED ${after.response.status}`);
  }

  const result = {
    timestamp: new Date().toISOString(),
    base,
    adminUserId,
    idempotencyKey,
    statusBefore: before.response.status,
    reconnectStatus: reconnect.response.status,
    reconnectReplayStatus: replay.response.status,
    replayHeader: replay.response.headers.get('Idempotency-Replayed') || '',
    statusAfter: after.response.status,
    beforeGrade: before.json?.statusGrade || null,
    afterGrade: after.json?.statusGrade || null,
    reconnectPayload: reconnect.json || reconnect.text,
    replayPayload: replay.json || replay.text,
  };

  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error('[rollback-rehearsal] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
