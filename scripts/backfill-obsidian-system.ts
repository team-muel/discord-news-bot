/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertObsidianSystemDocument } from '../src/services/obsidian/authoring';
import { getObsidianAdapterRuntimeStatus, readObsidianFileWithAdapter } from '../src/services/obsidian/router';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultCatalogPath = path.resolve(repoRoot, 'config/runtime/knowledge-backfill-catalog.json');

type CatalogEntry = {
  id: string;
  title: string;
  sourcePath: string;
  targetPath: string;
  sourceMode?: 'full-source' | 'compatibility-stub';
  sectionHeading?: string;
  tags?: string[];
  plane?: string;
  concern?: string;
  intent?: string;
  queries?: string[];
  audience?: 'operator-primary' | 'shared' | 'agent-support';
  canonical?: boolean;
  startHere?: boolean;
  agentReference?: boolean;
};

type CatalogPolicy = {
  humanFirst?: boolean;
  rules?: string[];
  avoidAsPrimary?: string[];
};

type CatalogDocument = {
  schemaVersion: number;
  updatedAt: string;
  description: string;
  policy?: CatalogPolicy;
  entries: CatalogEntry[];
};

type CliOptions = {
  vaultPath: string;
  catalogPath: string;
  dryRun: boolean;
  reportOnly: boolean;
  jsonOutput: boolean;
  allowOverwrite: boolean;
  entryIds: Set<string>;
};

type CatalogReport = {
  vaultPath: string;
  existenceMode: string;
  selectedReadAdapter: string | null;
  selectedWriteAdapter: string | null;
  totalEntries: number;
  existingEntries: number;
  missingEntries: number;
  operatorPrimaryEntries: number;
  operatorPrimaryMissing: number;
  startHereEntries: number;
  startHereMissing: number;
  agentReferenceEntries: number;
  humanFirst: boolean;
  policyRules: string[];
  avoidAsPrimary: string[];
  startHerePaths: string[];
  agentReferencePaths: string[];
  missingTargetPaths: string[];
  operatorPrimaryMissingPaths: string[];
};

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const stripMarkdownExtension = (value: string): string => value.replace(/\.md$/i, '');

const isCompatibilityStubEntry = (entry: CatalogEntry): boolean => entry.sourceMode === 'compatibility-stub';

const normalizeVaultRelativePath = (targetPath: string): string => {
  return `${stripMarkdownExtension(targetPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')}.md`;
};

const resolveVaultTargetPath = (vaultPath: string, targetPath: string): string => {
  const normalized = stripMarkdownExtension(normalizeVaultRelativePath(targetPath));
  const segments = normalized
    .split('/')
    .map((segment) => compact(segment))
    .filter(Boolean);

  return path.join(path.resolve(vaultPath), ...segments) + '.md';
};

const targetExistsInVault = async (vaultPath: string, targetPath: string): Promise<boolean> => {
  if (fs.existsSync(resolveVaultTargetPath(vaultPath, targetPath))) {
    return true;
  }

  const content = await readObsidianFileWithAdapter({
    vaultPath,
    filePath: normalizeVaultRelativePath(targetPath),
  });
  return content !== null;
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  let vaultPath = String(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();
  let catalogPath = String(process.env.OBSIDIAN_SYSTEM_BACKFILL_CATALOG || defaultCatalogPath).trim();
  let dryRun = false;
  let reportOnly = false;
  let jsonOutput = false;
  let allowOverwrite = false;
  const entryIds = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const current = compact(args[index]);
    if (current === '--vault' || current === '--vault-path') {
      vaultPath = compact(args[index + 1]);
      index += 1;
      continue;
    }
    if (current === '--catalog') {
      catalogPath = compact(args[index + 1]);
      index += 1;
      continue;
    }
    if (current === '--entry' || current === '--entries') {
      const raw = compact(args[index + 1]);
      for (const token of raw.split(',').map((item) => compact(item)).filter(Boolean)) {
        entryIds.add(token);
      }
      index += 1;
      continue;
    }
    if (current === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (current === '--report') {
      reportOnly = true;
      continue;
    }
    if (current === '--json') {
      jsonOutput = true;
      continue;
    }
    if (current === '--overwrite' || current === '--allow-overwrite') {
      allowOverwrite = true;
    }
  }

  return {
    vaultPath,
    catalogPath,
    dryRun,
    reportOnly,
    jsonOutput,
    allowOverwrite,
    entryIds,
  };
};

const loadCatalog = (catalogPath: string): CatalogDocument => {
  const raw = fs.readFileSync(path.resolve(catalogPath), 'utf8');
  return JSON.parse(raw) as CatalogDocument;
};

const extractMarkdownSection = (content: string, sectionHeading: string): string => {
  const escapedHeading = sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`(^${escapedHeading}\\s*$[\\s\\S]*?)(?=^##\\s+|^#\\s+|\\Z)`, 'm'));
  return match?.[1]?.trim() || content.trim();
};

const renderEntryContent = (entry: CatalogEntry, rawSource: string): string => {
  const sourceExtension = path.extname(entry.sourcePath).toLowerCase();
  const body = entry.sectionHeading && sourceExtension === '.md'
    ? extractMarkdownSection(rawSource, entry.sectionHeading)
    : rawSource.trim();

  const lines = [
    `> Repository backfill source: ${entry.sourcePath}${entry.sectionHeading ? ` (${entry.sectionHeading})` : ''}`,
    `> Imported at: ${new Date().toISOString()}`,
    '',
  ];

  if (sourceExtension === '.json') {
    lines.push('```json', body, '```');
    return lines.join('\n');
  }

  lines.push(body);
  return lines.join('\n');
};

const buildCatalogReport = async (options: CliOptions, catalog: CatalogDocument, entries: CatalogEntry[]): Promise<CatalogReport> => {
  const missingTargetPaths: string[] = [];
  const operatorPrimaryMissingPaths: string[] = [];
  let existingEntries = 0;
  let operatorPrimaryEntries = 0;
  let operatorPrimaryMissing = 0;
  let startHereEntries = 0;
  let startHereMissing = 0;
  let agentReferenceEntries = 0;
  const adapterStatus = getObsidianAdapterRuntimeStatus();
  const selectedReadAdapter = adapterStatus.selectedByCapability.read_file ?? null;
  const selectedWriteAdapter = adapterStatus.selectedByCapability.write_note ?? null;

  for (const entry of entries) {
    const exists = await targetExistsInVault(options.vaultPath, entry.targetPath);
    if (exists) {
      existingEntries += 1;
    } else {
      missingTargetPaths.push(entry.targetPath);
    }

    if (entry.audience === 'operator-primary') {
      operatorPrimaryEntries += 1;
      if (!exists) {
        operatorPrimaryMissing += 1;
        operatorPrimaryMissingPaths.push(entry.targetPath);
      }
    }

    if (entry.startHere) {
      startHereEntries += 1;
      if (!exists) {
        startHereMissing += 1;
      }
    }

    if (entry.agentReference !== false) {
      agentReferenceEntries += 1;
    }
  }

  return {
    vaultPath: options.vaultPath,
    existenceMode: 'filesystem-or-adapter-read',
    selectedReadAdapter,
    selectedWriteAdapter,
    totalEntries: entries.length,
    existingEntries,
    missingEntries: entries.length - existingEntries,
    operatorPrimaryEntries,
    operatorPrimaryMissing,
    startHereEntries,
    startHereMissing,
    agentReferenceEntries,
    humanFirst: Boolean(catalog.policy?.humanFirst),
    policyRules: Array.isArray(catalog.policy?.rules) ? catalog.policy?.rules || [] : [],
    avoidAsPrimary: Array.isArray(catalog.policy?.avoidAsPrimary) ? catalog.policy?.avoidAsPrimary || [] : [],
    startHerePaths: entries.filter((entry) => entry.startHere).map((entry) => entry.targetPath),
    agentReferencePaths: entries.filter((entry) => entry.agentReference !== false).map((entry) => entry.targetPath),
    missingTargetPaths,
    operatorPrimaryMissingPaths,
  };
};

const printCatalogReport = (report: CatalogReport, jsonOutput: boolean): void => {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`[obsidian-system-backfill] report vault=${report.vaultPath}`);
  console.log(
    `[obsidian-system-backfill] verification mode=${report.existenceMode} readAdapter=${report.selectedReadAdapter || 'none'} writeAdapter=${report.selectedWriteAdapter || 'none'}`,
  );
  console.log(
    `[obsidian-system-backfill] coverage total=${report.totalEntries} existing=${report.existingEntries} missing=${report.missingEntries} operatorPrimary=${report.operatorPrimaryEntries} operatorPrimaryMissing=${report.operatorPrimaryMissing} startHere=${report.startHereEntries} startHereMissing=${report.startHereMissing} agentReference=${report.agentReferenceEntries}`,
  );

  if (report.policyRules.length > 0) {
    console.log('[obsidian-system-backfill] human-first rules:');
    for (const rule of report.policyRules) {
      console.log(`- ${rule}`);
    }
  }

  if (report.startHerePaths.length > 0) {
    console.log('[obsidian-system-backfill] start-here paths:');
    for (const value of report.startHerePaths) {
      console.log(`- ${value}`);
    }
  }

  if (report.avoidAsPrimary.length > 0) {
    console.log('[obsidian-system-backfill] avoid-as-primary:');
    for (const value of report.avoidAsPrimary) {
      console.log(`- ${value}`);
    }
  }

  if (report.missingTargetPaths.length > 0) {
    console.log('[obsidian-system-backfill] missing targets:');
    for (const value of report.missingTargetPaths) {
      console.log(`- ${value}`);
    }
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  if (!options.vaultPath) {
    throw new Error('vault path is required. Use --vault or set OBSIDIAN_SYNC_VAULT_PATH/OBSIDIAN_VAULT_PATH');
  }

  const catalog = loadCatalog(options.catalogPath);
  const entries = catalog.entries.filter((entry) => options.entryIds.size === 0 || options.entryIds.has(entry.id));
  if (entries.length === 0) {
    console.log('[obsidian-system-backfill] no matching entries');
    return;
  }

  const report = await buildCatalogReport(options, catalog, entries);

  if (options.reportOnly) {
    printCatalogReport(report, options.jsonOutput);
    return;
  }

  if (options.dryRun) {
    console.log(`[obsidian-system-backfill] dry-run entries=${entries.length} vault=${options.vaultPath}`);
    for (const entry of entries) {
      const exists = await targetExistsInVault(options.vaultPath, entry.targetPath);
      const mode = isCompatibilityStubEntry(entry)
        ? 'skip-compatibility-stub'
        : exists
          ? (options.allowOverwrite ? 'overwrite' : 'skip-existing')
          : 'create';
      console.log(`- ${entry.id}: ${entry.sourcePath} -> ${entry.targetPath} [${mode}]`);
    }
    printCatalogReport(report, options.jsonOutput);
    return;
  }

  let successCount = 0;
  let skippedExisting = 0;
  let skippedCompatibilityStubs = 0;
  for (const entry of entries) {
    if (isCompatibilityStubEntry(entry)) {
      skippedCompatibilityStubs += 1;
      console.log(`[obsidian-system-backfill] skip id=${entry.id} target=${entry.targetPath} reason=compatibility_stub_source`);
      continue;
    }

    const exists = await targetExistsInVault(options.vaultPath, entry.targetPath);
    if (exists && !options.allowOverwrite) {
      skippedExisting += 1;
      console.log(`[obsidian-system-backfill] skip id=${entry.id} target=${entry.targetPath} reason=exists`);
      continue;
    }

    const sourcePath = path.resolve(repoRoot, entry.sourcePath);
    const rawSource = fs.readFileSync(sourcePath, 'utf8');
    const content = renderEntryContent(entry, rawSource);
    const result = await upsertObsidianSystemDocument({
      vaultPath: options.vaultPath,
      fileName: stripMarkdownExtension(entry.targetPath),
      content,
      tags: entry.tags || [],
      allowHighLinkDensity: true,
      properties: {
        title: entry.title,
        source_repo_path: entry.sourcePath,
        source_kind: 'repo-backfill',
        backfill_id: entry.id,
        plane: entry.plane || '',
        concern: entry.concern || '',
      },
    });

    if (!result.ok) {
      throw new Error(`backfill failed for ${entry.id}: ${result.reason || 'WRITE_FAILED'}`);
    }

    successCount += 1;
    console.log(`[obsidian-system-backfill] ok id=${entry.id} target=${entry.targetPath}`);
  }

  console.log(`[obsidian-system-backfill] completed entries=${successCount} skippedExisting=${skippedExisting} skippedCompatibilityStubs=${skippedCompatibilityStubs} vault=${options.vaultPath}`);
  printCatalogReport(await buildCatalogReport(options, catalog, entries), options.jsonOutput);
};

main().catch((error) => {
  console.error('[obsidian-system-backfill] fatal:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});