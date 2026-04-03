import logger from '../logger';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { isSchemaUnavailableError } from '../utils/supabaseErrors';

let missingInfrastructureLogged = false;

const isMissingInfraError = (error: any): boolean => isSchemaUnavailableError(error, 'api_rate_limits', 'acquire_rate_limit');

export const consumeSupabaseRateLimit = async (params: {
  key: string;
  windowMs: number;
  max: number;
}): Promise<{ ok: boolean; allowed: boolean; retryAfterSec: number }> => {
  const safeWindowMs = Math.max(1_000, Math.trunc(params.windowMs));
  const safeMax = Math.max(1, Math.trunc(params.max));

  if (!isSupabaseConfigured()) {
    return { ok: false, allowed: true, retryAfterSec: 1 };
  }

  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / safeWindowMs) * safeWindowMs;
  const windowEndMs = windowStartMs + safeWindowMs;

  try {
    const db = getSupabaseClient();
    const { data, error } = await db.rpc('acquire_rate_limit', {
      p_key: params.key,
      p_window_start: new Date(windowStartMs).toISOString(),
      p_window_end: new Date(windowEndMs).toISOString(),
      p_max: safeMax,
    });

    if (error) {
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const allowed = Boolean((row as any)?.allowed);
    const retryAfterSec = Math.max(1, Number((row as any)?.retry_after_sec || 1));

    return {
      ok: true,
      allowed,
      retryAfterSec,
    };
  } catch (error) {
    if (!missingInfrastructureLogged && isMissingInfraError(error)) {
      missingInfrastructureLogged = true;
      logger.error('[RATE_LIMIT] Supabase infra missing (api_rate_limits/acquire_rate_limit). Falling back to memory limiter.');
      return { ok: false, allowed: true, retryAfterSec: 1 };
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[RATE_LIMIT] Supabase limiter failed, fallback to memory: %s', message);
    return { ok: false, allowed: true, retryAfterSec: 1 };
  }
};
