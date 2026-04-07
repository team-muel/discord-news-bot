import fs from 'node:fs/promises';
import path from 'node:path';
import type { ActionPlan } from './types';
import logger from '../../../logger';
import { getErrorMessage } from '../../../utils/errorMessage';

const DEFAULT_RAG_INTENT_PATTERN = 'rag|근거|출처|기억|메모리|memory|회상|리콜|retrieve|retrieval|요약근거';
const RULES_DOC_PATH = path.resolve(process.cwd(), 'docs', 'SKILL_ACTION_RULES.json');

type QueryArgMode = 'goal' | 'none';

type RulePlanSpec = {
  actionName: string;
  reason: string;
  queryArg?: QueryArgMode;
};

type IntentRuleSpec = {
  id: string;
  pattern: RegExp;
  plans: RulePlanSpec[];
  conditionalPlans?: Array<{
    when: RegExp;
    plans: RulePlanSpec[];
  }>;
};

type IntentRuleConfig = {
  id: string;
  pattern: string;
  plans: RulePlanSpec[];
  conditionalPlans?: Array<{
    when: string;
    plans: RulePlanSpec[];
  }>;
};

type PlannerRulesConfig = {
  ragIntentPattern: string;
  rules: IntentRuleConfig[];
};

const pushUnique = (plans: ActionPlan[], next: ActionPlan) => {
  if (plans.some((plan) => plan.actionName === next.actionName)) {
    return;
  }
  plans.push(next);
};

const toArgs = (queryArg: QueryArgMode | undefined, goal: string): Record<string, unknown> => {
  if (queryArg === 'goal') {
    return { query: goal };
  }
  return {};
};

const buildPlansFromSpecs = (specs: RulePlanSpec[], goal: string): ActionPlan[] => {
  return specs.map((spec) => ({
    actionName: spec.actionName,
    args: toArgs(spec.queryArg, goal),
    reason: spec.reason,
  }));
};

const isQueryArgMode = (value: unknown): value is QueryArgMode => value === 'goal' || value === 'none';

const normalizePlanSpec = (input: unknown): RulePlanSpec | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const row = input as Record<string, unknown>;
  const actionName = String(row.actionName || '').trim();
  const reason = String(row.reason || '').trim();
  if (!actionName || !reason) {
    return null;
  }

  const queryArg = row.queryArg;
  return {
    actionName,
    reason,
    queryArg: isQueryArgMode(queryArg) ? queryArg : 'none',
  };
};

const normalizeIntentRuleConfig = (input: unknown): IntentRuleConfig | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const row = input as Record<string, unknown>;
  const id = String(row.id || '').trim();
  const pattern = String(row.pattern || '').trim();
  const plans = Array.isArray(row.plans)
    ? row.plans.map((plan) => normalizePlanSpec(plan)).filter((plan): plan is RulePlanSpec => Boolean(plan))
    : [];

  if (!id || !pattern || plans.length === 0) {
    return null;
  }

  const conditionalPlans = Array.isArray(row.conditionalPlans)
    ? row.conditionalPlans
      .map((conditional) => {
        if (!conditional || typeof conditional !== 'object' || Array.isArray(conditional)) {
          return null;
        }
        const when = String((conditional as Record<string, unknown>).when || '').trim();
        const conditionalSpecs = Array.isArray((conditional as Record<string, unknown>).plans)
          ? ((conditional as Record<string, unknown>).plans as unknown[])
            .map((plan) => normalizePlanSpec(plan))
            .filter((plan): plan is RulePlanSpec => Boolean(plan))
          : [];

        if (!when || conditionalSpecs.length === 0) {
          return null;
        }

        return { when, plans: conditionalSpecs };
      })
      .filter((entry): entry is { when: string; plans: RulePlanSpec[] } => Boolean(entry))
    : undefined;

  return { id, pattern, plans, conditionalPlans };
};

const loadPlannerRulesConfig = async (): Promise<PlannerRulesConfig> => {
  try {
    const raw = await fs.readFile(RULES_DOC_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ragIntentPattern = String(parsed.ragIntentPattern || '').trim() || DEFAULT_RAG_INTENT_PATTERN;
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules.map((rule) => normalizeIntentRuleConfig(rule)).filter((rule): rule is IntentRuleConfig => Boolean(rule))
      : [];

    if (rules.length === 0) {
      logger.warn('[PLANNER-RULES] no valid rule entries in %s; fallback to empty rules', RULES_DOC_PATH);
    }

    return { ragIntentPattern, rules };
  } catch (error) {
    logger.warn('[PLANNER-RULES] failed to load %s: %s', RULES_DOC_PATH, getErrorMessage(error));
    return {
      ragIntentPattern: DEFAULT_RAG_INTENT_PATTERN,
      rules: [],
    };
  }
};

const compileIntentRuleSpecs = (configRules: IntentRuleConfig[]): IntentRuleSpec[] => {
  const compiled: IntentRuleSpec[] = [];

  for (const rule of configRules) {
    try {
      compiled.push({
        id: rule.id,
        pattern: new RegExp(rule.pattern, 'i'),
        plans: rule.plans,
        conditionalPlans: rule.conditionalPlans?.map((entry) => ({
          when: new RegExp(entry.when, 'i'),
          plans: entry.plans,
        })),
      });
    } catch (error) {
      logger.warn('[PLANNER-RULES] invalid regex rule id=%s: %s', rule.id, getErrorMessage(error));
    }
  }

  return compiled;
};

let compiledRulesPromise: Promise<{ ragIntentRegex: RegExp; intentRuleSpecs: IntentRuleSpec[] }> | null = null;

const getCompiledRules = async (): Promise<{ ragIntentRegex: RegExp; intentRuleSpecs: IntentRuleSpec[] }> => {
  if (compiledRulesPromise) {
    return compiledRulesPromise;
  }

  compiledRulesPromise = (async () => {
    const loadedRulesConfig = await loadPlannerRulesConfig();
    return {
      ragIntentRegex: new RegExp(loadedRulesConfig.ragIntentPattern, 'i'),
      intentRuleSpecs: compileIntentRuleSpecs(loadedRulesConfig.rules),
    };
  })();

  return compiledRulesPromise;
};

export const isRagIntentGoal = async (goal: string): Promise<boolean> => {
  const rules = await getCompiledRules();
  return rules.ragIntentRegex.test(String(goal || '').toLowerCase());
};

export const buildFallbackPlan = async (goal: string): Promise<ActionPlan[]> => {
  const rules = await getCompiledRules();
  const lower = goal.toLowerCase();
  const plans: ActionPlan[] = [];

  for (const rule of rules.intentRuleSpecs) {
    if (!rule.pattern.test(lower)) {
      continue;
    }

    if (rule.conditionalPlans) {
      for (const conditional of rule.conditionalPlans) {
        if (!conditional.when.test(lower)) {
          continue;
        }
        for (const next of buildPlansFromSpecs(conditional.plans, goal)) {
          pushUnique(plans, next);
        }
      }
    }

    for (const next of buildPlansFromSpecs(rule.plans, goal)) {
      pushUnique(plans, next);
    }
  }

  return plans;
};
