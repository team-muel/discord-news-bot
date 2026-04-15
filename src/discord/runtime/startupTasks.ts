import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';

export const runStartupTaskSafely = (taskName: string, task: () => void | Promise<unknown>): void => {
  try {
    void Promise.resolve(task()).catch((error) => {
      logger.error('[BOT] %s failed: %s', taskName, getErrorMessage(error));
    });
  } catch (error) {
    logger.error('[BOT] %s failed: %s', taskName, getErrorMessage(error));
  }
};