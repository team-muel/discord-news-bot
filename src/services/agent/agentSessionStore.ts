import type { AgentSession } from '../multiAgentService';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import logger from '../../logger';

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

const isConversationColumnMissing = (error: any) => {
  return isMissingColumnError(error, 'conversation_thread_id') || isMissingColumnError(error, 'conversation_turn_index');
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
    ormScore: Number.isFinite(session.ormAssessment?.score) ? Number(session.ormAssessment?.score) : null,
    ormVerdict: session.ormAssessment?.verdict || null,
    ormReasons: [...(session.ormAssessment?.reasons || [])],
    evidenceBundleId: session.ormAssessment?.evidenceBundleId || null,
    totShadowEnabled: session.totShadowAssessment?.enabled || false,
    totShadowStrategy: session.totShadowAssessment?.strategy || null,
    totShadowExploredBranches: Number.isFinite(session.totShadowAssessment?.exploredBranches)
      ? Number(session.totShadowAssessment?.exploredBranches)
      : 0,
    totShadowBestScore: Number.isFinite(session.totShadowAssessment?.bestScore)
      ? Number(session.totShadowAssessment?.bestScore)
      : null,
    totShadowBestEvidenceBundleId: session.totShadowAssessment?.bestEvidenceBundleId || null,
    totShadowSelectedByRouter: session.totShadowAssessment?.selectedByRouter ?? null,
    totShadowScoreGainVsBaseline: Number.isFinite(session.totShadowAssessment?.scoreGainVsBaseline)
      ? Number(session.totShadowAssessment?.scoreGainVsBaseline)
      : null,
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
      conversation_thread_id: Number.isFinite(Number(session.conversationThreadId))
        ? Number(session.conversationThreadId)
        : null,
      conversation_turn_index: Number.isFinite(Number(session.conversationTurnIndex))
        ? Number(session.conversationTurnIndex)
        : null,
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

    if (error && (isMissingColumnError(error, 'shadow_graph_summary') || isMissingColumnError(error, 'progress_summary') || isConversationColumnMissing(error))) {
      const fallback = await client.from('agent_sessions').upsert({
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
      }, { onConflict: 'id' });
      error = fallback.error;
    }

    if (error) {
      if (isMissingTableError(error)) {
        disabled = true;
        logger.warn('[AGENT-SESSION-STORE] Permanently disabled ??missing table: %s', String(error.message || '').slice(0, 200));
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
        logger.warn('[AGENT-SESSION-STORE] Permanently disabled ??missing steps table: %s', String(stepError.message || '').slice(0, 200));
      }
    }
  } catch {
    // Best-effort persistence only.
  }
};
