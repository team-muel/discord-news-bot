import { describe, expect, it, vi } from 'vitest';

vi.mock('./router', () => ({
  writeObsidianNoteWithAdapter: vi.fn(),
}));

import { writeObsidianNoteWithAdapter } from './router';
import { upsertObsidianGuildDocument } from './authoring';

describe('upsertObsidianGuildDocument', () => {
  it('Guild_Lore 파일명을 표준 경로로 정규화한다', async () => {
    vi.mocked(writeObsidianNoteWithAdapter).mockResolvedValue({
      path: 'guilds/123456789012345678/Guild_Lore.md',
    });

    const result = await upsertObsidianGuildDocument({
      guildId: '123456789012345678',
      vaultPath: 'C:/vault',
      fileName: 'guild lore',
      content: '테스트 본문',
      tags: ['ops'],
      properties: {},
    });

    expect(result.ok).toBe(true);
    const call = vi.mocked(writeObsidianNoteWithAdapter).mock.calls.at(-1);
    expect(call?.[0]?.fileName).toBe('guilds/123456789012345678/Guild_Lore.md');
  });

  it('사용자 지정 파일도 guilds/<guildId> 아래로 고정한다', async () => {
    vi.mocked(writeObsidianNoteWithAdapter).mockResolvedValue({
      path: 'guilds/123456789012345678/Weekly_Update.md',
    });

    const result = await upsertObsidianGuildDocument({
      guildId: '123456789012345678',
      vaultPath: 'C:/vault',
      fileName: 'Weekly_Update',
      content: '테스트 본문',
      tags: ['ops'],
      properties: {},
    });

    expect(result.ok).toBe(true);
    const call = vi.mocked(writeObsidianNoteWithAdapter).mock.calls.at(-1);
    expect(call?.[0]?.fileName).toBe('guilds/123456789012345678/Weekly_Update.md');
  });

  it('중첩 경로 파일명을 guilds/<guildId>/... 하위에 보존한다', async () => {
    vi.mocked(writeObsidianNoteWithAdapter).mockResolvedValue({
      path: 'guilds/123456789012345678/events/ingest/channel_activity_2026-03-15-10.md',
    });

    const result = await upsertObsidianGuildDocument({
      guildId: '123456789012345678',
      vaultPath: 'C:/vault',
      fileName: 'events/ingest/channel_activity_2026-03-15-10',
      content: 'telemetry',
      tags: ['ops'],
      properties: {},
    });

    expect(result.ok).toBe(true);
    const call = vi.mocked(writeObsidianNoteWithAdapter).mock.calls.at(-1);
    expect(call?.[0]?.fileName).toBe('guilds/123456789012345678/events/ingest/channel_activity_2026-03-15-10.md');
  });
});
