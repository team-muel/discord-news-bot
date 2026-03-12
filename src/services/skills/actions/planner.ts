import { generateText, isAnyLlmConfigured } from '../../llmClient';
import { listActions } from './registry';
import type { ActionChainPlan, ActionPlan } from './types';
import { buildFallbackPlan, RAG_INTENT_REGEX } from './plannerRules';

const isRagIntent = (goal: string): boolean => RAG_INTENT_REGEX.test(goal.toLowerCase());

const applyRagPriority = (plans: ActionPlan[], goal: string): ActionPlan[] => {
  if (!isRagIntent(goal)) {
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

const fallbackPlan = (goal: string): ActionPlan[] => buildFallbackPlan(goal);

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

export const planActions = async (goal: string): Promise<ActionChainPlan> => {
  if (!isAnyLlmConfigured()) {
    return { actions: fallbackPlan(goal) };
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

  try {
    const raw = await generateText({
      system: '너는 액션 체인 플래너다. 지정 스키마 JSON만 출력한다.',
      user: prompt,
      temperature: 0,
      maxTokens: 260,
    });

    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return { actions: fallbackPlan(goal) };
    }

    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    const normalized = applyRagPriority(normalizePlan(parsed), goal).slice(0, 3);
    if (normalized.length === 0) {
      return { actions: fallbackPlan(goal) };
    }
    return { actions: normalized };
  } catch {
    return { actions: fallbackPlan(goal) };
  }
};
