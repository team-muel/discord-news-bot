import type { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME, RESEARCH_PRESET_ADMIN_USER_IDS } from '../config';
import { parseSessionToken } from '../services/authService';

const adminAllowlist = new Set(
  RESEARCH_PRESET_ADMIN_USER_IDS.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

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

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  if (adminAllowlist.size === 0) {
    return res.status(503).json({ error: 'CONFIG', message: 'RESEARCH_PRESET_ADMIN_USER_IDS is not configured' });
  }

  if (!adminAllowlist.has(req.user.id)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  next();
}
