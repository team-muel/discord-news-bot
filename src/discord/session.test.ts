import { describe, expect, it } from 'vitest';

import { buildSessionProgressText } from './session';

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
});