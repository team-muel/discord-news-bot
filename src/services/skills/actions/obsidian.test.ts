import { describe, expect, it, vi } from 'vitest';

vi.mock('../../obsidian/authoring', () => ({
  upsertObsidianGuildDocument: vi.fn(),
  stripMarkdownExtension: (name: string) => String(name || '').replace(/\.md$/i, '').trim(),
}));

vi.mock('../../../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: vi.fn(),
}));

vi.mock('../../llmClient', () => ({
  isAnyLlmConfigured: vi.fn(() => false),
  generateText: vi.fn(),
}));

import { upsertObsidianGuildDocument } from '../../obsidian/authoring';
import { generateText, isAnyLlmConfigured } from '../../llmClient';
import { getObsidianVaultRoot } from '../../../utils/obsidianEnv';
import { obsidianGuildDocUpsertAction } from './obsidian';

describe('obsidianGuildDocUpsertAction', () => {
  it('guildId가 없으면 실패한다', async () => {
    const result = await obsidianGuildDocUpsertAction.execute({
      goal: '테스트 문서 저장',
      args: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('GUILD_ID_REQUIRED');
  });

  it('vault 경로가 없으면 실패한다', async () => {
    vi.mocked(getObsidianVaultRoot).mockReturnValue('');

    const result = await obsidianGuildDocUpsertAction.execute({
      guildId: '123456789012345678',
      goal: '테스트 문서 저장',
      args: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('OBSIDIAN_VAULT_PATH_MISSING');
  });

  it('저장 성공 시 경로를 artifacts에 포함한다', async () => {
    vi.mocked(getObsidianVaultRoot).mockReturnValue('C:/vault');
    vi.mocked(upsertObsidianGuildDocument).mockResolvedValue({ ok: true, path: 'C:/vault/guilds/123/test.md' });

    const result = await obsidianGuildDocUpsertAction.execute({
      guildId: '123456789012345678',
      goal: '테스트 문서 저장',
      args: {
        fileName: 'test',
        content: '본문',
        tags: ['ops'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.artifacts[0]).toContain('test.md');
  });

  it('자동 태그 분류와 frontmatter 템플릿 속성을 강제한다', async () => {
    vi.mocked(getObsidianVaultRoot).mockReturnValue('C:/vault');
    vi.mocked(upsertObsidianGuildDocument).mockResolvedValue({ ok: true, path: 'C:/vault/guilds/123/incident.md' });

    await obsidianGuildDocUpsertAction.execute({
      guildId: '123456789012345678',
      goal: '장애 복구 postmortem 정리',
      args: {
        fileName: 'incident.md',
        content: '원인과 조치 내역을 정리한다',
        tags: ['custom-tag'],
      },
    });

    const call = vi.mocked(upsertObsidianGuildDocument).mock.calls.at(-1);
    expect(call).toBeTruthy();
    const payload = call?.[0] as any;

    expect(payload.tags).toEqual(expect.arrayContaining(['custom-tag', 'incident', 'muel-bot', 'backend-plugin']));
    expect(payload.properties?.schema).toBe('muel-note/v1');
    expect(payload.properties?.source).toBe('muel-bot-backend');
    expect(payload.properties?.guild_id).toBe('123456789012345678');
    expect(payload.properties?.category).toBe('incident');
    expect(payload.properties?.auto_tagged).toBe(true);
    expect(String(payload.content || '')).toContain('# incident');
  });

  it('AI 룰 엔진 분류 결과를 태그/카테고리에 반영한다', async () => {
    vi.mocked(getObsidianVaultRoot).mockReturnValue('C:/vault');
    vi.mocked(isAnyLlmConfigured).mockReturnValue(true);
    vi.mocked(generateText).mockResolvedValue('{"category":"policy","tags":["governance","approval-flow"]}');
    vi.mocked(upsertObsidianGuildDocument).mockResolvedValue({ ok: true, path: 'C:/vault/guilds/123/policy.md' });

    const result = await obsidianGuildDocUpsertAction.execute({
      guildId: '123456789012345678',
      goal: '승인 정책 문서를 갱신해줘',
      args: {
        fileName: 'policy.md',
        content: '승인 흐름과 역할을 명확히 한다',
      },
    });

    expect(result.ok).toBe(true);
    const call = vi.mocked(upsertObsidianGuildDocument).mock.calls.at(-1);
    const payload = call?.[0] as any;
    expect(payload.properties?.category).toBe('policy');
    expect(payload.tags).toEqual(expect.arrayContaining(['governance', 'approval-flow']));
  });
});
