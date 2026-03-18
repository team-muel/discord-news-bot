import { upsertObsidianGuildDocument } from '../../obsidian/authoring';
import { generateText, isAnyLlmConfigured } from '../../llmClient';
import { getObsidianVaultRoot } from '../../../utils/obsidianEnv';
import {
  getObsidianGraphMetadataWithAdapter,
  readObsidianFileWithAdapter,
  searchObsidianVaultWithAdapter,
} from '../../obsidian/router';
import type { ActionDefinition } from './types';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const toIsoNow = (): string => new Date().toISOString();

const stripMarkdownExtension = (name: string): string => {
  return String(name || '').replace(/\.md$/i, '').trim();
};

const inferCategory = (goal: string, content: string, fileName: string): string => {
  const text = `${goal}\n${content}\n${fileName}`.toLowerCase();

  if (/(incident|장애|에러|오류|온콜|oncall|복구|postmortem)/.test(text)) return 'incident';
  if (/(정책|policy|권한|승인|거버넌스|governance)/.test(text)) return 'policy';
  if (/(메모리|memory|rag|retrieval|회상|기억)/.test(text)) return 'memory';
  if (/(뉴스|news|헤드라인|브리핑)/.test(text)) return 'news';
  if (/(트레이딩|trading|매매|전략|시장|주가|차트|quote|binance)/.test(text)) return 'trading';
  if (/(ops|운영|runbook|sop|자동화|automation)/.test(text)) return 'operations';
  return 'general';
};

const inferAutoTags = (goal: string, content: string, fileName: string): string[] => {
  const text = `${goal}\n${content}\n${fileName}`.toLowerCase();
  const tags = new Set<string>(['muel-bot', 'backend-plugin']);

  if (/(incident|장애|에러|오류|복구|postmortem)/.test(text)) tags.add('incident');
  if (/(정책|policy|승인|권한|governance)/.test(text)) tags.add('policy');
  if (/(메모리|memory|rag|retrieval)/.test(text)) tags.add('memory');
  if (/(뉴스|news|브리핑|헤드라인)/.test(text)) tags.add('news');
  if (/(트레이딩|trading|매매|전략|시장|주가|차트|binance)/.test(text)) tags.add('trading');
  if (/(ops|운영|runbook|sop|자동화|automation)/.test(text)) tags.add('operations');

  return [...tags].slice(0, 40);
};

const inferAiTaxonomy = async (goal: string, content: string, fileName: string): Promise<{ tags: string[]; category?: string }> => {
  if (!isAnyLlmConfigured()) {
    return { tags: [] };
  }

  try {
    const raw = await generateText({
      system: [
        '너는 이제부터 옵시디언 지식 그래프를 구성하는 룰 엔진이다.',
        '반드시 태그와 카테고리만 결정한다. 문서 본문은 생성하지 않는다.',
        '출력은 반드시 단일 JSON 객체 한 줄만 허용한다.',
        '스키마: {"category":"general|operations|incident|policy|memory|news|trading","tags":["..."]}',
        '태그는 소문자 영문/숫자/하이픈만 사용하고 최대 8개까지 반환한다.',
      ].join('\n'),
      user: [
        `fileName: ${fileName}`,
        `goal: ${goal}`,
        `content: ${String(content || '').slice(0, 1200)}`,
      ].join('\n'),
      actionName: 'action.obsidian.taxonomy',
      temperature: 0,
      maxTokens: 160,
    });

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return { tags: [] };
    }

    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const category = typeof parsed.category === 'string' ? parsed.category.trim().toLowerCase() : '';
    const allowedCategories = new Set(['general', 'operations', 'incident', 'policy', 'memory', 'news', 'trading']);
    const safeCategory = allowedCategories.has(category) ? category : undefined;

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
        .map((tag) => String(tag || '').trim().toLowerCase())
        .filter((tag) => /^[a-z0-9-]{1,40}$/.test(tag))
        .slice(0, 8)
      : [];

    return { tags, category: safeCategory };
  } catch {
    return { tags: [] };
  }
};

const mergeTags = (manualTags: string[], autoTags: string[]): string[] => {
  const merged = new Set<string>();
  for (const tag of [...manualTags, ...autoTags]) {
    const clean = String(tag || '').trim().replace(/^#/, '').toLowerCase();
    if (!clean) continue;
    merged.add(clean);
  }
  return [...merged].slice(0, 40);
};

const enforceFrontmatterProperties = (params: {
  guildId: string;
  fileName: string;
  goal: string;
  content: string;
  aiCategory?: string;
  manual: Record<string, string | number | boolean | null>;
}): Record<string, string | number | boolean | null> => {
  const title = stripMarkdownExtension(params.fileName) || 'Guild Note';
  const category = params.aiCategory || inferCategory(params.goal, params.content, params.fileName);
  const nowIso = toIsoNow();

  return {
    ...params.manual,
    schema: 'muel-note/v1',
    source: 'muel-bot-backend',
    guild_id: params.guildId,
    title,
    category,
    auto_tagged: true,
    updated_at: nowIso,
  };
};

const enforceMarkdownBodyTemplate = (content: string, titleFromFileName: string): string => {
  const body = String(content || '').trim();
  if (!body) {
    return '';
  }

  if (/^#\s+/m.test(body)) {
    return body;
  }

  const title = stripMarkdownExtension(titleFromFileName) || 'Guild Note';
  return `# ${title}\n\n${body}`;
};

const toFileName = (goal: string, args?: Record<string, unknown>): string => {
  const fromArgs = typeof args?.fileName === 'string' ? compact(args.fileName) : '';
  if (fromArgs) {
    return fromArgs;
  }

  const fromTitle = typeof args?.title === 'string' ? compact(args.title) : '';
  if (fromTitle) {
    return fromTitle;
  }

  const fallback = compact(goal).slice(0, 80);
  return fallback || 'Guild Note';
};

const toContent = (goal: string, args?: Record<string, unknown>): string => {
  const fromArgs = typeof args?.content === 'string' ? String(args.content).trim() : '';
  if (fromArgs) {
    return fromArgs;
  }
  return String(goal || '').trim();
};

const toTags = (args?: Record<string, unknown>): string[] => {
  const fromArgs = Array.isArray(args?.tags) ? args?.tags : [];
  return fromArgs
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .slice(0, 40);
};

const toProperties = (args?: Record<string, unknown>): Record<string, string | number | boolean | null> => {
  if (!args?.properties || typeof args.properties !== 'object' || Array.isArray(args.properties)) {
    return {};
  }

  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(args.properties as Record<string, unknown>)) {
    if (!String(key || '').trim()) {
      continue;
    }

    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[String(key).trim()] = value;
    }
  }
  return out;
};

const REQUIRED_FRONTMATTER_KEYS = ['schema', 'source', 'guild_id', 'title', 'category', 'updated_at'];

const parseFrontmatterKeys = (markdown: string): Set<string> => {
  const match = String(markdown || '').match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return new Set();
  }

  const keys = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(':'))
    .map((line) => line.split(':', 1)[0]?.trim())
    .filter(Boolean) as string[];

  return new Set(keys);
};

const parseBooleanEnv = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
};

const runPostWriteVerification = async (params: {
  vaultPath: string;
  filePath: string;
  fileName: string;
}): Promise<{ verification: string[]; failed: boolean }> => {
  const verification: string[] = [];
  let failed = false;

  const markdown = await readObsidianFileWithAdapter({
    vaultPath: params.vaultPath,
    filePath: params.filePath,
  });

  if (!markdown) {
    verification.push('post_verify:read_failed');
    return { verification, failed: true };
  }

  verification.push('post_verify:read_ok');

  const fmKeys = parseFrontmatterKeys(markdown);
  const missingKeys = REQUIRED_FRONTMATTER_KEYS.filter((key) => !fmKeys.has(key));
  if (missingKeys.length > 0) {
    verification.push(`post_verify:missing_props=${missingKeys.join(',')}`);
    failed = true;
  } else {
    verification.push('post_verify:props_ok');
  }

  const searchResults = await searchObsidianVaultWithAdapter({
    vaultPath: params.vaultPath,
    query: stripMarkdownExtension(params.fileName),
    limit: 20,
  });

  const searchHit = searchResults.some((item) => String(item.filePath || '').trim() === params.filePath);
  if (!searchHit) {
    verification.push('post_verify:search_miss');
    failed = true;
  } else {
    verification.push('post_verify:search_hit');
  }

  const graph = await getObsidianGraphMetadataWithAdapter({ vaultPath: params.vaultPath });
  if (!graph[params.filePath]) {
    verification.push('post_verify:graph_missing');
    failed = true;
  } else {
    verification.push('post_verify:graph_ok');
  }

  return { verification, failed };
};

export const obsidianGuildDocUpsertAction: ActionDefinition = {
  name: 'obsidian.guild_doc.upsert',
  description: '길드 문서를 Obsidian vault에 기록하거나 갱신합니다.',
  execute: async ({ guildId, goal, args }) => {
    if (!guildId) {
      return {
        ok: false,
        name: 'obsidian.guild_doc.upsert',
        summary: 'guildId가 없어 Obsidian 문서를 작성할 수 없습니다.',
        artifacts: [],
        verification: ['guild context missing'],
        error: 'GUILD_ID_REQUIRED',
      };
    }

    const vaultPath = getObsidianVaultRoot();
    if (!vaultPath) {
      return {
        ok: false,
        name: 'obsidian.guild_doc.upsert',
        summary: 'Obsidian vault 경로가 설정되지 않았습니다.',
        artifacts: [],
        verification: ['vault path missing'],
        error: 'OBSIDIAN_VAULT_PATH_MISSING',
      };
    }

    const fileName = toFileName(goal, args);
    const rawContent = toContent(goal, args);
    const content = enforceMarkdownBodyTemplate(rawContent, fileName);
    if (!content) {
      return {
        ok: false,
        name: 'obsidian.guild_doc.upsert',
        summary: '작성할 문서 내용이 비어 있습니다.',
        artifacts: [],
        verification: ['content empty'],
        error: 'CONTENT_EMPTY',
      };
    }

    const manualTags = toTags(args);
    const aiTaxonomy = await inferAiTaxonomy(goal, content, fileName);
    const autoTags = inferAutoTags(goal, content, fileName);
    const tags = mergeTags(manualTags, [...autoTags, ...aiTaxonomy.tags]);
    const properties = enforceFrontmatterProperties({
      guildId,
      fileName,
      goal,
      content,
      aiCategory: aiTaxonomy.category,
      manual: toProperties(args),
    });

    const result = await upsertObsidianGuildDocument({
      guildId,
      vaultPath,
      fileName,
      content,
      tags,
      properties,
    });

    if (!result.ok || !result.path) {
      return {
        ok: false,
        name: 'obsidian.guild_doc.upsert',
        summary: `Obsidian 문서 저장 실패 (${result.reason || 'WRITE_FAILED'})`,
        artifacts: [],
        verification: ['adapter write failed'],
        error: result.reason || 'WRITE_FAILED',
      };
    }

    const postVerify = await runPostWriteVerification({
      vaultPath,
      filePath: result.path,
      fileName,
    });

    const strictPostVerify = parseBooleanEnv(process.env.OBSIDIAN_POST_WRITE_VERIFY_STRICT, false);
    if (strictPostVerify && postVerify.failed) {
      return {
        ok: false,
        name: 'obsidian.guild_doc.upsert',
        summary: 'Obsidian 문서 저장 후 정합성 검증 실패',
        artifacts: [result.path],
        verification: ['adapter write_note', ...postVerify.verification],
        error: 'POST_WRITE_VERIFY_FAILED',
      };
    }

    return {
      ok: true,
      name: 'obsidian.guild_doc.upsert',
      summary: 'Obsidian 문서 저장 완료',
      artifacts: [result.path],
      verification: [
        'adapter write_note',
        ...postVerify.verification,
        `auto_tags=${tags.join(',')}`,
        `category=${String(properties.category || 'general')}`,
      ],
    };
  },
};
