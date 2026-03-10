import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { FRONTEND_ORIGIN, JSON_BODY_LIMIT, NODE_ENV } from './config';
import { attachUser, requireCsrfForStateChange } from './middleware/auth';
import { createAuthRouter } from './routes/auth';
import { createBenchmarkRouter } from './routes/benchmark';
import { createBotRouter } from './routes/bot';
import { createFredRouter } from './routes/fred';
import { createHealthRouter } from './routes/health';
import { createQuantRouter } from './routes/quant';
import { createResearchRouter } from './routes/research';
import { createTradingRouter } from './routes/trading';
import { createTradesRouter } from './routes/trades';

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
      origin: frontendOrigins.length > 0 ? frontendOrigins : true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());
  app.use(attachUser);
  app.use(requireCsrfForStateChange);

  // Frontend popup callbacks often target /auth/callback without /api.
  app.get('/auth/callback', (req, res) => {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(`/api/auth/callback${query}`);
  });

  app.use(createHealthRouter());
  app.use('/api/auth', createAuthRouter());
  app.use('/api/research', createResearchRouter());
  app.use('/api/fred', createFredRouter());
  app.use('/api/quant', createQuantRouter());
  app.use('/api/bot', createBotRouter());
  app.use('/api/benchmark', createBenchmarkRouter());
  app.use('/api/trades', createTradesRouter());
  app.use('/api/trading', createTradingRouter());

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  return app;
}

export default createApp;
