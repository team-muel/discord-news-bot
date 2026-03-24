import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseClient: vi.fn(() => { throw new Error('SUPABASE_NOT_CONFIGURED'); }),
}));

import { withSupabase, normalizeDbError, getClient } from './baseRepository';

describe('baseRepository', () => {
  describe('withSupabase', () => {
    it('returns NOT_CONFIGURED when Supabase is not configured', async () => {
      const result = await withSupabase(async () => 'should not reach');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('NOT_CONFIGURED');
      }
    });
  });

  describe('getClient', () => {
    it('throws when Supabase is not configured', () => {
      expect(() => getClient()).toThrow('SUPABASE_NOT_CONFIGURED');
    });
  });

  describe('normalizeDbError', () => {
    it('returns message from Error objects', () => {
      expect(normalizeDbError(new Error('test error'))).toBe('test error');
    });

    it('returns string errors as-is', () => {
      expect(normalizeDbError('raw string error')).toBe('raw string error');
    });

    it('extracts message from Postgrest-style errors', () => {
      const pgError = { code: '42P01', message: 'relation does not exist', details: null, hint: null };
      expect(normalizeDbError(pgError)).toBe('relation does not exist');
    });

    it('extracts details when message is missing', () => {
      const pgError = { code: '23503', details: 'Key (user_id)=(xyz) is not present in table users' };
      expect(normalizeDbError(pgError)).toBe('Key (user_id)=(xyz) is not present in table users');
    });

    it('returns fallback for null/undefined', () => {
      expect(normalizeDbError(null)).toBe('Unknown database error');
      expect(normalizeDbError(undefined)).toBe('Unknown database error');
    });

    it('stringifies unknown objects', () => {
      expect(normalizeDbError(42)).toBe('42');
    });
  });
});
