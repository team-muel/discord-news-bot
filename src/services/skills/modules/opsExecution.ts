import type { SkillExecutionResult, SkillContext } from '../types';
import { runSkillText } from './common';
import { runGoalActions } from '../actionRunner';

const maybeBuildYouTubeResult = (goal: string): string | null => {
  const lower = goal.toLowerCase();
  if (!/(youtube|유튜브)/.test(lower)) {
    return null;
  }

  const cleaned = goal
    .replace(/세션 스킬 실행:[^\n]*/g, '')
    .replace(/요청:\s*/g, '')
    .replace(/목표:\s*/g, '')
    .trim();
  const query = encodeURIComponent(cleaned.length > 0 ? cleaned : '고양이 영상');

  return [
    '요청 결과:',
    `바로 열 수 있는 YouTube 검색 링크를 생성했습니다: https://www.youtube.com/results?search_query=${query}`,
    '필요 시 위 링크에서 첫 번째 결과 URL을 공유하세요.',
  ].join('\n');
};

export const executeOpsExecutionSkill = async (context: SkillContext): Promise<SkillExecutionResult> => {
  const actionResult = await runGoalActions({
    goal: context.goal,
    guildId: context.guildId,
    requestedBy: context.requestedBy,
  });
  if (actionResult.handled) {
    return { skillId: 'ops-execution', output: actionResult.output };
  }

  const youtubeDirectResult = maybeBuildYouTubeResult(context.goal);
  if (youtubeDirectResult) {
    return { skillId: 'ops-execution', output: youtubeDirectResult };
  }

  const output = await runSkillText({
    context,
    systemLines: [
      '너는 서버 운영 실행 담당 에이전트다.',
      '과정 설명 대신 바로 실행 가능한 최종 산출물만 출력한다.',
    ],
    rules: [
      '결과물 형식: 실행 결과/적용값/검증 포인트',
      '체크리스트 단계 나열 대신 완료된 형태의 산출물 텍스트를 제시',
    ],
    temperature: 0.2,
    maxTokens: 1100,
  });

  return { skillId: 'ops-execution', output };
};
