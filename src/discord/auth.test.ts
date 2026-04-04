import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const loadDiscordAuth = async (params?: {
  cleanupOwner?: 'app' | 'db';
  autoLoginOnFirstCommand?: 'true' | 'false';
}) => {
  vi.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    DISCORD_LOGIN_SESSION_CLEANUP_OWNER: params?.cleanupOwner ?? 'db',
    DISCORD_AUTO_LOGIN_ON_FIRST_COMMAND: params?.autoLoginOnFirstCommand ?? 'true',
  };

  const mocks = {
    isUserAdmin: vi.fn(async () => false),
    getDiscordLoginSessionExpiryMs: vi.fn<
      (_params: { guildId: string; userId: string }) => Promise<number | null>
    >(async () => null),
    purgeExpiredDiscordLoginSessions: vi.fn(async () => 0),
    upsertDiscordLoginSession: vi.fn(async () => true),
    getErrorMessage: vi.fn((error: unknown) => String(error)),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };

  vi.doMock('../services/adminAllowlistService', () => ({
    isUserAdmin: mocks.isUserAdmin,
  }));
  vi.doMock('../services/discord-support/discordLoginSessionStore', () => ({
    getDiscordLoginSessionExpiryMs: mocks.getDiscordLoginSessionExpiryMs,
    purgeExpiredDiscordLoginSessions: mocks.purgeExpiredDiscordLoginSessions,
    upsertDiscordLoginSession: mocks.upsertDiscordLoginSession,
  }));
  vi.doMock('./ui', () => ({
    getErrorMessage: mocks.getErrorMessage,
  }));
  vi.doMock('../logger', () => ({
    default: mocks.logger,
  }));

  const module = await import('./auth');
  return { module, mocks };
};

describe('discord/auth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...ORIGINAL_ENV };
  });

  it('hasValidLoginSession은 캐시 미스 시 DB에서 세션을 로드한다', async () => {
    const { module, mocks } = await loadDiscordAuth();
    mocks.getDiscordLoginSessionExpiryMs.mockResolvedValue(Date.now() + 60_000);

    const ok = await module.hasValidLoginSession('guild-1', 'user-1');
    expect(ok).toBe(true);
    expect(mocks.getDiscordLoginSessionExpiryMs).toHaveBeenCalledWith({ guildId: 'guild-1', userId: 'user-1' });
    expect(module.loggedInUsersByGuild.get('guild-1')?.has('user-1')).toBe(true);
  });

  it('ensureFeatureAccess는 auto-login 비활성 + 세션 없음이면 login_required를 반환한다', async () => {
    const { module } = await loadDiscordAuth({ autoLoginOnFirstCommand: 'false' });

    const interaction: any = {
      guildId: 'guild-1',
      user: { id: 'user-1' },
      memberPermissions: { has: vi.fn(() => false) },
    };

    const result = await module.ensureFeatureAccess(interaction);
    expect(result).toEqual({ ok: false, reason: 'login_required' });
  });

  it('ensureFeatureAccess는 auto-login 활성 + 세션 없음이면 자동 로그인한다', async () => {
    const { module, mocks } = await loadDiscordAuth({ autoLoginOnFirstCommand: 'true' });
    mocks.upsertDiscordLoginSession.mockResolvedValue(true);

    const interaction: any = {
      guildId: 'guild-1',
      user: { id: 'user-1' },
      memberPermissions: { has: vi.fn(() => false) },
    };

    const result = await module.ensureFeatureAccess(interaction);
    expect(result).toEqual({ ok: true, autoLoggedIn: true, mode: 'persisted' });
  });

  it('hasFeatureAccess는 guildId가 없고 admin이 아니면 false다', async () => {
    const { module } = await loadDiscordAuth();

    const interaction: any = {
      guildId: null,
      user: { id: 'user-1' },
      memberPermissions: { has: vi.fn(() => false) },
    };

    await expect(module.hasFeatureAccess(interaction)).resolves.toBe(false);
  });

  it('startLoginSessionCleanupLoop는 owner=db일 때 app 루프를 시작하지 않는다', async () => {
    const { module, mocks } = await loadDiscordAuth({ cleanupOwner: 'db' });

    module.startLoginSessionCleanupLoop();

    expect(mocks.purgeExpiredDiscordLoginSessions).not.toHaveBeenCalled();
    expect(module.getLoginSessionCleanupLoopStats()).toMatchObject({
      owner: 'db',
      running: false,
    });
  });

  it('startLoginSessionCleanupLoop는 owner=app일 때 즉시 1회 + 주기 cleanup을 실행한다', async () => {
    const { module, mocks } = await loadDiscordAuth({ cleanupOwner: 'app' });
    mocks.purgeExpiredDiscordLoginSessions.mockResolvedValue(1);

    module.startLoginSessionCleanupLoop();
    await Promise.resolve();
    expect(mocks.purgeExpiredDiscordLoginSessions).toHaveBeenCalledTimes(1);
    expect(module.getLoginSessionCleanupLoopStats()).toMatchObject({
      owner: 'app',
      running: true,
    });

    vi.advanceTimersByTime(module.LOGIN_SESSION_CLEANUP_INTERVAL_MS);
    await Promise.resolve();
    expect(mocks.purgeExpiredDiscordLoginSessions).toHaveBeenCalledTimes(2);
  });
});
