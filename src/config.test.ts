import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('production에서 JWT_SECRET이 없으면 import 시 예외를 던진다', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.SESSION_SECRET;

    await expect(import('./config')).rejects.toThrow(
      'JWT_SECRET (or SESSION_SECRET) must be set to a non-default value in production',
    );
  });

  it('PUBLIC_BASE_URL은 우선순위 값에서 trailing slash를 제거한다', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PUBLIC_BASE_URL;
    process.env.RENDER_EXTERNAL_URL = 'https://example.onrender.com///';
    delete process.env.RENDER_PUBLIC_URL;

    const config = await import('./config');
    expect(config.PUBLIC_BASE_URL).toBe('https://example.onrender.com');
  });

  it('JWT_SECRET이 비어 있어도 SESSION_SECRET이 있으면 production import가 성공한다', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    process.env.SESSION_SECRET = 'session-secret-only';

    const config = await import('./config');
    expect(config.JWT_SECRET).toBe('session-secret-only');
  });

  it('OBSIDIAN_VAULT_PATH는 OBSIDIAN_SYNC_VAULT_PATH를 legacy alias로 받아들인다', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.OBSIDIAN_VAULT_PATH;
    process.env.OBSIDIAN_SYNC_VAULT_PATH = 'C:/vault-sync';

    const config = await import('./config');

    expect(config.OBSIDIAN_VAULT_PATH).toBe('C:/vault-sync');
    expect(config.OBSIDIAN_SYNC_VAULT_PATH).toBe('C:/vault-sync');
  });

  it('DISCORD_OAUTH_REDIRECT_URI는 PUBLIC_BASE_URL fallback을 유지한다', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PUBLIC_BASE_URL = 'https://discord.example.com///';
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.RENDER_PUBLIC_URL;
    delete process.env.DISCORD_OAUTH_REDIRECT_URI;

    const config = await import('./config');

    expect(config.DISCORD_OAUTH_REDIRECT_URI).toBe('https://discord.example.com/api/auth/callback');
  });

  it('SPRINT_LEARNING_JOURNAL_AUTO_APPLY_MIN_CONFIDENCE는 percent 입력을 0-1 범위로 정규화한다', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SPRINT_LEARNING_JOURNAL_AUTO_APPLY_MIN_CONFIDENCE = '85';

    const config = await import('./config');

    expect(config.SPRINT_LEARNING_JOURNAL_AUTO_APPLY_MIN_CONFIDENCE).toBe(0.85);
  });

  it('MCP_FAST_FAIL_TIMEOUT_MS는 sprint phase timeout의 절반을 넘지 않는다', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SPRINT_PHASE_TIMEOUT_MS = '8000';
    process.env.MCP_FAST_FAIL_TIMEOUT_MS = '10000';

    const config = await import('./config');

    expect(config.MCP_FAST_FAIL_TIMEOUT_MS).toBe(4000);
  });
});
