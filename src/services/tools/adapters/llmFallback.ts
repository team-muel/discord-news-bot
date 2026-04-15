import logger from '../../../logger';
import { getErrorMessage } from '../../../utils/errorMessage';
import { generateText, isAnyLlmConfigured } from '../../llmClient';

export type AdapterLlmFallbackParams = {
  actionName: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  lineLimit?: number;
  minContentLength?: number;
  debugLabel: string;
};

export const runAdapterLlmFallback = async (params: AdapterLlmFallbackParams): Promise<string[] | null> => {
  if (!isAnyLlmConfigured()) {
    return null;
  }

  try {
    const content = String(await generateText({
      system: params.system,
      user: params.user,
      actionName: params.actionName,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    }) || '').trim();
    if (content.length < (params.minContentLength ?? 1)) {
      return null;
    }
    return content.split('\n').slice(0, params.lineLimit ?? 20);
  } catch (error) {
    logger.debug('%s llm fallback failed: %s', params.debugLabel, getErrorMessage(error));
    return null;
  }
};