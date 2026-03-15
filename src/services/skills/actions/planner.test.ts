import { describe, expect, it } from 'vitest';
import { selectConsensusActions } from './planner';
import type { ActionPlan } from './types';

const plan = (names: string[]): ActionPlan[] => names.map((name) => ({
  actionName: name,
  args: {},
}));

describe('selectConsensusActions', () => {
  it('다수결 시그니처를 우선 선택한다', () => {
    const candidates = [
      plan(['rag.retrieve', 'web.search']),
      plan(['rag.retrieve', 'web.search']),
      plan(['web.search']),
    ];

    const selected = selectConsensusActions(candidates);
    expect(selected.map((item) => item.actionName)).toEqual(['rag.retrieve', 'web.search']);
  });

  it('동률이면 먼저 등장한 후보를 선택한다', () => {
    const candidates = [
      plan(['news.verify']),
      plan(['web.search']),
    ];

    const selected = selectConsensusActions(candidates);
    expect(selected.map((item) => item.actionName)).toEqual(['news.verify']);
  });

  it('유효 후보가 없으면 빈 배열을 반환한다', () => {
    const selected = selectConsensusActions([]);
    expect(selected).toEqual([]);
  });
});
