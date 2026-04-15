import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRunExternalAction = vi.fn();
const mockGetExternalAdaptersStatus = vi.fn();
const mockGetDelegationStatus = vi.fn();
const mockListN8nLocalWorkflowsViaDockerCli = vi.fn();

vi.mock('../../tools/toolRouter', () => ({
  runExternalAction: (...args: unknown[]) => mockRunExternalAction(...args),
  getExternalAdaptersStatus: () => mockGetExternalAdaptersStatus(),
}));

vi.mock('../../automation/n8nDelegationService', () => ({
  getDelegationStatus: () => mockGetDelegationStatus(),
}));

vi.mock('../../../../scripts/bootstrap-n8n-local.mjs', () => ({
  listN8nLocalWorkflowsViaDockerCli: (...args: unknown[]) => mockListN8nLocalWorkflowsViaDockerCli(...args),
}));

// ─── Default mock returns ─────────────────────────────────────────────────────

const DEFAULT_DELEGATION_STATUS = {
  enabled: true,
  delegationFirst: false,
  n8nCacheAvailable: true,
  tasks: {
    'news-rss-fetch': { configured: true, webhookPath: '***' },
    'news-summarize': { configured: true, webhookPath: '***' },
    'news-monitor-candidates': { configured: false, webhookPath: '' },
    'youtube-feed-fetch': { configured: false, webhookPath: '' },
    'youtube-community-scrape': { configured: false, webhookPath: '' },
    'alert-dispatch': { configured: true, webhookPath: '***' },
    'article-context-fetch': { configured: false, webhookPath: '' },
  },
};

const adapterResult = (ok: boolean, output: string[] = [], error?: string) => ({
  ok,
  adapterId: 'n8n',
  action: 'test',
  summary: ok ? 'ok' : 'fail',
  output,
  error,
  durationMs: 42,
});

describe('n8n agent actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDelegationStatus.mockReturnValue(DEFAULT_DELEGATION_STATUS);
    mockListN8nLocalWorkflowsViaDockerCli.mockReset();
    mockGetExternalAdaptersStatus.mockResolvedValue([
      { id: 'n8n', available: true, capabilities: ['workflow.execute', 'workflow.list', 'workflow.trigger', 'workflow.status'] },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── n8n.status ─────────────────────────────────────────────────────────

  describe('n8nStatusAction', () => {
    it('returns full status when n8n is available', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(true, [
        JSON.stringify({ data: [{ id: '1', name: 'RSS Fetcher', active: true }, { id: '2', name: 'Alert Sender', active: true }] }),
      ]));

      const { n8nStatusAction } = await import('./n8n');
      const result = await n8nStatusAction.execute({ goal: 'n8n 상태 확인' });

      expect(result.ok).toBe(true);
      expect(result.name).toBe('n8n.status');
      expect(result.summary).toContain('정상 연결');
      expect(result.artifacts.join('\n')).toContain('RSS Fetcher');
      expect(result.artifacts.join('\n')).toContain('Alert Sender');
      expect(result.agentRole).toBe('operate');
    });

    it('reports unavailable when n8n adapter is down', async () => {
      mockGetExternalAdaptersStatus.mockResolvedValue([
        { id: 'n8n', available: false, capabilities: [] },
      ]);

      const { n8nStatusAction } = await import('./n8n');
      const result = await n8nStatusAction.execute({ goal: 'n8n status' });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('미연결');
      expect(result.artifacts.join('\n')).toContain('미연결');
    });

    it('shows delegation config', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(false, [], 'ADAPTER_UNAVAILABLE'));
      mockGetExternalAdaptersStatus.mockResolvedValue([
        { id: 'n8n', available: false, capabilities: [] },
      ]);

      const { n8nStatusAction } = await import('./n8n');
      const result = await n8nStatusAction.execute({ goal: 'check' });

      const text = result.artifacts.join('\n');
      expect(text).toContain('위임 활성화: true');
      expect(text).toContain('news-rss-fetch: 설정됨');
      expect(text).toContain('news-monitor-candidates: 미설정');
    });

    it('surfaces missing REST API auth when adapter is reachable but workflow list returns 401', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(false, [], 'HTTP_401'));

      const { n8nStatusAction } = await import('./n8n');
      const result = await n8nStatusAction.execute({ goal: 'check auth' });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('정상 연결');
      expect(result.artifacts.join('\n')).toContain('REST API auth required');
      expect(result.artifacts.join('\n')).toContain('N8N_API_KEY');
    });

    it('falls back to local container CLI when REST API auth is missing', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(false, [], 'HTTP_401'));
      mockListN8nLocalWorkflowsViaDockerCli.mockReturnValue([
        { id: '10', name: 'News Pipeline' },
      ]);

      const { n8nStatusAction } = await import('./n8n');
      const result = await n8nStatusAction.execute({ goal: 'check auth fallback' });

      expect(result.ok).toBe(true);
      expect(result.artifacts.join('\n')).toContain('News Pipeline');
      expect(result.artifacts.join('\n')).toContain('local container CLI fallback');
    });
  });

  // ─── n8n.workflow.list ──────────────────────────────────────────────────

  describe('n8nWorkflowListAction', () => {
    it('lists workflows successfully', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(true, [
        JSON.stringify({ data: [{ id: '10', name: 'News Pipeline', active: true }] }),
      ]));

      const { n8nWorkflowListAction } = await import('./n8n');
      const result = await n8nWorkflowListAction.execute({ goal: 'list workflows', args: { limit: 10 } });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('1건');
      expect(result.artifacts[0]).toContain('[10] News Pipeline');
      expect(mockRunExternalAction).toHaveBeenCalledWith('n8n', 'workflow.list', { limit: 10 });
    });

    it('defaults limit to 25', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(true, ['{"data":[]}']));

      const { n8nWorkflowListAction } = await import('./n8n');
      await n8nWorkflowListAction.execute({ goal: 'list' });

      expect(mockRunExternalAction).toHaveBeenCalledWith('n8n', 'workflow.list', { limit: 25 });
    });

    it('clamps limit to 1-100', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(true, ['{"data":[]}']));

      const { n8nWorkflowListAction } = await import('./n8n');
      await n8nWorkflowListAction.execute({ goal: 'list', args: { limit: 500 } });

      expect(mockRunExternalAction).toHaveBeenCalledWith('n8n', 'workflow.list', { limit: 100 });
    });

    it('returns error when adapter fails', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(false, [], 'ADAPTER_UNAVAILABLE'));

      const { n8nWorkflowListAction } = await import('./n8n');
      const result = await n8nWorkflowListAction.execute({ goal: 'list' });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('ADAPTER_UNAVAILABLE');
    });

    it('falls back to local container CLI when REST API auth is missing', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(false, [], 'HTTP_401'));
      mockListN8nLocalWorkflowsViaDockerCli.mockReturnValue([
        { id: '10', name: 'News Pipeline' },
        { id: '11', name: 'Alert Sender' },
      ]);

      const { n8nWorkflowListAction } = await import('./n8n');
      const result = await n8nWorkflowListAction.execute({ goal: 'list' });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('CLI fallback');
      expect(result.artifacts.join('\n')).toContain('News Pipeline');
      expect(result.artifacts.join('\n')).toContain('N8N_API_KEY');
    });
  });

  // ─── n8n.workflow.execute ───────────────────────────────────────────────

  describe('n8nWorkflowExecuteAction', () => {
    it('executes workflow by ID', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(true, ['{"result":"done"}']));

      const { n8nWorkflowExecuteAction } = await import('./n8n');
      const result = await n8nWorkflowExecuteAction.execute({
        goal: 'run workflow 42',
        args: { workflowId: '42', data: { key: 'value' } },
      });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('42');
      expect(mockRunExternalAction).toHaveBeenCalledWith('n8n', 'workflow.execute', {
        workflowId: '42',
        data: { key: 'value' },
      });
    });

    it('rejects missing workflowId', async () => {
      const { n8nWorkflowExecuteAction } = await import('./n8n');
      const result = await n8nWorkflowExecuteAction.execute({ goal: 'run' });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('MISSING_WORKFLOW_ID');
      expect(mockRunExternalAction).not.toHaveBeenCalled();
    });

    it('rejects invalid workflowId', async () => {
      const { n8nWorkflowExecuteAction } = await import('./n8n');
      const result = await n8nWorkflowExecuteAction.execute({
        goal: 'run',
        args: { workflowId: '../etc/passwd' },
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_WORKFLOW_ID');
      expect(mockRunExternalAction).not.toHaveBeenCalled();
    });

    it('accepts alphanumeric-hyphen workflowIds', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(true, ['{}']));

      const { n8nWorkflowExecuteAction } = await import('./n8n');
      const result = await n8nWorkflowExecuteAction.execute({
        goal: 'run',
        args: { workflowId: 'abc-123_def' },
      });

      expect(result.ok).toBe(true);
    });

    it('returns error on adapter failure', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(false, [], 'HTTP_500'));

      const { n8nWorkflowExecuteAction } = await import('./n8n');
      const result = await n8nWorkflowExecuteAction.execute({
        goal: 'run',
        args: { workflowId: '1' },
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('HTTP_500');
    });
  });

  // ─── n8n.workflow.trigger ───────────────────────────────────────────────

  describe('n8nWorkflowTriggerAction', () => {
    it('triggers webhook with data', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(true, ['{"status":"ok"}']));

      const { n8nWorkflowTriggerAction } = await import('./n8n');
      const result = await n8nWorkflowTriggerAction.execute({
        goal: 'trigger webhook',
        args: { webhookPath: 'news-fetch', data: { query: 'test' } },
      });

      expect(result.ok).toBe(true);
      expect(result.summary).toContain('news-fetch');
      expect(mockRunExternalAction).toHaveBeenCalledWith('n8n', 'workflow.trigger', {
        webhookPath: 'news-fetch',
        data: { query: 'test' },
        method: 'POST',
      });
    });

    it('rejects missing webhookPath', async () => {
      const { n8nWorkflowTriggerAction } = await import('./n8n');
      const result = await n8nWorkflowTriggerAction.execute({ goal: 'trigger' });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('MISSING_WEBHOOK_PATH');
    });

    it('rejects invalid webhook path characters', async () => {
      const { n8nWorkflowTriggerAction } = await import('./n8n');
      const result = await n8nWorkflowTriggerAction.execute({
        goal: 'trigger',
        args: { webhookPath: 'my path/../evil' },
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_WEBHOOK_PATH');
    });

    it('accepts path alias via args.path', async () => {
      mockRunExternalAction.mockResolvedValue(adapterResult(true, ['{}']));

      const { n8nWorkflowTriggerAction } = await import('./n8n');
      const result = await n8nWorkflowTriggerAction.execute({
        goal: 'trigger',
        args: { path: 'my-hook' },
      });

      expect(result.ok).toBe(true);
      expect(mockRunExternalAction).toHaveBeenCalledWith('n8n', 'workflow.trigger', expect.objectContaining({
        webhookPath: 'my-hook',
      }));
    });
  });

  // ─── Action metadata ───────────────────────────────────────────────────

  describe('action metadata', () => {
    it('all n8n actions have category automation', async () => {
      const { n8nStatusAction, n8nWorkflowListAction, n8nWorkflowExecuteAction, n8nWorkflowTriggerAction } = await import('./n8n');

      expect(n8nStatusAction.category).toBe('automation');
      expect(n8nWorkflowListAction.category).toBe('automation');
      expect(n8nWorkflowExecuteAction.category).toBe('automation');
      expect(n8nWorkflowTriggerAction.category).toBe('automation');
    });

    it('actions have correct names', async () => {
      const { n8nStatusAction, n8nWorkflowListAction, n8nWorkflowExecuteAction, n8nWorkflowTriggerAction } = await import('./n8n');

      expect(n8nStatusAction.name).toBe('n8n.status');
      expect(n8nWorkflowListAction.name).toBe('n8n.workflow.list');
      expect(n8nWorkflowExecuteAction.name).toBe('n8n.workflow.execute');
      expect(n8nWorkflowTriggerAction.name).toBe('n8n.workflow.trigger');
    });
  });
});

// ─── Registry integration ─────────────────────────────────────────────────

describe('n8n actions in registry', () => {
  it('all n8n actions are discoverable via listActions', async () => {
    const { listActions } = await import('./registry');
    const actions = listActions();
    const n8nNames = actions.filter((a) => a.name.startsWith('n8n.')).map((a) => a.name);

    expect(n8nNames).toContain('n8n.status');
    expect(n8nNames).toContain('n8n.workflow.list');
    expect(n8nNames).toContain('n8n.workflow.execute');
    expect(n8nNames).toContain('n8n.workflow.trigger');
    expect(n8nNames).toContain('n8n.delegate.news-rss');
    expect(n8nNames).toContain('n8n.delegate.alert');
  });

  it('n8n actions are retrievable by getAction', async () => {
    const { getAction } = await import('./registry');

    expect(getAction('n8n.status')).not.toBeNull();
    expect(getAction('n8n.workflow.list')).not.toBeNull();
    expect(getAction('n8n.workflow.execute')).not.toBeNull();
    expect(getAction('n8n.workflow.trigger')).not.toBeNull();
  });
});
