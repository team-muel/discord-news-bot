import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AUTH_COOKIE_NAME, AUTH_CSRF_COOKIE_NAME, JWT_SECRET, NODE_ENV } from '../config';
import type { JwtUser } from '../types/auth';

type SessionToken = { user: JwtUser };

const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

export function buildDevUserFromCode(code?: string): JwtUser {
  const safeCode = (code || 'guest').slice(0, 24).replace(/[^a-zA-Z0-9_-]/g, '') || 'guest';
  return {
    id: `dev-${safeCode}`,
    username: `dev_${safeCode}`,
    avatar: null,
  };
}

export function issueSessionToken(user: JwtUser): string {
  return jwt.sign({ user } satisfies SessionToken, JWT_SECRET, { expiresIn: SESSION_TTL_SEC });
}

export function parseSessionToken(token?: string): JwtUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as SessionToken;
    if (!payload?.user?.id || !payload?.user?.username) return null;
    return payload.user;
  } catch {
    return null;
  }
}

export function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: NODE_ENV === 'production',
    maxAge: SESSION_TTL_SEC * 1000,
    path: '/',
  };
}

export function clearSessionCookie(res: { clearCookie: (name: string, options: Record<string, unknown>) => void }) {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
}

export function issueCsrfToken(userId: string): string {
  const nonce = crypto.randomBytes(24).toString('hex');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${nonce}:${userId}`).digest('hex');
  return `${nonce}.${sig}`;
}

export function verifyCsrfToken(token: string, userId: string): boolean {
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) return false;
  const nonce = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!nonce || !sig) return false;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${nonce}:${userId}`).digest('hex');
  if (!/^[0-9a-f]+$/i.test(sig) || sig.length !== expected.length) {
    return false;
  }

  const received = Buffer.from(sig, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (received.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(received, expectedBuffer);
}

export function getCsrfCookieOptions() {
  return {
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: NODE_ENV === 'production',
    maxAge: SESSION_TTL_SEC * 1000,
    path: '/',
  };
}

export function setCsrfCookie(
  res: { cookie: (name: string, value: string, options: Record<string, unknown>) => void },
  token: string,
) {
  res.cookie(AUTH_CSRF_COOKIE_NAME, token, getCsrfCookieOptions());
}

export function clearCsrfCookie(res: { clearCookie: (name: string, options: Record<string, unknown>) => void }) {
  res.clearCookie(AUTH_CSRF_COOKIE_NAME, { path: '/' });
}
