export const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Preserve caller's signal: if provided, abort when either signal fires
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  return fetch(input, {
    ...init,
    signal,
  }).finally(() => clearTimeout(timeout));
};
