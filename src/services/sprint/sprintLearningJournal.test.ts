import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const mockUpsert = vi.fn();
const mockSearch = vi.fn();
const mockRead = vi.fn();
const mockGenerateText = vi.fn();

vi.mock('../../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: () => '/mock/vault',
}));

vi.mock('../obsidian/authoring', () => ({
  upsertObsidianGuildDocument: (...args: unknown[]) => mockUpsert(...args),
}));

vi.mock('../obsidian/router', () => ({
  searchObsidianVaultWithAdapter: (...args: unknown[]) => mockSearch(...args),
  readObsidianFileWithAdapter: (...args: unknown[]) => mockRead(...args),
}));

vi.mock('../llmClient', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  isAnyLlmConfigured: () => true,
}));

vi.mock('../../utils/env', () => ({
  parseBooleanEnv: (_v: unknown, fallback: boolean) => fallback,
  parseIntegerEnv: (_v: unknown, fallback: number) => fallback,
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => { throw new Error('not configured'); },
}));

import {
  recordSprintJournalEntry,
  loadWorkflowReconfigHints,
  formatReconfigHintsForPreamble,
  applyReconfigToPhaseOrder,
  type JournalEntry,
  type WorkflowReconfigHints,
} from './sprintLearningJournal';

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeEntry = (overrides?: Partial<JournalEntry>): JournalEntry => ({
  sprintId: 'sprint-test-001',
  guildId: '123456',
  objective: 'Fix login bug',
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

describe('sprintLearningJournal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordSprintJournalEntry', () => {
    it('Obsidian에 journal entry를 기록한다', async () => {
      mockUpsert.mockResolvedValue({ ok: true, path: 'guilds/123456/sprint-journal/20260325_sprint-test-001.md' });

      const result = await recordSprintJournalEntry(makeEntry());

      expect(result.ok).toBe(true);
      expect(result.path).toContain('sprint-journal');
      expect(mockUpsert).toHaveBeenCalledTimes(1);

      const call = mockUpsert.mock.calls[0][0];
      expect(call.tags).toContain('sprint-journal');
      expect(call.tags).toContain('retro');
      expect(call.tags).toContain('had-review-loops');
      expect(call.content).toContain('Implement↔review loops: 1');
      expect(call.properties.schema).toBe('sprint-journal/v1');
    });

    it('review loop이 없으면 had-review-loops 태그가 없다', async () => {
      mockUpsert.mockResolvedValue({ ok: true, path: 'test.md' });

      await recordSprintJournalEntry(makeEntry({ implementReviewLoops: 0 }));

      const call = mockUpsert.mock.calls[0][0];
      expect(call.tags).not.toContain('had-review-loops');
    });

    it('실패한 phase가 있으면 had-failures 태그가 붙는다', async () => {
      mockUpsert.mockResolvedValue({ ok: true, path: 'test.md' });

      await recordSprintJournalEntry(makeEntry({ failedPhases: ['qa'] }));

      const call = mockUpsert.mock.calls[0][0];
      expect(call.tags).toContain('had-failures');
    });
  });

  describe('loadWorkflowReconfigHints', () => {
    it('journal entry가 3개 미만이면 null을 반환한다', async () => {
      mockSearch.mockResolvedValue([
        { filePath: 'a.md', title: 'a', score: 1 },
        { filePath: 'b.md', title: 'b', score: 1 },
      ]);
      mockRead.mockResolvedValue(makeJournalMd(0, 'none'));

      const result = await loadWorkflowReconfigHints();
      expect(result).toBeNull();
    });

    it('반복적인 review loop 패턴을 감지한다', async () => {
      mockSearch.mockResolvedValue([
        { filePath: 'a.md', title: 'a', score: 1 },
        { filePath: 'b.md', title: 'b', score: 1 },
        { filePath: 'c.md', title: 'c', score: 1 },
        { filePath: 'd.md', title: 'd', score: 1 },
      ]);
      // 4 entries, 3 with review loops
      mockRead
        .mockResolvedValueOnce(makeJournalMd(2, 'none'))
        .mockResolvedValueOnce(makeJournalMd(1, 'none'))
        .mockResolvedValueOnce(makeJournalMd(1, 'none'))
        .mockResolvedValueOnce(makeJournalMd(0, 'none'));

      mockGenerateText.mockResolvedValue('[]');

      const result = await loadWorkflowReconfigHints();

      expect(result).not.toBeNull();
      expect(result!.proposals.length).toBeGreaterThan(0);
      const loopProposal = result!.proposals.find((p) => p.type === 'phase-insert');
      expect(loopProposal).toBeDefined();
      expect(loopProposal!.summary).toContain('review loops');
    });

    it('특정 phase의 반복 실패를 감지한다', async () => {
      mockSearch.mockResolvedValue([
        { filePath: 'a.md', title: 'a', score: 1 },
        { filePath: 'b.md', title: 'b', score: 1 },
        { filePath: 'c.md', title: 'c', score: 1 },
        { filePath: 'd.md', title: 'd', score: 1 },
      ]);
      mockRead
        .mockResolvedValueOnce(makeJournalMd(0, 'qa'))
        .mockResolvedValueOnce(makeJournalMd(0, 'qa'))
        .mockResolvedValueOnce(makeJournalMd(0, 'qa'))
        .mockResolvedValueOnce(makeJournalMd(0, 'none'));

      mockGenerateText.mockResolvedValue('[]');

      const result = await loadWorkflowReconfigHints();

      expect(result).not.toBeNull();
      const failProposal = result!.proposals.find((p) => p.type === 'fallback-reorder');
      expect(failProposal).toBeDefined();
      expect(failProposal!.summary).toContain('qa');
    });
  });

  describe('formatReconfigHintsForPreamble', () => {
    it('proposals를 마크다운으로 렌더링한다', () => {
      const hints: WorkflowReconfigHints = {
        proposals: [
          { type: 'phase-insert', summary: 'Add pre-review lint', confidence: 0.85, evidence: ['3/4 had loops'] },
        ],
        patternSummary: '[phase-insert] Add pre-review lint',
        journalEntriesAnalyzed: 4,
      };

      const output = formatReconfigHintsForPreamble(hints);

      expect(output).toContain('Workflow Reconfiguration Proposals');
      expect(output).toContain('4 recent sprint journal entries');
      expect(output).toContain('phase-insert');
      expect(output).toContain('85% confidence');
      expect(output).toContain('3/4 had loops');
    });
  });

  describe('applyReconfigToPhaseOrder', () => {
    const BASE_ORDER = ['plan', 'implement', 'review', 'qa', 'ops-validate', 'ship', 'retro'];

    it('hints가 null이면 변경 없이 반환한다', () => {
      const result = applyReconfigToPhaseOrder(BASE_ORDER, 3, null, 'manual');
      expect(result.phaseOrder).toEqual(BASE_ORDER);
      expect(result.appliedProposals).toHaveLength(0);
      expect(result.adjustedLoopLimit).toBeNull();
    });

    it('낮은 신뢰도 제안은 적용하지 않는다', () => {
      const hints: WorkflowReconfigHints = {
        proposals: [{ type: 'phase-insert', summary: 'test', confidence: 0.3, evidence: [] }],
        patternSummary: '',
        journalEntriesAnalyzed: 5,
      };
      const result = applyReconfigToPhaseOrder(BASE_ORDER, 3, hints, 'manual');
      expect(result.appliedProposals).toHaveLength(0);
    });

    it('phase-insert: security-audit을 review 뒤에 삽입한다', () => {
      const hints: WorkflowReconfigHints = {
        proposals: [{ type: 'phase-insert', summary: 'test', confidence: 0.85, evidence: [] }],
        patternSummary: '',
        journalEntriesAnalyzed: 5,
      };
      const result = applyReconfigToPhaseOrder(BASE_ORDER, 3, hints, 'manual');
      expect(result.appliedProposals).toHaveLength(1);
      const idx = result.phaseOrder.indexOf('security-audit');
      expect(idx).toBeGreaterThan(result.phaseOrder.indexOf('review'));
      expect(idx).toBeLessThan(result.phaseOrder.indexOf('qa'));
    });

    it('phase-insert: security-audit이 이미 있으면 중복 삽입하지 않는다', () => {
      const orderWithSA = ['plan', 'implement', 'review', 'security-audit', 'qa', 'ops-validate', 'ship', 'retro'];
      const hints: WorkflowReconfigHints = {
        proposals: [{ type: 'phase-insert', summary: 'test', confidence: 0.85, evidence: [] }],
        patternSummary: '',
        journalEntriesAnalyzed: 5,
      };
      const result = applyReconfigToPhaseOrder(orderWithSA, 3, hints, 'manual');
      const saCount = result.phaseOrder.filter((p) => p === 'security-audit').length;
      expect(saCount).toBe(1);
    });

    it('phase-skip: 저위험 트리거에서만 security-audit을 제거한다', () => {
      const orderWithSA = ['plan', 'implement', 'review', 'security-audit', 'qa', 'ops-validate', 'ship', 'retro'];
      const hints: WorkflowReconfigHints = {
        proposals: [{ type: 'phase-skip', summary: 'skip SA', confidence: 0.8, evidence: [] }],
        patternSummary: '',
        journalEntriesAnalyzed: 5,
      };

      // scheduled -> 적용됨
      const schedResult = applyReconfigToPhaseOrder(orderWithSA, 3, hints, 'scheduled');
      expect(schedResult.phaseOrder).not.toContain('security-audit');
      expect(schedResult.appliedProposals).toHaveLength(1);

      // manual -> 적용 안됨
      const manualResult = applyReconfigToPhaseOrder(orderWithSA, 3, hints, 'manual');
      expect(manualResult.phaseOrder).toContain('security-audit');
      expect(manualResult.appliedProposals).toHaveLength(0);
    });

    it('loop-limit-adjust: 루프 상한을 1 증가시킨다 (최대 5)', () => {
      const hints: WorkflowReconfigHints = {
        proposals: [{ type: 'loop-limit-adjust', summary: 'increase', confidence: 0.9, evidence: [] }],
        patternSummary: '',
        journalEntriesAnalyzed: 5,
      };
      const result = applyReconfigToPhaseOrder(BASE_ORDER, 3, hints, 'manual');
      expect(result.adjustedLoopLimit).toBe(4);

      // cap at 5
      const capped = applyReconfigToPhaseOrder(BASE_ORDER, 5, hints, 'manual');
      expect(capped.adjustedLoopLimit).toBeNull(); // no change since already at 5
    });

    it('fallback-reorder는 advisory only이다', () => {
      const hints: WorkflowReconfigHints = {
        proposals: [{ type: 'fallback-reorder', summary: 'reorder', confidence: 0.9, evidence: [] }],
        patternSummary: '',
        journalEntriesAnalyzed: 5,
      };
      const result = applyReconfigToPhaseOrder(BASE_ORDER, 3, hints, 'manual');
      expect(result.appliedProposals).toHaveLength(0);
      expect(result.log.some((l) => l.includes('[SKIPPED'))).toBe(true);
    });

    it('plan이 제거되면 safety가 base order를 복원한다', () => {
      // This shouldn't happen in normal flow, but tests the safety net
      const brokenOrder = ['implement', 'review', 'qa', 'ops-validate', 'ship', 'retro'];
      const hints: WorkflowReconfigHints = {
        proposals: [{ type: 'phase-insert', summary: 'test', confidence: 0.85, evidence: [] }],
        patternSummary: '',
        journalEntriesAnalyzed: 5,
      };
      const result = applyReconfigToPhaseOrder(brokenOrder, 3, hints, 'manual');
      // plan is missing in base, but safety should restore the original base
      expect(result.log.some((l) => l.includes('[SAFETY]'))).toBe(true);
    });
  });
});
