import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';

export type ActionExecutionLogEvent = {
  guildId: string;
  requestedBy: string;
  goal: string;
  actionName: string;
  ok: boolean;
  summary: string;
  artifacts: string[];
  verification: string[];
  durationMs: number;
  retryCount: number;
  circuitOpen: boolean;
  error?: string;
};

export const logActionExecutionEvent = async (event: ActionExecutionLogEvent) => {
  if (!isSupabaseConfigured()) {
    return;
  }

  try {
    const client = getSupabaseClient();
    await client.from('agent_action_logs').insert({
      guild_id: event.guildId,
      requested_by: event.requestedBy,
      goal: String(event.goal || '').slice(0, 1200),
      action_name: event.actionName,
      status: event.ok ? 'success' : 'failed',
      summary: String(event.summary || '').slice(0, 1200),
      artifacts: event.artifacts,
      verification: event.verification,
      duration_ms: Math.max(0, Math.trunc(event.durationMs || 0)),
      retry_count: Math.max(0, Math.trunc(event.retryCount || 0)),
      circuit_open: Boolean(event.circuitOpen),
      error: event.error || null,
    });
  } catch {
    // Logging must never break user flow.
  }
};
