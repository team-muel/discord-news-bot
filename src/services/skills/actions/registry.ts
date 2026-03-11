import { investmentAnalysisAction } from './analysis';
import { stockChartAction, stockQuoteAction } from './stock';
import type { ActionDefinition } from './types';
import { youtubeSearchFirstAction } from './youtube';

const ACTIONS: ActionDefinition[] = [
  youtubeSearchFirstAction,
  stockChartAction,
  stockQuoteAction,
  investmentAnalysisAction,
];

const ACTION_MAP = new Map<string, ActionDefinition>(ACTIONS.map((action) => [action.name, action]));

export const listActions = (): ActionDefinition[] => ACTIONS.map((action) => ({ ...action }));

export const getAction = (actionName: string): ActionDefinition | null => ACTION_MAP.get(actionName) || null;
