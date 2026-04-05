import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import logger from '../logger';
import {
  API_IDEMPOTENCY_TABLE,
  API_IDEMPOTENCY_TTL_SEC,
  API_IDEMPOTENCY_REQUIRE_HEADER,
} from '../config';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient';

type IdempotencyState = 'in_progress' | 'completed';

type IdempotencyRecord = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  state: IdempotencyState;
  responseCode: number | null;
  responseJson: unknown;
  createdAt: number;
  expiresAt: number;
};

const TABLE = API_IDEMPOTENCY_TABLE;
const DEFAULT_TTL_SEC = API_IDEMPOTENCY_TTL_SEC;
const REQUIRE_HEADER_DEFAULT = API_IDEMPOTENCY_REQUIRE_HEADER;

const MEMORY_STORE_MAX = 5_000;
const memoryStore = new Map<string, IdempotencyRecord>();

const nowMs = () => Date.now();

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(',')}}`;
};

const toHash = (value: string): string => {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
};

const toRecordKey = (scope: string, key: string) => `${scope}::${key}`;

const garbageCollectMemory = () => {
  const now = nowMs();
  for (const [key, record] of memoryStore.entries()) {
    if (record.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
};

const getMemoryRecord = (scope: string, key: string): IdempotencyRecord | null => {
  garbageCollectMemory();
  const hit = memoryStore.get(toRecordKey(scope, key));
  if (!hit) {
    return null;
  }
  if (hit.expiresAt <= nowMs()) {
    memoryStore.delete(toRecordKey(scope, key));
    return null;
  }
  return hit;
};

const claimMemoryRecord = (params: {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  ttlSec: number;
}): { ok: true } | { ok: false; record: IdempotencyRecord } => {
  const existing = getMemoryRecord(params.scope, params.idempotencyKey);
  if (existing) {
    return { ok: false, record: existing };
  }

  if (memoryStore.size >= MEMORY_STORE_MAX) {
    garbageCollectMemory();
  }

  const current = nowMs();
  memoryStore.set(toRecordKey(params.scope, params.idempotencyKey), {
    scope: params.scope,
    idempotencyKey: params.idempotencyKey,
    requestHash: params.requestHash,
    state: 'in_progress',
    responseCode: null,
    responseJson: null,
    createdAt: current,
    expiresAt: current + (params.ttlSec * 1000),
  });
  return { ok: true };
};

const completeMemoryRecord = (params: {
  scope: string;
  idempotencyKey: string;
  responseCode: number;
  responseJson: unknown;
}) => {
  const key = toRecordKey(params.scope, params.idempotencyKey);
  const hit = memoryStore.get(key);
  if (!hit) {
    return;
  }
  hit.state = 'completed';
  hit.responseCode = params.responseCode;
  hit.responseJson = params.responseJson;
  memoryStore.set(key, hit);
};

const releaseMemoryRecord = (scope: string, key: string) => {
  memoryStore.delete(toRecordKey(scope, key));
};

const useSupabaseStore = () => isSupabaseConfigured();

const readSupabaseRecord = async (scope: string, key: string): Promise<IdempotencyRecord | null> => {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from(TABLE)
    .select('scope,idempotency_key,request_hash,state,response_code,response_json,created_at,expires_at')
    .eq('scope', scope)
    .eq('idempotency_key', key)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return {
    scope: String((data as { scope?: string }).scope || scope),
    idempotencyKey: String((data as { idempotency_key?: string }).idempotency_key || key),
    requestHash: String((data as { request_hash?: string }).request_hash || ''),
    state: String((data as { state?: string }).state || 'in_progress') === 'completed' ? 'completed' : 'in_progress',
    responseCode: Number((data as { response_code?: number }).response_code ?? 0) || null,
    responseJson: (data as { response_json?: unknown }).response_json ?? null,
    createdAt: Date.parse(String((data as { created_at?: string }).created_at || '')) || 0,
    expiresAt: Date.parse(String((data as { expires_at?: string }).expires_at || '')) || 0,
  };
};

const claimSupabaseRecord = async (params: {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  ttlSec: number;
}): Promise<{ ok: true } | { ok: false; record: IdempotencyRecord | null }> => {
  const db = getSupabaseClient();
  const expiresAt = new Date(nowMs() + (params.ttlSec * 1000)).toISOString();

  const { error } = await db
    .from(TABLE)
    .insert({
      scope: params.scope,
      idempotency_key: params.idempotencyKey,
      request_hash: params.requestHash,
      state: 'in_progress',
      response_code: null,
      response_json: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: expiresAt,
    });

  if (!error) {
    return { ok: true };
  }

  const conflict = String((error as { code?: string }).code || '') === '23505';
  if (conflict) {
    const existing = await readSupabaseRecord(params.scope, params.idempotencyKey);
    return { ok: false, record: existing };
  }
  throw error;
};

const completeSupabaseRecord = async (params: {
  scope: string;
  idempotencyKey: string;
  responseCode: number;
  responseJson: unknown;
}) => {
  const db = getSupabaseClient();
  const { error } = await db
    .from(TABLE)
    .update({
      state: 'completed',
      response_code: params.responseCode,
      response_json: params.responseJson,
      updated_at: new Date().toISOString(),
    })
    .eq('scope', params.scope)
    .eq('idempotency_key', params.idempotencyKey);
  if (error) {
    throw error;
  }
};

const releaseSupabaseRecord = async (scope: string, key: string) => {
  const db = getSupabaseClient();
  const { error } = await db
    .from(TABLE)
    .delete()
    .eq('scope', scope)
    .eq('idempotency_key', key)
    .eq('state', 'in_progress');
  if (error) {
    throw error;
  }
};

const handleExistingRecord = (res: Response, record: IdempotencyRecord, requestHash: string) => {
  if (record.requestHash && record.requestHash !== requestHash) {
    return res.status(409).json({ ok: false, error: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' });
  }

  if (record.state === 'completed') {
    res.setHeader('Idempotency-Replayed', 'true');
    return res.status(record.responseCode || 200).json(record.responseJson ?? { ok: true });
  }

  return res.status(409).json({ ok: false, error: 'IDEMPOTENCY_IN_PROGRESS', retryAfterSec: 2 });
};

export const createIdempotencyGuard = (params: {
  scope: string;
  ttlSec?: number;
  requireHeader?: boolean;
}) => {
  const scope = String(params.scope || '').trim();
  if (!scope) {
    throw new Error('IDEMPOTENCY_SCOPE_REQUIRED');
  }
  const ttlSec = Math.max(60, Number(params.ttlSec || DEFAULT_TTL_SEC));
  const requireHeader = typeof params.requireHeader === 'boolean' ? params.requireHeader : REQUIRE_HEADER_DEFAULT;

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (!key) {
      if (requireHeader) {
        return res.status(400).json({ ok: false, error: 'IDEMPOTENCY_KEY_REQUIRED' });
      }
      return next();
    }

    const requester = String(req.user?.id || req.ip || 'anonymous').trim();
    const fingerprint = toHash([
      String(req.method || '').toUpperCase(),
      String(req.path || '').trim(),
      requester,
      stableStringify(req.body || {}),
    ].join('|'));

    try {
      if (useSupabaseStore()) {
        const claimResult = await claimSupabaseRecord({
          scope,
          idempotencyKey: key,
          requestHash: fingerprint,
          ttlSec,
        });

        if (!claimResult.ok) {
          if (!claimResult.record) {
            return res.status(409).json({ ok: false, error: 'IDEMPOTENCY_CONFLICT' });
          }
          return handleExistingRecord(res, claimResult.record, fingerprint);
        }
      } else {
        const claimResult = claimMemoryRecord({
          scope,
          idempotencyKey: key,
          requestHash: fingerprint,
          ttlSec,
        });
        if (!claimResult.ok) {
          return handleExistingRecord(res, claimResult.record, fingerprint);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[IDEMPOTENCY] store unavailable, bypassing guard scope=%s err=%s', scope, message);
      return next();
    }

    let responseBody: unknown = null;

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      responseBody = body;
      return originalJson(body);
    }) as Response['json'];

    const originalSend = res.send.bind(res);
    res.send = ((body?: unknown) => {
      if (responseBody === null) {
        responseBody = body ?? null;
      }
      return originalSend(body as never);
    }) as Response['send'];

    res.once('finish', () => {
      const responseCode = Number(res.statusCode || 500);
      const isSuccessLike = responseCode < 500;

      void (async () => {
        try {
          if (useSupabaseStore()) {
            if (isSuccessLike) {
              await completeSupabaseRecord({
                scope,
                idempotencyKey: key,
                responseCode,
                responseJson: responseBody,
              });
            } else {
              await releaseSupabaseRecord(scope, key);
            }
          } else if (isSuccessLike) {
            completeMemoryRecord({
              scope,
              idempotencyKey: key,
              responseCode,
              responseJson: responseBody,
            });
          } else {
            releaseMemoryRecord(scope, key);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn('[IDEMPOTENCY] finalize failed scope=%s err=%s', scope, message);
        }
      })();
    });

    return next();
  };
};
