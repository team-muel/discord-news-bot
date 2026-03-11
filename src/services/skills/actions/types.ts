export type ActionExecutionInput = {
  goal: string;
  args?: Record<string, unknown>;
};

export type ActionExecutionResult = {
  ok: boolean;
  name: string;
  summary: string;
  artifacts: string[];
  verification: string[];
  error?: string;
  durationMs?: number;
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
