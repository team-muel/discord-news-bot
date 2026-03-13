import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import logger from '../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { withObsidianFileLock } from '../utils/obsidianFileLock';
import { assessMemoryPoisonRisk } from './memoryPoisonGuard';
import { logStructuredError } from './structuredErrorLogService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const OBSIDIAN_VAULT_PATH = String(process.env.OBSIDIAN_VAULT_PATH || '').trim();
const OBSIDIAN_CLI_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_CLI_ENABLED, true);
const OBSIDIAN_CLI_COMMAND = String(process.env.OBSIDIAN_CLI_COMMAND || '').trim();
const OBSIDIAN_CLI_ARGS_JSON = String(process.env.OBSIDIAN_CLI_ARGS_JSON || '').trim();
const OBSIDIAN_CLI_TIMEOUT_MS = Math.max(500, parseIntegerEnv(process.env.OBSIDIAN_CLI_TIMEOUT_MS, 4_000));
const OBSIDIAN_CLI_MAX_HINTS = Math.max(1, Math.min(20, parseIntegerEnv(process.env.OBSIDIAN_CLI_MAX_HINTS, 8)));
const OBSIDIAN_INPUT_MAX_LENGTH = Math.max(40, Math.min(1200, parseIntegerEnv(process.env.OBSIDIAN_INPUT_MAX_LENGTH, 320)));
const MEMORY_HINT_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.MEMORY_HINT_MIN_CONFIDENCE || 0.35)));

const execFileAsync = promisify(execFile);

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const sanitizeUntrustedText = (value: unknown, maxLen = OBSIDIAN_INPUT_MAX_LENGTH): string => {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\.\.[/\\]/g, ' ')
    .replace(/[|&;$`<>]/g, ' ')
    .replace(/\$\(|\)\s*;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, Math.max(8, maxLen));
};

const sanitizeGuildId = (value: unknown): string => {
  const candidate = sanitizeUntrustedText(value, 40);
  if (!/^\d{6,30}$/.test(candidate)) {
    return '';
  }
  return candidate;
};

const resolveUnderRoot = (rootPath: string, ...segments: string[]): string | null => {
  if (!rootPath) {
    return null;
  }

  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, ...segments);
  const withSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved === root || resolved.startsWith(withSep)) {
    return resolved;
  }

  return null;
};

const safeGoalTerms = (goal: string): string[] =>
  sanitizeUntrustedText(goal)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 6);

const buildObsidianCliArgs = (params: { guildId: string; goal: string; vaultPath: string }) => {
  const safeGuildId = sanitizeGuildId(params.guildId);
  const safeGoal = sanitizeUntrustedText(params.goal);
  const safeVaultPath = path.resolve(params.vaultPath || '.');
  if (!safeGuildId || !safeGoal) {
    return [];
  }

  if (!OBSIDIAN_CLI_ARGS_JSON) {
    return [
      '--guild-id',
      safeGuildId,
      '--goal',
      safeGoal,
      '--vault-path',
      safeVaultPath,
    ];
  }

  try {
    const parsed = JSON.parse(OBSIDIAN_CLI_ARGS_JSON);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const substituted = parsed
      .map((value) => String(value || ''))
      .filter((value) => value.length > 0)
      .map((value) => value
        .replaceAll('{guildId}', safeGuildId)
        .replaceAll('{goal}', safeGoal)
        .replaceAll('{vaultPath}', safeVaultPath));

    return substituted.map((value) => sanitizeUntrustedText(value, 280));
  } catch (error) {
    logger.warn('[AGENT-MEMORY] OBSIDIAN_CLI_ARGS_JSON parse failed: %s', error instanceof Error ? error.message : String(error));
    void logStructuredError({
      code: 'CLI_IO_ERROR',
      source: 'agentMemoryService.buildObsidianCliArgs',
      message: 'OBSIDIAN_CLI_ARGS_JSON parse failed',
      meta: { hasArgsJson: Boolean(OBSIDIAN_CLI_ARGS_JSON) },
      severity: 'warn',
    }, error);
    return [
      '--guild-id',
      safeGuildId,
      '--goal',
      safeGoal,
      '--vault-path',
      safeVaultPath,
    ];
  }
};

const readObsidianLoreByCli = async (params: { guildId: string; goal: string }): Promise<string[]> => {
  if (!OBSIDIAN_CLI_ENABLED || !OBSIDIAN_CLI_COMMAND || !OBSIDIAN_VAULT_PATH) {
    return [];
  }

  try {
    const safeGuildId = sanitizeGuildId(params.guildId);
    const safeGoal = sanitizeUntrustedText(params.goal);
    if (!safeGuildId || !safeGoal) {
      logger.warn('[AGENT-MEMORY] obsidian cli skipped due to invalid untrusted input');
      return [];
    }

    const safeVaultPath = path.resolve(OBSIDIAN_VAULT_PATH);
    const args = buildObsidianCliArgs({
      guildId: safeGuildId,
      goal: safeGoal,
      vaultPath: safeVaultPath,
    });
    if (args.length === 0) {
      return [];
    }

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
    void logStructuredError({
      code: 'CLI_IO_ERROR',
      source: 'agentMemoryService.readObsidianLoreByCli',
      message: 'Obsidian CLI execution failed',
      guildId: params.guildId,
      meta: { command: OBSIDIAN_CLI_COMMAND },
      severity: 'warn',
    }, error);
    return [];
  }
};

const readObsidianLore = async (params: { guildId: string; goal: string }): Promise<string[]> => {
  const safeGuildId = sanitizeGuildId(params.guildId);
  const safeGoal = sanitizeUntrustedText(params.goal);
  if (!safeGuildId || !safeGoal) {
    logger.warn('[AGENT-MEMORY] obsidian file read skipped due to invalid untrusted input');
    return [];
  }

  return withObsidianFileLock({
    vaultRoot: OBSIDIAN_VAULT_PATH,
    key: `obsidian:guild:${safeGuildId}`,
    task: async () => {
      const cliHints = await readObsidianLoreByCli({ guildId: safeGuildId, goal: safeGoal });
      if (cliHints.length > 0) {
        return cliHints;
      }

      if (!OBSIDIAN_VAULT_PATH) {
        return [];
      }

      const candidateFiles = ['Guild_Lore.md', 'Server_History.md', 'Decision_Log.md']
        .map((name) => resolveUnderRoot(OBSIDIAN_VAULT_PATH, 'guilds', safeGuildId, name))
        .filter((filePath): filePath is string => Boolean(filePath));

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
    },
  });
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
      const poison = assessMemoryPoisonRisk({
        title,
        summary: String(row?.summary || ''),
        content: String(row?.content || ''),
      });

      if (!row?.pinned && (poison.blocked || Number(conf || 0) < MEMORY_HINT_MIN_CONFIDENCE)) {
        return '';
      }

      return `[memory:${id}${pinnedMark}] (${type}, conf=${confidence}, src=${sourceCount}) ${title ? `${title}: ` : ''}${body}`;
    }).filter(Boolean);
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
  const safeGuildId = sanitizeGuildId(params.guildId);
  const safeGoal = sanitizeUntrustedText(params.goal, 480);
  if (!safeGoal) {
    return [];
  }

  if (!safeGuildId) {
    logger.warn('[AGENT-MEMORY] invalid guild id blocked in memory hint pipeline');
    return [`현재 목표: ${toSingleLine(safeGoal).slice(0, 180)}`].slice(0, maxItems);
  }

  const [memoryHints, supabaseLoreHints, obsidianHints] = await Promise.all([
    readSupabaseMemoryItems(safeGuildId, safeGoal),
    readSupabaseLore(safeGuildId),
    readObsidianLore({ guildId: safeGuildId, goal: safeGoal }),
  ]);

  const goalHint = `현재 목표: ${toSingleLine(safeGoal).slice(0, 180)}`;
  const merged = [goalHint, ...memoryHints, ...supabaseLoreHints, ...obsidianHints].filter(Boolean);
  return merged.slice(0, maxItems);
};
