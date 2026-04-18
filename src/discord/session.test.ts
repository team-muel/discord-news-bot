import { describe, expect, it } from 'vitest';

import { buildSessionProgressText, resolveVibeSessionPriority } from './session';

describe('buildSessionProgressText', () => {
  const baseSession = {
    status: 'completed',
    steps: [],
    error: null,
  } as const;

  it('deeper markdown deliverable headings still isolate the user-facing body', () => {
    const text = buildSessionProgressText({
      ...baseSession,
      result: [
        '### Deliverable',
        'Ship the runtime fix.',
        '',
        '### Verification',
        '- internal verification note',
        '상태: success',
      ].join('\n'),
    } as any, 'goal', { showDebugBlocks: false, maxLinks: 2 }, 0);

    expect(text).toContain('Ship the runtime fix.');
    expect(text).not.toContain('Verification');
    expect(text).not.toContain('internal verification note');
    expect(text).not.toContain('상태: success');
  });

  it('inline emphasized deliverable labels do not leak confidence or debug text', () => {
    const text = buildSessionProgressText({
      ...baseSession,
      result: [
        '**Deliverable:** Keep only the user-facing answer.',
        '',
        '**Confidence:** high',
        '액션: debug trace',
      ].join('\n'),
    } as any, 'goal', { showDebugBlocks: false, maxLinks: 2 }, 0);

    expect(text).toContain('Keep only the user-facing answer.');
    expect(text).not.toContain('Confidence');
    expect(text).not.toContain('액션:');
  });

  it('strips screenshot-style prompt compiler metadata from completed session results', () => {
    const text = buildSessionProgressText({
      ...baseSession,
      result: [
        '[프롬프트 컴파일] - dropped_noise=false - intent_tags=ops,coding - directives=response.short,response.with-verification,response.risk-first',
        'FinOps 모드: normal (daily=0.0509/5.00, monthly=0.2532/100.00)',
        'RAG 근거 6건 검색 완료 (query="요구사항: 중간 과정/역할별 산출물 노출 금지 목표: [ROUTE:mixed]")',
        '실행안은 서버 상태를 먼저 확인한 뒤 필요한 작업만 이어가세요.',
      ].join('\n'),
    } as any, 'goal', { showDebugBlocks: false, maxLinks: 2 }, 0);

    expect(text).toContain('실행안은 서버 상태를 먼저 확인한 뒤 필요한 작업만 이어가세요.');
    expect(text).not.toContain('[프롬프트 컴파일]');
    expect(text).not.toContain('intent_tags');
    expect(text).not.toContain('FinOps 모드');
    expect(text).not.toContain('RAG 근거 6건');
    expect(text).not.toContain('[ROUTE:mixed]');
  });

  it('strips why-this-path sections from completed session results', () => {
    const text = buildSessionProgressText({
      ...baseSession,
      result: [
        '## Deliverable',
        '최종 답변만 남겨주세요.',
        '## Why This Path',
        'intent_tags=mixed,response.risk-first',
      ].join('\n'),
    } as any, 'goal', { showDebugBlocks: false, maxLinks: 2 }, 0);

    expect(text).toContain('최종 답변만 남겨주세요.');
    expect(text).not.toContain('Why This Path');
    expect(text).not.toContain('intent_tags');
  });
});

describe('resolveVibeSessionPriority', () => {
  it('keeps low-signal mixed fallbacks on the fast lane', () => {
    expect(resolveVibeSessionPriority({
      request: 'asdf',
      route: 'mixed',
      reasons: ['default_mixed_fallback'],
    })).toBe('fast');
  });

  it('keeps explicit execution-oriented mixed requests on the balanced lane', () => {
    expect(resolveVibeSessionPriority({
      request: '왜 실패했는지 보고 고쳐줘',
      route: 'mixed',
      reasons: ['knowledge_and_execution_signals'],
    })).toBe('balanced');
  });
});