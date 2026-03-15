import type { AgentSession } from './multiAgentService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

let disabled = false;

const isMissingTableError = (error: any) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes('agent_sessions') || message.includes('agent_steps');
};

const isMissingColumnError = (error: any, column: string) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42703' || message.includes(String(column || '').toLowerCase());
};

const buildShadowSummaryForPersistence = (session: AgentSession) => {
  const shadow = session.shadowGraph;
  const traceLength = shadow?.trace.length || 0;
  const lastNode = traceLength > 0 ? shadow?.trace[traceLength - 1]?.node || null : null;
  return {
    traceLength,
    lastNode,
    intent: shadow?.intent || null,
    hasError: Boolean(shadow?.errorCode),
  };
};

const buildProgressSummaryForPersistence = (session: AgentSession) => {
  const totalSteps = session.steps.length;
  const completedSteps = session.steps.filter((step) => step.status === 'completed').length;
  const failedSteps = session.steps.filter((step) => step.status === 'failed').length;
  const cancelledSteps = session.steps.filter((step) => step.status === 'cancelled').length;
  const doneSteps = completedSteps + failedSteps + cancelledSteps;
  const progressPercent = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 100;

  return {
    totalSteps,
    doneSteps,
    progressPercent,
    deliberationMode: session.deliberationMode || 'direct',
    riskScore: Number.isFinite(session.riskScore) ? Number(session.riskScore) : 0,
    policyDecision: session.policyGate?.decision || 'allow',
    policyReasons: [...(session.policyGate?.reasons || [])],
  };
};

export const persistAgentSession = async (session: AgentSession): Promise<void> => {
  if (!isSupabaseConfigured() || disabled) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const baseSessionRow = {
      id: session.id,
      guild_id: session.guildId,
      requested_by: session.requestedBy,
      goal: session.goal,
      priority: session.priority,
      requested_skill_id: session.requestedSkillId,
      status: session.status,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      started_at: session.startedAt,
      ended_at: session.endedAt,
      result: session.result,
      error: session.error,
    };

    let { error } = await client.from('agent_sessions').upsert(
      {
        ...baseSessionRow,
        shadow_graph_summary: buildShadowSummaryForPersistence(session),
        progress_summary: buildProgressSummaryForPersistence(session),
      },
      { onConflict: 'id' },
    );

    if (error && (isMissingColumnError(error, 'shadow_graph_summary') || isMissingColumnError(error, 'progress_summary'))) {
      const fallback = await client.from('agent_sessions').upsert(baseSessionRow, { onConflict: 'id' });
      error = fallback.error;
    }

    if (error) {
      if (isMissingTableError(error)) {
        disabled = true;
      }
      return;
    }

    const stepRows = session.steps.map((step) => ({
      id: step.id,
      session_id: session.id,
      role: step.role,
      title: step.title,
      status: step.status,
      started_at: step.startedAt,
      ended_at: step.endedAt,
      output: step.output,
      error: step.error,
      updated_at: session.updatedAt,
    }));

    if (stepRows.length > 0) {
      const { error: stepError } = await client.from('agent_steps').upsert(stepRows, { onConflict: 'id' });
      if (stepError && isMissingTableError(stepError)) {
        disabled = true;
      }
    }
  } catch {
    // Best-effort persistence only.
  }
};
