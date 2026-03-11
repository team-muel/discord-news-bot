import type { AgentSession } from './multiAgentService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

let disabled = false;

const isMissingTableError = (error: any) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes('agent_sessions') || message.includes('agent_steps');
};

export const persistAgentSession = async (session: AgentSession): Promise<void> => {
  if (!isSupabaseConfigured() || disabled) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client.from('agent_sessions').upsert(
      {
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
      },
      { onConflict: 'id' },
    );

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
