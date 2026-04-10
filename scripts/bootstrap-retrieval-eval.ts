/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultCatalogPath = path.resolve(repoRoot, 'config/runtime/knowledge-backfill-catalog.json');

type LoreRow = {
  id: number;
  title: string;
  summary: string | null;
  source: string | null;
};

type ExistingCaseRow = {
  id: number;
  query: string;
};

type BackfillCatalogEntry = {
  id: string;
  title: string;
  targetPath: string;
  plane?: string;
  concern?: string;
  intent?: string;
  tags?: string[];
  queries?: string[];
};

const GUILD_RELATIVE_ROOTS = [
  'events/',
  'memory/',
  'policy/',
  'customer/',
  'retros/',
  'sprint-journal/',
  'playbooks/',
  'experiments/',
  'ops/',
  'index/',
  'chat/',
];

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const parseArgs = () => {
  const args = process.argv.slice(2);
  let guildId = String(process.env.RETRIEVAL_BOOTSTRAP_GUILD_ID || '').trim();
  let setName = String(process.env.RETRIEVAL_BOOTSTRAP_SET_NAME || 'default-lore-bootstrap').trim();
  let createdBy = String(process.env.RETRIEVAL_BOOTSTRAP_CREATED_BY || 'script-bootstrap').trim();
  let sourceMode = String(process.env.RETRIEVAL_BOOTSTRAP_SOURCE || 'all').trim().toLowerCase();
  let catalogPath = String(process.env.RETRIEVAL_BOOTSTRAP_CATALOG || defaultCatalogPath).trim();
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const key = String(args[i] || '').trim();
    if (key === '--guild' || key === '--guild-id') {
      guildId = compact(args[i + 1]);
      i += 1;
      continue;
    }
    if (key === '--set') {
      setName = compact(args[i + 1]);
      i += 1;
      continue;
    }
    if (key === '--created-by') {
      createdBy = compact(args[i + 1]);
      i += 1;
      continue;
    }
    if (key === '--source') {
      sourceMode = compact(args[i + 1]).toLowerCase();
      i += 1;
      continue;
    }
    if (key === '--catalog') {
      catalogPath = compact(args[i + 1]);
      i += 1;
      continue;
    }
    if (key === '--dry-run') {
      dryRun = true;
    }
  }

  return { guildId, setName, createdBy, sourceMode, catalogPath, dryRun };
};

const parseRelativePathFromSource = (source: string | null, guildId: string): string => {
  const normalized = compact(source);
  if (!normalized) return '';

  const colonIndex = normalized.indexOf(':');
  const afterColon = colonIndex >= 0 ? normalized.slice(colonIndex + 1) : normalized;
  const clean = afterColon.replace(/^\/+/, '').replace(/\\/g, '/');

  const cleanLower = clean.toLowerCase();
  const guildPrefix = `guilds/${guildId}/`.toLowerCase();
  if (cleanLower.startsWith(guildPrefix)) {
    return clean.slice(guildPrefix.length);
  }

  const directPrefix = `${guildId}/`.toLowerCase();
  if (cleanLower.startsWith(directPrefix)) {
    return clean.slice(directPrefix.length);
  }

  const embeddedGuildMarker = `/guilds/${guildId}/`.toLowerCase();
  const embeddedGuildIndex = cleanLower.indexOf(embeddedGuildMarker);
  if (embeddedGuildIndex >= 0) {
    return clean.slice(embeddedGuildIndex + embeddedGuildMarker.length);
  }

  for (const root of GUILD_RELATIVE_ROOTS) {
    const rootIndex = cleanLower.indexOf(root);
    if (rootIndex >= 0) {
      return clean.slice(rootIndex);
    }
  }

  const segments = clean.split('/').map((segment) => compact(segment)).filter(Boolean);
  return segments.at(-1) || '';
};

const buildTargetPath = (guildId: string, source: string | null): string => {
  const relative = parseRelativePathFromSource(source, guildId);
  return `guilds/${guildId}/${relative || 'Guild_Lore.md'}`;
};

const buildQueries = (row: LoreRow): string[] => {
  const title = compact(row.title);
  const summary = compact(row.summary);
  const summaryHead = summary.split(/[.!?]\s*/).map((v) => compact(v)).find(Boolean) || summary;

  const candidates = [
    title,
    `${title} 요약`,
    `${title} 규칙`,
    `${title} 핵심`,
    `${title} 배경`,
    `${title} 근거`,
    `${title} 출처`,
    `${title} 정책`,
    `${title} 체크리스트`,
    `${title} 운영`,
    `${title} reference`,
    `${title} policy`,
    `${title} incident`,
    `${title} history`,
    summaryHead,
  ].map((v) => compact(v)).filter(Boolean);

  return [...new Set(candidates)].slice(0, 12);
};

const loadBackfillCatalogEntries = (catalogPath: string): BackfillCatalogEntry[] => {
  try {
    const raw = fs.readFileSync(path.resolve(catalogPath), 'utf8');
    const parsed = JSON.parse(raw) as { entries?: BackfillCatalogEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
};

const buildCatalogQueries = (entry: BackfillCatalogEntry): string[] => {
  const title = compact(entry.title);
  const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => compact(tag)) : [];
  const candidates = [
    ...(Array.isArray(entry.queries) ? entry.queries : []),
    title,
    `${title} 문서`,
    `${title} 운영`,
    `${title} 기준`,
    ...tags.map((tag) => `${title} ${tag}`),
  ].map((value) => compact(value)).filter(Boolean);

  return [...new Set(candidates)].slice(0, 12);
};

const upsertCaseTarget = async (params: {
  client: any;
  guildId: string;
  evalSetId: number;
  query: string;
  intent: string;
  targetPath: string;
  existingByQuery: Map<string, number>;
}) => {
  const { guildId, evalSetId, query, intent, targetPath, existingByQuery } = params;
  const client = params.client;
  const normalizedQuery = compact(query);
  if (!normalizedQuery) {
    return { inserted: 0, updated: 0, targetsUpserted: 0 };
  }

  let caseId = existingByQuery.get(normalizedQuery) || 0;
  let inserted = 0;
  let updated = 0;

  if (caseId) {
    const { error: updateError } = await client
      .from('retrieval_eval_cases')
      .update({
        intent: intent || 'memory',
        difficulty: 'normal',
        enabled: true,
      })
      .eq('id', caseId);

    if (updateError) {
      throw new Error(updateError.message || 'EVAL_CASE_UPDATE_FAILED');
    }
    updated += 1;
  } else {
    const { data: insertedCase, error: insertCaseError } = await client
      .from('retrieval_eval_cases')
      .insert({
        eval_set_id: evalSetId,
        guild_id: guildId,
        query: normalizedQuery,
        intent: intent || 'memory',
        difficulty: 'normal',
        enabled: true,
      })
      .select('id')
      .single();

    if (insertCaseError) {
      throw new Error(insertCaseError.message || 'EVAL_CASE_INSERT_FAILED');
    }

    caseId = Number(insertedCase.id || 0);
    existingByQuery.set(normalizedQuery, caseId);
    inserted += 1;
  }

  const { error: deleteTargetError } = await client
    .from('retrieval_eval_targets')
    .delete()
    .eq('case_id', caseId)
    .eq('target_file_path', targetPath);

  if (deleteTargetError) {
    throw new Error(deleteTargetError.message || 'EVAL_TARGET_DELETE_FAILED');
  }

  const { error: targetInsertError } = await client
    .from('retrieval_eval_targets')
    .insert({
      case_id: caseId,
      target_file_path: targetPath,
      gain: 1.0,
    });

  if (targetInsertError) {
    throw new Error(targetInsertError.message || 'EVAL_TARGET_INSERT_FAILED');
  }

  return { inserted, updated, targetsUpserted: 1 };
};

const main = async () => {
  const { guildId, setName, createdBy, sourceMode, catalogPath, dryRun } = parseArgs();
  if (!guildId) {
    console.error('[retrieval-bootstrap] Missing guild id. use --guild <id>');
    process.exit(2);
  }

  const includeLore = sourceMode === 'all' || sourceMode === 'lore';
  const includeCatalog = sourceMode === 'all' || sourceMode === 'catalog';
  const needsSupabase = includeLore || !dryRun;

  const supabaseUrl = compact(process.env.SUPABASE_URL);
  const supabaseKey = compact(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
  if (needsSupabase && (!supabaseUrl || !supabaseKey)) {
    console.error('[retrieval-bootstrap] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY');
    process.exit(2);
  }

  const client = needsSupabase
    ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    : null;

  let loreRows: LoreRow[] = [];
  if (includeLore) {
    const { data: loreRowsRaw, error: loreError } = await client!
      .from('guild_lore_docs')
      .select('id, title, summary, source')
      .eq('guild_id', guildId)
      .order('updated_at', { ascending: false })
      .limit(200);

    if (loreError) {
      throw new Error(loreError.message || 'LORE_READ_FAILED');
    }

    loreRows = (loreRowsRaw || []) as LoreRow[];
  }

  const catalogEntries = includeCatalog ? loadBackfillCatalogEntries(catalogPath) : [];
  if (loreRows.length === 0 && catalogEntries.length === 0) {
    console.log('[retrieval-bootstrap] No lore rows or catalog entries found. nothing to seed.');
    return;
  }

  const allQueries = loreRows.flatMap((row) => buildQueries(row));
  const uniqueQueries = [...new Set(allQueries)].slice(0, 60);
  const catalogQueries = [...new Set(catalogEntries.flatMap((entry) => buildCatalogQueries(entry)))].slice(0, 120);

  if (dryRun) {
    console.log(`[retrieval-bootstrap] dry-run guild=${guildId} set=${setName} source=${sourceMode} loreRows=${loreRows.length} catalogEntries=${catalogEntries.length} generatedQueries=${uniqueQueries.length + catalogQueries.length}`);
    for (const row of loreRows.slice(0, 10)) {
      const targetPath = buildTargetPath(guildId, row.source);
      const sampleQueries = buildQueries(row).slice(0, 3).join(' | ');
      console.log(`- target=${targetPath} queries=${sampleQueries}`);
    }
    for (const entry of catalogEntries.slice(0, 10)) {
      const sampleQueries = buildCatalogQueries(entry).slice(0, 3).join(' | ');
      console.log(`- catalog=${entry.id} target=${entry.targetPath} queries=${sampleQueries}`);
    }
    return;
  }

  const { data: setRows, error: setReadError } = await client!
    .from('retrieval_eval_sets')
    .select('id, name')
    .eq('guild_id', guildId)
    .eq('name', setName)
    .limit(1);

  if (setReadError) {
    throw new Error(setReadError.message || 'EVAL_SET_READ_FAILED');
  }

  let evalSetId = Number(setRows?.[0]?.id || 0);
  if (!evalSetId) {
    const { data: insertedSet, error: setInsertError } = await client!
      .from('retrieval_eval_sets')
      .insert({
        guild_id: guildId,
        name: setName,
        description: 'auto bootstrap from lore/catalog knowledge targets',
        created_by: createdBy,
      })
      .select('id')
      .single();

    if (setInsertError) {
      throw new Error(setInsertError.message || 'EVAL_SET_INSERT_FAILED');
    }
    evalSetId = Number(insertedSet.id || 0);
  }

  if (!evalSetId) {
    throw new Error('EVAL_SET_ID_MISSING');
  }

  const { data: existingRaw, error: existingError } = await client!
    .from('retrieval_eval_cases')
    .select('id, query')
    .eq('guild_id', guildId)
    .eq('eval_set_id', evalSetId)
    .limit(1000);

  if (existingError) {
    throw new Error(existingError.message || 'EVAL_CASE_READ_FAILED');
  }

  const existingRows = (existingRaw || []) as ExistingCaseRow[];
  const existingByQuery = new Map(existingRows.map((row) => [compact(row.query), Number(row.id)]));

  let inserted = 0;
  let updated = 0;
  let targetsUpserted = 0;

  for (const lore of loreRows) {
    const targetPath = buildTargetPath(guildId, lore.source);
    for (const query of buildQueries(lore)) {
      const counts = await upsertCaseTarget({
        client,
        guildId,
        evalSetId,
        query,
        intent: 'memory',
        targetPath,
        existingByQuery,
      });
      inserted += counts.inserted;
      updated += counts.updated;
      targetsUpserted += counts.targetsUpserted;
    }
  }

  for (const entry of catalogEntries) {
    for (const query of buildCatalogQueries(entry)) {
      const counts = await upsertCaseTarget({
        client,
        guildId,
        evalSetId,
        query,
        intent: compact(entry.intent) || 'operations',
        targetPath: compact(entry.targetPath),
        existingByQuery,
      });
      inserted += counts.inserted;
      updated += counts.updated;
      targetsUpserted += counts.targetsUpserted;
    }
  }

  console.log(
    `[retrieval-bootstrap] done guild=${guildId} setId=${evalSetId} set=${setName} source=${sourceMode} loreRows=${loreRows.length} catalogEntries=${catalogEntries.length} caseInserted=${inserted} caseUpdated=${updated} targetsUpserted=${targetsUpserted} generatedQueries=${uniqueQueries.length + catalogQueries.length}`,
  );
};

main().catch((error) => {
  console.error('[retrieval-bootstrap] fatal:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
