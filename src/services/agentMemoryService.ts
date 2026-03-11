import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import logger from '../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const OBSIDIAN_VAULT_PATH = String(process.env.OBSIDIAN_VAULT_PATH || '').trim();
const OBSIDIAN_CLI_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_CLI_ENABLED, true);
const OBSIDIAN_CLI_COMMAND = String(process.env.OBSIDIAN_CLI_COMMAND || '').trim();
const OBSIDIAN_CLI_ARGS_JSON = String(process.env.OBSIDIAN_CLI_ARGS_JSON || '').trim();
const OBSIDIAN_CLI_TIMEOUT_MS = Math.max(500, parseIntegerEnv(process.env.OBSIDIAN_CLI_TIMEOUT_MS, 4_000));
const OBSIDIAN_CLI_MAX_HINTS = Math.max(1, Math.min(20, parseIntegerEnv(process.env.OBSIDIAN_CLI_MAX_HINTS, 8)));

const execFileAsync = promisify(execFile);

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const safeGoalTerms = (goal: string): string[] =>
  goal
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 6);

const buildObsidianCliArgs = (params: { guildId: string; goal: string; vaultPath: string }) => {
  if (!OBSIDIAN_CLI_ARGS_JSON) {
    return [
      '--guild-id',
      params.guildId,
      '--goal',
      params.goal,
      '--vault-path',
      params.vaultPath,
    ];
  }

  try {
    const parsed = JSON.parse(OBSIDIAN_CLI_ARGS_JSON);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => String(value || ''))
      .filter((value) => value.length > 0)
      .map((value) => value
        .replaceAll('{guildId}', params.guildId)
        .replaceAll('{goal}', params.goal)
        .replaceAll('{vaultPath}', params.vaultPath));
  } catch (error) {
    logger.warn('[AGENT-MEMORY] OBSIDIAN_CLI_ARGS_JSON parse failed: %s', error instanceof Error ? error.message : String(error));
    return [];
  }
};

const readObsidianLoreByCli = async (params: { guildId: string; goal: string }): Promise<string[]> => {
  if (!OBSIDIAN_CLI_ENABLED || !OBSIDIAN_CLI_COMMAND || !OBSIDIAN_VAULT_PATH) {
    return [];
  }

  try {
    const args = buildObsidianCliArgs({
      guildId: params.guildId,
      goal: params.goal,
      vaultPath: OBSIDIAN_VAULT_PATH,
    });

    const { stdout } = await execFileAsync(OBSIDIAN_CLI_COMMAND, args, {
      timeout: OBSIDIAN_CLI_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });

    return String(stdout || '')
      .split(/\r?\n/)
      .map((line) => toSingleLine(line))
      .filter(Boolean)
      .slice(0, OBSIDIAN_CLI_MAX_HINTS)
      .map((line) => `[obsidian-cli] ${line}`);
  } catch (error) {
    logger.warn('[AGENT-MEMORY] obsidian cli execution failed: %s', error instanceof Error ? error.message : String(error));
    return [];
  }
};

const readObsidianLore = async (params: { guildId: string; goal: string }): Promise<string[]> => {
  const cliHints = await readObsidianLoreByCli(params);
  if (cliHints.length > 0) {
    return cliHints;
  }

  if (!OBSIDIAN_VAULT_PATH) {
    return [];
  }

  const candidateFiles = [
    path.join(OBSIDIAN_VAULT_PATH, 'guilds', params.guildId, 'Guild_Lore.md'),
    path.join(OBSIDIAN_VAULT_PATH, 'guilds', params.guildId, 'Server_History.md'),
    path.join(OBSIDIAN_VAULT_PATH, 'guilds', params.guildId, 'Decision_Log.md'),
  ];

  const hints: string[] = [];
  for (const filePath of candidateFiles) {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .slice(0, 6)
        .map((line) => toSingleLine(line));
      if (lines.length > 0) {
        const basename = path.basename(filePath);
        hints.push(`[${basename}] ${lines.join(' | ')}`);
      }
    } catch {
      // Ignore missing files.
    }
  }

  return hints;
};

const readSupabaseLore = async (guildId: string): Promise<string[]> => {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('guild_lore_docs')
      .select('title, summary, content, updated_at')
      .eq('guild_id', guildId)
      .order('updated_at', { ascending: false })
      .limit(5);

    if (error) {
      return [];
    }

    return (data || []).map((row: any) => {
      const title = toSingleLine(row?.title || 'lore');
      const summary = toSingleLine(row?.summary || row?.content || '').slice(0, 220);
      return summary ? `${title}: ${summary}` : title;
    }).filter(Boolean);
  } catch {
    return [];
  }
};

const readSupabaseMemoryItems = async (guildId: string, goal: string): Promise<string[]> => {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const terms = safeGoalTerms(goal);

    let query = client
      .from('memory_items')
      .select('id, type, title, content, summary, confidence, pinned, updated_at')
      .eq('guild_id', guildId)
      .eq('status', 'active')
      .order('pinned', { ascending: false })
      .order('priority', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(12);

    if (terms.length > 0) {
      const orFilter = terms
        .map((term) => `content.ilike.%${term}%,summary.ilike.%${term}%,title.ilike.%${term}%`)
        .join(',');
      query = query.or(orFilter);
    }

    const { data: items, error } = await query;
    if (error || !items || items.length === 0) {
      return [];
    }

    const ids = items.map((item: any) => String(item.id || '')).filter(Boolean);
    const sourceCountById = new Map<string, number>();

    if (ids.length > 0) {
      const { data: sourceRows } = await client
        .from('memory_sources')
        .select('memory_item_id')
        .in('memory_item_id', ids)
        .limit(120);

      for (const row of (sourceRows || []) as Array<any>) {
        const id = String(row?.memory_item_id || '');
        if (!id) continue;
        sourceCountById.set(id, (sourceCountById.get(id) || 0) + 1);
      }
    }

    return items.map((row: any) => {
      const id = String(row?.id || '');
      const type = toSingleLine(row?.type || 'memory');
      const title = toSingleLine(row?.title || row?.summary || '').slice(0, 80);
      const body = toSingleLine(row?.summary || row?.content || '').slice(0, 220);
      const conf = Number(row?.confidence ?? 0.5);
      const confidence = Number.isFinite(conf) ? conf.toFixed(2) : '0.50';
      const pinnedMark = row?.pinned ? ' pinned' : '';
      const sourceCount = sourceCountById.get(id) || 0;
      return `[memory:${id}${pinnedMark}] (${type}, conf=${confidence}, src=${sourceCount}) ${title ? `${title}: ` : ''}${body}`;
    });
  } catch {
    return [];
  }
};

export const buildAgentMemoryHints = async (params: {
  guildId: string;
  goal: string;
  maxItems?: number;
}): Promise<string[]> => {
  const maxItems = Math.max(1, Math.min(20, Math.trunc(params.maxItems ?? 10)));
  const [memoryHints, supabaseLoreHints, obsidianHints] = await Promise.all([
    readSupabaseMemoryItems(params.guildId, params.goal),
    readSupabaseLore(params.guildId),
    readObsidianLore({ guildId: params.guildId, goal: params.goal }),
  ]);

  const goalHint = `현재 목표: ${toSingleLine(params.goal).slice(0, 180)}`;
  const merged = [goalHint, ...memoryHints, ...supabaseLoreHints, ...obsidianHints].filter(Boolean);
  return merged.slice(0, maxItems);
};
