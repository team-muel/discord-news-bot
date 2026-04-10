import { describe, expect, it, vi } from 'vitest';

const { mockBuildObsidianKnowledgeReflectionBundle } = vi.hoisted(() => ({
  mockBuildObsidianKnowledgeReflectionBundle: vi.fn((value: string) => ({
    targetPath: value,
    plane: String(value).startsWith('ops/') ? 'control' : 'record',
    concern: String(value).includes('/customer/')
      ? 'customer-operating-memory'
      : (String(value).startsWith('ops/control-tower/') ? 'control-tower' : 'guild-memory'),
    requiredPaths: [value, 'ops/knowledge-control/INDEX.md', 'ops/knowledge-control/LOG.md'],
    suggestedPaths: ['ops/control-tower/GATE_ENTRYPOINTS.md'],
    suggestedPatterns: [],
    verificationChecklist: ['search visibility verified'],
    gatePaths: ['ops/control-tower/GATE_ENTRYPOINTS.md'],
    customerImpact: String(value).includes('/customer/'),
    notes: [],
  })),
}));

vi.mock('./router', () => ({
  writeObsidianNoteWithAdapter: vi.fn(),
}));

vi.mock('./knowledgeCompilerService', () => ({
  buildObsidianKnowledgeReflectionBundle: mockBuildObsidianKnowledgeReflectionBundle,
}));

import { writeObsidianNoteWithAdapter } from './router';
import { upsertObsidianGuildDocument, upsertObsidianSystemDocument } from './authoring';

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
    expect(result.reflectionBundle?.concern).toBe('guild-memory');
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

  it('customer ledger 경로는 customer-operating-memory bundle을 반환한다', async () => {
    vi.mocked(writeObsidianNoteWithAdapter).mockResolvedValue({
      path: 'guilds/123456789012345678/customer/ISSUES.md',
    });

    const result = await upsertObsidianGuildDocument({
      guildId: '123456789012345678',
      vaultPath: 'C:/vault',
      fileName: 'customer/ISSUES',
      content: '고객 이슈 정리',
      tags: ['customer'],
      properties: {},
    });

    expect(result.ok).toBe(true);
    expect(result.reflectionBundle?.concern).toBe('customer-operating-memory');
    expect(result.reflectionBundle?.customerImpact).toBe(true);
  });

  it('system document write도 control-plane bundle을 반환한다', async () => {
    vi.mocked(writeObsidianNoteWithAdapter).mockResolvedValue({
      path: 'ops/control-tower/BLUEPRINT.md',
    });

    const result = await upsertObsidianSystemDocument({
      vaultPath: 'C:/vault',
      fileName: 'ops/control-tower/BLUEPRINT',
      content: '운영 청사진',
      tags: ['control'],
      properties: {},
    });

    expect(result.ok).toBe(true);
    expect(result.reflectionBundle?.plane).toBe('control');
    expect(result.reflectionBundle?.concern).toBe('control-tower');
    expect(mockBuildObsidianKnowledgeReflectionBundle).toHaveBeenCalledWith('ops/control-tower/BLUEPRINT.md');
  });

  it('system backfill은 high-link-density trusted content를 명시적으로 허용한다', async () => {
    vi.mocked(writeObsidianNoteWithAdapter).mockResolvedValue({
      path: 'ops/services/gcp-worker/PROFILE.md',
    });

    const result = await upsertObsidianSystemDocument({
      vaultPath: 'C:/vault',
      fileName: 'ops/services/gcp-worker/PROFILE',
      content: '운영 프로필',
      tags: ['runtime'],
      allowHighLinkDensity: true,
      properties: {},
    });

    expect(result.ok).toBe(true);
    const call = vi.mocked(writeObsidianNoteWithAdapter).mock.calls.at(-1);
    expect(call?.[0]?.allowHighLinkDensity).toBe(true);
  });
});
