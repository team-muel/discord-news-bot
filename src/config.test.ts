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

  it('수동 트레이드 제한값은 양수가 아니면 fallback을 사용한다', async () => {
    process.env.NODE_ENV = 'development';
    process.env.MAX_MANUAL_TRADE_QTY = '0';
    process.env.MAX_MANUAL_TRADE_LEVERAGE = '-10';
    process.env.MAX_MANUAL_TRADE_ENTRY_PRICE = 'NaN';

    const config = await import('./config');
    expect(config.MAX_MANUAL_TRADE_QTY).toBe(10_000);
    expect(config.MAX_MANUAL_TRADE_LEVERAGE).toBe(125);
    expect(config.MAX_MANUAL_TRADE_ENTRY_PRICE).toBe(10_000_000);
  });
});
