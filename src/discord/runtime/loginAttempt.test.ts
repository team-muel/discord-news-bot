import { describe, expect, it, vi } from 'vitest';
import { DISCORD_LOGIN_READY_TIMEOUT_ERROR, loginDiscordClientWithTimeout } from './loginAttempt';

type FakeClient = {
  login: (token: string) => Promise<unknown>;
  isReady: () => boolean;
  once: (event: 'clientReady', listener: () => void) => void;
  off: (event: 'clientReady', listener: () => void) => void;
  emitReady: () => void;
  loginMock: ReturnType<typeof vi.fn<(token: string) => Promise<unknown>>>;
  isReadyMock: ReturnType<typeof vi.fn<() => boolean>>;
  onceMock: ReturnType<typeof vi.fn<(event: 'clientReady', listener: () => void) => void>>;
  offMock: ReturnType<typeof vi.fn<(event: 'clientReady', listener: () => void) => void>>;
};

const createFakeClient = (): FakeClient => {
  let readyListener: (() => void) | null = null;
  const loginMock = vi.fn<(token: string) => Promise<unknown>>(async () => undefined);
  const isReadyMock = vi.fn<() => boolean>(() => false);
  const onceMock = vi.fn<(event: 'clientReady', listener: () => void) => void>((_event, listener) => {
    readyListener = listener;
  });
  const offMock = vi.fn<(event: 'clientReady', listener: () => void) => void>((_event, listener) => {
    if (readyListener === listener) {
      readyListener = null;
    }
  });

  return {
    login: loginMock,
    isReady: isReadyMock,
    once: onceMock,
    off: offMock,
    emitReady: () => {
      const listener = readyListener;
      readyListener = null;
      listener?.();
    },
    loginMock,
    isReadyMock,
    onceMock,
    offMock,
  };
};

describe('loginDiscordClientWithTimeout', () => {
  it('resolves when the client becomes ready after login', async () => {
    const client = createFakeClient();
    const pending = loginDiscordClientWithTimeout(client, 'token', 100);

    await Promise.resolve();
    expect(client.loginMock).toHaveBeenCalledWith('token');
    client.emitReady();

    await expect(pending).resolves.toBeUndefined();
  });

  it('resolves immediately when the client is already ready after login', async () => {
    const client = createFakeClient();
    client.isReadyMock.mockReturnValue(true);

    await expect(loginDiscordClientWithTimeout(client, 'token', 100)).resolves.toBeUndefined();
    expect(client.onceMock).toHaveBeenCalledTimes(1);
  });

  it('resolves when ready fires immediately after login resolves', async () => {
    const client = createFakeClient();
    client.loginMock.mockImplementation(async () => {
      client.emitReady();
      return undefined;
    });

    await expect(loginDiscordClientWithTimeout(client, 'token', 100)).resolves.toBeUndefined();
    expect(client.offMock).toHaveBeenCalledTimes(1);
  });

  it('rejects when login never resolves', async () => {
    vi.useFakeTimers();
    const client = createFakeClient();
    client.loginMock.mockImplementation(() => new Promise(() => undefined));

    const pending = loginDiscordClientWithTimeout(client, 'token', 50);
    const assertion = expect(pending).rejects.toThrow(DISCORD_LOGIN_READY_TIMEOUT_ERROR);
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
    vi.useRealTimers();
  });

  it('rejects when login resolves but ready never arrives', async () => {
    vi.useFakeTimers();
    const client = createFakeClient();

    const pending = loginDiscordClientWithTimeout(client, 'token', 50);
    const assertion = expect(pending).rejects.toThrow(DISCORD_LOGIN_READY_TIMEOUT_ERROR);
    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(client.offMock).toHaveBeenCalled();
    vi.useRealTimers();
  });
});