type DiscordLoginClientLike = {
  login: (token: string) => Promise<unknown>;
  isReady: () => boolean;
  once: (event: 'clientReady', listener: () => void) => unknown;
  off?: (event: 'clientReady', listener: () => void) => unknown;
  removeListener?: (event: 'clientReady', listener: () => void) => unknown;
};

export const DISCORD_LOGIN_READY_TIMEOUT_ERROR = 'Discord login/ready timeout';

const detachReadyListener = (client: DiscordLoginClientLike, listener: (() => void) | null) => {
  if (!listener) {
    return;
  }
  if (typeof client.off === 'function') {
    client.off('clientReady', listener);
    return;
  }
  if (typeof client.removeListener === 'function') {
    client.removeListener('clientReady', listener);
  }
};

export async function loginDiscordClientWithTimeout(
  client: DiscordLoginClientLike,
  token: string,
  readyTimeoutMs: number,
): Promise<void> {
  const safeTimeoutMs = Math.max(1_000, Number(readyTimeoutMs) || 15_000);
  let timeoutHandle: NodeJS.Timeout | null = null;
  let readyListener: (() => void) | null = null;

  try {
    await Promise.race([
      (async () => {
        const readyPromise = new Promise<void>((resolve) => {
          readyListener = () => resolve();
          client.once('clientReady', readyListener);
        });

        await client.login(token);
        if (client.isReady()) {
          return;
        }
        await readyPromise;
      })(),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(DISCORD_LOGIN_READY_TIMEOUT_ERROR)), safeTimeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    detachReadyListener(client, readyListener);
  }
}