import {
  localOrchestratorAllAction,
  localOrchestratorRouteAction,
  nemoclawReviewAction,
  opendevPlanAction,
  openjarvisOpsAction,
} from './agentCollab';
import { investmentAnalysisAction } from './analysis';
import { codeGenerateAction } from './code';
import { communitySearchAction } from './community';
import { dbSupabaseReadAction } from './db';
import { newsGoogleSearchAction } from './news';
import { newsVerifyAction } from './newsVerify';
import { obsidianGuildDocUpsertAction } from './obsidian';
import { opencodeExecuteAction } from './opencode';
import { privacyForgetGuildAction, privacyForgetUserAction } from './privacy';
import { ragRetrieveAction } from './rag';
import { stockChartAction, stockQuoteAction } from './stock';
import { toolsRunCliAction } from './tools';
import type { ActionDefinition } from './types';
import { webFetchAction } from './web';
import { webSearchAction } from './webSearch';
import { youtubeSearchFirstAction } from './youtube';
import { youtubeSearchWebhookAction } from './youtubeWebhook';

const aliasAction = (name: string, description: string, target: ActionDefinition): ActionDefinition => ({
  name,
  description,
  execute: async (input) => {
    const result = await target.execute(input);
    return {
      ...result,
      name,
    };
  },
});

const ACTIONS: ActionDefinition[] = [
  localOrchestratorAllAction,
  localOrchestratorRouteAction,
  aliasAction('coordinate.all', 'Neutral alias for local.orchestrator.all.', localOrchestratorAllAction),
  aliasAction('coordinate.route', 'Neutral alias for local.orchestrator.route.', localOrchestratorRouteAction),
  opendevPlanAction,
  aliasAction('architect.plan', 'Neutral alias for opendev.plan.', opendevPlanAction),
  nemoclawReviewAction,
  aliasAction('review.review', 'Neutral alias for nemoclaw.review.', nemoclawReviewAction),
  openjarvisOpsAction,
  aliasAction('operate.ops', 'Neutral alias for openjarvis.ops.', openjarvisOpsAction),
  codeGenerateAction,
  youtubeSearchWebhookAction,
  youtubeSearchFirstAction,
  stockChartAction,
  stockQuoteAction,
  ragRetrieveAction,
  privacyForgetUserAction,
  privacyForgetGuildAction,
  investmentAnalysisAction,
  newsGoogleSearchAction,
  newsVerifyAction,
  opencodeExecuteAction,
  aliasAction('implement.execute', 'Neutral alias for opencode.execute.', opencodeExecuteAction),
  obsidianGuildDocUpsertAction,
  communitySearchAction,
  webSearchAction,
  webFetchAction,
  dbSupabaseReadAction,
  toolsRunCliAction,
];

const ACTION_MAP = new Map<string, ActionDefinition>(ACTIONS.map((action) => [action.name, action]));

export const listActions = (): ActionDefinition[] => ACTIONS.map((action) => ({ ...action }));

export const getAction = (actionName: string): ActionDefinition | null => ACTION_MAP.get(actionName) || null;
