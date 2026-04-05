import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('tokenEncryption', () => {
  const TEST_SECRET = 'test-encryption-secret-at-least-16-chars';

  beforeEach(() => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('encrypt → decrypt round-trip preserves plaintext', async () => {
    const { encryptToken, decryptToken } = await import('./tokenEncryption');
    const original = 'discord-access-token-abc123';
    const encrypted = encryptToken(original);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(original);
  });

  it('encrypted output starts with version prefix', async () => {
    const { encryptToken, isEncryptedToken } = await import('./tokenEncryption');
    const encrypted = encryptToken('some-token');
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(isEncryptedToken(encrypted)).toBe(true);
  });

  it('different encryptions of the same plaintext produce different ciphertexts', async () => {
    const { encryptToken } = await import('./tokenEncryption');
    const token = 'same-token-value';
    const a = encryptToken(token);
    const b = encryptToken(token);
    expect(a).not.toBe(b); // random IV + salt
  });

  it('decryptToken returns legacy plaintext as-is', async () => {
    const { decryptToken, isEncryptedToken } = await import('./tokenEncryption');
    const legacy = 'plain-text-token-from-old-data';
    expect(isEncryptedToken(legacy)).toBe(false);
    expect(decryptToken(legacy)).toBe(legacy);
  });

  it('throws on tampered ciphertext', async () => {
    const { encryptToken, decryptToken } = await import('./tokenEncryption');
    const encrypted = encryptToken('secret');
    // Flip a character in the base64 payload
    const tampered = encrypted.replace(/^(enc:v1:.)/, '$1AAAA');
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('throws when no encryption key is configured', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('SESSION_SECRET', '');

    // Re-import to pick up empty env
    vi.resetModules();
    const { encryptToken } = await import('./tokenEncryption');
    expect(() => encryptToken('token')).toThrow('TOKEN_ENCRYPTION_KEY');
  });

  it('handles empty string encryption', async () => {
    const { encryptToken, decryptToken } = await import('./tokenEncryption');
    const encrypted = encryptToken('');
    expect(decryptToken(encrypted)).toBe('');
  });

  it('handles unicode content', async () => {
    const { encryptToken, decryptToken } = await import('./tokenEncryption');
    const unicode = '한국어토큰🔐';
    const encrypted = encryptToken(unicode);
    expect(decryptToken(encrypted)).toBe(unicode);
  });
});
