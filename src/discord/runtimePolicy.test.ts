import { afterEach, describe, expect, it, vi } from 'vitest';

describe('discord runtimePolicy intent regex handling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the documented default patterns when no override is configured', async () => {
    vi.stubEnv('DISCORD_CODING_INTENT_PATTERN', '');
    vi.stubEnv('DISCORD_AUTOMATION_INTENT_PATTERN', '');

    const policy = await import('./runtimePolicy');

    expect(policy.INTENT_PATTERN_DIAGNOSTICS.coding).toMatchObject({
      status: 'default',
      reason: 'missing',
    });
    expect(policy.INTENT_PATTERN_DIAGNOSTICS.automation).toMatchObject({
      status: 'default',
      reason: 'missing',
    });
    expect(policy.CODING_INTENT_PATTERN.test('typescript 함수 만들어줘')).toBe(true);
    expect(policy.AUTOMATION_INTENT_PATTERN.test('자동화 워커 만들어줘')).toBe(true);
  });

  it('disables an invalid coding override instead of widening back to the default pattern', async () => {
    vi.stubEnv('DISCORD_CODING_INTENT_PATTERN', '[invalid');
    vi.stubEnv('DISCORD_AUTOMATION_INTENT_PATTERN', '자동화');

    const policy = await import('./runtimePolicy');

    expect(policy.INTENT_PATTERN_DIAGNOSTICS.coding).toMatchObject({
      status: 'disabled-invalid',
      reason: 'invalid-regex',
      source: '[invalid',
    });
    expect(policy.CODING_INTENT_PATTERN.test('typescript 함수 만들어줘')).toBe(false);
    expect(policy.CODING_INTENT_PATTERN.test('[invalid')).toBe(false);
    expect(policy.AUTOMATION_INTENT_PATTERN.test('자동화 요청')).toBe(true);
  });

  it('disables a ReDoS-suspect automation override instead of silently restoring the broad default', async () => {
    vi.stubEnv('DISCORD_CODING_INTENT_PATTERN', '코드');
    vi.stubEnv('DISCORD_AUTOMATION_INTENT_PATTERN', '(a+)+');

    const policy = await import('./runtimePolicy');

    expect(policy.INTENT_PATTERN_DIAGNOSTICS.automation).toMatchObject({
      status: 'disabled-invalid',
      reason: 'redos-suspect',
      source: '(a+)+',
    });
    expect(policy.AUTOMATION_INTENT_PATTERN.test('자동화 워커 만들어줘')).toBe(false);
    expect(policy.CODING_INTENT_PATTERN.test('코드 구현')).toBe(true);
  });
});