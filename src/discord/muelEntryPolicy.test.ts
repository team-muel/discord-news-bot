import { describe, expect, it } from 'vitest';

import {
  isLowSignalPrompt,
  isQuickConversation,
  resolveMuelEntryIntent,
} from './muelEntryPolicy';

const patterns = {
  codingIntentPattern: /코드|구현|만들/i,
  automationIntentPattern: /자동화|연동|상태|실행/i,
};

describe('muelEntryPolicy', () => {
  it('routes coding or automation requests to the session lane', () => {
    expect(resolveMuelEntryIntent('Express 라우터 만들어줘', patterns)).toBe('session');
    expect(resolveMuelEntryIntent('배포 상태 자동화해줘', patterns)).toBe('session');
  });

  it('routes ordinary knowledge questions to the docs lane', () => {
    expect(resolveMuelEntryIntent('현재 구조 설명해줘', patterns)).toBe('docs');
  });

  it('routes empty or low-signal requests to clarification', () => {
    expect(resolveMuelEntryIntent('', patterns)).toBe('clarify');
    expect(resolveMuelEntryIntent('asdf', patterns)).toBe('clarify');
  });

  it('detects low-signal repeated or symbol-only noise', () => {
    expect(isLowSignalPrompt('ㅋㅋㅋㅋㅋㅋ', patterns)).toBe(true);
    expect(isLowSignalPrompt('....', patterns)).toBe(true);
    expect(isLowSignalPrompt('api 연동', patterns)).toBe(false);
  });

  it('preserves quick conversation detection for casual messages', () => {
    expect(isQuickConversation('안녕')).toBe(true);
    expect(isQuickConversation('지금 몇시야?')).toBe(true);
    expect(isQuickConversation('아키텍처 설명해줘')).toBe(false);
  });
});