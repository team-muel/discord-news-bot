import { describe, expect, it } from 'vitest';

import { formatCitationFirstResult, sanitizeDeliverableText, selectConsensusText } from './runtimeFormatting';

describe('runtimeFormatting', () => {
  it('sanitizeDeliverableText는 debug line과 section label-only line을 제거한다', () => {
    const raw = [
      '## Deliverable',
      '실제 결과',
      '검증: 내부 디버그',
      '상태: running',
      'Confidence',
    ].join('\n');

    expect(sanitizeDeliverableText(raw)).toBe('실제 결과');
  });

  it('formatCitationFirstResult는 citation-first 출력 블록을 만든다', () => {
    const result = formatCitationFirstResult('최종 답변', {
      goal: '[ROUTE:knowledge] 테스트 목표',
      priority: 'precise',
      memoryHints: ['근거 [memory:abc123]'],
    });

    expect(result).toContain('## Deliverable');
    expect(result).toContain('## Verification');
    expect(result).toContain('memory:abc123');
    expect(result).toContain('## Confidence:');
  });

  it('selectConsensusText는 가장 유사한 후보를 선택한다', () => {
    const consensus = selectConsensusText([
      '배포 전에 health와 ready를 확인하세요.',
      '배포 전 health와 ready를 먼저 확인하세요.',
      '완전히 다른 메시지',
    ]);

    expect(consensus).toContain('health');
    expect(consensus).toContain('ready');
  });
});