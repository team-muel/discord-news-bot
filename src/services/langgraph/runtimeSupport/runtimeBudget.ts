export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const ensureSessionBudget = (sessionStartedAtMs: number, timeoutMs: number): void => {
  if (Date.now() - sessionStartedAtMs > timeoutMs) {
    throw new Error('SESSION_TIMEOUT');
  }
};

export { getErrorMessage } from '../../../utils/errorMessage';
