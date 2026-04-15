import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { FRONTEND_ORIGIN, JSON_BODY_LIMIT, NODE_ENV } from './config';
import { attachUser, requireCsrfForStateChange } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { createAuthRouter } from './routes/auth';
import { createBenchmarkRouter } from './routes/benchmark';
import { createBotRouter } from './routes/bot';
import { createChatRouter } from './routes/chat';
import { createFredRouter } from './routes/fred';
import { createHealthRouter } from './routes/health';
import { createInternalRouter } from './routes/internal';
import { createDashboardRouter } from './routes/dashboard';
import { createMcpRouter } from './routes/mcp';
import { createResearchRouter } from './routes/research';

const buildCorsOrigins = () =>
  (FRONTEND_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export function createApp(): Express {
  const app = express();
  const frontendOrigins = buildCorsOrigins();

  if (NODE_ENV === 'production' && frontendOrigins.length === 0) {
    throw new Error('CORS_ALLOWLIST or FRONTEND_ORIGIN must be configured in production');
  }

  app.use(
    cors({
      origin: frontendOrigins.length > 0 ? frontendOrigins : ['http://localhost:3000', 'http://localhost:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(helmet({
    contentSecurityPolicy: false, // JSON-only API — CSP is a browser rendering concern; set on frontend server
  }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());
  app.use(attachUser);
  app.use(requireCsrfForStateChange);

  // Frontend popup callbacks often target /auth/callback without /api.
  app.get('/auth/callback', (req, res) => {
    const allowed = new Set(['code', 'state', 'error', 'error_description']);
    const filtered = new URLSearchParams();
    for (const [k, v] of new URL(req.url, 'http://localhost').searchParams) {
      if (allowed.has(k)) filtered.set(k, v);
    }
    const qs = filtered.toString();
    return res.redirect(`/api/auth/callback${qs ? `?${qs}` : ''}`);
  });

  app.use(createHealthRouter());
  app.use(createDashboardRouter());
  app.use('/api/internal', createInternalRouter());
  app.use('/api/auth', createAuthRouter());
  app.use('/api/research', createResearchRouter());
  app.use('/api/fred', createFredRouter());
  app.use('/api/bot', createBotRouter());
  app.use('/api/chat', createChatRouter());
  app.use('/api/benchmark', createBenchmarkRouter());
  app.use('/api/mcp', createMcpRouter());

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  // Global error handler — must be registered AFTER all routes and the 404 fallback
  app.use(errorHandler);

  return app;
}

export default createApp;
