import { BotAgentRouteDeps } from './bot-agent/types';
import { registerBotAgentCoreRoutes } from './bot-agent/coreRoutes';
import { registerBotAgentRuntimeRoutes } from './bot-agent/runtimeRoutes';
import { registerBotAgentGotRoutes } from './bot-agent/gotRoutes';
import { registerBotAgentQualityPrivacyRoutes } from './bot-agent/qualityPrivacyRoutes';
import { registerBotAgentGovernanceRoutes } from './bot-agent/governanceRoutes';
import { registerBotAgentMemoryRoutes } from './bot-agent/memoryRoutes';
import { registerBotAgentLearningRoutes } from './bot-agent/learningRoutes';
import { registerBotAgentToolsRoutes } from './bot-agent/toolsRoutes';
import { registerSprintRoutes } from './bot-agent/sprintRoutes';
import { registerBotAgentRewardEvalRoutes } from './bot-agent/rewardEvalRoutes';

export function registerBotAgentRoutes(deps: BotAgentRouteDeps): void {
  registerBotAgentCoreRoutes(deps);
  registerBotAgentRuntimeRoutes(deps);
  registerBotAgentGotRoutes(deps);
  registerBotAgentQualityPrivacyRoutes(deps);
  registerBotAgentGovernanceRoutes(deps);
  registerBotAgentToolsRoutes(deps);
  registerBotAgentMemoryRoutes(deps);
  registerBotAgentLearningRoutes(deps);
  registerSprintRoutes(deps);
  registerBotAgentRewardEvalRoutes(deps);
}
