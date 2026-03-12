import { executeWebhookSkill } from './modules/webhook';
import { executeCasualChatSkill } from './modules/casualChat';
import { executeOpsPlanSkill } from './modules/opsPlan';
import { executeOpsExecutionSkill } from './modules/opsExecution';
import { executeOpsCritiqueSkill } from './modules/opsCritique';
import { executeGuildOnboardingBlueprintSkill } from './modules/guildOnboardingBlueprint';
import { executeIncidentReviewSkill } from './modules/incidentReview';
import type { SkillContext, SkillExecutionResult, SkillId } from './types';

export const executeSkill = async (
  skillId: SkillId,
  context: SkillContext,
): Promise<SkillExecutionResult> => {
  switch (skillId) {
    case 'casual_chat':
      return executeCasualChatSkill(context);
    case 'ops-plan':
      return executeOpsPlanSkill(context);
    case 'ops-execution':
      return executeOpsExecutionSkill(context);
    case 'ops-critique':
      return executeOpsCritiqueSkill(context);
    case 'guild-onboarding-blueprint':
      return executeGuildOnboardingBlueprintSkill(context);
    case 'incident-review':
      return executeIncidentReviewSkill(context);
    case 'webhook':
      return executeWebhookSkill(context);
    default:
      return {
        skillId,
        output: '지원되지 않는 스킬입니다.',
      };
  }
};
