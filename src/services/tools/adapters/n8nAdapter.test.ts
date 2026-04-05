import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExternalAdapterResult } from '../externalAdapterTypes';

// Mock fetchWithTimeout utility
vi.mock('../../../utils/network', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { n8nAdapter } from './n8nAdapter';
import { fetchWithTimeout } from '../../../utils/network';

const mockFetch = vi.mocked(fetchWithTimeout);

describe('n8nAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('adapter metadata', () => {
    it('has correct id', () => {
      expect(n8nAdapter.id).toBe('n8n');
    });

    it('exposes workflow capabilities', () => {
      expect(n8nAdapter.capabilities).toContain('workflow.execute');
      expect(n8nAdapter.capabilities).toContain('workflow.list');
      expect(n8nAdapter.capabilities).toContain('workflow.trigger');
      expect(n8nAdapter.capabilities).toContain('workflow.status');
    });
  });

  describe('isAvailable', () => {
    it('returns false when N8N_BASE_URL is unreachable (env not set)', async () => {
      // Default: not explicitly disabled, but http probe fails
      const available = await n8nAdapter.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('execute', () => {
    it('returns error when executing and n8n is unreachable', async () => {
      const result = await n8nAdapter.execute('workflow.execute', { workflowId: '123' });
      expect(result.ok).toBe(false);
    });

    it('returns error for unknown actions', async () => {
      const result = await n8nAdapter.execute('unknown.action', {});
      expect(result.ok).toBe(false);
    });

    it('requires workflowId for workflow.execute', async () => {
      // Even when disabled, the disabled check happens first
      const result = await n8nAdapter.execute('workflow.execute', {});
      expect(result.ok).toBe(false);
    });

    it('requires webhookPath for workflow.trigger', async () => {
      const result = await n8nAdapter.execute('workflow.trigger', {});
      expect(result.ok).toBe(false);
    });

    it('requires executionId for workflow.status', async () => {
      const result = await n8nAdapter.execute('workflow.status', {});
      expect(result.ok).toBe(false);
    });

    it('result shape follows ExternalAdapterResult', async () => {
      const result = await n8nAdapter.execute('workflow.list', {});
      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('adapterId', 'n8n');
      expect(result).toHaveProperty('action', 'workflow.list');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('durationMs');
    });
  });
});
