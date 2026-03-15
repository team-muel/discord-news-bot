import { describe, expect, it } from 'vitest';
import { toAgentOutcome } from './agentOutcomeContract';

describe('toAgentOutcome', () => {
  it('ok=true는 success로 정규화한다', () => {
    const out = toAgentOutcome({
      ok: true,
      name: 'web.search',
      summary: '검색 성공',
      artifacts: [],
      verification: [],
    });

    expect(out.state).toBe('success');
    expect(out.code).toBe('OK');
    expect(out.retryable).toBe(false);
    expect(out.confidence).toBe('high');
  });

  it('UNVERIFIED_CONTENT는 degraded로 정규화한다', () => {
    const out = toAgentOutcome({
      ok: false,
      name: 'news.verify',
      summary: '검증 보류',
      artifacts: [],
      verification: [],
      error: 'UNVERIFIED_CONTENT',
    });

    expect(out.state).toBe('degraded');
    expect(out.code).toBe('UNVERIFIED_CONTENT');
    expect(out.confidence).toBe('medium');
  });

  it('기타 실패는 failure로 정규화한다', () => {
    const out = toAgentOutcome({
      ok: false,
      name: 'db.supabase.read',
      summary: '권한 없음',
      artifacts: [],
      verification: [],
      error: 'ACTION_NOT_ALLOWED',
    });

    expect(out.state).toBe('failure');
    expect(out.code).toBe('ACTION_NOT_ALLOWED');
    expect(out.confidence).toBe('low');
  });
});
