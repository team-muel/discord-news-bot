import { executeWebhookSkill } from './modules/webhook';
import { executeCasualChatSkill } from './modules/casualChat';
import { executeOpsPlanSkill } from './modules/opsPlan';
import { executeOpsExecutionSkill } from './modules/opsExecution';
import { executeOpsCritiqueSkill } from './modules/opsCritique';
import { executeGuildOnboardingBlueprintSkill } from './modules/guildOnboardingBlueprint';
import { executeIncidentReviewSkill } from './modules/incidentReview';
import type { SkillContext, SkillExecutionResult, SkillId } from './types';

type SkillExecutor = (context: SkillContext) => Promise<SkillExecutionResult>;

const SKILL_EXECUTOR_MAP: Record<SkillId, SkillExecutor> = {
  casual_chat: executeCasualChatSkill,
  'ops-plan': executeOpsPlanSkill,
  'ops-execution': executeOpsExecutionSkill,
  'ops-critique': executeOpsCritiqueSkill,
  'guild-onboarding-blueprint': executeGuildOnboardingBlueprintSkill,
  'incident-review': executeIncidentReviewSkill,
  webhook: executeWebhookSkill,
};

export const executeSkill = async (
  skillId: SkillId,
  context: SkillContext,
): Promise<SkillExecutionResult> => {
  const executor = SKILL_EXECUTOR_MAP[skillId];
  if (!executor) {
    return {
      skillId,
      output: '지원되지 않는 스킬입니다.',
    };
  }

  return executor(context);
};
