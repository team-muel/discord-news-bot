import {
  localOrchestratorAllAction,
  localOrchestratorRouteAction,
  nemoclawReviewAction,
  opendevPlanAction,
  openjarvisOpsAction,
  jarvisResearchAction,
  jarvisDigestAction,
  jarvisMemoryIndexAction,
  jarvisMemorySearchAction,
  jarvisEvalAction,
  jarvisTelemetryAction,
  jarvisSchedulerListAction,
  jarvisSkillSearchAction,
  qaTestAction,
  csoAuditAction,
  releaseShipAction,
  retroSummarizeAction,
  sopUpdateAction,
} from './agentCollab';
import { investmentAnalysisAction } from './analysis';
import { codeGenerateAction } from './code';
import { communitySearchAction } from './community';
import { dbSupabaseReadAction } from './db';
import { guildAnalyticsAction } from './guildAnalytics';
import { newsGoogleSearchAction } from './news';
import { newsVerifyAction } from './newsVerify';
import { obsidianGuildDocUpsertAction } from './obsidian';
import { opencodeExecuteAction } from './opencode';
import { privacyForgetGuildAction, privacyForgetUserAction } from './privacy';
import { ragRetrieveAction } from './rag';
import { stockChartAction, stockQuoteAction } from './stock';
import { n8nStatusAction, n8nWorkflowListAction, n8nWorkflowExecuteAction, n8nWorkflowTriggerAction, n8nDelegateNewsRssAction, n8nDelegateNewsSummarizeAction, n8nDelegateNewsMonitorAction, n8nDelegateYoutubeFeedAction, n8nDelegateYoutubeScrapAction, n8nDelegateAlertAction, n8nDelegateArticleContextAction } from './n8n';
import { toolsRunCliAction } from './tools';
import type { ActionDefinition, ActionCategory } from './types';
import { webFetchAction } from './web';
import { webSearchAction } from './webSearch';
import { youtubeSearchFirstAction } from './youtube';
import { youtubeSearchWebhookAction } from './youtubeWebhook';

// ──── Action Registry ───────────────────────────────────────────────────────
// Actions self-register via registerActions / registerAlias rather than
// being manually listed. This makes adding a new action a single-step
// operation: export it and call registerActions() in the same module.

const ACTIONS: ActionDefinition[] = [];
const ACTION_MAP = new Map<string, ActionDefinition>();

const createAlias = (name: string, description: string, target: ActionDefinition): ActionDefinition => ({
  name,
  description,
  category: target.category,
  execute: async (input) => {
    const result = await target.execute(input);
    return { ...result, name };
  },
});

/**
 * Register one or more actions into the global registry.
 * Duplicate names are silently skipped (first-wins).
 */
export const registerActions = (...actions: ActionDefinition[]): void => {
  for (const action of actions) {
    if (ACTION_MAP.has(action.name)) continue;
    ACTIONS.push(action);
    ACTION_MAP.set(action.name, action);
  }
};

/**
 * Register a neutral-name alias that delegates to an existing action.
 */
export const registerAlias = (name: string, description: string, target: ActionDefinition): void => {
  registerActions(createAlias(name, description, target));
};

// ──── Built-in registrations ────────────────────────────────────────────────
// Orchestrator
registerActions(localOrchestratorAllAction, localOrchestratorRouteAction);
registerAlias('coordinate.all', 'Neutral alias for local.orchestrator.all.', localOrchestratorAllAction);
registerAlias('coordinate.route', 'Neutral alias for local.orchestrator.route.', localOrchestratorRouteAction);

// Lead agent roles
registerActions(opendevPlanAction, nemoclawReviewAction, openjarvisOpsAction);
registerAlias('architect.plan', 'Neutral alias for opendev.plan.', opendevPlanAction);
registerAlias('review.review', 'Neutral alias for nemoclaw.review.', nemoclawReviewAction);
registerAlias('operate.ops', 'Neutral alias for openjarvis.ops.', openjarvisOpsAction);

// Jarvis extended
registerActions(
  jarvisResearchAction, jarvisDigestAction, jarvisMemoryIndexAction,
  jarvisMemorySearchAction, jarvisEvalAction, jarvisTelemetryAction,
  jarvisSchedulerListAction, jarvisSkillSearchAction,
);

// Code / content / data
registerActions(
  codeGenerateAction, youtubeSearchWebhookAction, youtubeSearchFirstAction,
  stockChartAction, stockQuoteAction, ragRetrieveAction,
  privacyForgetUserAction, privacyForgetGuildAction, investmentAnalysisAction,
  newsGoogleSearchAction, newsVerifyAction, opencodeExecuteAction,
);
registerAlias('implement.execute', 'Neutral alias for opencode.execute.', opencodeExecuteAction);

// Infrastructure / ops
registerActions(
  obsidianGuildDocUpsertAction, communitySearchAction, guildAnalyticsAction,
  webSearchAction, webFetchAction, dbSupabaseReadAction, toolsRunCliAction,
);

// n8n delegation
registerActions(
  n8nStatusAction, n8nWorkflowListAction, n8nWorkflowExecuteAction,
  n8nWorkflowTriggerAction, n8nDelegateNewsRssAction, n8nDelegateNewsSummarizeAction,
  n8nDelegateNewsMonitorAction, n8nDelegateYoutubeFeedAction, n8nDelegateYoutubeScrapAction,
  n8nDelegateAlertAction, n8nDelegateArticleContextAction,
);

// Sprint phases
registerActions(qaTestAction, csoAuditAction, releaseShipAction, retroSummarizeAction, sopUpdateAction);
registerAlias('test.qa', 'Neutral alias for qa.test.', qaTestAction);
registerAlias('security.audit', 'Neutral alias for cso.audit.', csoAuditAction);
registerAlias('ship.release', 'Neutral alias for release.ship.', releaseShipAction);
registerAlias('summary.retro', 'Neutral alias for retro.summarize.', retroSummarizeAction);
registerAlias('knowledge.update', 'Neutral alias for sop.update.', sopUpdateAction);

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

/**
 * Generate a tool catalog section for system prompts.
 * Groups actions by category and renders parameter specs.
 * Inspired by Cline's ClineToolSet → PromptBuilder pipeline.
 */
export function buildToolCatalogPrompt(filter?: { categories?: ActionCategory[] }): string {
  const actions = filter?.categories
    ? ACTIONS.filter((a) => filter.categories!.includes(a.category))
    : ACTIONS;

  // Deduplicate aliases — keep only the first registration for each execute reference
  const seen = new Set<string>();
  const unique = actions.filter((a) => {
    if (seen.has(a.name)) return false;
    seen.add(a.name);
    return true;
  });

  // Group by category
  const groups = new Map<string, ActionDefinition[]>();
  for (const action of unique) {
    const cat = action.category;
    const list = groups.get(cat) ?? [];
    list.push(action);
    groups.set(cat, list);
  }

  const lines: string[] = ['## Available Tools', ''];
  for (const [category, categoryActions] of groups) {
    lines.push(`### ${category}`);
    for (const action of categoryActions) {
      const params = action.parameters;
      if (params && params.length > 0) {
        const paramList = params
          .map((p) => `  - \`${p.name}\`${p.required ? ' (required)' : ''}: ${p.description}`)
          .join('\n');
        lines.push(`- **${action.name}**: ${action.description}\n${paramList}`);
      } else {
        lines.push(`- **${action.name}**: ${action.description}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
