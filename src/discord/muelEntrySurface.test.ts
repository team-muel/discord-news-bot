import { describe, expect, it } from 'vitest';
import { commandDefinitions } from './commandDefinitions';
import { DISCORD_MESSAGES } from './messages';
import { hasVibeMessagePrefix, stripVibeMessagePrefix } from './commands/vibe';
import { SIMPLE_COMMAND_ALLOWLIST } from './runtimePolicy';

describe('Discord Muel entry surface', () => {
  it('keeps the simplified public surface plus the three operator commands', () => {
    const commandNames = commandDefinitions.map((definition) => String((definition as { name?: string }).name || ''));

    expect(commandNames).toContain('뮤엘');
    expect(commandNames).toContain('해줘');
    expect(commandNames).toContain('시작');
    expect(commandNames).toContain('온보딩');
    expect(commandNames).toContain('중지');
    expect(commandNames).toContain('프로필');
    expect(commandNames).toContain('메모');
    expect(commandNames).not.toContain('관리자');
    expect(commandNames).not.toContain('정책');
    expect(commandNames).not.toContain('스킬목록');
    expect(commandNames).not.toContain('관리설정');
    expect(commandNames).not.toContain('유저');
    expect(commandNames).not.toContain('통계');
    expect(commandNames).not.toContain('지표리뷰');
    expect(commandNames).not.toContain('만들어줘');
    expect(SIMPLE_COMMAND_ALLOWLIST.has('시작')).toBe(true);
    expect(SIMPLE_COMMAND_ALLOWLIST.has('온보딩')).toBe(true);
    expect(SIMPLE_COMMAND_ALLOWLIST.has('중지')).toBe(true);
    expect(SIMPLE_COMMAND_ALLOWLIST.has('관리자')).toBe(false);
    expect(SIMPLE_COMMAND_ALLOWLIST.has('정책')).toBe(false);
    expect(SIMPLE_COMMAND_ALLOWLIST.has('스킬목록')).toBe(false);
    expect(SIMPLE_COMMAND_ALLOWLIST.has('만들어줘')).toBe(false);
  });

  it('recognizes Muel-prefixed message requests', () => {
    expect(hasVibeMessagePrefix('뮤엘 오늘 뉴스 요약해줘')).toBe(true);
    expect(hasVibeMessagePrefix('뮤엘: 오늘 뉴스 요약해줘')).toBe(true);
    expect(hasVibeMessagePrefix('뮤엘아 오늘 일정 정리해줘')).toBe(true);
    expect(hasVibeMessagePrefix('해줘 오늘 뉴스 요약해줘')).toBe(false);
    expect(hasVibeMessagePrefix('나는 뮤엘 구조를 보고 있다')).toBe(false);
  });

  it('strips the Muel prefix from message requests', () => {
    expect(stripVibeMessagePrefix('뮤엘 오늘 뉴스 요약해줘')).toBe('오늘 뉴스 요약해줘');
    expect(stripVibeMessagePrefix('뮤엘: 오늘 뉴스 요약해줘')).toBe('오늘 뉴스 요약해줘');
    expect(stripVibeMessagePrefix('뮤엘아 오늘 일정 정리해줘')).toBe('오늘 일정 정리해줘');
    expect(stripVibeMessagePrefix('오늘 뉴스 요약해줘')).toBe('오늘 뉴스 요약해줘');
  });

  it('updates onboarding copy to guide users toward Muel message entry', () => {
    const onboardingLines = DISCORD_MESSAGES.bot.onboardingWelcomeLines(null);
    const mentionPrompt = DISCORD_MESSAGES.vibe.mentionPrompt;
    const utilityOnlyPrompt = DISCORD_MESSAGES.vibe.utilityOnlyPrompt;

    expect(onboardingLines[1]).toContain('`뮤엘 ...`');
    expect(onboardingLines[1]).toContain('`/뮤엘`');
    expect(onboardingLines[1]).not.toContain('`/해줘`');
    expect(onboardingLines[2]).toContain('`/메모`');
    expect(onboardingLines[2]).toContain('`/프로필`');
    expect(onboardingLines[2]).not.toContain('`/정책`');
    expect(mentionPrompt).toContain('`뮤엘 오늘 뉴스 요약해줘`');
    expect(utilityOnlyPrompt).toContain('`뮤엘 뉴스 요약해줘`');
  });
});