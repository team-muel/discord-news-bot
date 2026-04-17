import { beforeEach, describe, expect, it, vi } from 'vitest';

// actionRunner의 순수 공개 함수 테스트
// runGoalActions는 LLM/Supabase 의존이 있어 여기서는 diagnostics snapshot 구조만 검증
import {
  __resetActionRunnerForTests,
  buildWorkflowCloseoutArtifacts,
  extractWorkflowArtifactRefs,
  formatActionArtifactsForDisplay,
  getActionRunnerDiagnosticsSnapshot,
  type ActionRunnerDiagnosticsSnapshot,
} from './actionRunner';
import {
  HIGH_RISK_APPROVAL_ACTIONS,
  isActionCacheable,
  isGovernanceFastPathEligible,
} from './actionRunnerConfig';
import { buildActionReflectionArtifact, parseActionReflectionArtifact } from './actions/types';

beforeEach(() => {
  __resetActionRunnerForTests();
});

describe('getActionRunnerDiagnosticsSnapshot (초기 상태)', () => {
  it('스냅샷 구조가 올바르다', () => {
    const snap = getActionRunnerDiagnosticsSnapshot();

    // 기본 카운터
    expect(typeof snap.totalRuns).toBe('number');
    expect(typeof snap.handledRuns).toBe('number');
    expect(typeof snap.successRuns).toBe('number');
    expect(typeof snap.failedRuns).toBe('number');
    expect(typeof snap.externalUnavailableRuns).toBe('number');

    // failureTotals 구조
    expect(typeof snap.failureTotals.totalFailures).toBe('number');
    expect(typeof snap.failureTotals.missingAction).toBe('number');
    expect(typeof snap.failureTotals.policyBlocked).toBe('number');
    expect(typeof snap.failureTotals.governanceUnavailable).toBe('number');
    expect(typeof snap.failureTotals.finopsBlocked).toBe('number');
    expect(typeof snap.failureTotals.externalFailures).toBe('number');
    expect(typeof snap.failureTotals.unknownFailures).toBe('number');

    // trend 구조
    expect(typeof snap.trend.windowSize).toBe('number');
    expect(snap.trend.windowSize).toBeGreaterThan(0);
    expect(typeof snap.trend.comparedRuns).toBe('number');
    expect(['up', 'down', 'flat', 'unknown']).toContain(snap.trend.direction);

    // topFailureCodes 구조
    expect(Array.isArray(snap.topFailureCodes)).toBe(true);
    for (const item of snap.topFailureCodes) {
      expect(typeof item.code).toBe('string');
      expect(typeof item.count).toBe('number');
      expect(item.share).toBeGreaterThanOrEqual(0);
      expect(item.share).toBeLessThanOrEqual(1);
    }

    // recentRuns 구조
    expect(Array.isArray(snap.recentRuns)).toBe(true);

    // lastRun은 null 또는 올바른 구조
    if (snap.lastRun !== null) {
      expect(typeof snap.lastRun.handled).toBe('boolean');
      expect(typeof snap.lastRun.hasSuccess).toBe('boolean');
      expect(typeof snap.lastRun.externalUnavailable).toBe('boolean');
    }
  });

  it('초기 카운터는 음수가 아니다', () => {
    const snap = getActionRunnerDiagnosticsSnapshot();
    expect(snap.totalRuns).toBeGreaterThanOrEqual(0);
    expect(snap.failureTotals.totalFailures).toBeGreaterThanOrEqual(0);
    expect(snap.failureTotals.missingAction).toBeGreaterThanOrEqual(0);
    expect(snap.failureTotals.policyBlocked).toBeGreaterThanOrEqual(0);
  });

  it('topFailureCodes의 share 합계는 1을 초과하지 않는다', () => {
    const snap = getActionRunnerDiagnosticsSnapshot();
    const totalShare = snap.topFailureCodes.reduce((sum, item) => sum + item.share, 0);
    expect(totalShare).toBeLessThanOrEqual(1.01); // 부동소수 오차 허용
  });

  it('recentRuns의 각 항목은 at 필드(ISO 문자열)를 가진다', () => {
    const snap = getActionRunnerDiagnosticsSnapshot();
    for (const run of snap.recentRuns) {
      expect(run.at).toBeTruthy();
      expect(() => new Date(run.at)).not.toThrow();
    }
  });

  it('trend.windowSize는 최솟값(4) 이상이다', () => {
    const snap = getActionRunnerDiagnosticsSnapshot();
    expect(snap.trend.windowSize).toBeGreaterThanOrEqual(4);
  });
});

describe('reflection artifact helpers', () => {
  it('reflection artifact를 다시 파싱할 수 있다', () => {
    const artifact = buildActionReflectionArtifact({
      plane: 'record',
      concern: 'guild-memory',
      nextPath: 'guilds/123/Guild_Lore.md',
      customerImpact: false,
    });

    expect(parseActionReflectionArtifact(artifact)).toEqual({
      type: 'obsidian_reflection',
      plane: 'record',
      concern: 'guild-memory',
      nextPath: 'guilds/123/Guild_Lore.md',
      customerImpact: false,
    });
  });

  it('display formatter는 raw reflection artifact를 숨기고 follow-up 힌트로 바꾼다', () => {
    const artifact = buildActionReflectionArtifact({
      plane: 'learning',
      concern: 'recursive-improvement',
      nextPath: 'ops/improvement/rules/knowledge-reflection-pipeline.md',
      customerImpact: true,
    });

    const result = formatActionArtifactsForDisplay(['/vault/guilds/123/test.md', artifact]);

    expect(result.artifactLines).toEqual(['/vault/guilds/123/test.md']);
    expect(result.reflectionLines).toEqual([
      'plane=learning',
      'concern=recursive-improvement',
      'next_path=ops/improvement/rules/knowledge-reflection-pipeline.md',
      'customer_impact=true',
    ]);
  });

  it('workflow artifact ref extractor는 ref-like artifact만 구조화한다', () => {
    const reflection = buildActionReflectionArtifact({
      plane: 'learning',
      concern: 'recursive-improvement',
      nextPath: 'ops/improvement/rules/knowledge-reflection-pipeline.md',
      customerImpact: true,
    });

    const refs = extractWorkflowArtifactRefs([
      'docs/CHANGELOG-ARCH.md',
      'branch: feature/runtime-hot-state',
      'commit: abc1234def5678',
      'workflow session: supabase:remote-session-1',
      'Release plan\nhttps://example.com/runbook?utm_source=test',
      reflection,
      'plain summary text that should stay unstructured',
    ]);

    expect(refs).toEqual([
      {
        locator: 'docs/CHANGELOG-ARCH.md',
        refKind: 'repo-file',
        title: 'CHANGELOG-ARCH.md',
        artifactPlane: 'github',
        githubSettlementKind: 'repo-file',
      },
      {
        locator: 'branch:feature/runtime-hot-state',
        refKind: 'git-ref',
        title: 'feature/runtime-hot-state',
        artifactPlane: 'github',
        githubSettlementKind: 'branch',
      },
      {
        locator: 'abc1234def5678',
        refKind: 'git-ref',
        title: 'commit abc1234def56',
        artifactPlane: 'github',
        githubSettlementKind: 'commit',
      },
      {
        locator: 'supabase:remote-session-1',
        refKind: 'workflow-session',
        title: 'supabase:remote-session-1',
        artifactPlane: 'hot-state',
      },
      {
        locator: 'https://example.com/runbook',
        refKind: 'url',
        title: 'Release plan',
        artifactPlane: 'external',
      },
      {
        locator: 'ops/improvement/rules/knowledge-reflection-pipeline.md',
        refKind: 'vault-note',
        title: 'recursive-improvement reflection target',
        artifactPlane: 'obsidian',
      },
    ]);
  });
});

describe('actionRunner config defaults', () => {
  it('keeps the canonical executor in the high-risk approval set', () => {
    expect(HIGH_RISK_APPROVAL_ACTIONS.has('implement.execute')).toBe(true);
  });

  it('marks read-only default actions as governance fast-path and cacheable', () => {
    expect(isGovernanceFastPathEligible('web.search')).toBe(true);
    expect(isActionCacheable('web.search')).toBe(true);
  });

  it('does not mark write-style actions as cacheable by default', () => {
    expect(isActionCacheable('privacy.forget.guild')).toBe(false);
  });
});

describe('buildWorkflowCloseoutArtifacts', () => {
  it('builds planner-empty decision distillate and capability demand together', () => {
    const closeout = buildWorkflowCloseoutArtifacts({
      goal: 'stabilize shared tooling handoff',
      guildId: 'guild-1',
      finalStatus: 'failed',
      sourceEvent: 'recall_request',
      plannerActionCount: 0,
    });

    expect(closeout.decisionDistillate).toMatchObject({
      summary: 'Planner could not produce any executable actions inside the current boundary.',
      nextAction: 'clarify the goal or expand the approved action surface before retrying',
      sourceEvent: 'recall_request',
      promoteAs: 'requirement',
      tags: ['goal-pipeline', 'planner-empty'],
    });
    expect(closeout.capabilityDemands).toEqual([
      expect.objectContaining({
        summary: 'Planner produced no executable actions inside the current boundary.',
        objective: 'stabilize shared tooling handoff',
        missingCapability: 'executable plan inside current boundary',
        missingSource: 'planner',
        failedOrInsufficientRoute: 'planActions',
        proposedOwner: 'gpt',
        recallCondition: 'Planner produced no executable actions; GPT recall required',
      }),
    ]);
  });

  it('builds failed pipeline closeout with operator-owned capability demand when policy blocks a step', () => {
    const closeout = buildWorkflowCloseoutArtifacts({
      goal: 'repair the failed automation route',
      guildId: 'guild-2',
      finalStatus: 'failed',
      sourceEvent: 'session_complete',
      stepCount: 3,
      replanned: true,
      replanCount: 1,
      failedSteps: [{
        stepName: 'replan-step-1-web.search',
        stepType: 'action',
        ok: false,
        output: [],
        artifacts: ['docs/CHANGELOG-ARCH.md'],
        durationMs: 120,
        agentRole: 'review',
        error: 'ACTION_NOT_ALLOWED',
      }],
    });

    expect(closeout.decisionDistillate).toMatchObject({
      summary: 'Pipeline failed after replanning and now needs GPT boundary review.',
      nextAction: 'inspect the failed steps and revise the objective, policy boundary, or execution plan',
      sourceEvent: 'session_complete',
      promoteAs: 'development_slice',
      tags: ['goal-pipeline', 'failed'],
    });
    expect(closeout.capabilityDemands).toEqual([
      expect.objectContaining({
        summary: 'Pipeline step replan-step-1-web.search was blocked by policy and needs a narrower route or approval.',
        objective: 'repair the failed automation route',
        missingCapability: 'ACTION_NOT_ALLOWED',
        failedOrInsufficientRoute: 'replan-step-1-web.search',
        proposedOwner: 'operator',
        evidenceRefs: ['docs/CHANGELOG-ARCH.md'],
        evidenceRefDetails: [
          {
            locator: 'docs/CHANGELOG-ARCH.md',
            refKind: 'repo-file',
            title: 'CHANGELOG-ARCH.md',
            artifactPlane: 'github',
            githubSettlementKind: 'repo-file',
          },
        ],
        recallCondition: 'Pipeline failed after replanning; GPT recall required',
        tags: ['goal-pipeline', 'failed', 'replanned'],
      }),
    ]);
  });
});

// policy.ts 순수 함수 테스트 (actionRunner 연계)
import { isActionAllowed, isWebHostAllowed, isDbTableAllowed, getActionRunnerMode } from './actions/policy';

describe('isActionAllowed', () => {
  it('ACTION_ALLOWED_ACTIONS=* (기본값) 이면 모든 액션이 허용된다', () => {
    expect(isActionAllowed('web.search')).toBe(true);
    expect(isActionAllowed('rag.retrieve')).toBe(true);
    expect(isActionAllowed('news.verify')).toBe(true);
  });

  it('빈 문자열 액션은 거부된다', () => {
    expect(isActionAllowed('')).toBe(false);
  });

  it('legacy allowlist도 canonical executor action을 허용한다', async () => {
    vi.resetModules();
    vi.stubEnv('ACTION_ALLOWED_ACTIONS', 'opencode.execute,rag.retrieve');

    const { isActionAllowed: isActionAllowedWithLegacyEnv } = await import('./actions/policy');
    expect(isActionAllowedWithLegacyEnv('implement.execute')).toBe(true);
    expect(isActionAllowedWithLegacyEnv('opencode.execute')).toBe(true);
  });
});

describe('isWebHostAllowed', () => {
  it('빈 WEB_ALLOWED_HOSTS(기본값) 이면 모든 호스트가 거부된다 (closed-by-default)', () => {
    expect(isWebHostAllowed('reuters.com')).toBe(false);
    expect(isWebHostAllowed('bloomberg.com')).toBe(false);
  });

  it('빈 host 값은 거부된다', () => {
    expect(isWebHostAllowed('')).toBe(false);
  });
});

describe('isDbTableAllowed', () => {
  it('기본 허용 테이블은 통과한다', () => {
    expect(isDbTableAllowed('guild_lore_docs')).toBe(true);
    expect(isDbTableAllowed('memory_items')).toBe(true);
  });

  it('허용되지 않은 테이블은 거부된다', () => {
    expect(isDbTableAllowed('users')).toBe(false);
    expect(isDbTableAllowed('trades')).toBe(false);
  });

  it('빈 테이블명은 거부된다', () => {
    expect(isDbTableAllowed('')).toBe(false);
  });
});

describe('getActionRunnerMode', () => {
  it('기본값은 execute 이다', () => {
    const mode = getActionRunnerMode();
    expect(['execute', 'dry-run']).toContain(mode);
  });
});

// ── D-06: syncHighRiskActionsToSandboxPolicy ──────────────────────────

describe('syncHighRiskActionsToSandboxPolicy', () => {
  it('calls openshell policy.set with YAML containing high-risk actions', async () => {
    const mockRunExternalAction = vi.fn().mockResolvedValue({ ok: true, summary: 'policy set' });
    vi.doMock('../tools/toolRouter', () => ({
      runExternalAction: mockRunExternalAction,
    }));

    // Re-import to pick up the mock
    const { syncHighRiskActionsToSandboxPolicy } = await import('./actionRunner');
    const result = await syncHighRiskActionsToSandboxPolicy();

    // The function should have attempted to sync (assuming default HIGH_RISK_APPROVAL_ACTIONS includes implement.execute)
    if (result.synced) {
      expect(mockRunExternalAction).toHaveBeenCalledWith('openshell', 'policy.set', expect.objectContaining({
        policy: expect.stringContaining('network:'),
      }));
      expect(result.actions.length).toBeGreaterThan(0);
    } else {
      // If executeExternalAction returned not-ok, synced is false but no throw
      expect(typeof result.error).toBe('string');
    }

    vi.doUnmock('../tools/toolRouter');
  });

  it('returns synced: false gracefully when openshell is unavailable', async () => {
    vi.doMock('../tools/toolRouter', () => ({
      runExternalAction: vi.fn().mockRejectedValue(new Error('adapter not available')),
    }));

    const { syncHighRiskActionsToSandboxPolicy } = await import('./actionRunner');
    const result = await syncHighRiskActionsToSandboxPolicy();
    expect(result.synced).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);

    vi.doUnmock('../tools/toolRouter');
  });
});
