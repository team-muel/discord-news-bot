import express, { Express } from 'express';

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/', (_req, res) => res.send('Muel bot server running'));

  return app;
}

export default createApp;
