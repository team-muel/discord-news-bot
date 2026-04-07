import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { searchObsidianVaultWithAdapter } from '../obsidian/router';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getClient } from '../infra/baseRepository';
import { T_RETRIEVAL_EVAL_SETS, T_RETRIEVAL_EVAL_CASES, T_RETRIEVAL_EVAL_TARGETS, T_RETRIEVAL_EVAL_RUNS, T_RETRIEVAL_EVAL_RESULTS, T_RETRIEVAL_RANKER_EXPERIMENTS, T_RETRIEVAL_RANKER_ACTIVE_PROFILES } from '../infra/tableRegistry';
import { parseBoundedNumberEnv, parseIntegerEnv, parseNumberEnv } from '../../utils/env';
import { getErrorMessage } from '../../utils/errorMessage';

const RETRIEVAL_EVAL_DEFAULT_TOP_K = parseBoundedNumberEnv(process.env.RETRIEVAL_EVAL_DEFAULT_TOP_K, 5, 1, 20);
const RETRIEVAL_TUNING_MIN_CASES = Math.max(10, parseIntegerEnv(process.env.RETRIEVAL_TUNING_MIN_CASES, 30));
const RETRIEVAL_TUNING_MIN_NDCG_DELTA = Math.max(0.001, parseNumberEnv(process.env.RETRIEVAL_TUNING_MIN_NDCG_DELTA, 0.03));
const RETRIEVAL_SHADOW_VARIANTS = String(process.env.RETRIEVAL_SHADOW_VARIANTS || 'intent_prefix,keyword_expansion')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

export type RetrievalShadowVariant = 'baseline' | 'intent_prefix' | 'keyword_expansion';

const SUPPORTED_VARIANTS = new Set<RetrievalShadowVariant>(['baseline', 'intent_prefix', 'keyword_expansion']);

type EvalCaseInput = {
  evalSetId: number;
  guildId: string;
  query: string;
  intent?: string;
  difficulty?: string;
  enabled?: boolean;
  targets: Array<{ filePath: string; gain?: number }>;
};

const ensureSupabase = () => {
  const db = getClient();
  if (!db) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  return db;
};

const normalizeText = (value: unknown): string => String(value || '').trim();

const normalizePath = (value: unknown): string => String(value || '').trim().replace(/\\/g, '/');

const uniqueArray = <T>(values: T[]): T[] => [...new Set(values)];

function toIntentExpansion(intent: string): string {
  const normalized = String(intent || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized.includes('memory')) return 'retrieval context lore';
  if (normalized.includes('trading')) return 'strategy market price';
  if (normalized.includes('architecture')) return 'design pattern system';
  if (normalized.includes('operations')) return 'runbook incident monitor';
  if (normalized.includes('policy')) return 'governance approval role';
  if (normalized.includes('news')) return 'briefing headline summary';
  return normalized;
}

function buildVariantQuery(query: string, intent: string, variant: RetrievalShadowVariant): string {
  const cleanQuery = normalizeText(query);
  const cleanIntent = normalizeText(intent).toLowerCase();
  if (variant === 'baseline') {
    return cleanQuery;
  }

  if (variant === 'intent_prefix') {
    if (!cleanIntent) {
      return cleanQuery;
    }
    return `tag:${cleanIntent} ${cleanQuery}`.trim();
  }

  if (variant === 'keyword_expansion') {
    const expansion = toIntentExpansion(cleanIntent);
    if (!expansion) {
      return cleanQuery;
    }
    return `${cleanQuery} ${expansion}`.trim();
  }

  return cleanQuery;
}

function computeDcg(paths: string[], gainByPath: Map<string, number>, topK: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(topK, paths.length); i += 1) {
    const path = normalizePath(paths[i]);
    const gain = Math.max(0, Number(gainByPath.get(path) || 0));
    if (gain <= 0) {
      continue;
    }
    const denom = Math.log2(i + 2);
    dcg += gain / denom;
  }
  return dcg;
}

function computeMetrics(params: {
  retrievedPaths: string[];
  gainByPath: Map<string, number>;
  topK: number;
}): { recallAtK: number; mrr: number; ndcg: number; hitAtK: number } {
  const { retrievedPaths, gainByPath, topK } = params;
  const relevantPaths = [...gainByPath.keys()].filter((path) => (gainByPath.get(path) || 0) > 0);
  const relevantSet = new Set(relevantPaths.map((path) => normalizePath(path)));

  if (relevantSet.size === 0) {
    return { recallAtK: 0, mrr: 0, ndcg: 0, hitAtK: 0 };
  }

  const topPaths = retrievedPaths.slice(0, topK).map((path) => normalizePath(path));
  const hitCount = topPaths.filter((path) => relevantSet.has(path)).length;
  const recallAtK = hitCount / relevantSet.size;

  let mrr = 0;
  for (let i = 0; i < topPaths.length; i += 1) {
    if (relevantSet.has(topPaths[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  const dcg = computeDcg(topPaths, gainByPath, topK);
  const idealPaths = [...relevantSet].sort((a, b) => (gainByPath.get(b) || 0) - (gainByPath.get(a) || 0));
  const idcg = computeDcg(idealPaths, gainByPath, topK);
  const ndcg = idcg > 0 ? dcg / idcg : 0;

  return {
    recallAtK: Number(recallAtK.toFixed(4)),
    mrr: Number(mrr.toFixed(4)),
    ndcg: Number(ndcg.toFixed(4)),
    hitAtK: hitCount > 0 ? 1 : 0,
  };
}

export async function createRetrievalEvalSet(params: {
  guildId: string;
  name: string;
  description?: string;
  createdBy: string;
}) {
  const client = ensureSupabase();
  const row = {
    guild_id: normalizeText(params.guildId),
    name: normalizeText(params.name),
    description: normalizeText(params.description) || null,
    created_by: normalizeText(params.createdBy) || 'api',
  };

  if (!row.guild_id || !row.name) {
    throw new Error('VALIDATION');
  }

  const { data, error } = await client
    .from(T_RETRIEVAL_EVAL_SETS)
    .insert(row)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'RETRIEVAL_EVAL_SET_CREATE_FAILED');
  }

  return data;
}

export async function upsertRetrievalEvalCase(params: EvalCaseInput) {
  const client = ensureSupabase();
  const query = normalizeText(params.query);
  const guildId = normalizeText(params.guildId);
  if (!guildId || !query || !Number.isFinite(params.evalSetId)) {
    throw new Error('VALIDATION');
  }

  const insertCase = {
    eval_set_id: params.evalSetId,
    guild_id: guildId,
    query,
    intent: normalizeText(params.intent) || null,
    difficulty: normalizeText(params.difficulty) || 'normal',
    enabled: params.enabled !== false,
  };

  const { data: caseRow, error: caseError } = await client
    .from(T_RETRIEVAL_EVAL_CASES)
    .insert(insertCase)
    .select('*')
    .single();

  if (caseError) {
    throw new Error(caseError.message || 'RETRIEVAL_EVAL_CASE_UPSERT_FAILED');
  }

  const caseId = Number(caseRow.id);
  await client
    .from(T_RETRIEVAL_EVAL_TARGETS)
    .delete()
    .eq('case_id', caseId);

  const normalizedTargets = uniqueArray(
    (params.targets || [])
      .map((target) => ({
        case_id: caseId,
        target_file_path: normalizePath(target.filePath),
        gain: Math.max(0.1, Number(target.gain ?? 1)),
      }))
      .filter((target) => Boolean(target.target_file_path)),
  );

  if (normalizedTargets.length > 0) {
    const { error: targetError } = await client
      .from(T_RETRIEVAL_EVAL_TARGETS)
      .insert(normalizedTargets);

    if (targetError) {
      throw new Error(targetError.message || 'RETRIEVAL_EVAL_TARGET_UPSERT_FAILED');
    }
  }

  return caseRow;
}

export async function listRetrievalEvalCases(params: { guildId: string; evalSetId?: number; limit: number }) {
  const client = ensureSupabase();
  let query = client
    .from(T_RETRIEVAL_EVAL_CASES)
    .select('id, eval_set_id, guild_id, query, intent, difficulty, enabled, created_at, updated_at')
    .eq('guild_id', params.guildId)
    .order('updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(300, params.limit)));

  if (params.evalSetId) {
    query = query.eq('eval_set_id', params.evalSetId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message || 'RETRIEVAL_EVAL_CASE_LIST_FAILED');
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  const caseIds = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));

  const targetMap = new Map<number, Array<{ filePath: string; gain: number }>>();
  if (caseIds.length > 0) {
    const { data: targetRows, error: targetError } = await client
      .from(T_RETRIEVAL_EVAL_TARGETS)
      .select('case_id, target_file_path, gain')
      .in('case_id', caseIds)
      .order('case_id', { ascending: true });

    if (targetError) {
      throw new Error(targetError.message || 'RETRIEVAL_EVAL_TARGET_LIST_FAILED');
    }

    for (const row of (targetRows || []) as Array<Record<string, unknown>>) {
      const caseId = Number(row.case_id);
      const target = {
        filePath: normalizePath(row.target_file_path),
        gain: Math.max(0, Number(row.gain || 1)),
      };
      const current = targetMap.get(caseId) || [];
      current.push(target);
      targetMap.set(caseId, current);
    }
  }

  return rows.map((row) => ({
    id: Number(row.id),
    evalSetId: Number(row.eval_set_id),
    guildId: String(row.guild_id || ''),
    query: String(row.query || ''),
    intent: String(row.intent || ''),
    difficulty: String(row.difficulty || ''),
    enabled: Boolean(row.enabled),
    targets: targetMap.get(Number(row.id)) || [],
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }));
}

export async function runRetrievalEval(params: {
  guildId: string;
  evalSetId?: number;
  requestedBy: string;
  topK?: number;
  variants?: string[];
}) {
  const client = ensureSupabase();
  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    throw new Error('OBSIDIAN_VAULT_PATH_MISSING');
  }

  const topK = Math.max(1, Math.min(20, Number(params.topK || RETRIEVAL_EVAL_DEFAULT_TOP_K)));
  const requestedVariants = uniqueArray([
    'baseline',
    ...(params.variants || RETRIEVAL_SHADOW_VARIANTS),
  ])
    .map((variant) => String(variant || '').trim() as RetrievalShadowVariant)
    .filter((variant) => SUPPORTED_VARIANTS.has(variant));

  const runInsert = {
    guild_id: params.guildId,
    eval_set_id: params.evalSetId || null,
    requested_by: params.requestedBy,
    status: 'running',
    top_k: topK,
    variants: requestedVariants,
    started_at: new Date().toISOString(),
  };

  const { data: runRow, error: runError } = await client
    .from(T_RETRIEVAL_EVAL_RUNS)
    .insert(runInsert)
    .select('*')
    .single();

  if (runError) {
    throw new Error(runError.message || 'RETRIEVAL_EVAL_RUN_CREATE_FAILED');
  }

  const runId = Number(runRow.id);

  try {
    const cases = await listRetrievalEvalCases({
      guildId: params.guildId,
      evalSetId: params.evalSetId,
      limit: 1000,
    });
    const enabledCases = cases.filter((row) => row.enabled);

    let totalResults = 0;
    for (const evalCase of enabledCases) {
      const gainByPath = new Map<string, number>(
        evalCase.targets.map((target) => [normalizePath(target.filePath), Math.max(0.1, Number(target.gain || 1))]),
      );

      for (const variant of requestedVariants) {
        const queryText = buildVariantQuery(evalCase.query, evalCase.intent, variant);
        const startedAt = Date.now();
        const results = await searchObsidianVaultWithAdapter({
          vaultPath,
          query: queryText,
          limit: topK,
        });
        const latencyMs = Date.now() - startedAt;
        const retrievedPaths = results.map((row) => normalizePath(row.filePath));
        const metrics = computeMetrics({
          retrievedPaths,
          gainByPath,
          topK,
        });

        const resultRow = {
          run_id: runId,
          guild_id: params.guildId,
          case_id: evalCase.id,
          variant,
          query: evalCase.query,
          executed_query: queryText,
          top_k: topK,
          recall_at_k: metrics.recallAtK,
          mrr: metrics.mrr,
          ndcg: metrics.ndcg,
          hit_at_k: metrics.hitAtK,
          latency_ms: latencyMs,
          retrieved_paths: retrievedPaths,
          expected_paths: [...gainByPath.keys()],
        };

        const { error: resultError } = await client
          .from(T_RETRIEVAL_EVAL_RESULTS)
          .insert(resultRow);

        if (resultError) {
          throw new Error(resultError.message || 'RETRIEVAL_EVAL_RESULT_INSERT_FAILED');
        }

        totalResults += 1;
      }
    }

    const summary = await summarizeRetrievalEvalRun({ runId, guildId: params.guildId });

    await client
      .from(T_RETRIEVAL_EVAL_RUNS)
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        case_count: enabledCases.length,
        result_count: totalResults,
        summary,
      })
      .eq('id', runId);

    return {
      runId,
      status: 'completed',
      caseCount: enabledCases.length,
      resultCount: totalResults,
      summary,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    await client
      .from(T_RETRIEVAL_EVAL_RUNS)
      .update({
        status: 'failed',
        ended_at: new Date().toISOString(),
        error: message,
      })
      .eq('id', runId);
    throw error;
  }
}

export async function summarizeRetrievalEvalRun(params: { runId: number; guildId: string }) {
  const client = ensureSupabase();
  const { data, error } = await client
    .from(T_RETRIEVAL_EVAL_RESULTS)
    .select('variant, recall_at_k, mrr, ndcg, hit_at_k, latency_ms')
    .eq('run_id', params.runId)
    .eq('guild_id', params.guildId)
    .limit(100000);

  if (error) {
    throw new Error(error.message || 'RETRIEVAL_EVAL_SUMMARY_FAILED');
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  const byVariant = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const variant = String(row.variant || 'baseline');
    const list = byVariant.get(variant) || [];
    list.push(row);
    byVariant.set(variant, list);
  }

  const summarize = (variantRows: Array<Record<string, unknown>>) => {
    const count = variantRows.length;
    if (count === 0) {
      return {
        count: 0,
        recallAtK: 0,
        mrr: 0,
        ndcg: 0,
        hitRate: 0,
        avgLatencyMs: 0,
      };
    }

    const sumRecall = variantRows.reduce((acc, row) => acc + Number(row.recall_at_k || 0), 0);
    const sumMrr = variantRows.reduce((acc, row) => acc + Number(row.mrr || 0), 0);
    const sumNdcg = variantRows.reduce((acc, row) => acc + Number(row.ndcg || 0), 0);
    const sumHit = variantRows.reduce((acc, row) => acc + Number(row.hit_at_k || 0), 0);
    const sumLatency = variantRows.reduce((acc, row) => acc + Number(row.latency_ms || 0), 0);

    return {
      count,
      recallAtK: Number((sumRecall / count).toFixed(4)),
      mrr: Number((sumMrr / count).toFixed(4)),
      ndcg: Number((sumNdcg / count).toFixed(4)),
      hitRate: Number((sumHit / count).toFixed(4)),
      avgLatencyMs: Number((sumLatency / count).toFixed(2)),
    };
  };

  const summary: Record<string, unknown> = {
    runId: params.runId,
    totalRows: rows.length,
    variants: {},
    generatedAt: new Date().toISOString(),
  };

  for (const [variant, variantRows] of byVariant.entries()) {
    (summary.variants as Record<string, unknown>)[variant] = summarize(variantRows);
  }

  return summary;
}

export async function runRetrievalAutoTuning(params: {
  guildId: string;
  runId: number;
  requestedBy: string;
  applyIfBetter?: boolean;
}) {
  const client = ensureSupabase();
  const summary = await summarizeRetrievalEvalRun({ runId: params.runId, guildId: params.guildId });
  const variants = (summary.variants || {}) as Record<string, {
    count: number;
    ndcg: number;
    avgLatencyMs: number;
  }>;

  const baseline = variants.baseline;
  if (!baseline || baseline.count < RETRIEVAL_TUNING_MIN_CASES) {
    return {
      recommended: null,
      applied: false,
      reason: 'INSUFFICIENT_BASELINE_CASES',
      summary,
    };
  }

  const candidates = Object.entries(variants)
    .filter(([name, stat]) => name !== 'baseline' && stat.count >= RETRIEVAL_TUNING_MIN_CASES)
    .map(([name, stat]) => ({
      variant: name,
      ndcgDelta: Number((Number(stat.ndcg || 0) - Number(baseline.ndcg || 0)).toFixed(4)),
      latencyDeltaMs: Number((Number(stat.avgLatencyMs || 0) - Number(baseline.avgLatencyMs || 0)).toFixed(2)),
      count: Number(stat.count || 0),
      ndcg: Number(stat.ndcg || 0),
      avgLatencyMs: Number(stat.avgLatencyMs || 0),
    }))
    .sort((a, b) => b.ndcgDelta - a.ndcgDelta);

  const best = candidates[0] || null;
  if (!best || best.ndcgDelta < RETRIEVAL_TUNING_MIN_NDCG_DELTA) {
    return {
      recommended: null,
      applied: false,
      reason: 'NO_VARIANT_MEETS_THRESHOLD',
      summary,
    };
  }

  const experimentRow = {
    guild_id: params.guildId,
    run_id: params.runId,
    requested_by: params.requestedBy,
    baseline_variant: 'baseline',
    candidate_variant: best.variant,
    baseline_ndcg: Number(baseline.ndcg || 0),
    candidate_ndcg: best.ndcg,
    ndcg_delta: best.ndcgDelta,
    baseline_latency_ms: Number(baseline.avgLatencyMs || 0),
    candidate_latency_ms: best.avgLatencyMs,
    latency_delta_ms: best.latencyDeltaMs,
    decision: params.applyIfBetter ? 'applied' : 'recommended',
    meta: {
      minCases: RETRIEVAL_TUNING_MIN_CASES,
      minNdcgDelta: RETRIEVAL_TUNING_MIN_NDCG_DELTA,
      summary,
    },
  };

  const { data: experiment, error: experimentError } = await client
    .from(T_RETRIEVAL_RANKER_EXPERIMENTS)
    .insert(experimentRow)
    .select('*')
    .single();

  if (experimentError) {
    throw new Error(experimentError.message || 'RETRIEVAL_TUNING_EXPERIMENT_INSERT_FAILED');
  }

  let applied = false;
  if (params.applyIfBetter) {
    const { error: profileError } = await client
      .from(T_RETRIEVAL_RANKER_ACTIVE_PROFILES)
      .upsert({
        guild_id: params.guildId,
        active_variant: best.variant,
        updated_by: params.requestedBy,
      }, {
        onConflict: 'guild_id',
      });

    if (profileError) {
      throw new Error(profileError.message || 'RETRIEVAL_TUNING_PROFILE_UPSERT_FAILED');
    }
    applied = true;
  }

  return {
    recommended: best,
    applied,
    reason: applied ? 'APPLIED' : 'RECOMMENDED_ONLY',
    experiment,
    summary,
  };
}

export async function getRetrievalEvalRun(params: { runId: number; guildId: string }) {
  const client = ensureSupabase();
  const { data: runRows, error: runError } = await client
    .from(T_RETRIEVAL_EVAL_RUNS)
    .select('*')
    .eq('id', params.runId)
    .eq('guild_id', params.guildId)
    .limit(1);

  if (runError) {
    throw new Error(runError.message || 'RETRIEVAL_EVAL_RUN_READ_FAILED');
  }

  const run = (runRows || [])[0] as Record<string, unknown> | undefined;
  if (!run) {
    throw new Error('RETRIEVAL_EVAL_RUN_NOT_FOUND');
  }

  const summary = await summarizeRetrievalEvalRun({ runId: params.runId, guildId: params.guildId });

  return {
    id: Number(run.id),
    guildId: String(run.guild_id || ''),
    evalSetId: Number(run.eval_set_id || 0) || null,
    requestedBy: String(run.requested_by || ''),
    status: String(run.status || ''),
    topK: Number(run.top_k || 0),
    variants: Array.isArray(run.variants) ? run.variants : [],
    caseCount: Number(run.case_count || 0),
    resultCount: Number(run.result_count || 0),
    startedAt: String(run.started_at || ''),
    endedAt: String(run.ended_at || ''),
    error: String(run.error || ''),
    summary,
  };
}
