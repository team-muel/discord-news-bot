import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { appendBenchmarkEvents, summarizeReconnectEvents, type BenchmarkEventRecord } from '../services/benchmarkStore';

export function createBenchmarkRouter(): Router {
  const router = Router();

  router.post('/events', requireAuth, (req, res) => {
    const events = Array.isArray(req.body?.events) ? (req.body.events as BenchmarkEventRecord[]) : [];
    appendBenchmarkEvents(events);
    return res.status(202).json({ accepted: events.length });
  });

  router.get('/summary', requireAuth, (_req, res) => {
    const reconnect = summarizeReconnectEvents();
    return res.json({ reconnect });
  });

  return router;
}
