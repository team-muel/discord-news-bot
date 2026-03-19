import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  parseSessionToken: vi.fn(),
  getAdminAllowlist: vi.fn(),
}));

vi.mock('../config', () => ({
  AUTH_COOKIE_NAME: 'muel_session',
  AUTH_CSRF_COOKIE_NAME: 'muel_csrf',
  AUTH_CSRF_HEADER_NAME: 'x-csrf-token',
}));

vi.mock('../services/authService', () => ({
  parseSessionToken: hoisted.parseSessionToken,
}));

vi.mock('../services/adminAllowlistService', () => ({
  getAdminAllowlist: hoisted.getAdminAllowlist,
}));

import {
  attachUser,
  requireAdmin,
  requireAuth,
  requireCsrfForStateChange,
} from './auth';

const createRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('middleware/auth', () => {
  it('attachUser는 cookie 토큰을 파싱해 req.user를 붙인다', () => {
    hoisted.parseSessionToken.mockReturnValue({ id: 'u-1' });
    const req: any = { cookies: { muel_session: 'token-1' } };
    const res = createRes();
    const next = vi.fn();

    attachUser(req, res, next);

    expect(hoisted.parseSessionToken).toHaveBeenCalledWith('token-1');
    expect(req.user).toMatchObject({ id: 'u-1' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requireAuth는 user가 없으면 401을 반환한다', () => {
    const req: any = { user: undefined };
    const res = createRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'UNAUTHORIZED' });
    expect(next).not.toHaveBeenCalled();
  });

  it('requireCsrfForStateChange는 안전 메서드를 통과시킨다', () => {
    const req: any = { method: 'GET', headers: {}, cookies: {}, user: { id: 'u-1' } };
    const res = createRes();
    const next = vi.fn();

    requireCsrfForStateChange(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requireCsrfForStateChange는 비로그인 상태 변경 요청을 통과시킨다', () => {
    const req: any = { method: 'POST', headers: {}, cookies: {}, user: undefined };
    const res = createRes();
    const next = vi.fn();

    requireCsrfForStateChange(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requireCsrfForStateChange는 토큰이 불일치하면 403을 반환한다', () => {
    const req: any = {
      method: 'PATCH',
      user: { id: 'u-1' },
      headers: { 'x-csrf-token': 'header-token' },
      cookies: { muel_csrf: 'cookie-token' },
    };
    const res = createRes();
    const next = vi.fn();

    requireCsrfForStateChange(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF', message: 'CSRF token missing or invalid' });
    expect(next).not.toHaveBeenCalled();
  });

  it('requireCsrfForStateChange는 토큰이 일치하면 통과시킨다', () => {
    const req: any = {
      method: 'DELETE',
      user: { id: 'u-1' },
      headers: { 'x-csrf-token': 'same-token' },
      cookies: { muel_csrf: 'same-token' },
    };
    const res = createRes();
    const next = vi.fn();

    requireCsrfForStateChange(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requireAdmin은 allowlist가 비어 있으면 503을 반환한다', async () => {
    hoisted.getAdminAllowlist.mockResolvedValue(new Set());
    const req: any = { user: { id: 'u-1' } };
    const res = createRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'CONFIG',
      message: 'No admin allowlist source is configured',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('requireAdmin은 allowlist에 없으면 403을 반환한다', async () => {
    hoisted.getAdminAllowlist.mockResolvedValue(new Set(['u-2']));
    const req: any = { user: { id: 'u-1' } };
    const res = createRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'FORBIDDEN' });
    expect(next).not.toHaveBeenCalled();
  });

  it('requireAdmin은 allowlist 조회 오류 시 503을 반환한다', async () => {
    hoisted.getAdminAllowlist.mockRejectedValue(new Error('ALLOWLIST_DOWN'));
    const req: any = { user: { id: 'u-1' } };
    const res = createRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'CONFIG', message: 'ALLOWLIST_DOWN' });
    expect(next).not.toHaveBeenCalled();
  });

  it('requireAdmin은 allowlist에 있으면 next를 호출한다', async () => {
    hoisted.getAdminAllowlist.mockResolvedValue(new Set(['u-1']));
    const req: any = { user: { id: 'u-1' } };
    const res = createRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
