import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(() => { throw new Error('SUPABASE_NOT_CONFIGURED'); }),
}));

import { getClient } from './baseRepository';

describe('baseRepository', () => {
  describe('getClient', () => {
    it('throws when Supabase is not configured', () => {
      expect(() => getClient()).toThrow('SUPABASE_NOT_CONFIGURED');
    });
  });
});
