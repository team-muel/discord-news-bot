/* eslint-disable no-console */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type SyncTarget = {
  folderName: string;
  guildId: string;
};

type LoreDoc = {
  folderName: string;
  guildId: string;
  source: string;
  relativePath: string;
  title: string;
  summary: string;
  content: string;
};

type GuildKnowledgeManifest = {
  version?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  maxFiles?: number;
  sourcePrefix?: string;
};

type SyncStats = {
  dryRun: boolean;
  scannedTargets: number;
  skippedTargets: number;
  docsFound: number;
  touchedRows: number;
  insertedRows: number;
  updatedRows: number;
  duplicateRowsDeleted: number;
  graphLinksUpserted: number;
};

const DEFAULT_INCLUDE_GLOBS = String(process.env.OBSIDIAN_SYNC_DEFAULT_INCLUDE_GLOBS || '**/*.md')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const DEFAULT_EXCLUDE_GLOBS = String(process.env.OBSIDIAN_SYNC_DEFAULT_EXCLUDE_GLOBS || '.obsidian/**,.trash/**,templates/**,ops/state/**,index/**')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const DEFAULT_SOURCE_PREFIX = 'knowledge';
const CONTENT_MAX_LEN = 12000;
const SUMMARY_MAX_LEN = 220;
const DEFAULT_MAX_FILES_PER_GUILD = (() => {
  const parsed = Number(process.env.OBSIDIAN_SYNC_DEFAULT_MAX_FILES || 600);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 600;
  }
  return Math.floor(parsed);
})();

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const truncate = (value: string, maxLen: number): string => {
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLen - 1)).trimEnd()}...`;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const guildIds: string[] = [];
  let vaultPath = String(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();
  let guildMapJson = String(process.env.OBSIDIAN_SYNC_GUILD_MAP_JSON || '').trim();
  let guildMapFile = String(process.env.OBSIDIAN_SYNC_GUILD_MAP_FILE || '').trim();
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();
    if (current === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (current === '--vault' || current === '--vault-path') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        vaultPath = value;
      }
      i += 1;
      continue;
    }
    if (current === '--guild' || current === '--guild-id') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        guildIds.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
      }
      i += 1;
      continue;
    }
    if (current === '--guild-map-json') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        guildMapJson = value;
      }
      i += 1;
      continue;
    }
    if (current === '--guild-map-file') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        guildMapFile = value;
      }
      i += 1;
    }
  }

  return {
    guildIds: Array.from(new Set(guildIds)),
    vaultPath,
    guildMapJson,
    guildMapFile,
    dryRun,
  };
};

const parseGuildMapRecord = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()] as const)
    .filter(([folder, guildId]) => folder.length > 0 && guildId.length > 0);

  return Object.fromEntries(entries);
};

const loadGuildMap = async (guildMapJson: string, guildMapFile: string): Promise<Record<string, string>> => {
  if (guildMapJson) {
    try {
      return parseGuildMapRecord(JSON.parse(guildMapJson));
    } catch (error) {
      throw new Error(`[obsidian-sync] OBSIDIAN_SYNC_GUILD_MAP_JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (guildMapFile) {
    try {
      const raw = await fs.readFile(guildMapFile, 'utf-8');
      return parseGuildMapRecord(JSON.parse(raw));
    } catch (error) {
      throw new Error(`[obsidian-sync] OBSIDIAN_SYNC_GUILD_MAP_FILE parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {};
};

const resolveTargets = async (
  vaultPath: string,
  requestedGuildIds: string[],
  guildMap: Record<string, string>,
): Promise<SyncTarget[]> => {
  if (requestedGuildIds.length > 0) {
    return requestedGuildIds.map((input) => {
      if (input.includes(':')) {
        const [folderNameRaw, guildIdRaw] = input.split(':', 2);
        const folderName = String(folderNameRaw || '').trim();
        const guildId = String(guildIdRaw || '').trim();
        if (!folderName || !guildId) {
          throw new Error(`[obsidian-sync] Invalid --guild mapping value: ${input}`);
        }
        return { folderName, guildId };
      }

      const guildId = input;
      return { folderName: guildId, guildId };
    });
  }

  const guildRoot = path.join(vaultPath, 'guilds');
  const entries = await fs.readdir(guildRoot, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.trim())
    .filter(Boolean)
    .map((folderName) => ({
      folderName,
      guildId: guildMap[folderName] || folderName,
    }));
};

const extractTitle = (filename: string, raw: string): string => {
  const heading = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '));

  if (heading) {
    return truncate(toSingleLine(heading.replace(/^#\s+/, '')), 80);
  }

  return filename.replace(/\.md$/i, '');
};

const extractSummary = (raw: string): string => {
  const body = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(0, 6)
    .join(' ');

  return truncate(toSingleLine(body), SUMMARY_MAX_LEN);
};

const toPosix = (value: string): string => value.split(path.sep).join('/').replace(/^\/+/, '');

const globToRegExp = (glob: string): RegExp => {
  let normalized = toPosix(String(glob || '').trim());
  if (!normalized) {
    normalized = '**/*';
  }

  let pattern = '';
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === '*' && next === '*') {
      // consume optional trailing slash so '**/' matches root-level files too
      if (normalized[i + 2] === '/') {
        pattern += '(?:.*/)?';
        i += 3;
      } else {
        pattern += '.*';
        i += 2;
      }
      continue;
    }

    if (char === '*') {
      pattern += '[^/]*';
      i += 1;
      continue;
    }

    if (char === '?') {
      pattern += '[^/]';
      i += 1;
      continue;
    }

    const escaped = char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    pattern += escaped;
    i += 1;
  }

  return new RegExp(`^${pattern}$`, 'i');
};

const normalizeManifest = (input: GuildKnowledgeManifest | null): Required<GuildKnowledgeManifest> => {
  const includeGlobs = (input?.includeGlobs || DEFAULT_INCLUDE_GLOBS)
    .map((item) => toPosix(String(item || '').trim()))
    .filter(Boolean);

  const excludeGlobs = (input?.excludeGlobs || DEFAULT_EXCLUDE_GLOBS)
    .map((item) => toPosix(String(item || '').trim()))
    .filter(Boolean);

  const maxFilesRaw = Number(input?.maxFiles ?? DEFAULT_MAX_FILES_PER_GUILD);
  const maxFiles = Number.isFinite(maxFilesRaw) && maxFilesRaw > 0
    ? Math.floor(maxFilesRaw)
    : DEFAULT_MAX_FILES_PER_GUILD;

  const sourcePrefix = String(input?.sourcePrefix || DEFAULT_SOURCE_PREFIX).trim() || DEFAULT_SOURCE_PREFIX;

  return {
    version: Number(input?.version || 1),
    includeGlobs,
    excludeGlobs,
    maxFiles,
    sourcePrefix,
  };
};

const readGuildManifest = async (guildPath: string): Promise<Required<GuildKnowledgeManifest>> => {
  const candidates = [
    path.join(guildPath, 'index', 'manifest.json'),
    path.join(guildPath, 'manifest.json'),
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as GuildKnowledgeManifest;
      return normalizeManifest(parsed);
    } catch {
      // Continue probing next candidate.
    }
  }

  return normalizeManifest(null);
};

const listMarkdownFilesRecursive = async (rootPath: string): Promise<string[]> => {
  const output: string[] = [];

  const walk = async (current: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (entry.isFile() && /\.md$/i.test(entry.name)) {
        output.push(absolute);
      }
    }
  };

  await walk(rootPath);
  return output;
};

const collectLoreDocs = async (vaultPath: string, target: SyncTarget): Promise<LoreDoc[]> => {
  const guildPath = path.join(vaultPath, 'guilds', target.folderName);
  const docs: LoreDoc[] = [];

  const manifest = await readGuildManifest(guildPath);
  const includePatterns = manifest.includeGlobs.map((glob) => globToRegExp(glob));
  const excludePatterns = manifest.excludeGlobs.map((glob) => globToRegExp(glob));

  const files = await listMarkdownFilesRecursive(guildPath);
  const selected = files
    .map((absolute) => ({ absolute, relative: toPosix(path.relative(guildPath, absolute)) }))
    .filter(({ relative }) => includePatterns.some((pattern) => pattern.test(relative)))
    .filter(({ relative }) => !excludePatterns.some((pattern) => pattern.test(relative)))
    .slice(0, manifest.maxFiles);

  for (const file of selected) {
    let raw = '';
    try {
      raw = await fs.readFile(file.absolute, 'utf-8');
    } catch {
      continue;
    }

    const content = truncate(raw.trim(), CONTENT_MAX_LEN);
    if (!content) {
      continue;
    }

    const source = `obsidian-sync:${manifest.sourcePrefix}/${file.relative}`;
    docs.push({
      folderName: target.folderName,
      guildId: target.guildId,
      source,
      relativePath: file.relative,
      title: extractTitle(file.relative, raw),
      summary: extractSummary(raw),
      content,
    });
  }

  return docs;
};

const notifyDiscordWebhook = async (stats: SyncStats): Promise<void> => {
  const webhookUrl = String(process.env.OBSIDIAN_SYNC_DISCORD_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return;
  }

  try {
    new URL(webhookUrl);
  } catch {
    console.warn('[obsidian-sync] webhook notify error: OBSIDIAN_SYNC_DISCORD_WEBHOOK_URL is not a valid URL');
    return;
  }

  const content = [
    '[obsidian-sync] 완료',
    `dryRun=${stats.dryRun}`,
    `targets=${stats.scannedTargets}`,
    `docs=${stats.docsFound}`,
    `touched=${stats.touchedRows}`,
    `inserted=${stats.insertedRows}`,
    `updated=${stats.updatedRows}`,
    `dedupDeleted=${stats.duplicateRowsDeleted}`,
    `graphLinks=${stats.graphLinksUpserted}`,
    `skipped=${stats.skippedTargets}`,
  ].join(' | ');

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      console.warn(`[obsidian-sync] webhook notify failed status=${response.status}`);
    }
  } catch (error) {
    console.warn('[obsidian-sync] webhook notify error:', error instanceof Error ? error.message : String(error));
  }
};

const lorMemoryItemId = (guildId: string, source: string): string => {
  const hash = createHash('sha1').update(`${guildId}:${source}`).digest('hex').slice(0, 20);
  return `lore_${hash}`;
};

const upsertLoreMemoryItem = async (
  supabase: SupabaseClient<any>,
  doc: LoreDoc,
): Promise<void> => {
  const id = lorMemoryItemId(doc.guildId, doc.source);
  const row = {
    id,
    guild_id: doc.guildId,
    type: 'semantic',
    scope: 'guild',
    title: doc.title,
    content: doc.content,
    summary: doc.summary,
    tags: [] as string[],
    status: 'active',
    confidence: 0.700,
    priority: 60,
    pinned: false,
    source_count: 1,
    conflict_key: `lore:${doc.source}`,
    created_by: 'sync-obsidian-lore',
    updated_by: 'sync-obsidian-lore',
  };
  const { error } = await supabase
    .from('memory_items')
    .upsert(row, { onConflict: 'id' });
  if (error) {
    throw new Error(
      `[obsidian-sync] memory_items upsert failed guild=${doc.guildId} source=${doc.source}: ${error.message}`,
    );
  }
};

/** Extract wikilinks ([[page]] or [[page|alias]]) from Obsidian markdown content. */
const extractWikiLinks = (content: string): string[] => {
  const matches = content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
  const links = new Set<string>();
  for (const match of matches) {
    const target = match[1].trim();
    if (target && !target.startsWith('http')) {
      links.add(target);
    }
  }
  return [...links];
};

/**
 * Extract typed relations from structured link sections.
 * Parses lines like: `- spawned-by: [[plan/2026-01-01_plan_xyz]]`
 */
const extractTypedRelations = (content: string): Array<{ target: string; relationType: string }> => {
  const VALID_TYPES = new Set([
    'spawned-by', 'follows', 'references', 'related', 'supersedes', 'caused', 'fixed-in',
  ]);
  const results: Array<{ target: string; relationType: string }> = [];
  const regex = /^-\s+([\w-]+):\s+\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const relType = match[1].trim().toLowerCase();
    const target = match[2].trim();
    if (VALID_TYPES.has(relType) && target && !target.startsWith('http')) {
      results.push({ target, relationType: relType });
    }
  }
  return results;
};

const RELATION_STRENGTH: Record<string, number> = {
  'spawned-by': 0.9,
  'follows':    0.85,
  'references': 0.7,
  'related':    0.6,
  'supersedes': 0.95,
  'caused':     0.9,
  'fixed-in':   0.85,
  'derived-from': 0.9,
};

/**
 * Upsert graph relationships between lore docs based on Obsidian wikilinks.
 * Links are inserted as 'related' type into memory_item_links.
 * Both source and target must exist as memory_items (via lore ID convention).
 */
const upsertGraphLinks = async (
  supabase: SupabaseClient<any>,
  doc: LoreDoc,
  allDocs: LoreDoc[],
): Promise<number> => {
  const wikiLinks = extractWikiLinks(doc.content);
  if (wikiLinks.length === 0) return 0;

  const sourceId = lorMemoryItemId(doc.guildId, doc.source);
  const typedRelations = extractTypedRelations(doc.content);
  let upserted = 0;

  // Build a lookup of relative path (without .md) → LoreDoc for same guild
  const targetLookup = new Map<string, LoreDoc>();
  for (const d of allDocs) {
    if (d.guildId !== doc.guildId) continue;
    const key = d.relativePath.replace(/\.md$/i, '').toLowerCase();
    targetLookup.set(key, d);
    // Also index by filename only for short wikilinks
    const filename = key.split('/').pop() || '';
    if (filename && !targetLookup.has(filename)) {
      targetLookup.set(filename, d);
    }
  }

  for (const link of wikiLinks) {
    const normalized = link.toLowerCase().replace(/\.md$/i, '');
    const targetDoc = targetLookup.get(normalized);
    if (!targetDoc) continue;

    const targetId = lorMemoryItemId(targetDoc.guildId, targetDoc.source);
    if (sourceId === targetId) continue;

    // Check if this link has a typed relation from the ## Links section
    const typedMatch = typedRelations.find(
      (tr) => tr.target.toLowerCase().replace(/\.md$/i, '') === normalized,
    );
    const relationType = typedMatch?.relationType || 'related';
    const strength = RELATION_STRENGTH[relationType] ?? 0.6;

    const { error } = await supabase
      .from('memory_item_links')
      .upsert(
        {
          source_id: sourceId,
          target_id: targetId,
          guild_id: doc.guildId,
          relation_type: relationType,
          strength,
          created_by: 'sync-obsidian-lore',
        },
        { onConflict: 'source_id,target_id,relation_type' },
      );

    if (error) {
      // Non-fatal: target memory_item might not exist yet due to ordering
      console.warn(`[obsidian-sync] graph link skip: ${doc.relativePath} → ${link}: ${error.message}`);
      continue;
    }
    upserted += 1;
  }

  return upserted;
};

const main = async () => {
  const {
    guildIds: requestedGuildIds,
    vaultPath,
    guildMapJson,
    guildMapFile,
    dryRun,
  } = parseArgs();

  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();

  if (!vaultPath) {
    console.error('[obsidian-sync] Missing vault path. Set OBSIDIAN_SYNC_VAULT_PATH (or OBSIDIAN_VAULT_PATH), or pass --vault.');
    process.exit(2);
  }
  if (!supabaseUrl || !supabaseKey) {
    console.error('[obsidian-sync] Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY).');
    process.exit(2);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const guildMap = await loadGuildMap(guildMapJson, guildMapFile);
  const targets = await resolveTargets(vaultPath, requestedGuildIds, guildMap);

  if (targets.length === 0) {
    console.log('[obsidian-sync] No guild folders found. Nothing to sync.');
    return;
  }

  console.log(`[obsidian-sync] Start targetCount=${targets.length} dryRun=${dryRun}`);

  const allSyncedDocs: LoreDoc[] = [];

  const stats: SyncStats = {
    dryRun,
    scannedTargets: targets.length,
    skippedTargets: 0,
    docsFound: 0,
    touchedRows: 0,
    insertedRows: 0,
    updatedRows: 0,
    duplicateRowsDeleted: 0,
    graphLinksUpserted: 0,
  };

  for (const target of targets) {
    const docs = await collectLoreDocs(vaultPath, target);
    if (docs.length === 0) {
      stats.skippedTargets += 1;
      console.log(`[obsidian-sync] folder=${target.folderName} guild=${target.guildId} no matched markdown found`);
      continue;
    }

    stats.docsFound += docs.length;
    allSyncedDocs.push(...docs);

    for (const doc of docs) {
      const { data: existingRows, error: selectError } = await supabase
        .from('guild_lore_docs')
        .select('id')
        .eq('guild_id', doc.guildId)
        .eq('source', doc.source)
        .order('updated_at', { ascending: false });

      if (selectError) {
        throw new Error(`[obsidian-sync] select failed guild=${doc.guildId} source=${doc.source}: ${selectError.message}`);
      }

      const primaryId = existingRows?.[0]?.id;

      if (dryRun) {
        const mode = primaryId ? 'update' : 'insert';
        console.log(`[obsidian-sync] dry-run folder=${doc.folderName} guild=${doc.guildId} path=${doc.relativePath} source=${doc.source} mode=${mode}`);
        stats.touchedRows += 1;
        if (mode === 'insert') {
          stats.insertedRows += 1;
        } else {
          stats.updatedRows += 1;
        }
        continue;
      }

      if (primaryId) {
        const { error: updateError } = await supabase
          .from('guild_lore_docs')
          .update({
            title: doc.title,
            summary: doc.summary,
            content: doc.content,
            source: doc.source,
            updated_at: new Date().toISOString(),
          })
          .eq('id', primaryId);

        if (updateError) {
          throw new Error(`[obsidian-sync] update failed id=${String(primaryId)}: ${updateError.message}`);
        }

        if ((existingRows?.length || 0) > 1) {
          const extraIds = existingRows!.slice(1).map((row) => row.id);
          stats.duplicateRowsDeleted += extraIds.length;
          const { error: cleanupError } = await supabase
            .from('guild_lore_docs')
            .delete()
            .in('id', extraIds);

          if (cleanupError) {
            throw new Error(`[obsidian-sync] duplicate cleanup failed guild=${doc.guildId}: ${cleanupError.message}`);
          }
        }
        stats.updatedRows += 1;
      } else {
        const { error: insertError } = await supabase
          .from('guild_lore_docs')
          .insert({
            guild_id: doc.guildId,
            title: doc.title,
            summary: doc.summary,
            content: doc.content,
            source: doc.source,
          });

        if (insertError) {
          throw new Error(`[obsidian-sync] insert failed guild=${doc.guildId} source=${doc.source}: ${insertError.message}`);
        }

        stats.insertedRows += 1;
      }

      await upsertLoreMemoryItem(supabase, doc);
      stats.touchedRows += 1;
      console.log(`[obsidian-sync] folder=${doc.folderName} guild=${doc.guildId} path=${doc.relativePath} source=${doc.source} synced`);
    }
  }

  console.log(
    `[obsidian-sync] Done touched=${stats.touchedRows} inserted=${stats.insertedRows} updated=${stats.updatedRows} dedupDeleted=${stats.duplicateRowsDeleted} skipped=${stats.skippedTargets}`,
  );

  // Phase 2: Sync graph relationships (wikilinks → memory_item_links)
  if (!dryRun && allSyncedDocs.length > 0) {
    console.log(`[obsidian-sync] Phase 2: syncing graph links for ${allSyncedDocs.length} docs`);
    for (const doc of allSyncedDocs) {
      const linked = await upsertGraphLinks(supabase, doc, allSyncedDocs);
      stats.graphLinksUpserted += linked;
    }
    if (stats.graphLinksUpserted > 0) {
      console.log(`[obsidian-sync] Graph links upserted: ${stats.graphLinksUpserted}`);
    }
  }

  await notifyDiscordWebhook(stats);
};

main().catch((error) => {
  console.error('[obsidian-sync] Fatal:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
