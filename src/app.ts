import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { FRONTEND_ORIGIN } from './config';
import { attachUser } from './middleware/auth';
import { createAuthRouter } from './routes/auth';
import { createBenchmarkRouter } from './routes/benchmark';
import { createBotRouter } from './routes/bot';
import { createHealthRouter } from './routes/health';
import { createResearchRouter } from './routes/research';

const buildCorsOrigins = () =>
  (FRONTEND_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export function createApp(): Express {
  const app = express();
  const frontendOrigins = buildCorsOrigins();

  app.use(
    cors({
      origin: frontendOrigins.length > 0 ? frontendOrigins : true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachUser);

  // Frontend popup callbacks often target /auth/callback without /api.
  app.get('/auth/callback', (req, res) => {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(`/api/auth/callback${query}`);
  });

  app.use(createHealthRouter());
  app.use('/api/auth', createAuthRouter());
  app.use('/api/research', createResearchRouter());
  app.use('/api/bot', createBotRouter());
  app.use('/api/benchmark', createBenchmarkRouter());

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  return app;
}

export default createApp;
