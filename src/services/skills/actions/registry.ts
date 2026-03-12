import { investmentAnalysisAction } from './analysis';
import { communitySearchAction } from './community';
import { dbSupabaseReadAction } from './db';
import { newsGoogleSearchAction } from './news';
import { privacyForgetGuildAction, privacyForgetUserAction } from './privacy';
import { ragRetrieveAction } from './rag';
import { stockChartAction, stockQuoteAction } from './stock';
import type { ActionDefinition } from './types';
import { webFetchAction } from './web';
import { youtubeSearchFirstAction } from './youtube';
import { youtubeSearchWebhookAction } from './youtubeWebhook';

const ACTIONS: ActionDefinition[] = [
  youtubeSearchWebhookAction,
  youtubeSearchFirstAction,
  stockChartAction,
  stockQuoteAction,
  ragRetrieveAction,
  privacyForgetUserAction,
  privacyForgetGuildAction,
  investmentAnalysisAction,
  newsGoogleSearchAction,
  communitySearchAction,
  webFetchAction,
  dbSupabaseReadAction,
];

const ACTION_MAP = new Map<string, ActionDefinition>(ACTIONS.map((action) => [action.name, action]));

export const listActions = (): ActionDefinition[] => ACTIONS.map((action) => ({ ...action }));

export const getAction = (actionName: string): ActionDefinition | null => ACTION_MAP.get(actionName) || null;
