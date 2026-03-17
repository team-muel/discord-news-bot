import logger from '../logger';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type GotNodeType = 'root' | 'hypothesis' | 'evidence' | 'critique' | 'merge' | 'decision' | 'patch';

type GotEdgeType = 'expand' | 'support' | 'refute' | 'merge' | 'select' | 'revise';

type GotScoreSource = 'self_eval' | 'provider_logprob' | 'rule' | 'human' | 'hybrid';

export type GotShadowCandidateInput = {
  nodeKey: string;
  nodeType: GotNodeType;
  content: string;
  parentNodeKey?: string;
  depth: number;
  score?: number | null;
  confidence?: number | null;
  novelty?: number | null;
  risk?: number | null;
  grounded?: boolean;
  blocked?: boolean;
  scoreSource?: GotScoreSource;
  metadata?: Record<string, unknown>;
};

export type RecordGotShadowRunInput = {
  guildId: string;
  sessionId: string;
  rootGoal: string;
  strategy: string;
  maxNodes: number;
  maxEdges: number;
  candidates: GotShadowCandidateInput[];
  selectedNodeKey?: string;
  selectedScore?: number;
  selectionReason?: string;
};

const ensureSupabase = () => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  return getSupabaseClient();
};

const clamp01 = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return Math.max(0, Math.min(1, n));
};

const normalizeNodeType = (value: string): GotNodeType => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'root' || normalized === 'hypothesis' || normalized === 'evidence' || normalized === 'critique' || normalized === 'merge' || normalized === 'decision' || normalized === 'patch') {
    return normalized;
  }
  return 'hypothesis';
};

const normalizeScoreSource = (value: string | undefined): GotScoreSource | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'self_eval' || normalized === 'provider_logprob' || normalized === 'rule' || normalized === 'human' || normalized === 'hybrid') {
    return normalized;
  }
  return null;
};

const toNodeRow = (params: {
  runId: number;
  guildId: string;
  sessionId: string;
  candidate: GotShadowCandidateInput;
}): Record<string, unknown> => {
  const score = clamp01(params.candidate.score);
  const confidence = clamp01(params.candidate.confidence);
  const novelty = clamp01(params.candidate.novelty);
  const risk = clamp01(params.candidate.risk);
  return {
    run_id: params.runId,
    guild_id: params.guildId,
    session_id: params.sessionId,
    node_key: String(params.candidate.nodeKey || '').trim(),
    node_type: normalizeNodeType(params.candidate.nodeType),
    content: String(params.candidate.content || '').trim().slice(0, 8000),
    parent_count: params.candidate.parentNodeKey ? 1 : 0,
    child_count: 0,
    depth: Math.max(0, Math.trunc(Number(params.candidate.depth) || 0)),
    score,
    confidence,
    novelty,
    risk,
    grounded: params.candidate.grounded === true,
    blocked: params.candidate.blocked === true,
    score_source: normalizeScoreSource(params.candidate.scoreSource),
    metadata: params.candidate.metadata || {},
  };
};

export const recordGotShadowRun = async (params: RecordGotShadowRunInput): Promise<number | null> => {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const guildId = String(params.guildId || '').trim();
  const sessionId = String(params.sessionId || '').trim();
  const rootGoal = String(params.rootGoal || '').trim();
  if (!guildId || !sessionId || !rootGoal) {
    return null;
  }

  try {
    const client = ensureSupabase();
    const { data: runData, error: runError } = await client
      .from('agent_got_runs')
      .insert({
        guild_id: guildId,
        session_id: sessionId,
        strategy: String(params.strategy || 'got_v1').trim() || 'got_v1',
        status: 'running',
        root_goal: rootGoal,
        max_nodes: Math.max(1, Math.min(200, Math.trunc(params.maxNodes || 24))),
        max_edges: Math.max(1, Math.min(800, Math.trunc(params.maxEdges || 64))),
      })
      .select('id')
      .single();

    if (runError || !runData) {
      throw new Error(runError?.message || 'AGENT_GOT_RUN_INSERT_FAILED');
    }

    const runId = Number((runData as Record<string, unknown>).id);
    if (!Number.isFinite(runId)) {
      throw new Error('AGENT_GOT_RUN_ID_INVALID');
    }

    const dedupedByKey = new Map<string, GotShadowCandidateInput>();
    for (const candidate of params.candidates || []) {
      const key = String(candidate.nodeKey || '').trim();
      if (!key) {
        continue;
      }
      if (!dedupedByKey.has(key)) {
        dedupedByKey.set(key, candidate);
      }
    }

    const candidateRows = [...dedupedByKey.values()]
      .slice(0, Math.max(1, Math.min(199, Math.trunc(params.maxNodes || 24) - 1)))
      .map((candidate) => toNodeRow({ runId, guildId, sessionId, candidate }));

    const nodeRows = [
      {
        run_id: runId,
        guild_id: guildId,
        session_id: sessionId,
        node_key: 'root',
        node_type: 'root',
        content: rootGoal.slice(0, 8000),
        parent_count: 0,
        child_count: 0,
        depth: 0,
        score: null,
        confidence: null,
        novelty: null,
        risk: null,
        grounded: false,
        blocked: false,
        score_source: null,
        metadata: {},
      },
      ...candidateRows,
    ];

    const { data: insertedNodes, error: nodeError } = await client
      .from('agent_got_nodes')
      .insert(nodeRows)
      .select('id,node_key');

    if (nodeError) {
      throw new Error(nodeError.message || 'AGENT_GOT_NODE_INSERT_FAILED');
    }

    const nodeIdByKey = new Map<string, number>();
    for (const row of (insertedNodes || []) as Array<Record<string, unknown>>) {
      const key = String(row.node_key || '').trim();
      const id = Number(row.id);
      if (!key || !Number.isFinite(id)) {
        continue;
      }
      nodeIdByKey.set(key, id);
    }

    const edgeRows: Array<Record<string, unknown>> = [];
    const rootId = nodeIdByKey.get('root') || 0;
    for (const candidate of dedupedByKey.values()) {
      const toId = nodeIdByKey.get(String(candidate.nodeKey || '').trim());
      if (!toId) {
        continue;
      }
      const fromKey = String(candidate.parentNodeKey || 'root').trim() || 'root';
      const fromId = nodeIdByKey.get(fromKey) || rootId;
      if (!fromId || fromId === toId) {
        continue;
      }
      edgeRows.push({
        run_id: runId,
        guild_id: guildId,
        session_id: sessionId,
        from_node_id: fromId,
        to_node_id: toId,
        edge_type: 'expand' satisfies GotEdgeType,
        weight: clamp01(candidate.score) ?? 0,
        rationale: String((candidate.metadata || {}).reason || '').trim() || null,
      });
    }

    if (edgeRows.length > 0) {
      const limitedEdgeRows = edgeRows.slice(0, Math.max(1, Math.min(800, Math.trunc(params.maxEdges || 64))));
      const { error: edgeError } = await client.from('agent_got_edges').insert(limitedEdgeRows);
      if (edgeError) {
        throw new Error(edgeError.message || 'AGENT_GOT_EDGE_INSERT_FAILED');
      }
    }

    const selectedNodeKey = String(params.selectedNodeKey || '').trim();
    const selectedNodeId = selectedNodeKey ? (nodeIdByKey.get(selectedNodeKey) || null) : null;
    const selectedScore = clamp01(params.selectedScore);

    const selectionEvents: Array<Record<string, unknown>> = [
      {
        run_id: runId,
        guild_id: guildId,
        session_id: sessionId,
        stage: 'pre_filter',
        candidate_node_id: null,
        candidate_score: null,
        accepted: true,
        reason: 'shadow_candidates_collected',
        payload: {
          candidateCount: dedupedByKey.size,
        },
      },
      {
        run_id: runId,
        guild_id: guildId,
        session_id: sessionId,
        stage: selectedNodeId ? 'final_select' : 'fallback',
        candidate_node_id: selectedNodeId,
        candidate_score: selectedScore,
        accepted: Boolean(selectedNodeId),
        reason: String(params.selectionReason || '').trim() || (selectedNodeId ? 'shadow_best_selected' : 'no_candidate_selected'),
        payload: {
          selectedNodeKey: selectedNodeKey || null,
        },
      },
    ];

    const { error: selectionError } = await client
      .from('agent_got_selection_events')
      .insert(selectionEvents);

    if (selectionError) {
      throw new Error(selectionError.message || 'AGENT_GOT_SELECTION_EVENT_INSERT_FAILED');
    }

    const { error: updateError } = await client
      .from('agent_got_runs')
      .update({
        status: 'completed',
        total_nodes: nodeRows.length,
        total_edges: edgeRows.length,
        selected_node_id: selectedNodeId,
        selected_score: selectedScore,
        selection_reason: String(params.selectionReason || '').trim() || null,
        ended_at: new Date().toISOString(),
      })
      .eq('id', runId);

    if (updateError) {
      throw new Error(updateError.message || 'AGENT_GOT_RUN_UPDATE_FAILED');
    }

    return runId;
  } catch (error) {
    logger.warn('[AGENT-GOT] shadow run record failed: %s', error instanceof Error ? error.message : String(error));
    return null;
  }
};

export const listGotRuns = async (params: { guildId: string; limit?: number }) => {
  const client = ensureSupabase();
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(params.limit || 30))));
  const { data, error } = await client
    .from('agent_got_runs')
    .select('id,guild_id,session_id,strategy,status,root_goal,max_nodes,max_edges,total_nodes,total_edges,selected_node_id,selected_score,selection_reason,started_at,ended_at,created_at,updated_at')
    .eq('guild_id', params.guildId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message || 'AGENT_GOT_RUN_LIST_FAILED');
  }

  return data || [];
};

export const getGotRunById = async (params: { guildId: string; runId: number }) => {
  const client = ensureSupabase();
  const { data, error } = await client
    .from('agent_got_runs')
    .select('id,guild_id,session_id,strategy,status,root_goal,max_nodes,max_edges,total_nodes,total_edges,selected_node_id,selected_score,selection_reason,started_at,ended_at,created_at,updated_at')
    .eq('guild_id', params.guildId)
    .eq('id', params.runId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'AGENT_GOT_RUN_READ_FAILED');
  }
  if (!data) {
    throw new Error('AGENT_GOT_RUN_NOT_FOUND');
  }

  return data;
};

export const listGotNodes = async (params: { guildId: string; runId: number; limit?: number }) => {
  const client = ensureSupabase();
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(params.limit || 200))));
  const { data, error } = await client
    .from('agent_got_nodes')
    .select('id,run_id,guild_id,session_id,node_key,node_type,content,parent_count,child_count,depth,score,confidence,novelty,risk,grounded,blocked,score_source,metadata,created_at,updated_at')
    .eq('guild_id', params.guildId)
    .eq('run_id', params.runId)
    .order('depth', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message || 'AGENT_GOT_NODE_LIST_FAILED');
  }

  return data || [];
};

export const listGotSelectionEvents = async (params: { guildId: string; runId: number; limit?: number }) => {
  const client = ensureSupabase();
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(params.limit || 200))));
  const { data, error } = await client
    .from('agent_got_selection_events')
    .select('id,run_id,guild_id,session_id,stage,candidate_node_id,candidate_score,accepted,reason,payload,created_at')
    .eq('guild_id', params.guildId)
    .eq('run_id', params.runId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message || 'AGENT_GOT_SELECTION_EVENT_LIST_FAILED');
  }

  return data || [];
};
