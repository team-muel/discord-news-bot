import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import type { TaskRoute } from './taskRoutingService';

type TaskRoutingChannel = 'docs' | 'vibe';
type TaskRoutingStatus = 'success' | 'failed';

type TaskRoutingSummaryParams = {
  guildId?: string;
  days: number;
};

type RoutingRow = {
  guild_id: string | null;
  action_name: string | null;
  status: string | null;
  summary: string | null;
  artifacts: unknown;
  duration_ms: number | null;
  created_at: string | null;
};

const ROUTES: TaskRoute[] = ['knowledge', 'execution', 'mixed', 'casual'];
const CHANNELS: TaskRoutingChannel[] = ['docs', 'vibe'];
const ACTION_NAMES = ['task_routing_docs', 'task_routing_vibe'];
const FEEDBACK_ACTION_NAME = 'task_routing_feedback';

const toIsoFromDays = (days: number): string => {
  const safeDays = Math.max(1, Math.trunc(days));
  return new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
};

const toDateBucket = (iso: string | null): string => {
  if (!iso) {
    return 'unknown';
  }
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return 'unknown';
  }
  return new Date(ts).toISOString().slice(0, 10);
};

const parseChannel = (actionName: string | null): TaskRoutingChannel | null => {
  if (actionName === 'task_routing_docs') {
    return 'docs';
  }
  if (actionName === 'task_routing_vibe') {
    return 'vibe';
  }
  return null;
};

const parseRoute = (row: RoutingRow): TaskRoute | null => {
  const artifacts = Array.isArray(row.artifacts) ? row.artifacts : [];
  const first = artifacts[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const route = String((first as { route?: unknown }).route || '').trim().toLowerCase();
    if (ROUTES.includes(route as TaskRoute)) {
      return route as TaskRoute;
    }
  }

  const summary = String(row.summary || '');
  const match = summary.match(/route=(knowledge|execution|mixed|casual)/i);
  if (match) {
    return String(match[1]).toLowerCase() as TaskRoute;
  }
  return null;
};

const parseConfidence = (row: RoutingRow): number => {
  const artifacts = Array.isArray(row.artifacts) ? row.artifacts : [];
  const first = artifacts[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const raw = Number((first as { confidence?: unknown }).confidence);
    if (Number.isFinite(raw)) {
      return Math.max(0, Math.min(1, raw));
    }
  }

  const summary = String(row.summary || '');
  const match = summary.match(/confidence=([0-9]+(?:\.[0-9]+)?)/i);
  const value = Number(match?.[1] || NaN);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
};

const parseOverrideUsed = (row: RoutingRow): boolean => {
  const artifacts = Array.isArray(row.artifacts) ? row.artifacts : [];
  const first = artifacts[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    return Boolean((first as { overrideUsed?: unknown }).overrideUsed);
  }

  const summary = String(row.summary || '');
  return /override=1\b/i.test(summary);
};

const normalizeStatus = (value: string | null): TaskRoutingStatus => {
  return String(value || '').trim().toLowerCase() === 'failed' ? 'failed' : 'success';
};

const pct = (num: number, den: number): number => {
  if (den <= 0) {
    return 0;
  }
  return Number(((num / den) * 100).toFixed(2));
};

export const getTaskRoutingSummary = async (params: TaskRoutingSummaryParams) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const days = Math.max(1, Math.min(90, Math.trunc(params.days)));
  const since = toIsoFromDays(days);
  const client = getSupabaseClient();

  let query = client
    .from('agent_action_logs')
    .select('guild_id, action_name, status, summary, artifacts, duration_ms, created_at')
    .in('action_name', ACTION_NAMES)
    .gte('created_at', since)
    .limit(10000);

  let feedbackQuery = client
    .from('agent_action_logs')
    .select('guild_id, action_name, status, summary, artifacts, duration_ms, created_at')
    .eq('action_name', FEEDBACK_ACTION_NAME)
    .gte('created_at', since)
    .limit(5000);

  if (params.guildId) {
    query = query.eq('guild_id', params.guildId);
    feedbackQuery = feedbackQuery.eq('guild_id', params.guildId);
  }

  const [{ data, error }, { data: feedbackData, error: feedbackError }] = await Promise.all([
    query,
    feedbackQuery,
  ]);
  if (error) {
    throw new Error(error.message || 'TASK_ROUTING_SUMMARY_QUERY_FAILED');
  }
  if (feedbackError) {
    throw new Error(feedbackError.message || 'TASK_ROUTING_FEEDBACK_QUERY_FAILED');
  }

  const rows = (data || []) as RoutingRow[];
  const feedbackRows = (feedbackData || []) as RoutingRow[];
  const daily = new Map<string, { total: number; success: number; failed: number }>();
  const routeStats = new Map<string, {
    channel: TaskRoutingChannel;
    route: TaskRoute;
    total: number;
    success: number;
    failed: number;
    overrideCount: number;
    confidenceSum: number;
    durationSum: number;
    durationCount: number;
  }>();

  const channelTotals = new Map<TaskRoutingChannel, { total: number; success: number; failed: number }>();
  for (const channel of CHANNELS) {
    channelTotals.set(channel, { total: 0, success: 0, failed: 0 });
  }

  const feedbackByRoute = new Map<string, { count: number; scoreSum: number; lowScoreCount: number }>();

  for (const row of rows) {
    const channel = parseChannel(row.action_name);
    const route = parseRoute(row);
    if (!channel || !route) {
      continue;
    }

    const status = normalizeStatus(row.status);
    const confidence = parseConfidence(row);
    const durationMs = Number(row.duration_ms || 0);
    const durationValid = Number.isFinite(durationMs) && durationMs >= 0;
    const overrideUsed = parseOverrideUsed(row);
    const day = toDateBucket(row.created_at);

    const channelTotal = channelTotals.get(channel)!;
    channelTotal.total += 1;
    if (status === 'failed') {
      channelTotal.failed += 1;
    } else {
      channelTotal.success += 1;
    }

    const dayAgg = daily.get(day) || { total: 0, success: 0, failed: 0 };
    dayAgg.total += 1;
    if (status === 'failed') {
      dayAgg.failed += 1;
    } else {
      dayAgg.success += 1;
    }
    daily.set(day, dayAgg);

    const key = `${channel}:${route}`;
    const agg = routeStats.get(key) || {
      channel,
      route,
      total: 0,
      success: 0,
      failed: 0,
      overrideCount: 0,
      confidenceSum: 0,
      durationSum: 0,
      durationCount: 0,
    };

    agg.total += 1;
    if (status === 'failed') {
      agg.failed += 1;
    } else {
      agg.success += 1;
    }
    if (overrideUsed) {
      agg.overrideCount += 1;
    }
    agg.confidenceSum += confidence;
    if (durationValid) {
      agg.durationSum += durationMs;
      agg.durationCount += 1;
    }

    routeStats.set(key, agg);
  }

  const byRoute = [...routeStats.values()]
    .map((row) => ({
      channel: row.channel,
      route: row.route,
      total: row.total,
      success: row.success,
      failed: row.failed,
      successRatePct: pct(row.success, row.total),
      overrideRatePct: pct(row.overrideCount, row.total),
      avgConfidence: Number((row.confidenceSum / Math.max(1, row.total)).toFixed(4)),
      avgDurationMs: row.durationCount > 0 ? Number((row.durationSum / row.durationCount).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const byChannel = CHANNELS.map((channel) => {
    const totals = channelTotals.get(channel)!;
    return {
      channel,
      total: totals.total,
      success: totals.success,
      failed: totals.failed,
      successRatePct: pct(totals.success, totals.total),
    };
  });

  const byDay = [...daily.entries()]
    .map(([day, value]) => ({
      day,
      total: value.total,
      success: value.success,
      failed: value.failed,
      successRatePct: pct(value.success, value.total),
    }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  for (const row of feedbackRows) {
    const route = parseRoute(row);
    if (!route) {
      continue;
    }

    const artifacts = Array.isArray(row.artifacts) ? row.artifacts : [];
    const first = artifacts[0] && typeof artifacts[0] === 'object' && !Array.isArray(artifacts[0])
      ? (artifacts[0] as { outcomeScore?: unknown })
      : null;
    const summary = String(row.summary || '');
    const summaryMatch = summary.match(/outcome_score=([0-9]+(?:\.[0-9]+)?)/i);
    const score = Number(first?.outcomeScore ?? summaryMatch?.[1] ?? NaN);
    if (!Number.isFinite(score)) {
      continue;
    }
    const clamped = Math.max(0, Math.min(1, score));
    const bucket = feedbackByRoute.get(route) || { count: 0, scoreSum: 0, lowScoreCount: 0 };
    bucket.count += 1;
    bucket.scoreSum += clamped;
    if (clamped < 0.5) {
      bucket.lowScoreCount += 1;
    }
    feedbackByRoute.set(route, bucket);
  }

  const feedback = ROUTES
    .map((route) => {
      const bucket = feedbackByRoute.get(route);
      if (!bucket) {
        return {
          route,
          count: 0,
          avgOutcomeScore: 0,
          lowScoreRatePct: 0,
        };
      }

      return {
        route,
        count: bucket.count,
        avgOutcomeScore: Number((bucket.scoreSum / Math.max(1, bucket.count)).toFixed(4)),
        lowScoreRatePct: pct(bucket.lowScoreCount, bucket.count),
      };
    });

  return {
    scope: params.guildId || 'all',
    windowDays: days,
    since,
    total: rows.length,
    byChannel,
    byRoute,
    byDay,
    feedback,
    generatedAt: new Date().toISOString(),
  };
};

export const buildTaskRoutingPolicyHints = (summary: Awaited<ReturnType<typeof getTaskRoutingSummary>>) => {
  const hints: Array<{
    severity: 'high' | 'medium' | 'low';
    route: TaskRoute | 'global';
    message: string;
    evidence: Record<string, unknown>;
  }> = [];

  for (const row of summary.byRoute) {
    if (row.total >= 20 && row.successRatePct < 70) {
      hints.push({
        severity: row.successRatePct < 55 ? 'high' : 'medium',
        route: row.route,
        message: `route=${row.route} successRate가 낮습니다. 키워드/분기 규칙 보정이 필요합니다.`,
        evidence: {
          channel: row.channel,
          total: row.total,
          successRatePct: row.successRatePct,
          avgConfidence: row.avgConfidence,
        },
      });
    }

    if (row.total >= 20 && row.overrideRatePct >= 25) {
      hints.push({
        severity: 'medium',
        route: row.route,
        message: `route=${row.route} 수동 override 비율이 높습니다. 정책 라우팅과 사용자 기대가 어긋납니다.`,
        evidence: {
          channel: row.channel,
          total: row.total,
          overrideRatePct: row.overrideRatePct,
        },
      });
    }
  }

  for (const fb of summary.feedback) {
    if (fb.count >= 10 && fb.avgOutcomeScore < 0.55) {
      hints.push({
        severity: fb.avgOutcomeScore < 0.45 ? 'high' : 'medium',
        route: fb.route,
        message: `route=${fb.route} 사용자 결과 점수가 낮습니다. 응답 템플릿/기억랭킹/후속질문 정책 개선이 필요합니다.`,
        evidence: {
          count: fb.count,
          avgOutcomeScore: fb.avgOutcomeScore,
          lowScoreRatePct: fb.lowScoreRatePct,
        },
      });
    }
  }

  if (summary.total < 30) {
    hints.push({
      severity: 'low',
      route: 'global',
      message: '표본 수가 적습니다. 자동 정책 변경보다 관측 기간을 늘리세요.',
      evidence: {
        total: summary.total,
      },
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: summary.windowDays,
    scope: summary.scope,
    hints,
  };
};
