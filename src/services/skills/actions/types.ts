export type ActionExecutionInput = {
  goal: string;
  args?: Record<string, unknown>;
  guildId?: string;
  requestedBy?: string;
};

export type AgentRole = 'openjarvis' | 'opencode' | 'nemoclaw' | 'opendev';

export type ActionHandoff = {
  fromAgent: AgentRole;
  toAgent: AgentRole;
  reason?: string;
  evidenceId?: string;
};

export type ActionExecutionResult = {
  ok: boolean;
  name: string;
  summary: string;
  artifacts: string[];
  verification: string[];
  error?: string;
  durationMs?: number;
  agentRole?: AgentRole;
  handoff?: ActionHandoff;
};

export type ActionDefinition = {
  name: string;
  description: string;
  execute: (input: ActionExecutionInput) => Promise<ActionExecutionResult>;
};

export type ActionPlan = {
  actionName: string;
  args: Record<string, unknown>;
  reason?: string;
};

export type ActionChainPlan = {
  actions: ActionPlan[];
};
