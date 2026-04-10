import type { AgentOutcome } from '../agent/agentOutcomeContract';

export type SkillId = string;

export type SkillContext = {
  guildId: string;
  requestedBy: string;
  goal: string;
  actionName?: string;
  memoryHints?: string[];
  priorOutput?: string;
  generationOptions?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };
};

export type SkillDefinition = {
  id: SkillId;
  title: string;
  description: string;
  inputGuide: string;
  outputGuide: string;
  systemPrompt: string;
  executorKey?: string;
  adminOnly?: boolean;
  enabled?: boolean;
  temperature?: number;
  maxTokens?: number;
};

export type SkillExecutionResult = {
  skillId: SkillId;
  output: string;
  outcomes?: AgentOutcome[];
};
