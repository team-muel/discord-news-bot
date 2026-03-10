import type { NextFunction, Request, Response } from 'express';
import { consumeSupabaseRateLimit } from '../services/supabaseRateLimitService';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  keyFn?: (req: Request) => string;
  store?: 'memory' | 'supabase';
};

type Bucket = {
  count: number;
  resetAtMs: number;
};

const buckets = new Map<string, Bucket>();

const buildDefaultKey = (req: Request): string => {
  const userId = req.user?.id || 'anon';
  const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
  return `${userId}|${ip}`;
};

export const createRateLimiter = (options: RateLimitOptions) => {
  const windowMs = Math.max(1_000, Math.trunc(options.windowMs));
  const max = Math.max(1, Math.trunc(options.max));
  const prefix = options.keyPrefix || 'global';
  const store = options.store || 'memory';

  const reject = (res: Response, retryAfterSec: number) => {
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: 'RATE_LIMITED', message: `Too many requests. Retry in ${retryAfterSec}s.` });
  };

  const runMemoryLimit = (key: string): { allowed: boolean; retryAfterSec: number } => {
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAtMs <= now) {
      buckets.set(key, { count: 1, resetAtMs: now + windowMs });
      return { allowed: true, retryAfterSec: 1 };
    }

    current.count += 1;
    buckets.set(key, current);

    if (current.count > max) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((current.resetAtMs - now) / 1000)) };
    }

    return { allowed: true, retryAfterSec: 1 };
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const keyCore = (options.keyFn || buildDefaultKey)(req);
    const key = `${prefix}:${keyCore}`;

    if (store === 'supabase') {
      void (async () => {
        const distributed = await consumeSupabaseRateLimit({ key, windowMs, max });
        if (distributed.ok) {
          if (!distributed.allowed) {
            reject(res, distributed.retryAfterSec);
            return;
          }
          next();
          return;
        }

        const local = runMemoryLimit(key);
        if (!local.allowed) {
          reject(res, local.retryAfterSec);
          return;
        }
        next();
      })();
      return;
    }

    const local = runMemoryLimit(key);
    if (!local.allowed) {
      return reject(res, local.retryAfterSec);
    }
    return next();
  };
};
