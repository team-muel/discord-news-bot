import {
  localOrchestratorAllAction,
  localOrchestratorRouteAction,
  nemoclawReviewAction,
  opendevPlanAction,
  openjarvisOpsAction,
  qaTestAction,
  csoAuditAction,
  releaseShipAction,
  retroSummarizeAction,
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
  qaTestAction,
  aliasAction('test.qa', 'Neutral alias for qa.test.', qaTestAction),
  csoAuditAction,
  aliasAction('security.audit', 'Neutral alias for cso.audit.', csoAuditAction),
  releaseShipAction,
  aliasAction('ship.release', 'Neutral alias for release.ship.', releaseShipAction),
  retroSummarizeAction,
  aliasAction('summary.retro', 'Neutral alias for retro.summarize.', retroSummarizeAction),
];

const ACTION_MAP = new Map<string, ActionDefinition>(ACTIONS.map((action) => [action.name, action]));

// Pre-built term sets for Jaccard-based tool filtering in planner
const toTermSet = (text: string): Set<string> => {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9\uac00-\ud7af_\-/]+/g).filter((t) => t.length >= 2),
  );
};

const actionTermIndex = new Map<string, Set<string>>(
  ACTIONS.map((action) => [action.name, toTermSet(`${action.name} ${action.description}`)]),
);

export const listActions = (): ActionDefinition[] => ACTIONS.map((action) => ({ ...action }));

export const getAction = (actionName: string): ActionDefinition | null => ACTION_MAP.get(actionName) || null;

export const getActionTermIndex = (): ReadonlyMap<string, Set<string>> => actionTermIndex;
