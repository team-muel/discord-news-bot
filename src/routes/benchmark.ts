import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import { appendBenchmarkEvents, summarizeReconnectEvents, type BenchmarkEventRecord } from '../services/benchmarkStore';

export function createBenchmarkRouter(): Router {
  const router = Router();

  router.post('/events', requireAdmin, (req, res) => {
    const raw = Array.isArray(req.body?.events) ? req.body.events : [];
    const events: BenchmarkEventRecord[] = [];
    for (const item of raw.slice(0, 100)) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.ts === 'string' &&
        typeof item.path === 'string'
      ) {
        events.push({
          id: item.id.slice(0, 100),
          name: item.name.slice(0, 200),
          ts: item.ts.slice(0, 50),
          path: item.path.slice(0, 500),
          payload: item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
            ? item.payload as BenchmarkEventRecord['payload']
            : undefined,
        });
      }
    }
    appendBenchmarkEvents(events);
    return res.status(202).json({ accepted: events.length });
  });

  router.get('/summary', requireAdmin, (_req, res) => {
    const reconnect = summarizeReconnectEvents();
    return res.json({ reconnect });
  });

  return router;
}
