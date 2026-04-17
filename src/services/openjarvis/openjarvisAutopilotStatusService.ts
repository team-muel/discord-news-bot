export type OpenJarvisAutopilotRecallRequestSummary = {
  createdAt: string | null;
  decisionReason: string | null;
  evidenceId: string | null;
  blockedAction: string | null;
  nextAction: string | null;
  requestedBy: string | null;
  runtimeLane: string | null;
  failedStepNames: string[];
};

export type OpenJarvisAutopilotDecisionDistillateSummary = {
  createdAt: string | null;
  summary: string | null;
  evidenceId: string | null;
  nextAction: string | null;
  runtimeLane: string | null;
  sourceEvent: string | null;
  promoteAs: string | null;
  tags: string[];
};

export type OpenJarvisAutopilotArtifactRefSummary = {
  createdAt: string | null;
  locator: string;
  refKind: string | null;
  title: string | null;
  artifactPlane?: string | null;
  githubSettlementKind?: string | null;
  runtimeLane: string | null;
  sourceStepName: string | null;
  sourceEvent: string | null;
};

export type OpenJarvisAutopilotCapabilityDemandSummary = {
  createdAt: string | null;
  summary: string | null;
  objective: string | null;
  missingCapability: string | null;
  missingSource: string | null;
  failedOrInsufficientRoute: string | null;
  cheapestEnablementPath: string | null;
  proposedOwner: string | null;
  evidenceRefs: string[];
  evidenceRefDetails?: OpenJarvisAutopilotArtifactRefSummary[];
  recallCondition: string | null;
  runtimeLane: string | null;
  sourceEvent: string | null;
  tags: string[];
};

export type OpenJarvisAutopilotStatus = {
  ok: boolean;
  summary_path: string | null;
  workflow: {
    session_id: string | null;
    session_path: string | null;
    source: string | null;
    runtime_lane: string | null;
    workflow_name: string | null;
    status: string | null;
    scope: string | null;
    stage: string | null;
    objective: string | null;
    route_mode: string | null;
    started_at: string | null;
    completed_at: string | null;
    execution_health: string | null;
    lastRecallRequest: OpenJarvisAutopilotRecallRequestSummary | null;
    lastDecisionDistillate: OpenJarvisAutopilotDecisionDistillateSummary | null;
    lastCapabilityDemands?: OpenJarvisAutopilotCapabilityDemandSummary[];
    lastArtifactRefs: OpenJarvisAutopilotArtifactRefSummary[];
  };
  launch: Record<string, unknown> | null;
  supervisor: (Record<string, unknown> & {
    auto_select_queued_objective?: boolean;
    auto_launch_queued_chat?: boolean;
    awaiting_reentry_acknowledgment?: boolean;
    awaiting_reentry_acknowledgment_started_at?: string | null;
    awaiting_reentry_acknowledgment_age_ms?: number | null;
    awaiting_reentry_acknowledgment_stale?: boolean;
    reentry_acknowledgment?: Record<string, unknown> | null;
  }) | null;
  result: {
    final_status: string | null;
    step_count: number;
    failed_steps: number;
    latest_gate_decision: string | null;
    deploy_status: string | null;
    stale_execution_suspected: boolean;
  };
  capacity: Record<string, unknown> | null;
  resume_state: Record<string, unknown> | null;
  continuity_packets: Record<string, unknown> | null;
  gcp_capacity_recovery_requested: boolean;
  gcp_native: Record<string, unknown> | null;
  hermes_runtime: {
    target_role: string | null;
    current_role: string | null;
    readiness: string | null;
    can_continue_without_gpt_session: boolean;
    queue_enabled: boolean;
    supervisor_alive: boolean;
    awaiting_reentry_acknowledgment?: boolean;
    awaiting_reentry_acknowledgment_started_at?: string | null;
    awaiting_reentry_acknowledgment_age_ms?: number | null;
    awaiting_reentry_acknowledgment_stale?: boolean;
    has_hot_state: boolean;
    local_operator_surface: boolean;
    ide_handoff_observed: boolean;
    queued_objectives_available: boolean;
    strengths: string[];
    blockers: string[];
    next_actions: string[];
    remediation_actions: Array<{
      action_id: string;
      label: string | null;
      description: string | null;
      admin_route: {
        method: string | null;
        path: string | null;
      } | null;
      mcp_tool: {
        name: string | null;
      } | null;
      default_payload: Record<string, unknown>;
      command_preview: string | null;
    }>;
  };
  autonomous_goal_candidates: Array<{
    objective: string;
    source: string | null;
    milestone: string | null;
    source_path: string | null;
    fingerprint: string | null;
  }>;
  vscode_cli: Record<string, unknown> | null;
  steps: Array<Record<string, unknown>>;
};

export type OpenJarvisAutopilotStatusParams = {
  sessionPath?: string | null;
  sessionId?: string | null;
  vaultPath?: string | null;
  capacityTarget?: number | null;
  gcpCapacityRecoveryRequested?: boolean;
  runtimeLane?: string | null;
};

export type OpenJarvisSessionOpenBundle = {
  bundle_version: number;
  generated_at: string;
  summary_path: string | null;
  objective: string | null;
  route_mode: string | null;
  runtime_lane: string | null;
  workflow: {
    session_id: string | null;
    source: string | null;
    status: string | null;
    scope: string | null;
    stage: string | null;
    started_at: string | null;
    completed_at: string | null;
    execution_health: string | null;
  };
  continuity: {
    owner: string | null;
    mode: string | null;
    next_action: string | null;
    resumable: boolean;
    reason: string | null;
    escalation_status: string | null;
    auto_restart_on_release: boolean;
    safe_queue: string[];
    progress_packet: string | null;
    handoff_packet: string | null;
  };
  autonomous_queue: {
    enabled: boolean;
    candidates: Array<{
      objective: string;
      source: string | null;
      milestone: string | null;
      source_path: string | null;
    }>;
  };
  routing: {
    recommended_mode: string | null;
    primary_path_type: string | null;
    primary_surfaces: string[];
    fallback_surfaces: string[];
    hot_state: string | null;
    orchestration: string | null;
    semantic_owner: string | null;
    artifact_plane: string | null;
    candidate_apis: string[];
    candidate_mcp_tools: string[];
    matched_examples: string[];
    escalation_required: boolean;
    escalation_target: string | null;
  };
  hermes_runtime: {
    target_role: string | null;
    current_role: string | null;
    readiness: string | null;
    can_continue_without_gpt_session: boolean;
    queue_enabled: boolean;
    supervisor_alive: boolean;
    awaiting_reentry_acknowledgment?: boolean;
    awaiting_reentry_acknowledgment_started_at?: string | null;
    awaiting_reentry_acknowledgment_age_ms?: number | null;
    awaiting_reentry_acknowledgment_stale?: boolean;
    has_hot_state: boolean;
    local_operator_surface: boolean;
    ide_handoff_observed: boolean;
    queued_objectives_available: boolean;
    strengths: string[];
    blockers: string[];
    next_actions: string[];
    remediation_actions: Array<{
      action_id: string;
      label: string | null;
      description: string | null;
      admin_route: {
        method: string | null;
        path: string | null;
      } | null;
      mcp_tool: {
        name: string | null;
      } | null;
      default_payload: Record<string, unknown>;
      command_preview: string | null;
    }>;
  };
  activation_pack: {
    target_objective: string | null;
    objective_class: string | null;
    summary: string | null;
    activate_first: string[];
    recommended_skills: Array<{
      skill_id: string;
      reason: string;
    }>;
    read_next: string[];
    tool_calls: string[];
    commands: string[];
    api_surfaces: string[];
    mcp_surfaces: string[];
    fallback_order: string[];
  };
  orchestration: {
    current_priority: string;
    advisor_strategy: {
      posture: string;
      reason: string;
      max_advisor_uses: number | null;
    };
    context_economics: {
      current_bottleneck: string;
      optimization_order: string[];
    };
  };
  compact_bootstrap: {
    posture: string;
    start_with: string[];
    objective: string | null;
    hermes_readiness: string | null;
    latest_decision_distillate: string | null;
    next_queue_head: string | null;
    defer_large_docs_until_ambiguous: boolean;
    open_later: string[];
  };
  decision: {
    summary: string | null;
    next_action: string | null;
    promote_as: string | null;
    tags: string[];
  };
  recall: {
    decision_reason: string | null;
    blocked_action: string | null;
    next_action: string | null;
    failed_step_names: string[];
  };
  evidence_refs: Array<{
    locator: string;
    refKind: string | null;
    title: string | null;
    artifactPlane?: string | null;
    githubSettlementKind?: string | null;
    sourceStepName: string | null;
  }>;
  capability_demands: Array<{
    summary: string;
    objective: string | null;
    missing_capability: string | null;
    missing_source: string | null;
    failed_or_insufficient_route: string | null;
    cheapest_enablement_path: string | null;
    proposed_owner: string | null;
    evidence_refs: string[];
    evidence_ref_details?: Array<{
      locator: string;
      refKind: string | null;
      title: string | null;
      artifactPlane?: string | null;
      githubSettlementKind?: string | null;
      sourceStepName: string | null;
    }>;
    recall_condition: string | null;
  }>;
  capacity: {
    score: number | null;
    target: number | null;
    state: string | null;
    loop_action: string | null;
    primary_reason: string | null;
    continue_recommended: boolean;
  };
  supervisor: {
    status: string | null;
    launches_completed: number;
    stop_reason: string | null;
    last_launch_source: string | null;
    last_launch_at: string | null;
    awaiting_reentry_acknowledgment?: boolean;
    awaiting_reentry_acknowledgment_started_at?: string | null;
    awaiting_reentry_acknowledgment_age_ms?: number | null;
    awaiting_reentry_acknowledgment_stale?: boolean;
  };
  result: {
    final_status: string | null;
    step_count: number;
    failed_steps: number;
    latest_gate_decision: string | null;
    deploy_status: string | null;
    stale_execution_suspected: boolean;
  };
  personalization: {
    priority: string | null;
    provider_profile: string | null;
    retrieval_profile: string | null;
    communication_style: string | null;
    preferred_topics: string[];
    prompt_hints: string[];
  } | null;
  read_first: string[];
  recall_triggers: string[];
};

type GoalCycleStatusModule = {
  buildStatusPayload: (params?: Record<string, unknown>) => Promise<OpenJarvisAutopilotStatus>;
  buildSessionOpenBundle: (params?: Record<string, unknown>) => OpenJarvisSessionOpenBundle;
};

export const getOpenJarvisAutopilotStatus = async (
  params: OpenJarvisAutopilotStatusParams = {},
): Promise<OpenJarvisAutopilotStatus> => {
  const module = await import('../../../scripts/run-openjarvis-goal-cycle.mjs') as GoalCycleStatusModule;
  return module.buildStatusPayload({
    sessionPath: params.sessionPath || null,
    sessionId: params.sessionId || null,
    vaultPath: params.vaultPath || null,
    capacityTarget: params.capacityTarget ?? undefined,
    gcpCapacityRecoveryRequested: params.gcpCapacityRecoveryRequested,
    runtimeLane: params.runtimeLane || undefined,
  });
};

export const getOpenJarvisSessionOpenBundle = async (
  params: OpenJarvisAutopilotStatusParams & {
    status?: OpenJarvisAutopilotStatus | null;
    personalizationSnapshot?: Record<string, unknown> | null;
  } = {},
): Promise<OpenJarvisSessionOpenBundle> => {
  const module = await import('../../../scripts/run-openjarvis-goal-cycle.mjs') as GoalCycleStatusModule;
  const status = params.status || await getOpenJarvisAutopilotStatus(params);
  return module.buildSessionOpenBundle({
    status,
    personalizationSnapshot: params.personalizationSnapshot || null,
  });
};