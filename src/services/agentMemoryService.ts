import fs from 'fs/promises';
import path from 'path';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const OBSIDIAN_VAULT_PATH = String(process.env.OBSIDIAN_VAULT_PATH || '').trim();

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const readObsidianLore = async (guildId: string): Promise<string[]> => {
  if (!OBSIDIAN_VAULT_PATH) {
    return [];
  }

  const candidateFiles = [
    path.join(OBSIDIAN_VAULT_PATH, 'guilds', guildId, 'Guild_Lore.md'),
    path.join(OBSIDIAN_VAULT_PATH, 'guilds', guildId, 'Server_History.md'),
    path.join(OBSIDIAN_VAULT_PATH, 'guilds', guildId, 'Decision_Log.md'),
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

export const buildAgentMemoryHints = async (params: {
  guildId: string;
  goal: string;
  maxItems?: number;
}): Promise<string[]> => {
  const maxItems = Math.max(1, Math.min(20, Math.trunc(params.maxItems ?? 10)));
  const [supabaseHints, obsidianHints] = await Promise.all([
    readSupabaseLore(params.guildId),
    readObsidianLore(params.guildId),
  ]);

  const goalHint = `현재 목표: ${toSingleLine(params.goal).slice(0, 180)}`;
  const merged = [goalHint, ...supabaseHints, ...obsidianHints].filter(Boolean);
  return merged.slice(0, maxItems);
};
