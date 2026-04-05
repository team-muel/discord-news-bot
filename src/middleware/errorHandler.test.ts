import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from './errorHandler';
import { AppError } from '../utils/errors';

vi.mock('../logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/** Create a fake Express `res` with chainable .status().json() */
const mockRes = () => {
  const res: Record<string, unknown> = {};
  const jsonFn = vi.fn();
  const statusFn = vi.fn(() => ({ json: jsonFn }));
  res.status = statusFn;
  res.json = jsonFn;
  return { res, statusFn, jsonFn };
};

const mockReq = {} as any;
const mockNext = vi.fn();

describe('errorHandler middleware', () => {
  it('handles AppError with correct status and JSON', () => {
    const { res, statusFn, jsonFn } = mockRes();
    errorHandler(new AppError('VALIDATION', 'bad input'), mockReq, res as any, mockNext);
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith({ ok: false, error: 'VALIDATION', message: 'bad input' });
  });

  it('handles AppError with 404 code', () => {
    const { res, statusFn, jsonFn } = mockRes();
    errorHandler(new AppError('MEMORY_NOT_FOUND', 'item not found'), mockReq, res as any, mockNext);
    expect(statusFn).toHaveBeenCalledWith(404);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
  });

  it('handles AppError with 503 code', () => {
    const { res, statusFn, jsonFn } = mockRes();
    errorHandler(new AppError('SUPABASE_NOT_CONFIGURED'), mockReq, res as any, mockNext);
    expect(statusFn).toHaveBeenCalledWith(503);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'CONFIG' }));
  });

  it('promotes legacy Error with known code', () => {
    const { res, statusFn, jsonFn } = mockRes();
    errorHandler(new Error('SUPABASE_NOT_CONFIGURED'), mockReq, res as any, mockNext);
    expect(statusFn).toHaveBeenCalledWith(503);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'CONFIG' }));
  });

  it('promotes legacy Error with prefix:detail format', () => {
    const { res, statusFn } = mockRes();
    errorHandler(new Error('OBSIDIAN_SANITIZER_BLOCKED: forbidden content'), mockReq, res as any, mockNext);
    expect(statusFn).toHaveBeenCalledWith(422);
  });

  it('returns 500 for unknown errors', () => {
    const { res, statusFn, jsonFn } = mockRes();
    errorHandler(new Error('Something unexpected'), mockReq, res as any, mockNext);
    expect(statusFn).toHaveBeenCalledWith(500);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'INTERNAL' }));
  });

  it('redacts sensitive information in error messages', () => {
    const { res, jsonFn } = mockRes();
    errorHandler(new Error('supabase connection_string leaked'), mockReq, res as any, mockNext);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ message: 'internal error' }));
  });

  it('handles 409 Conflict errors', () => {
    const { res, statusFn, jsonFn } = mockRes();
    errorHandler(new AppError('JOB_NOT_CANCELABLE', 'cannot cancel'), mockReq, res as any, mockNext);
    expect(statusFn).toHaveBeenCalledWith(409);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'CONFLICT' }));
  });

  it('handles 403 Forbidden errors', () => {
    const { res, statusFn, jsonFn } = mockRes();
    errorHandler(new Error('PRIVACY_PREFLIGHT_BLOCKED: not allowed'), mockReq, res as any, mockNext);
    expect(statusFn).toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ error: 'FORBIDDEN' }));
  });
});
