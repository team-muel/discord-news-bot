import { describe, it, expect, beforeEach } from 'vitest';

// 싱글톤 state를 테스트마다 초기화하기 위해 모듈 전체를 동적 import 하지 않고
// 같은 인스턴스를 사용하되 순서 의존 없이 독립 동작을 검증한다.
import {
  recordWorkerProposalClick,
  recordWorkerGenerationResult,
  recordWorkerApprovalDecision,
  getWorkerProposalMetricsSnapshot,
} from '../../services/workerGeneration/workerProposalMetrics';

describe('workerProposalMetrics', () => {
  it('스냅샷은 항상 startedAt 필드를 포함한다', () => {
    const snap = getWorkerProposalMetricsSnapshot();
    expect(snap.startedAt).toBeTruthy();
    expect(typeof snap.startedAt).toBe('string');
  });

  it('recordWorkerProposalClick 호출 시 proposalClicks가 증가한다', () => {
    const before = getWorkerProposalMetricsSnapshot().proposalClicks;
    recordWorkerProposalClick();
    const after = getWorkerProposalMetricsSnapshot().proposalClicks;
    expect(after).toBe(before + 1);
  });

  it('성공 생성 시 generationSucceeded와 generationRequested가 증가한다', () => {
    const before = getWorkerProposalMetricsSnapshot();
    recordWorkerGenerationResult(true);
    const after = getWorkerProposalMetricsSnapshot();
    expect(after.generationRequested).toBe(before.generationRequested + 1);
    expect(after.generationSucceeded).toBe(before.generationSucceeded + 1);
    expect(after.generationFailed).toBe(before.generationFailed);
  });

  it('실패 생성 시 generationFailed가 증가하고 실패 원인이 기록된다', () => {
    const before = getWorkerProposalMetricsSnapshot();
    recordWorkerGenerationResult(false, '코드 생성 실패: timeout');
    const after = getWorkerProposalMetricsSnapshot();
    expect(after.generationFailed).toBe(before.generationFailed + 1);
    expect(after.generationFailureReasonCounts['llm_generation_failed']).toBeGreaterThanOrEqual(1);
  });

  it('실패 원인 없이 실패 시 unknown으로 분류된다', () => {
    recordWorkerGenerationResult(false, undefined);
    const snap = getWorkerProposalMetricsSnapshot();
    expect(snap.generationFailureReasonCounts['unknown']).toBeGreaterThanOrEqual(1);
  });

  it('샌드박스 실패 원인이 올바르게 정규화된다', () => {
    recordWorkerGenerationResult(false, '샌드박스 저장 실패: disk full');
    const snap = getWorkerProposalMetricsSnapshot();
    expect(snap.generationFailureReasonCounts['sandbox_write_failed']).toBeGreaterThanOrEqual(1);
  });

  it('승인 결정이 올바르게 기록된다', () => {
    const before = getWorkerProposalMetricsSnapshot();
    recordWorkerApprovalDecision('approved');
    recordWorkerApprovalDecision('rejected');
    recordWorkerApprovalDecision('refactor_requested');
    const after = getWorkerProposalMetricsSnapshot();
    expect(after.approvalsApproved).toBe(before.approvalsApproved + 1);
    expect(after.approvalsRejected).toBe(before.approvalsRejected + 1);
    expect(after.approvalsRefactorRequested).toBe(before.approvalsRefactorRequested + 1);
  });

  it('generationSuccessRate는 0~1 범위이다', () => {
    recordWorkerGenerationResult(true);
    recordWorkerGenerationResult(false, 'some error');
    const snap = getWorkerProposalMetricsSnapshot();
    expect(snap.generationSuccessRate).toBeGreaterThanOrEqual(0);
    expect(snap.generationSuccessRate).toBeLessThanOrEqual(1);
  });

  it('topGenerationFailureReasons는 최대 3개이다', () => {
    const snap = getWorkerProposalMetricsSnapshot();
    expect(snap.topGenerationFailureReasons.length).toBeLessThanOrEqual(3);
  });

  it('history는 각 이벤트 후 쌓인다', () => {
    const before = getWorkerProposalMetricsSnapshot().history.length;
    recordWorkerProposalClick();
    const after = getWorkerProposalMetricsSnapshot().history.length;
    expect(after).toBeGreaterThan(before);
  });

  it('lastUpdatedAt은 이벤트 후 null이 아니다', () => {
    recordWorkerProposalClick();
    const snap = getWorkerProposalMetricsSnapshot();
    expect(snap.lastUpdatedAt).not.toBeNull();
  });
});
