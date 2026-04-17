import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockIsSupabaseConfigured,
  mockGetSupabaseClient,
  mockFrom,
} = vi.hoisted(() => ({
  mockIsSupabaseConfigured: vi.fn(() => true),
  mockGetSupabaseClient: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: mockIsSupabaseConfigured,
  getSupabaseClient: mockGetSupabaseClient,
}));

type QueryResult = { data: unknown; error: { message?: string } | null };

const createAwaitableChain = (result: QueryResult) => {
  const chain = {
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };

  return chain;
};

describe('actionGovernanceStore persistence fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('lists approval requests from in-memory fallback when create persistence fails under configured Supabase', async () => {
    const insertFailure = createAwaitableChain({ data: null, error: { message: 'insert failed' } });
    const listEmpty = createAwaitableChain({ data: [], error: null });
    mockFrom
      .mockReturnValueOnce(insertFailure)
      .mockReturnValueOnce(listEmpty);
    mockGetSupabaseClient.mockReturnValue({ from: mockFrom });

    const store = await import('./actionGovernanceStore');
    const created = await store.createActionApprovalRequest({
      guildId: 'guild-fallback',
      requestedBy: 'user-1',
      goal: 'Run a risky action',
      actionName: 'implement.execute',
      actionArgs: { ticket: 'A-1' },
    });

    const listed = await store.listActionApprovalRequests({ guildId: 'guild-fallback', limit: 10 });

    expect(created.status).toBe('pending');
    expect(listed.map((row) => row.id)).toContain(created.id);
    expect(listed[0]).toMatchObject({
      guildId: 'guild-fallback',
      actionName: 'implement.execute',
      status: 'pending',
    });
  });

  it('can approve an in-memory fallback request when the DB lookup misses it', async () => {
    const insertFailure = createAwaitableChain({ data: null, error: { message: 'insert failed' } });
    const lookupMiss = createAwaitableChain({ data: null, error: null });
    const listEmpty = createAwaitableChain({ data: [], error: null });
    mockFrom
      .mockReturnValueOnce(insertFailure)
      .mockReturnValueOnce(lookupMiss)
      .mockReturnValueOnce(listEmpty);
    mockGetSupabaseClient.mockReturnValue({ from: mockFrom });

    const store = await import('./actionGovernanceStore');
    const created = await store.createActionApprovalRequest({
      guildId: 'guild-fallback-approve',
      requestedBy: 'user-2',
      goal: 'Approve a fallback request',
      actionName: 'implement.execute',
      actionArgs: { ticket: 'A-2' },
    });

    const decided = await store.decideActionApprovalRequest({
      requestId: created.id,
      decision: 'approve',
      actorId: 'admin-1',
      reason: 'approved during db outage',
    });
    const listed = await store.listActionApprovalRequests({
      guildId: 'guild-fallback-approve',
      status: 'approved',
      limit: 10,
    });

    expect(decided).toMatchObject({
      id: created.id,
      status: 'approved',
      approvedBy: 'admin-1',
      reason: 'approved during db outage',
    });
    expect(listed.map((row) => row.id)).toContain(created.id);
  });

  it('can fetch an in-memory fallback request when the DB lookup misses it', async () => {
    const insertFailure = createAwaitableChain({ data: null, error: { message: 'insert failed' } });
    const lookupMiss = createAwaitableChain({ data: null, error: null });
    mockFrom
      .mockReturnValueOnce(insertFailure)
      .mockReturnValueOnce(lookupMiss);
    mockGetSupabaseClient.mockReturnValue({ from: mockFrom });

    const store = await import('./actionGovernanceStore');
    const created = await store.createActionApprovalRequest({
      guildId: 'guild-fallback-get',
      requestedBy: 'user-3',
      goal: 'Fetch a fallback request',
      actionName: 'n8n.workflow.install',
      actionArgs: { workflow: 'starter' },
    });

    const fetched = await store.getActionApprovalRequest(created.id);

    expect(fetched).toMatchObject({
      id: created.id,
      guildId: 'guild-fallback-get',
      actionName: 'n8n.workflow.install',
      status: 'pending',
    });
  });
});