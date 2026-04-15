import { generateText, isAnyLlmConfigured } from '../../llmClient';
import { getActionTermIndex, listActions } from './registry';
import { getActionUtilityScore } from '../actionRunner';
import type { ActionChainPlan, ActionPlan } from './types';
import { buildFallbackPlan, isRagIntentGoal } from './plannerRules';
import { parseBooleanEnv, parseBoundedNumberEnv, parseMinIntEnv } from '../../../utils/env';
import { runExternalAction } from '../../tools/toolRouter';
import type { ExternalAdapterId } from '../../tools/externalAdapterTypes';

// ──── Planner Configuration ────────────────────────────────────────────────
// All planner env vars consolidated into a single config object.
// To tune planner behavior, set PLANNER_* env vars (see defaults below).

const PLANNER_CONFIG = {
  selfConsistency: {
    enabled: parseBooleanEnv(process.env.PLANNER_SELF_CONSISTENCY_ENABLED, true),
    samples: parseBoundedNumberEnv(process.env.PLANNER_SELF_CONSISTENCY_SAMPLES, 3, 1, 5),
    temperature: parseBoundedNumberEnv(process.env.PLANNER_SELF_CONSISTENCY_TEMPERATURE, 0.35, 0, 1),
    adaptiveSamplesEnabled: parseBooleanEnv(process.env.PLANNER_ADAPTIVE_SAMPLES_ENABLED, true),
  },
  rulesFirstEnabled: parseBooleanEnv(process.env.PLANNER_RULES_FIRST_ENABLED, true),
  catalogMaxActions: parseMinIntEnv(process.env.PLANNER_CATALOG_MAX_ACTIONS, 12, 5),
  patternCache: {
    enabled: parseBooleanEnv(process.env.PLANNER_PATTERN_CACHE_ENABLED, true),
    ttlMs: parseMinIntEnv(process.env.PLANNER_PATTERN_CACHE_TTL_MS, 30 * 60_000, 60_000),
    maxSize: parseMinIntEnv(process.env.PLANNER_PATTERN_CACHE_MAX_SIZE, 100, 10),
    minSimilarity: parseBoundedNumberEnv(process.env.PLANNER_PATTERN_CACHE_MIN_SIMILARITY, 0.75, 0.5, 1),
  },
} as const;

// ──── Pattern Cache ────────────────────────────────────────────────────────────

type CachedPlan = {
  goalTerms: Set<string>;
  actions: ActionPlan[];
  createdAt: number;
};

const patternCache: CachedPlan[] = [];

const evictExpiredEntries = (): void => {
  const now = Date.now();
  for (let i = patternCache.length - 1; i >= 0; i--) {
    if (now - patternCache[i].createdAt > PLANNER_CONFIG.patternCache.ttlMs) {
      patternCache.splice(i, 1);
    }
  }
};

const findCachedPlan = (goalTerms: Set<string>): ActionPlan[] | null => {
  if (!PLANNER_CONFIG.patternCache.enabled || patternCache.length === 0) return null;
  evictExpiredEntries();

  let bestMatch: CachedPlan | null = null;
  let bestScore = 0;

  for (const entry of patternCache) {
    const score = jaccardSets(goalTerms, entry.goalTerms);
    if (score >= PLANNER_CONFIG.patternCache.minSimilarity && score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestMatch ? bestMatch.actions : null;
};

const cachePlan = (goalTerms: Set<string>, actions: ActionPlan[]): void => {
  if (!PLANNER_CONFIG.patternCache.enabled || actions.length === 0) return;
  evictExpiredEntries();

  // Enforce max size — evict oldest
  while (patternCache.length >= PLANNER_CONFIG.patternCache.maxSize) {
    patternCache.shift();
  }

  patternCache.push({ goalTerms, actions, createdAt: Date.now() });
};

// ──── Exported cache stats (for diagnostics) ──────────────────────────────────

export const getPlannerCacheStats = () => ({
  enabled: PLANNER_CONFIG.patternCache.enabled,
  size: patternCache.length,
  maxSize: PLANNER_CONFIG.patternCache.maxSize,
  ttlMs: PLANNER_CONFIG.patternCache.ttlMs,
  minSimilarity: PLANNER_CONFIG.patternCache.minSimilarity,
});

/** Reduce LLM calls for simple goals — short or single-action-likely goals use k=1 */
const resolveAdaptiveSamples = (goal: string): number => {
  if (!PLANNER_CONFIG.selfConsistency.adaptiveSamplesEnabled || !PLANNER_CONFIG.selfConsistency.enabled) {
    return PLANNER_CONFIG.selfConsistency.samples;
  }
  const text = String(goal || '').trim();
  // Very short goals are almost always single-action
  if (text.length < 40) return 1;
  // Simple imperative goals don't benefit from multi-sample consensus
  const simplePatterns = /^(검색|찾아|알려|보여|조회|요약|상태|확인|정보)/;
  if (simplePatterns.test(text)) return 1;
  return PLANNER_CONFIG.selfConsistency.samples;
};

const toGoalTerms = (text: string): Set<string> => {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9\uac00-\ud7af_\-/]+/g).filter((t) => t.length >= 2),
  );
};

const jaccardSets = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
};

/** Rank actions by Jaccard similarity to the goal and return top-N catalog lines. */
const buildPrunedCatalog = (goal: string, maxActions = PLANNER_CONFIG.catalogMaxActions): string => {
  const goalTerms = toGoalTerms(goal);
  const termIndex = getActionTermIndex();
  const actions = listActions();

  const ranked = actions
    .map((action) => {
      const relevance = jaccardSets(goalTerms, termIndex.get(action.name) || new Set());
      const utility = getActionUtilityScore(action.name);
      // Penalize actions with high recent failure rate (only when enough runs exist)
      const utilityPenalty = utility.runs >= 3 && utility.successRate < 0.4 ? -0.1 : 0;
      return {
        action,
        score: relevance + utilityPenalty,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxActions);

  return ranked.map(({ action }) => `- ${action.name}: ${action.description}`).join('\n');
};

// ──── Dynamic n8n workflow catalog ─────────────────────────────────────────────

const N8N_CATALOG_CACHE_TTL_MS = parseMinIntEnv(process.env.N8N_CATALOG_CACHE_TTL_MS, 5 * 60_000, 30_000);

let n8nCatalogCache: { lines: string[]; fetchedAt: number } | null = null;

/**
 * Fetch live n8n workflow names. Cached to avoid API calls on every plan.
 * Returns empty array if n8n is unavailable — never blocks planner.
 */
const fetchN8nWorkflowCatalog = async (): Promise<string[]> => {
  const now = Date.now();
  if (n8nCatalogCache && now - n8nCatalogCache.fetchedAt < N8N_CATALOG_CACHE_TTL_MS) {
    return n8nCatalogCache.lines;
  }

  try {
    const result = await runExternalAction('n8n' as ExternalAdapterId, 'workflow.list', { limit: 25 });
    if (!result.ok) {
      n8nCatalogCache = { lines: [], fetchedAt: now };
      return [];
    }

    const parsed = JSON.parse(result.output[0] || '{}') as { data?: Array<{ id: string; name: string }> };
    const workflows = parsed.data || [];
    const lines = workflows.map((w) => `  - n8n.workflow.execute(workflowId="${w.id}"): ${w.name}`);
    n8nCatalogCache = { lines, fetchedAt: now };
    return lines;
  } catch {
    n8nCatalogCache = { lines: [], fetchedAt: now };
    return [];
  }
};

/** @internal Exported for testing only. */
export const _resetN8nCatalogCache = (): void => {
  n8nCatalogCache = null;
};

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
  guildId?: string;
  requestedBy?: string;
  providerProfile?: import('../../llmClient').LlmProviderProfile;
  sessionId?: string;
}): Promise<ActionPlan[] | null> => {
  try {
    const raw = await generateText({
      system: '너는 액션 체인 플래너다. 지정 스키마 JSON만 출력한다.',
      user: params.prompt,
      actionName: 'planner.action_chain',
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      providerProfile: params.providerProfile,
      sessionId: params.sessionId,
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

export const planActions = async (goal: string, options?: {
  guildId?: string;
  requestedBy?: string;
  providerProfile?: import('../../llmClient').LlmProviderProfile;
  sessionId?: string;
}): Promise<ActionChainPlan> => {
  const goalTerms = toGoalTerms(goal);

  // Pattern cache fast-path: reuse plan from a similar recent goal
  const cachedActions = findCachedPlan(goalTerms);
  if (cachedActions) {
    const withRag = await applyRagPriority(cachedActions, goal);
    return { actions: withRag.slice(0, 3) };
  }

  // Rules-first fast-path: if regex rules produce a plan, skip LLM entirely.
  if (PLANNER_CONFIG.rulesFirstEnabled) {
    const rulesPlan = await buildFallbackPlan(goal);
    if (rulesPlan.length > 0) {
      const withRag = await applyRagPriority(rulesPlan, goal);
      cachePlan(goalTerms, withRag.slice(0, 3));
      return { actions: withRag.slice(0, 3) };
    }
  }

  if (!isAnyLlmConfigured()) {
    return { actions: await fallbackPlan(goal) };
  }

  const actions = listActions();
  const catalog = buildPrunedCatalog(goal);

  // Always inject live n8n workflow catalog (cached, no-op when unavailable)
  const n8nHint = await fetchN8nWorkflowCatalog();

  const promptLines = [
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
  ];

  if (n8nHint.length > 0) {
    promptLines.push('', 'n8n 실행 가능한 워크플로 (n8n.workflow.execute의 workflowId로 사용):');
    promptLines.push(...n8nHint);
  }

  promptLines.push('', `목표: ${goal}`);
  const prompt = promptLines.join('\n');

  if (!PLANNER_CONFIG.selfConsistency.enabled || PLANNER_CONFIG.selfConsistency.samples <= 1) {
    const single = await requestPlanCandidate({
      goal,
      prompt,
      temperature: 0,
      guildId: options?.guildId,
      requestedBy: options?.requestedBy,
      providerProfile: options?.providerProfile,
      sessionId: options?.sessionId,
    });
    if (!single || single.length === 0) {
      return { actions: await fallbackPlan(goal) };
    }
    cachePlan(goalTerms, single);
    return { actions: single };
  }

  const k = resolveAdaptiveSamples(goal);
  if (k <= 1) {
    const single = await requestPlanCandidate({
      goal,
      prompt,
      temperature: 0,
      guildId: options?.guildId,
      requestedBy: options?.requestedBy,
      providerProfile: options?.providerProfile,
      sessionId: options?.sessionId,
    });
    if (!single || single.length === 0) {
      return { actions: await fallbackPlan(goal) };
    }
    cachePlan(goalTerms, single);
    return { actions: single };
  }

  const temperatures = Array.from({ length: k }, (_, index) => (
    index === 0 ? 0 : PLANNER_CONFIG.selfConsistency.temperature
  ));
  const candidates = await Promise.all(temperatures.map((temperature) => requestPlanCandidate({
    goal,
    prompt,
    temperature,
    guildId: options?.guildId,
    requestedBy: options?.requestedBy,
    providerProfile: options?.providerProfile,
    sessionId: options?.sessionId,
  })));
  const validCandidates = candidates.filter((candidate): candidate is ActionPlan[] => Boolean(candidate && candidate.length > 0));
  const consensus = selectConsensusActions(validCandidates);
  if (consensus.length === 0) {
    return { actions: await fallbackPlan(goal) };
  }

  cachePlan(goalTerms, consensus);
  return { actions: consensus };
};
