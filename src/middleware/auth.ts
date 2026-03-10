import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME, AUTH_CSRF_COOKIE_NAME, AUTH_CSRF_HEADER_NAME } from '../config';
import { parseSessionToken } from '../services/authService';
import { getAdminAllowlist } from '../services/adminAllowlistService';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
  req.user = parseSessionToken(token) || undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  next();
}

export function requireCsrfForStateChange(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) {
    return next();
  }

  if (!req.user) {
    return next();
  }

  const headerName = AUTH_CSRF_HEADER_NAME.toLowerCase();
  const headerToken = String(req.headers[headerName] || '').trim();
  const cookieToken = String(req.cookies?.[AUTH_CSRF_COOKIE_NAME] || '').trim();

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'CSRF', message: 'CSRF token missing or invalid' });
  }

  return next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const adminAllowlist = await getAdminAllowlist();

    if (adminAllowlist.size === 0) {
      return res.status(503).json({ error: 'CONFIG', message: 'No admin allowlist source is configured' });
    }

    if (!adminAllowlist.has(req.user.id)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(503).json({ error: 'CONFIG', message });
  }

  next();
}
