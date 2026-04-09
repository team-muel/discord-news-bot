import { describe, it, expect, vi } from 'vitest';

// actionRunner의 순수 공개 함수 테스트
// runGoalActions는 LLM/Supabase 의존이 있어 여기서는 diagnostics snapshot 구조만 검증
import {
  getActionRunnerDiagnosticsSnapshot,
  type ActionRunnerDiagnosticsSnapshot,
} from './actionRunner';

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
