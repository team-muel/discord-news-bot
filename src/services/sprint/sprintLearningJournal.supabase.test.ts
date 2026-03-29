import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks: Supabase fallback path (no Obsidian vault) ────────────────

const mockSupabaseUpsert = vi.fn();
const mockSupabaseSelect = vi.fn();
const mockSupabaseFrom = vi.fn();
const mockGenerateText = vi.fn();

// No Obsidian vault configured — triggers Supabase fallback
vi.mock('../../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: () => '',
}));

vi.mock('../obsidian/authoring', () => ({
  upsertObsidianGuildDocument: vi.fn(),
}));

vi.mock('../obsidian/router', () => ({
  searchObsidianVaultWithAdapter: vi.fn(),
  readObsidianFileWithAdapter: vi.fn(),
}));

vi.mock('../llmClient', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  isAnyLlmConfigured: () => true,
}));

vi.mock('../../utils/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/env')>();
  return {
    ...actual,
    parseBooleanEnv: (_v: unknown, fallback: boolean) => fallback,
    parseIntegerEnv: (_v: unknown, fallback: number) => fallback,
  };
});

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  }),
}));

import {
  recordSprintJournalEntry,
  loadWorkflowReconfigHints,
  type JournalEntry,
} from './sprintLearningJournal';

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeEntry = (overrides?: Partial<JournalEntry>): JournalEntry => ({
  sprintId: 'sprint-sb-001',
  guildId: '123456',
  objective: 'Fix auth bug',
  totalPhases: 7,
  implementReviewLoops: 1,
  changedFiles: ['src/auth.ts'],
  retroOutput: 'All good.',
  optimizeHints: ['reduce token usage'],
  benchResults: ['p95=120ms'],
  phaseTimings: { plan: 500, implement: 3000, review: 1500 },
  failedPhases: [],
  succeededPhases: ['plan', 'implement', 'review', 'qa', 'ops-validate', 'ship', 'retro'],
  completedAt: '2026-03-25T10:00:00.000Z',
  ...overrides,
});

const makeJournalMd = (loops: number, failed: string): string => `
# Sprint Journal: sprint-test

**Objective:** Something
**Completed:** 2026-03-25

## Execution Summary
- Total phases executed: 7
- Implement↔review loops: ${loops}
- Changed files: 1
- Succeeded: plan, implement
- Failed: ${failed}
`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('sprintLearningJournal — Supabase fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseFrom.mockReturnValue({ upsert: mockSupabaseUpsert });
    mockSupabaseUpsert.mockResolvedValue({ data: null, error: null });
  });

  describe('recordSprintJournalEntry (Supabase path)', () => {
    it('vault 없이 Supabase에 journal entry를 기록한다', async () => {
      const result = await recordSprintJournalEntry(makeEntry());

      expect(result.ok).toBe(true);
      expect(result.path).toContain('supabase://');
      expect(result.path).toContain('sprint-sb-001');
      expect(mockSupabaseFrom).toHaveBeenCalledWith('sprint_journal_entries');
      expect(mockSupabaseUpsert).toHaveBeenCalledTimes(1);

      const upsertArg = mockSupabaseUpsert.mock.calls[0][0];
      expect(upsertArg.sprint_id).toBe('sprint-sb-001');
      expect(upsertArg.guild_id).toBe('123456');
      expect(upsertArg.content).toContain('Sprint Journal');
      expect(upsertArg.tags).toContain('sprint-journal');
      expect(upsertArg.tags).toContain('had-review-loops');
    });

    it('Supabase upsert 실패 시 { ok: false }를 반환한다', async () => {
      mockSupabaseUpsert.mockRejectedValue(new Error('db error'));

      const result = await recordSprintJournalEntry(makeEntry());

      expect(result.ok).toBe(false);
      expect(result.path).toBeNull();
    });
  });

  describe('loadWorkflowReconfigHints (Supabase path)', () => {
    it('Supabase에서 journal entries를 읽어 패턴을 분석한다', async () => {
      const entries = [
        makeJournalMd(2, 'none'),
        makeJournalMd(1, 'none'),
        makeJournalMd(1, 'none'),
        makeJournalMd(0, 'none'),
      ];

      mockSupabaseFrom.mockReturnValue({
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({
              data: entries.map((content) => ({ content })),
              error: null,
            }),
          }),
        }),
      });

      mockGenerateText.mockResolvedValue('[]');

      const result = await loadWorkflowReconfigHints();

      expect(result).not.toBeNull();
      expect(result!.proposals.length).toBeGreaterThan(0);
      expect(result!.journalEntriesAnalyzed).toBe(4);
      const loopProposal = result!.proposals.find((p) => p.type === 'phase-insert');
      expect(loopProposal).toBeDefined();
    });

    it('Supabase에서 3개 미만 entries면 null을 반환한다', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({
              data: [{ content: makeJournalMd(0, 'none') }],
              error: null,
            }),
          }),
        }),
      });

      const result = await loadWorkflowReconfigHints();
      expect(result).toBeNull();
    });

    it('Supabase 읽기 실패 시 null을 반환한다', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({
              data: null,
              error: { message: 'table not found' },
            }),
          }),
        }),
      });

      const result = await loadWorkflowReconfigHints();
      expect(result).toBeNull();
    });
  });
});
