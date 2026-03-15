import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(),
}));

import { persistAgentSession } from './agentSessionStore';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import type { AgentSession } from './multiAgentService';

const makeSession = (): AgentSession => ({
  id: 's-1',
  guildId: 'g-1',
  requestedBy: 'u-1',
  goal: 'goal',
  priority: 'balanced',
  requestedSkillId: null,
  routedIntent: 'task',
  status: 'completed',
  createdAt: '2026-03-15T00:00:00.000Z',
  updatedAt: '2026-03-15T00:00:03.000Z',
  startedAt: '2026-03-15T00:00:01.000Z',
  endedAt: '2026-03-15T00:00:03.000Z',
  result: 'ok',
  error: null,
  cancelRequested: false,
  memoryHints: [],
  steps: [
    {
      id: 'step-1',
      role: 'planner',
      title: 'plan',
      status: 'completed',
      startedAt: '2026-03-15T00:00:01.000Z',
      endedAt: '2026-03-15T00:00:02.000Z',
      output: 'done',
      error: null,
    },
  ],
  shadowGraph: {
    sessionId: 's-1',
    guildId: 'g-1',
    requestedBy: 'u-1',
    priority: 'balanced',
    originalGoal: 'goal',
    executionGoal: 'goal',
    compiledPrompt: null,
    intent: 'task',
    memoryHints: [],
    plans: [],
    outcomes: [],
    policyBlocked: false,
    finalText: 'ok',
    errorCode: null,
    trace: [{ node: 'persist_and_emit', at: '2026-03-15T00:00:03.000Z', note: 'completed' }],
  },
});

describe('persistAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  });

  it('신규 컬럼 미존재 시 legacy payload로 재시도한다', async () => {
    const upsertSession = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: '42703', message: 'column shadow_graph_summary does not exist' } })
      .mockResolvedValueOnce({ error: null });
    const upsertSteps = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(getSupabaseClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'agent_sessions') {
          return { upsert: upsertSession };
        }
        if (table === 'agent_steps') {
          return { upsert: upsertSteps };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    } as any);

    await persistAgentSession(makeSession());

    expect(upsertSession).toHaveBeenCalledTimes(2);
    expect(upsertSteps).toHaveBeenCalledTimes(1);

    const firstPayload = upsertSession.mock.calls[0][0] as Record<string, unknown>;
    const secondPayload = upsertSession.mock.calls[1][0] as Record<string, unknown>;

    expect(firstPayload.shadow_graph_summary).toBeTruthy();
    expect(firstPayload.progress_summary).toBeTruthy();
    expect(secondPayload.shadow_graph_summary).toBeUndefined();
    expect(secondPayload.progress_summary).toBeUndefined();
  });
});
