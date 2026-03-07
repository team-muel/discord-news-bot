import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME } from '../config';
import { parseSessionToken } from '../services/authService';
import { getAdminAllowlist } from '../services/adminAllowlistService';

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
