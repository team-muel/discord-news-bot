import express from 'express';
import jwt from 'jsonwebtoken';
import type { AuthenticatedRequest, JwtUser } from '../types';

type CookieSecurity = {
  secure: boolean;
  sameSite: 'none' | 'lax';
};

type SessionAuthDeps = {
  authCookieName: string;
  csrfCookieName: string;
  jwtSecret: string;
  cookieSecurity: CookieSecurity;
};

export const createSessionAuth = ({ authCookieName, csrfCookieName, jwtSecret, cookieSecurity }: SessionAuthDeps) => {
  const issueAuthCookie = (res: express.Response, jwtPayload: JwtUser) => {
    const token = jwt.sign(jwtPayload, jwtSecret, { expiresIn: '7d' });
    res.cookie(authCookieName, token, {
      httpOnly: true,
      secure: cookieSecurity.secure,
      sameSite: cookieSecurity.sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    const csrfToken = jwt.sign({ t: 'csrf', u: jwtPayload.id }, jwtSecret, { expiresIn: '7d' });
    res.cookie(csrfCookieName, csrfToken, {
      httpOnly: false,
      secure: cookieSecurity.secure,
      sameSite: cookieSecurity.sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  };

  const requireAuth: express.RequestHandler = (req, res, next) => {
    const token = req.cookies?.[authCookieName];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as JwtUser;
      (req as AuthenticatedRequest).user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Session expired' });
    }
  };

  const requireCsrf: express.RequestHandler = (req, res, next) => {
    const csrfCookie = req.cookies?.[csrfCookieName];
    const csrfHeader = req.get('x-csrf-token');
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
  };

  const requireAuthAndCsrf: express.RequestHandler = (req, res, next) => {
    requireAuth(req, res, (authErr) => {
      if (authErr) return next(authErr);
      requireCsrf(req, res, next);
    });
  };

  return {
    issueAuthCookie,
    requireAuth,
    requireCsrf,
    requireAuthAndCsrf,
  };
};
