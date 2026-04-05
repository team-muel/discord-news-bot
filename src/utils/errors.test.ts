import { describe, expect, it } from 'vitest';
import { AppError, httpStatusForCode, isAppError, promoteToAppError } from './errors';

describe('AppError', () => {
  it('sets code, message, and statusCode from known code', () => {
    const err = new AppError('VALIDATION', 'bad input');
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toBe('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });

  it('uses code as message when message is omitted', () => {
    const err = new AppError('SUPABASE_NOT_CONFIGURED');
    expect(err.message).toBe('SUPABASE_NOT_CONFIGURED');
    expect(err.statusCode).toBe(503);
  });

  it('accepts explicit statusCode override', () => {
    const err = new AppError('CUSTOM_CODE', 'detail', 418);
    expect(err.statusCode).toBe(418);
  });

  it('defaults to 500 for unknown codes', () => {
    const err = new AppError('UNKNOWN_ERROR');
    expect(err.statusCode).toBe(500);
  });
});

describe('httpStatusForCode', () => {
  it('returns mapped status for known codes', () => {
    expect(httpStatusForCode('VALIDATION')).toBe(400);
    expect(httpStatusForCode('MEMORY_NOT_FOUND')).toBe(404);
    expect(httpStatusForCode('OPENCODE_CHANGE_REQUEST_NOT_APPROVED')).toBe(409);
    expect(httpStatusForCode('OBSIDIAN_SANITIZER_BLOCKED')).toBe(422);
    expect(httpStatusForCode('SUPABASE_NOT_CONFIGURED')).toBe(503);
  });

  it('returns 500 for unknown codes', () => {
    expect(httpStatusForCode('SOMETHING_UNKNOWN')).toBe(500);
  });
});

describe('isAppError', () => {
  it('returns true for AppError', () => {
    expect(isAppError(new AppError('VALIDATION'))).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isAppError(new Error('test'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

describe('promoteToAppError', () => {
  it('returns the same AppError if already one', () => {
    const err = new AppError('VALIDATION');
    expect(promoteToAppError(err)).toBe(err);
  });

  it('promotes Error with known code', () => {
    const promoted = promoteToAppError(new Error('SUPABASE_NOT_CONFIGURED'));
    expect(promoted).not.toBeNull();
    expect(promoted!.code).toBe('SUPABASE_NOT_CONFIGURED');
    expect(promoted!.statusCode).toBe(503);
  });

  it('promotes Error with prefix:detail format', () => {
    const promoted = promoteToAppError(new Error('OBSIDIAN_SANITIZER_BLOCKED: unsafe content'));
    expect(promoted).not.toBeNull();
    expect(promoted!.code).toBe('OBSIDIAN_SANITIZER_BLOCKED');
    expect(promoted!.statusCode).toBe(422);
    expect(promoted!.message).toBe('unsafe content');
  });

  it('promotes Error with PRIVACY_PREFLIGHT_BLOCKED prefix', () => {
    const promoted = promoteToAppError(new Error('PRIVACY_PREFLIGHT_BLOCKED: user opted out'));
    expect(promoted).not.toBeNull();
    expect(promoted!.code).toBe('PRIVACY_PREFLIGHT_BLOCKED');
    expect(promoted!.statusCode).toBe(403);
    expect(promoted!.message).toBe('user opted out');
  });

  it('returns null for unknown Error messages', () => {
    expect(promoteToAppError(new Error('Something went wrong'))).toBeNull();
  });

  it('returns null for empty error', () => {
    expect(promoteToAppError(new Error(''))).toBeNull();
  });

  it('handles string errors', () => {
    const promoted = promoteToAppError('VALIDATION');
    expect(promoted).not.toBeNull();
    expect(promoted!.code).toBe('VALIDATION');
    expect(promoted!.statusCode).toBe(400);
  });

  it('returns null for non-error non-string', () => {
    expect(promoteToAppError(42)).toBeNull();
    expect(promoteToAppError(null)).toBeNull();
  });
});
