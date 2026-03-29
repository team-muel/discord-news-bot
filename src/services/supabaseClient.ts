import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../config';

import { parseIntegerEnv } from '../utils/env';

let cachedClient: SupabaseClient | null = null;
const SUPABASE_FETCH_TIMEOUT_MS = Math.max(1_000, parseIntegerEnv(process.env.SUPABASE_FETCH_TIMEOUT_MS, 12_000));

const withTimeoutFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);

  // Compose with caller's signal so both timeout and external abort work
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  try {
    return await fetch(input, { ...init, signal });
  } finally {
    clearTimeout(timeout);
  }
};

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { fetch: withTimeoutFetch },
    });
  }

  return cachedClient;
}
