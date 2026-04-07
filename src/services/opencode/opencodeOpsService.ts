import { parseIntegerEnv, parseStringEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

const ACTION_APPROVAL_TABLE = parseStringEnv(process.env.ACTION_APPROVAL_TABLE, 'agent_action_approval_requests');
const OPENCODE_ACTION_NAME = 'opencode.execute';
const SUMMARY_DEFAULT_DAYS = Math.max(1, parseIntegerEnv(process.env.OPENCODE_SUMMARY_DEFAULT_DAYS, 7));

const toDays = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return SUMMARY_DEFAULT_DAYS;
  }
  return Math.max(1, Math.min(90, Math.trunc(parsed)));
};

const toErrorCode = (value: unknown): string => {
  const text = String(value || '').trim();
  if (!text) {
    return 'UNKNOWN';
  }
  return text.slice(0, 80);
};

export const getOpencodeExecutionSummary = async (params: {
  guildId: string;
  days?: number;
}) => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const days = toDays(params.days);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  if (!isSupabaseConfigured()) {
    return {
      guildId,
      windowDays: days,
      since: sinceIso,
      executions: {
        total: 0,
        success: 0,
        failed: 0,
        approvalRequired: 0,
        avgDurationMs: 0,
        topErrors: [] as Array<{ code: string; count: number }>,
      },
      approvals: {
        pending: 0,
        approved: 0,
        rejected: 0,
        expired: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  const client = getSupabaseClient();
  const [logsRes, pendingRes, approvedRes, rejectedRes, expiredRes] = await Promise.all([
    client
      .from('agent_action_logs')
      .select('status, error, duration_ms, created_at')
      .eq('guild_id', guildId)
      .eq('action_name', OPENCODE_ACTION_NAME)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(5000),
    client
      .from(ACTION_APPROVAL_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('action_name', OPENCODE_ACTION_NAME)
      .eq('status', 'pending'),
    client
      .from(ACTION_APPROVAL_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('action_name', OPENCODE_ACTION_NAME)
      .eq('status', 'approved')
      .gte('created_at', sinceIso),
    client
      .from(ACTION_APPROVAL_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('action_name', OPENCODE_ACTION_NAME)
      .eq('status', 'rejected')
      .gte('created_at', sinceIso),
    client
      .from(ACTION_APPROVAL_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('action_name', OPENCODE_ACTION_NAME)
      .eq('status', 'expired')
      .gte('created_at', sinceIso),
  ]);

  if (logsRes.error) {
    throw new Error(logsRes.error.message || 'OPENCODE_LOG_SUMMARY_QUERY_FAILED');
  }
  if (pendingRes.error || approvedRes.error || rejectedRes.error || expiredRes.error) {
    throw new Error('OPENCODE_APPROVAL_SUMMARY_QUERY_FAILED');
  }

  const rows = (logsRes.data || []) as Array<Record<string, unknown>>;
  const total = rows.length;
  const success = rows.filter((row) => String(row.status || '').trim().toLowerCase() === 'success').length;
  const failed = Math.max(0, total - success);
  const approvalRequired = rows.filter((row) => String(row.error || '').trim() === 'ACTION_APPROVAL_REQUIRED').length;

  const durations = rows
    .map((row) => Number(row.duration_ms || 0))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const avgDurationMs = durations.length > 0
    ? Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(2))
    : 0;

  const errorCounts = new Map<string, number>();
  for (const row of rows) {
    const code = toErrorCode(row.error);
    if (code === 'UNKNOWN') {
      continue;
    }
    errorCounts.set(code, (errorCounts.get(code) || 0) + 1);
  }

  const topErrors = [...errorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([code, count]) => ({ code, count }));

  return {
    guildId,
    windowDays: days,
    since: sinceIso,
    executions: {
      total,
      success,
      failed,
      approvalRequired,
      avgDurationMs,
      topErrors,
    },
    approvals: {
      pending: Number(pendingRes.count || 0),
      approved: Number(approvedRes.count || 0),
      rejected: Number(rejectedRes.count || 0),
      expired: Number(expiredRes.count || 0),
    },
    generatedAt: new Date().toISOString(),
  };
};
