import type { SkillExecutionResult, SkillContext } from '../types';
import { runSkillText } from './common';
import { runGoalActions } from '../actionRunner';
import { parseBooleanEnv } from '../../../utils/env';

const REACT_REFLECT_ON_ACTION_FAILURE_ENABLED = parseBooleanEnv(process.env.REACT_REFLECT_ON_ACTION_FAILURE_ENABLED, true);
const OPS_EXECUTION_ACTION_RUNNER_ENABLED = parseBooleanEnv(process.env.OPS_EXECUTION_ACTION_RUNNER_ENABLED, true);

const ACTIONABLE_GOAL_PATTERN = /(webhook|웹훅|api|엔드포인트|크롤|crawler|crawl|scrape|검색|search|조회|fetch|뉴스|news|youtube|유튜브|quote|chart|시세|가격|stock|db\.|supabase|notify|알림|자동화|automation|worker|mcp)/i;

const shouldAttemptActionRunner = (goal: string): boolean => {
  if (!OPS_EXECUTION_ACTION_RUNNER_ENABLED) {
    return false;
  }
  return ACTIONABLE_GOAL_PATTERN.test(String(goal || ''));
};

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
  if (shouldAttemptActionRunner(context.goal)) {
    const actionResult = await runGoalActions({
      goal: context.goal,
      guildId: context.guildId,
      requestedBy: context.requestedBy,
    });
    if (actionResult.handled && actionResult.hasSuccess) {
      return { skillId: 'ops-execution', output: actionResult.output };
    }

    if (actionResult.handled && !actionResult.hasSuccess && actionResult.externalUnavailable) {
      const fallback = await runSkillText({
        context,
        actionName: 'skill.ops-execution.fallback',
        systemLines: [
          '너는 서버 운영 실행 담당 에이전트다.',
          '외부 크롤링/워커가 불가할 때는 기존 기억 힌트를 우선 사용해 답변한다.',
          '확인되지 않은 외부 최신 사실은 단정하지 않는다.',
        ],
        rules: [
          '첫 문장에 다음 안내를 그대로 포함: 현재 외부 정보를 불러올 수 없어, 제가 가진 기존 기억(옵시디언)으로만 답변드릴게요.',
          '그 다음 문단부터 memory hints 기반으로 실행 가능한 요약/권장 조치를 작성',
          '출처가 불충분한 항목은 불확실성으로 명시',
        ],
        temperature: 0.2,
        maxTokens: 900,
      });

      return { skillId: 'ops-execution', output: fallback };
    }

    if (actionResult.handled && !actionResult.hasSuccess && REACT_REFLECT_ON_ACTION_FAILURE_ENABLED) {
      const reflected = await runSkillText({
        context: {
          ...context,
          priorOutput: actionResult.output,
        },
        actionName: 'skill.ops-execution.react_reflect',
        systemLines: [
          '너는 ReAct 반성 응답기다.',
          '관측(실행 로그)을 근거로 실패 원인과 다음 행동을 간결하게 제시한다.',
        ],
        rules: [
          '첫 문단: 실패 원인 요약(최대 2문장)',
          '둘째 문단: 즉시 실행 가능한 다음 단계 3개 이내',
          '미확인 사실은 추정으로 표시',
        ],
        temperature: 0.2,
        maxTokens: 900,
      });

      return { skillId: 'ops-execution', output: reflected };
    }
  }

  const youtubeDirectResult = maybeBuildYouTubeResult(context.goal);
  if (youtubeDirectResult) {
    return { skillId: 'ops-execution', output: youtubeDirectResult };
  }

  const output = await runSkillText({
    context,
    actionName: 'skill.ops-execution',
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
