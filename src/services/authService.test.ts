import { describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  AUTH_COOKIE_NAME: 'muel_session',
  AUTH_CSRF_COOKIE_NAME: 'muel_csrf',
  JWT_SECRET: 'test-jwt-secret',
  NODE_ENV: 'test',
}));

import { issueCsrfToken, verifyCsrfToken } from './authService';

describe('services/authService', () => {
  it('verifyCsrfToken은 정상 발급된 토큰을 검증한다', () => {
    const token = issueCsrfToken('user-1');

    expect(verifyCsrfToken(token, 'user-1')).toBe(true);
  });

  it('verifyCsrfToken은 형식이 잘못된 hex 서명에서 예외 없이 false를 반환한다', () => {
    expect(() => verifyCsrfToken('nonce.invalid-hex', 'user-1')).not.toThrow();
    expect(verifyCsrfToken('nonce.invalid-hex', 'user-1')).toBe(false);
    expect(verifyCsrfToken('nonce.abcd', 'user-1')).toBe(false);
  });
});