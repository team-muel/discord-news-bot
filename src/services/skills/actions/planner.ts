import { generateText, isAnyLlmConfigured } from '../../llmClient';
import { listActions } from './registry';
import type { ActionChainPlan, ActionPlan } from './types';
import { buildFallbackPlan, isRagIntentGoal } from './plannerRules';
import { parseBooleanEnv, parseBoundedNumberEnv, parseIntegerEnv } from '../../../utils/env';

const PLANNER_SELF_CONSISTENCY_ENABLED = parseBooleanEnv(process.env.PLANNER_SELF_CONSISTENCY_ENABLED, true);
const PLANNER_SELF_CONSISTENCY_SAMPLES = Math.max(1, Math.min(5, parseIntegerEnv(process.env.PLANNER_SELF_CONSISTENCY_SAMPLES, 3)));
const PLANNER_SELF_CONSISTENCY_TEMPERATURE = parseBoundedNumberEnv(process.env.PLANNER_SELF_CONSISTENCY_TEMPERATURE, 0.35, 0, 1);

const applyRagPriority = async (plans: ActionPlan[], goal: string): Promise<ActionPlan[]> => {
  if (!(await isRagIntentGoal(goal))) {
    return plans;
  }

  const rag = plans.find((plan) => plan.actionName === 'rag.retrieve');
  const others = plans.filter((plan) => plan.actionName !== 'rag.retrieve');
  if (rag) {
    return [rag, ...others];
  }

  return [
    { actionName: 'rag.retrieve', args: { query: goal }, reason: 'rag-priority-injected' },
    ...others,
  ];
};

const fallbackPlan = async (goal: string): Promise<ActionPlan[]> => buildFallbackPlan(goal);

const pushUnique = (plans: ActionPlan[], next: ActionPlan) => {
  if (plans.some((plan) => plan.actionName === next.actionName)) {
    return;
  }
  plans.push(next);
};

const normalizePlan = (input: unknown): ActionPlan[] => {
  const out: ActionPlan[] = [];

  const appendIfValid = (row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return;
    }
    const data = row as Record<string, unknown>;
    const actionName = String(data.actionName || '').trim();
    if (!actionName || actionName === 'none') {
      return;
    }
    const args = data.args && typeof data.args === 'object' && !Array.isArray(data.args)
      ? data.args as Record<string, unknown>
      : {};
    const reason = typeof data.reason === 'string' ? data.reason : undefined;
    pushUnique(out, { actionName, args, reason });
  };

  if (Array.isArray(input)) {
    for (const row of input) {
      appendIfValid(row);
    }
    return out;
  }

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.actions)) {
      for (const row of obj.actions) {
        appendIfValid(row);
      }
      return out;
    }
    appendIfValid(obj);
    return out;
  }

  return out;
};

const planSignature = (actions: ActionPlan[]): string => actions.map((action) => action.actionName).join(' > ');

export const selectConsensusActions = (candidates: ActionPlan[][]): ActionPlan[] => {
  const scoreBySignature = new Map<string, { count: number; firstIndex: number; sample: ActionPlan[] }>();

  candidates.forEach((candidate, index) => {
    if (!candidate || candidate.length === 0) {
      return;
    }

    const signature = planSignature(candidate);
    const existing = scoreBySignature.get(signature);
    if (existing) {
      existing.count += 1;
      return;
    }

    scoreBySignature.set(signature, {
      count: 1,
      firstIndex: index,
      sample: candidate,
    });
  });

  const ranked = [...scoreBySignature.values()].sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return a.firstIndex - b.firstIndex;
  });

  return ranked[0]?.sample ? ranked[0].sample.slice(0, 3) : [];
};

const requestPlanCandidate = async (params: {
  goal: string;
  prompt: string;
  temperature: number;
}): Promise<ActionPlan[] | null> => {
  try {
    const raw = await generateText({
      system: '너는 액션 체인 플래너다. 지정 스키마 JSON만 출력한다.',
      user: params.prompt,
      temperature: params.temperature,
      maxTokens: 260,
    });

    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return null;
    }

    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    const normalized = (await applyRagPriority(normalizePlan(parsed), params.goal)).slice(0, 3);
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
};

export const planActions = async (goal: string): Promise<ActionChainPlan> => {
  if (!isAnyLlmConfigured()) {
    return { actions: await fallbackPlan(goal) };
  }

  const actions = listActions();
  const catalog = actions.map((action) => `- ${action.name}: ${action.description}`).join('\n');
  const prompt = [
    '아래 목표를 가장 잘 수행할 액션 체인을 선택하세요.',
    '출력은 JSON 한 줄만 허용합니다.',
    '{"actions":[{"actionName":"...","args":{},"reason":"..."}]}',
    '최대 3개 액션까지만 선택하세요.',
    '없으면 {"actions":[]} 로 출력하세요.',
    '규칙: 목표가 근거/출처/기억 회상/검증 요청이면 첫 액션으로 rag.retrieve를 포함하세요.',
    '규칙: rag.retrieve를 선택했다면 args.query에는 목표를 넣고 reason에 rag 관련 근거를 남기세요.',
    '',
    '액션 목록:',
    catalog,
    '',
    `목표: ${goal}`,
  ].join('\n');

  if (!PLANNER_SELF_CONSISTENCY_ENABLED || PLANNER_SELF_CONSISTENCY_SAMPLES <= 1) {
    const single = await requestPlanCandidate({ goal, prompt, temperature: 0 });
    if (!single || single.length === 0) {
      return { actions: await fallbackPlan(goal) };
    }
    return { actions: single };
  }

  const temperatures = Array.from({ length: PLANNER_SELF_CONSISTENCY_SAMPLES }, (_, index) => (
    index === 0 ? 0 : PLANNER_SELF_CONSISTENCY_TEMPERATURE
  ));
  const candidates = await Promise.all(temperatures.map((temperature) => requestPlanCandidate({ goal, prompt, temperature })));
  const validCandidates = candidates.filter((candidate): candidate is ActionPlan[] => Boolean(candidate && candidate.length > 0));
  const consensus = selectConsensusActions(validCandidates);
  if (consensus.length === 0) {
    return { actions: await fallbackPlan(goal) };
  }

  return { actions: consensus };
};
