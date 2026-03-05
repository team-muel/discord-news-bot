import { Router } from 'express';
import { appendBenchmarkEvents, summarizeReconnectEvents, type BenchmarkEventRecord } from '../services/benchmarkStore';

export function createBenchmarkRouter(): Router {
  const router = Router();

  router.post('/events', (req, res) => {
    const events = Array.isArray(req.body?.events) ? (req.body.events as BenchmarkEventRecord[]) : [];
    appendBenchmarkEvents(events);
    return res.status(202).json({ accepted: events.length });
  });

  router.get('/summary', (_req, res) => {
    const reconnect = summarizeReconnectEvents();
    return res.json({ reconnect });
  });

  return router;
}
