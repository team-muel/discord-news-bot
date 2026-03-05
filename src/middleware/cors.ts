import type express from 'express';

export const createCorsMiddleware = (allowlist: string[]): express.RequestHandler => {
  return (req, res, next) => {
    const origin = req.get('origin');
    const isAllowed = !origin || allowlist.length === 0 || allowlist.includes(origin);

    if (isAllowed) {
      if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
      }
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Headers', 'Content-Type, x-csrf-token');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    next();
  };
};
