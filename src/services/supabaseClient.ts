import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, SUPABASE_FETCH_TIMEOUT_MS } from '../config';

import { fetchWithTimeout } from '../utils/network';

let cachedClient: SupabaseClient | null = null;

const withTimeoutFetch: typeof fetch = (input, init) =>
  fetchWithTimeout(String(input), init ?? {}, SUPABASE_FETCH_TIMEOUT_MS);

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
