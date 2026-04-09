import { describe, expect, it } from 'vitest';
import { commandDefinitions } from './commandDefinitions';
import { DISCORD_MESSAGES } from './messages';
import { hasVibeMessagePrefix, stripVibeMessagePrefix } from './commands/vibe';

describe('Discord Muel entry surface', () => {
  it('keeps /뮤엘, preserves /해줘 compatibility, and exposes /메모 surface', () => {
    const commandNames = commandDefinitions.map((definition) => String((definition as { name?: string }).name || ''));

    expect(commandNames).toContain('뮤엘');
    expect(commandNames).toContain('해줘');
    expect(commandNames).toContain('프로필');
    expect(commandNames).toContain('메모');
    expect(commandNames).toContain('만들어줘');
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
    expect(mentionPrompt).toContain('`뮤엘 오늘 뉴스 요약해줘`');
    expect(utilityOnlyPrompt).toContain('`뮤엘 뉴스 요약해줘`');
  });
});