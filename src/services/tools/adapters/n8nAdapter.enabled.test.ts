import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mock for fetchWithTimeout ──────────────────────────────────────
const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock('../../../utils/network', () => ({
  fetchWithTimeout: mockFetch,
}));

vi.mock('../../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('n8nAdapter — enabled path', () => {
  let envFixup: Record<string, string | undefined> = {};

  beforeEach(() => {
    mockFetch.mockReset();
    vi.resetModules();
    envFixup = {
      N8N_ENABLED: process.env.N8N_ENABLED,
      N8N_BASE_URL: process.env.N8N_BASE_URL,
      N8N_API_KEY: process.env.N8N_API_KEY,
      N8N_TIMEOUT_MS: process.env.N8N_TIMEOUT_MS,
    };
    process.env.N8N_ENABLED = 'true';
    process.env.N8N_BASE_URL = 'http://n8n.test:5678';
    process.env.N8N_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envFixup)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  // ── isAvailable ──────────────────────────────────────────────────────

  describe('isAvailable', () => {
    it('returns true when healthz returns ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const { n8nAdapter } = await import('./n8nAdapter');
      expect(await n8nAdapter.isAvailable()).toBe(true);
    });

    it('falls back to /api/v1/workflows if healthz fails', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))  // healthz fails
        .mockResolvedValueOnce({ ok: true });              // workflows endpoint succeeds
      const { n8nAdapter } = await import('./n8nAdapter');
      expect(await n8nAdapter.isAvailable()).toBe(true);
    });

    it('returns true for 401 (n8n running but wrong key)', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ ok: false, status: 401 });
      const { n8nAdapter } = await import('./n8nAdapter');
      expect(await n8nAdapter.isAvailable()).toBe(true);
    });

    it('returns false when both health probes fail', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'));
      const { n8nAdapter } = await import('./n8nAdapter');
      expect(await n8nAdapter.isAvailable()).toBe(false);
    });
  });

  // ── workflow.execute ─────────────────────────────────────────────────

  describe('workflow.execute', () => {
    it('returns MISSING_WORKFLOW_ID when no workflowId', async () => {
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.execute', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('MISSING_WORKFLOW_ID');
    });

    it('executes workflow and returns ok on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'exec-1', finished: true }),
      });

      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.execute', { workflowId: 'wf-123', data: { input: 'test' } });
      expect(result.ok).toBe(true);
      expect(result.summary).toContain('wf-123');

      // Verify URL
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://n8n.test:5678/api/v1/executions');
    });

    it('returns error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'internal error' }),
      });

      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.execute', { workflowId: 'wf-1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('HTTP_500');
    });

    it('falls back to webhook execution when /api/v1/executions is not supported', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 405,
          json: async () => ({ message: 'Method not allowed' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'wf-123',
            nodes: [{
              type: 'n8n-nodes-base.webhook',
              parameters: {
                path: 'muel/news-rss-fetch',
                httpMethod: 'POST',
              },
            }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ items: [{ title: 'news item' }] }),
        });

      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.execute', { workflowId: 'wf-123', data: { query: 'bitcoin' } });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('webhook fallback');
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://n8n.test:5678/api/v1/workflows/wf-123',
        expect.objectContaining({ method: 'GET' }),
        30000,
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://n8n.test:5678/webhook/muel/news-rss-fetch',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ query: 'bitcoin' }) }),
        30000,
      );
    });

    it('returns EXECUTION_ERROR on exception', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network down'));
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.execute', { workflowId: 'wf-1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('EXECUTION_ERROR');
    });
  });

  // ── workflow.list ────────────────────────────────────────────────────

  describe('workflow.list', () => {
    it('lists workflows on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: '1', name: 'RSS Fetch' }] }),
      });

      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.list', { limit: 5 });
      expect(result.ok).toBe(true);
      expect(result.summary).toBe('Workflows listed');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('limit=5');
      expect(url).toContain('active=true');
    });

    it('clamps limit to [1, 100]', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200, json: async () => ({ data: [] }),
      });

      const { n8nAdapter } = await import('./n8nAdapter');
      await n8nAdapter.execute('workflow.list', { limit: 999 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('limit=100');
    });

    it('returns error on fetch exception', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'));
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.list', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('LIST_ERROR');
    });
  });

  // ── workflow.trigger ─────────────────────────────────────────────────

  describe('workflow.trigger', () => {
    it('returns MISSING_WEBHOOK_PATH when empty', async () => {
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.trigger', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('MISSING_WEBHOOK_PATH');
    });

    it('rejects invalid webhook path (path traversal attempt)', async () => {
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.trigger', { webhookPath: '../../../etc/passwd' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_WEBHOOK_PATH');
    });

    it('rejects webhook path with special characters', async () => {
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.trigger', { webhookPath: 'test?payload=evil' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_WEBHOOK_PATH');
    });

    it('triggers webhook on valid path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200, json: async () => ({ success: true }),
      });

      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.trigger', {
        webhookPath: 'muel/news-rss',
        data: { query: 'crypto' },
        method: 'POST',
      });

      expect(result.ok).toBe(true);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://n8n.test:5678/webhook/muel/news-rss');
    });

    it('rejects invalid HTTP method', async () => {
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.trigger', { webhookPath: 'test', method: 'DELETE' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_METHOD');
    });

    it('returns TRIGGER_ERROR on exception', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.trigger', { webhookPath: 'muel/test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('TRIGGER_ERROR');
    });
  });

  // ── workflow.status ──────────────────────────────────────────────────

  describe('workflow.status', () => {
    it('returns MISSING_EXECUTION_ID when empty', async () => {
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.status', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('MISSING_EXECUTION_ID');
    });

    it('returns execution status on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200, json: async () => ({ id: 'exec-1', status: 'success', finished: true }),
      });

      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.status', { executionId: 'exec-1' });
      expect(result.ok).toBe(true);
      expect(result.summary).toContain('exec-1');
    });

    it('returns STATUS_ERROR on exception', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'));
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('workflow.status', { executionId: 'x' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('STATUS_ERROR');
    });
  });

  // ── Unknown action ───────────────────────────────────────────────────

  describe('unknown action', () => {
    it('returns UNKNOWN_ACTION', async () => {
      const { n8nAdapter } = await import('./n8nAdapter');
      const result = await n8nAdapter.execute('something.else', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('UNKNOWN_ACTION');
    });
  });
});
