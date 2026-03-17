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
import type { ActionDefinition } from './types';
import { webFetchAction } from './web';
import { webSearchAction } from './webSearch';
import { youtubeSearchFirstAction } from './youtube';
import { youtubeSearchWebhookAction } from './youtubeWebhook';

const ACTIONS: ActionDefinition[] = [
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
  obsidianGuildDocUpsertAction,
  communitySearchAction,
  webSearchAction,
  webFetchAction,
  dbSupabaseReadAction,
];

const ACTION_MAP = new Map<string, ActionDefinition>(ACTIONS.map((action) => [action.name, action]));

export const listActions = (): ActionDefinition[] => ACTIONS.map((action) => ({ ...action }));

export const getAction = (actionName: string): ActionDefinition | null => ACTION_MAP.get(actionName) || null;
