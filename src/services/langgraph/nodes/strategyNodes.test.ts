import { describe, expect, it } from 'vitest';
import { runSelectExecutionStrategyNode } from './strategyNodes';

describe('runSelectExecutionStrategyNode', () => {
  it('review 강제 시 full_review를 선택한다', () => {
    const out = runSelectExecutionStrategyNode({
      requestedSkillId: 'ops-plan',
      priority: 'fast',
      forceFullReview: true,
    });

    expect(out).toEqual({
      strategy: 'full_review',
      traceNote: 'forced_full_review:policy_gate=review',
    });
  });

  it('requested skill이 있으면 requested_skill을 선택한다', () => {
    const out = runSelectExecutionStrategyNode({
      requestedSkillId: 'ops-execution',
      priority: 'balanced',
      forceFullReview: false,
    });

    expect(out).toEqual({
      strategy: 'requested_skill',
      traceNote: 'requested_skill:ops-execution',
    });
  });

  it('fast 우선순위면 fast_path를 선택한다', () => {
    const out = runSelectExecutionStrategyNode({
      requestedSkillId: null,
      priority: 'fast',
      forceFullReview: false,
    });

    expect(out).toEqual({
      strategy: 'fast_path',
      traceNote: 'fast_path:priority=fast',
    });
  });

  it('기본 조건에서는 full_review를 선택한다', () => {
    const out = runSelectExecutionStrategyNode({
      requestedSkillId: null,
      priority: 'balanced',
      forceFullReview: false,
    });

    expect(out).toEqual({
      strategy: 'full_review',
      traceNote: 'full_review:priority=balanced',
    });
  });
});