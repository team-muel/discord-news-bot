export type SkillId =
  | 'casual_chat'
  | 'ops-plan'
  | 'ops-execution'
  | 'ops-critique'
  | 'guild-onboarding-blueprint'
  | 'incident-review'
  | 'webhook';

export type SkillContext = {
  guildId: string;
  requestedBy: string;
  goal: string;
  memoryHints?: string[];
  priorOutput?: string;
};

export type SkillDefinition = {
  id: SkillId;
  title: string;
  description: string;
  inputGuide: string;
  outputGuide: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
};

export type SkillExecutionResult = {
  skillId: SkillId;
  output: string;
};
