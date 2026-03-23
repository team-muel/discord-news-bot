import { describe, it, expect } from 'vitest';
import { makeActionableError, formatActionableOutput } from './actionableErrors';

describe('makeActionableError', () => {
  it('plan 실패 시 요약과 nextAction을 반환한다', () => {
    const result = makeActionableError('plan', 'some planning error');
    expect(result.summary).toContain('Plan phase failed');
    expect(result.nextAction).toBeTruthy();
    expect(result.suggestedPhase).toBeNull();
  });

  it('implement OBJECTIVE_EMPTY 에러를 인식한다', () => {
    const result = makeActionableError('implement', 'OBJECTIVE_EMPTY');
    expect(result.summary).toContain('empty objective');
    expect(result.suggestedPhase).toBe('plan');
  });

  it('implement timeout 에러를 인식한다', () => {
    const result = makeActionableError('implement', 'action timed out after 15s');
    expect(result.summary).toContain('timed out');
    expect(result.suggestedPhase).toBe('plan');
  });

  it('review 실패는 implement로 돌아간다', () => {
    const result = makeActionableError('review', 'critical issues found');
    expect(result.suggestedPhase).toBe('implement');
  });

  it('qa exit code를 파싱한다', () => {
    const result = makeActionableError('qa', 'tests failed with exit code 1');
    expect(result.summary).toContain('exit code 1');
    expect(result.suggestedPhase).toBe('implement');
  });

  it('ops-validate type error를 파싱한다', () => {
    const result = makeActionableError('ops-validate', '5 type errors found');
    expect(result.summary).toContain('type error');
    expect(result.suggestedPhase).toBe('implement');
  });

  it('ship git integration 에러를 인식한다', () => {
    const result = makeActionableError('ship', 'Git integration not configured');
    expect(result.summary).toContain('Git integration');
    expect(result.nextAction).toContain('SPRINT_GIT_ENABLED');
  });

  it('ship PR creation 에러를 인식한다', () => {
    const result = makeActionableError('ship', 'PR creation failed');
    expect(result.summary).toContain('PR creation');
  });

  it('retro 실패는 비차단이다', () => {
    const result = makeActionableError('retro', 'LLM timeout');
    expect(result.summary).toContain('Retro');
    expect(result.suggestedPhase).toBeNull();
  });

  it('알 수 없는 phase도 graceful하게 처리한다', () => {
    const result = makeActionableError('unknown-phase' as any, 'some error');
    expect(result.summary).toBeTruthy();
    expect(result.nextAction).toBeTruthy();
  });
});

describe('formatActionableOutput', () => {
  it('문자열 포맷을 반환한다', () => {
    const output = formatActionableOutput('qa', 'tests failed with exit code 1');
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('exit code');
  });
});
