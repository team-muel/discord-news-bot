import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renderAdapter } from './renderAdapter';

describe('renderAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('adapter metadata', () => {
    it('has correct id', () => {
      expect(renderAdapter.id).toBe('render');
    });

    it('exposes all 15 capabilities', () => {
      expect(renderAdapter.capabilities).toContain('service.list');
      expect(renderAdapter.capabilities).toContain('service.details');
      expect(renderAdapter.capabilities).toContain('deploy.list');
      expect(renderAdapter.capabilities).toContain('deploy.details');
      expect(renderAdapter.capabilities).toContain('deploy.trigger');
      expect(renderAdapter.capabilities).toContain('deploy.rollback');
      expect(renderAdapter.capabilities).toContain('log.query');
      expect(renderAdapter.capabilities).toContain('metrics.get');
      expect(renderAdapter.capabilities).toContain('job.list');
      expect(renderAdapter.capabilities).toContain('job.details');
      expect(renderAdapter.capabilities).toContain('job.create');
      expect(renderAdapter.capabilities).toContain('job.cancel');
      expect(renderAdapter.capabilities).toContain('env.list');
      expect(renderAdapter.capabilities).toContain('env.update');
      expect(renderAdapter.capabilities).toContain('postgres.query');
      expect(renderAdapter.capabilities).toHaveLength(15);
    });

    it('exposes 7 lite capabilities', () => {
      expect(renderAdapter.liteCapabilities).toContain('service.list');
      expect(renderAdapter.liteCapabilities).toContain('service.details');
      expect(renderAdapter.liteCapabilities).toContain('deploy.list');
      expect(renderAdapter.liteCapabilities).toContain('job.list');
      expect(renderAdapter.liteCapabilities).toContain('job.details');
      expect(renderAdapter.liteCapabilities).toContain('log.query');
      expect(renderAdapter.liteCapabilities).toContain('metrics.get');
      expect(renderAdapter.liteCapabilities).toHaveLength(7);
    });
  });

  describe('isAvailable', () => {
    it('returns false when RENDER_API_KEY is not set', async () => {
      // Explicitly clear the key so isAvailable() sees no key and returns early
      vi.stubEnv('RENDER_API_KEY', '');
      const available = await renderAdapter.isAvailable();
      vi.unstubAllEnvs();
      expect(available).toBe(false);
    });
  });

  describe('execute — input validation', () => {
    it('returns error for unknown actions', async () => {
      const result = await renderAdapter.execute('unknown.action', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('UNSUPPORTED_ACTION:unknown.action');
      expect(result.adapterId).toBe('render');
    });

    it('service.details rejects invalid service ID', async () => {
      const result = await renderAdapter.execute('service.details', { serviceId: '../../../etc' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_ID');
    });

    it('deploy.list rejects empty service ID', async () => {
      const result = await renderAdapter.execute('deploy.list', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_ID');
    });

    it('deploy.details rejects invalid deploy ID', async () => {
      const result = await renderAdapter.execute('deploy.details', {
        serviceId: 'srv-abc123',
        deployId: 'invalid id with spaces',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_ID');
    });

    it('deploy.trigger rejects empty service ID', async () => {
      const result = await renderAdapter.execute('deploy.trigger', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_ID');
    });

    it('deploy.rollback rejects invalid deploy ID', async () => {
      const result = await renderAdapter.execute('deploy.rollback', {
        serviceId: 'srv-abc123',
        deployId: 'invalid deploy id',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_ID');
    });

    it('log.query rejects invalid service ID', async () => {
      const result = await renderAdapter.execute('log.query', { serviceId: '!@#$' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_ID');
    });

    it('job.list rejects empty service ID', async () => {
      const result = await renderAdapter.execute('job.list', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_ID');
    });

    it('job.details rejects invalid job ID', async () => {
      const result = await renderAdapter.execute('job.details', {
        serviceId: 'srv-abc123',
        jobId: 'invalid job id',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_ID');
    });

    it('job.create rejects missing startCommand', async () => {
      const result = await renderAdapter.execute('job.create', {
        serviceId: 'srv-abc123',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('EMPTY_START_COMMAND');
    });

    it('job.cancel rejects invalid job ID', async () => {
      const result = await renderAdapter.execute('job.cancel', {
        serviceId: 'srv-abc123',
        jobId: 'invalid job id',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_ID');
    });

    it('env.update rejects empty vars', async () => {
      const result = await renderAdapter.execute('env.update', {
        serviceId: 'srv-abc123',
        vars: [],
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_VARS');
    });

    it('env.update rejects non-array vars', async () => {
      const result = await renderAdapter.execute('env.update', {
        serviceId: 'srv-abc123',
        vars: 'not an array',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_VARS');
    });

    it('postgres.query rejects empty SQL', async () => {
      const result = await renderAdapter.execute('postgres.query', {
        databaseId: 'db-abc123',
        sql: '',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('EMPTY_SQL');
    });

    it('postgres.query blocks write operations (INSERT)', async () => {
      const result = await renderAdapter.execute('postgres.query', {
        databaseId: 'db-abc123',
        sql: 'INSERT INTO users (name) VALUES (\'test\')',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('WRITE_BLOCKED');
    });

    it('postgres.query blocks write operations (DELETE)', async () => {
      const result = await renderAdapter.execute('postgres.query', {
        databaseId: 'db-abc123',
        sql: 'DELETE FROM users WHERE id = 1',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('WRITE_BLOCKED');
    });

    it('postgres.query blocks write operations (DROP)', async () => {
      const result = await renderAdapter.execute('postgres.query', {
        databaseId: 'db-abc123',
        sql: 'DROP TABLE users',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('WRITE_BLOCKED');
    });

    it('postgres.query blocks write operations (UPDATE)', async () => {
      const result = await renderAdapter.execute('postgres.query', {
        databaseId: 'db-abc123',
        sql: 'UPDATE users SET name = \'hacked\'',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('WRITE_BLOCKED');
    });

    it('postgres.query allows SELECT', async () => {
      // Will fail with network error since no real API, but should NOT be blocked by WRITE_BLOCKED
      const result = await renderAdapter.execute('postgres.query', {
        databaseId: 'db-abc123',
        sql: 'SELECT * FROM users LIMIT 10',
      });
      // Should fail with network error, not WRITE_BLOCKED
      expect(result.error).not.toBe('WRITE_BLOCKED');
    });

    it('postgres.query allows WITH (CTE)', async () => {
      const result = await renderAdapter.execute('postgres.query', {
        databaseId: 'db-abc123',
        sql: 'WITH cte AS (SELECT 1) SELECT * FROM cte',
      });
      expect(result.error).not.toBe('WRITE_BLOCKED');
    });
  });

  describe('execute — result shape', () => {
    it('service.list returns correct ExternalAdapterResult shape', async () => {
      const result = await renderAdapter.execute('service.list', {});
      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('adapterId', 'render');
      expect(result).toHaveProperty('action', 'service.list');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('output');
      expect(Array.isArray(result.output)).toBe(true);
      expect(result).toHaveProperty('durationMs');
      expect(typeof result.durationMs).toBe('number');
    });

    it('metrics.get returns correct ExternalAdapterResult shape', async () => {
      const result = await renderAdapter.execute('metrics.get', { serviceId: 'srv-test' });
      expect(result.adapterId).toBe('render');
      expect(result.action).toBe('metrics.get');
    });
  });
});
