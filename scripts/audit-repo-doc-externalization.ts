/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runObsidianSemanticLintAudit } from '../src/services/obsidian/knowledgeCompilerService';
import { getObsidianAdapterRuntimeStatus, readObsidianFileWithAdapter } from '../src/services/obsidian/router';
import { probeRemoteMcpAdapter } from '../src/services/obsidian/adapters/remoteMcpAdapter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultManifestPath = path.resolve(repoRoot, 'config/runtime/repo-doc-externalization-manifest.json');
const defaultCatalogPath = path.resolve(repoRoot, 'config/runtime/knowledge-backfill-catalog.json');

type Classification = 'keep' | 'externalize' | 'archive' | 'delete-candidate';

type ManifestMatch = {
  paths?: string[];
  prefixes?: string[];
  excludePaths?: string[];
  excludePrefixes?: string[];
  catalogSource?: boolean;
};

type ManifestFamily = {
  id: string;
  classification: Classification;
  description: string;
  match: ManifestMatch;
  notes?: string[];
};

type ManifestDefaults = {
  backfillRequiredFor?: Classification[];
  deleteReadyRequiresCatalogCoverage?: boolean;
  deleteReadyRequiresBackfilledTarget?: boolean;
  deleteReadyRequiresZeroHighSeverityLint?: boolean;
  deleteReadyRequiresNoHardLocalPathRefs?: boolean;
  deleteReadyRequiresNoSoftLocalPathRefs?: boolean;
};

type ManifestDocument = {
  schemaVersion: number;
  updatedAt: string;
  description: string;
  defaults?: ManifestDefaults;
  families: ManifestFamily[];
};

type CatalogEntry = {
  id: string;
  sourcePath: string;
  targetPath: string;
};

type CatalogDocument = {
  entries: CatalogEntry[];
};

type CliOptions = {
  manifestPath: string;
  catalogPath: string;
  vaultPath: string;
  jsonOutput: boolean;
};

type PathReferenceSummary = {
  hardRefs: string[];
  softRefs: string[];
};

type FileAudit = {
  path: string;
  classification: Classification | 'unclassified';
  familyId: string | null;
  catalogEntryIds: string[];
  targetPaths: string[];
  backfillRequired: boolean;
  sharedTargetsPresent: boolean | null;
  hardLocalPathRefCount: number;
  softLocalPathRefCount: number;
  externalizationReady: boolean;
  stubReady: boolean;
  deleteReady: boolean;
  blockers: string[];
};

type FamilyAudit = {
  id: string;
  classification: Classification;
  matchedFiles: number;
  backfillRequiredFiles: number;
  catalogCoveredFiles: number;
  sharedPresentFiles: number;
  externalizationReadyFiles: number;
  stubReadyFiles: number;
  deleteReadyFiles: number;
  samplePaths: string[];
};

type AuditReport = {
  manifest: {
    path: string;
    schemaVersion: number;
    updatedAt: string;
  };
  catalog: {
    path: string;
    entries: number;
  };
  vault: {
    path: string | null;
    selectedReadAdapter: string | null;
    selectedWriteAdapter: string | null;
    accessPosture: ReturnType<typeof getObsidianAdapterRuntimeStatus>['accessPosture'];
  };
  summary: {
    totalMarkdownFiles: number;
    classifiedFiles: number;
    unclassifiedFiles: number;
    keepFiles: number;
    externalizeFiles: number;
    archiveFiles: number;
    deleteCandidateFiles: number;
    backfillRequiredFiles: number;
    catalogCoveredFiles: number;
    sharedPresentFiles: number;
    externalizationReadyFiles: number;
    stubReadyFiles: number;
    deleteReadyFiles: number;
    highSeveritySemanticLintIssues: number;
    deleteReadyBlockingSemanticLintIssues: number;
  };
  semanticLint: {
    healthy: boolean;
    issueCount: number;
    highSeverityIssues: Array<{ kind: string; message: string; evidenceRefs: string[] }>;
    deleteReadyBlockingIssues: Array<{ kind: string; message: string; evidenceRefs: string[] }>;
  };
  families: FamilyAudit[];
  unclassifiedPaths: string[];
  missingCatalogPaths: string[];
  stubReadyPaths: string[];
  deleteReadyPaths: string[];
  fileAudits: FileAudit[];
};

const EXCLUDED_DIRS = new Set(['.git', '.venv', 'coverage', 'dist', 'node_modules', 'tmp']);
const TEXT_FILE_EXTENSIONS = new Set(['.cjs', '.js', '.json', '.md', '.mjs', '.ps1', '.sh', '.sql', '.ts', '.txt', '.yaml', '.yml']);

const normalizePath = (value: string): string => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();

const compact = (value: unknown): string => String(value || '').trim();

const stripMarkdownExtension = (value: string): string => value.replace(/\.md$/i, '');

const normalizeVaultRelativePath = (targetPath: string): string => {
  return `${stripMarkdownExtension(normalizePath(targetPath)).replace(/^\/+/, '')}.md`;
};

const resolveVaultTargetPath = (vaultPath: string, targetPath: string): string => {
  const normalized = stripMarkdownExtension(normalizeVaultRelativePath(targetPath));
  const segments = normalized.split('/').map((segment) => compact(segment)).filter(Boolean);
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
  let manifestPath = String(process.env.REPO_DOC_EXTERNALIZATION_MANIFEST || defaultManifestPath).trim();
  let catalogPath = String(process.env.OBSIDIAN_SYSTEM_BACKFILL_CATALOG || defaultCatalogPath).trim();
  let vaultPath = String(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();
  let jsonOutput = false;

  for (let index = 0; index < args.length; index += 1) {
    const current = compact(args[index]);
    if (current === '--manifest') {
      manifestPath = compact(args[index + 1]);
      index += 1;
      continue;
    }
    if (current === '--catalog') {
      catalogPath = compact(args[index + 1]);
      index += 1;
      continue;
    }
    if (current === '--vault' || current === '--vault-path') {
      vaultPath = compact(args[index + 1]);
      index += 1;
      continue;
    }
    if (current === '--json') {
      jsonOutput = true;
    }
  }

  return {
    manifestPath,
    catalogPath,
    vaultPath,
    jsonOutput,
  };
};

const loadJson = <T>(filePath: string): T => {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')) as T;
};

const listRepoFiles = (root: string, predicate: (relativePath: string) => boolean): string[] => {
  const results: string[] = [];
  const walk = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizePath(path.relative(root, absolutePath));
      if (!relativePath) {
        continue;
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        walk(absolutePath);
        continue;
      }
      if (predicate(relativePath)) {
        results.push(relativePath);
      }
    }
  };

  walk(root);
  return results;
};

const isMarkdownFile = (relativePath: string): boolean => relativePath.toLowerCase().endsWith('.md');

const isTextFile = (relativePath: string): boolean => {
  const ext = path.extname(relativePath).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(ext)) {
    return true;
  }
  return relativePath.endsWith('.instructions.md');
};

const matchesFamily = (relativePath: string, family: ManifestFamily, catalogSourcePaths: Set<string>): boolean => {
  const normalizedPath = normalizePath(relativePath);
  const match = family.match || {};
  const paths = new Set((match.paths || []).map((value) => normalizePath(value)));
  const excludePaths = new Set((match.excludePaths || []).map((value) => normalizePath(value)));
  const prefixes = (match.prefixes || []).map((value) => normalizePath(value));
  const excludePrefixes = (match.excludePrefixes || []).map((value) => normalizePath(value));

  if (excludePaths.has(normalizedPath)) {
    return false;
  }
  if (excludePrefixes.some((prefix) => normalizedPath.startsWith(prefix))) {
    return false;
  }

  if (paths.has(normalizedPath)) {
    return true;
  }
  if (match.catalogSource && catalogSourcePaths.has(normalizedPath)) {
    return true;
  }
  if (prefixes.some((prefix) => normalizedPath.startsWith(prefix))) {
    return true;
  }
  return false;
};

const buildPathReferenceSummary = (
  relativePath: string,
  textFiles: string[],
  contentByPath: Map<string, string>,
): PathReferenceSummary => {
  const normalizedPath = normalizePath(relativePath);
  const hardRefs: string[] = [];
  const softRefs: string[] = [];

  for (const textFile of textFiles) {
    if (textFile === normalizedPath) {
      continue;
    }
    if (textFile === 'config/runtime/knowledge-backfill-catalog.json' || textFile === 'config/runtime/repo-doc-externalization-manifest.json') {
      continue;
    }
    const content = contentByPath.get(textFile);
    if (!content || !content.includes(normalizedPath)) {
      continue;
    }
    if (textFile.toLowerCase().endsWith('.md')) {
      softRefs.push(textFile);
    } else {
      hardRefs.push(textFile);
    }
  }

  return {
    hardRefs,
    softRefs,
  };
};

const printReport = (report: AuditReport): void => {
  console.log(
    `[repo-doc-externalization] markdown total=${report.summary.totalMarkdownFiles} classified=${report.summary.classifiedFiles} unclassified=${report.summary.unclassifiedFiles}`,
  );
  console.log(
    `[repo-doc-externalization] classes keep=${report.summary.keepFiles} externalize=${report.summary.externalizeFiles} archive=${report.summary.archiveFiles} deleteCandidate=${report.summary.deleteCandidateFiles}`,
  );
  console.log(
    `[repo-doc-externalization] backfillRequired=${report.summary.backfillRequiredFiles} catalogCovered=${report.summary.catalogCoveredFiles} sharedPresent=${report.summary.sharedPresentFiles}`,
  );
  console.log(
    `[repo-doc-externalization] readiness externalizationReady=${report.summary.externalizationReadyFiles} stubReady=${report.summary.stubReadyFiles} deleteReady=${report.summary.deleteReadyFiles}`,
  );
  console.log(
    `[repo-doc-externalization] obsidian read=${report.vault.selectedReadAdapter || 'none'} write=${report.vault.selectedWriteAdapter || 'none'} posture=${report.vault.accessPosture.mode}`,
  );
  console.log(
    `[repo-doc-externalization] semanticLint healthy=${report.semanticLint.healthy} issues=${report.semanticLint.issueCount} highSeverity=${report.summary.highSeveritySemanticLintIssues} deleteReadyBlocking=${report.summary.deleteReadyBlockingSemanticLintIssues}`,
  );

  if (report.missingCatalogPaths.length > 0) {
    console.log('[repo-doc-externalization] missing catalog coverage:');
    for (const value of report.missingCatalogPaths.slice(0, 20)) {
      console.log(`- ${value}`);
    }
  }

  if (report.unclassifiedPaths.length > 0) {
    console.log('[repo-doc-externalization] unclassified markdown paths:');
    for (const value of report.unclassifiedPaths.slice(0, 20)) {
      console.log(`- ${value}`);
    }
  }

  if (report.stubReadyPaths.length > 0) {
    console.log('[repo-doc-externalization] stub-ready paths:');
    for (const value of report.stubReadyPaths.slice(0, 20)) {
      console.log(`- ${value}`);
    }
  }

  if (report.deleteReadyPaths.length > 0) {
    console.log('[repo-doc-externalization] delete-ready paths:');
    for (const value of report.deleteReadyPaths.slice(0, 20)) {
      console.log(`- ${value}`);
    }
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  const manifest = loadJson<ManifestDocument>(options.manifestPath);
  const catalog = loadJson<CatalogDocument>(options.catalogPath);
  const initialAdapterStatus = getObsidianAdapterRuntimeStatus();
  if (initialAdapterStatus.remoteMcp.enabled && initialAdapterStatus.remoteMcp.configured) {
    await probeRemoteMcpAdapter().catch(() => null);
  }
  const adapterStatus = getObsidianAdapterRuntimeStatus();
  const semanticLint = await runObsidianSemanticLintAudit({ persistFindings: false });
  const highSeverityIssues = semanticLint.issues.filter((issue) => issue.severity === 'high');
  const deleteReadyBlockingIssues = highSeverityIssues.filter((issue) => issue.kind === 'coverage-gap');

  const markdownFiles = listRepoFiles(repoRoot, isMarkdownFile);
  const textFiles = listRepoFiles(repoRoot, isTextFile);
  const contentByPath = new Map<string, string>();
  for (const filePath of textFiles) {
    try {
      contentByPath.set(filePath, fs.readFileSync(path.join(repoRoot, filePath), 'utf8'));
    } catch {
      // Ignore unreadable files in the lightweight audit.
    }
  }

  const catalogBySourcePath = new Map<string, CatalogEntry[]>();
  for (const entry of catalog.entries || []) {
    const normalizedSource = normalizePath(entry.sourcePath);
    const group = catalogBySourcePath.get(normalizedSource) || [];
    group.push(entry);
    catalogBySourcePath.set(normalizedSource, group);
  }
  const catalogSourcePaths = new Set(catalogBySourcePath.keys());
  const backfillRequiredFor = new Set(manifest.defaults?.backfillRequiredFor || ['externalize', 'delete-candidate']);

  const fileAudits: FileAudit[] = [];
  for (const filePath of markdownFiles) {
    const family = manifest.families.find((entry) => matchesFamily(filePath, entry, catalogSourcePaths)) || null;
    const classification = family?.classification || 'unclassified';
    const catalogEntries = catalogBySourcePath.get(filePath) || [];
    const targetPaths = catalogEntries.map((entry) => normalizePath(entry.targetPath));
    const backfillRequired = classification !== 'unclassified' && backfillRequiredFor.has(classification as Classification);
    const referenceSummary = buildPathReferenceSummary(filePath, textFiles, contentByPath);
    const sharedTargetsPresent = targetPaths.length === 0 || !options.vaultPath
      ? (targetPaths.length === 0 ? null : null)
      : (await Promise.all(targetPaths.map((targetPath) => targetExistsInVault(options.vaultPath, targetPath)))).every(Boolean);

    const blockers: string[] = [];
    if (backfillRequired && manifest.defaults?.deleteReadyRequiresCatalogCoverage !== false && catalogEntries.length === 0) {
      blockers.push('missing_catalog_entry');
    }
    if (backfillRequired && manifest.defaults?.deleteReadyRequiresBackfilledTarget !== false && targetPaths.length > 0 && sharedTargetsPresent === false) {
      blockers.push('missing_shared_target');
    }
    if (manifest.defaults?.deleteReadyRequiresZeroHighSeverityLint !== false && deleteReadyBlockingIssues.length > 0) {
      blockers.push('high_severity_coverage_gap');
    }
    if (manifest.defaults?.deleteReadyRequiresNoHardLocalPathRefs !== false && referenceSummary.hardRefs.length > 0) {
      blockers.push('hard_local_path_refs');
    }
    if (manifest.defaults?.deleteReadyRequiresNoSoftLocalPathRefs !== false && referenceSummary.softRefs.length > 0) {
      blockers.push('soft_local_path_refs');
    }

    const externalizationReady = !backfillRequired
      ? true
      : catalogEntries.length > 0 && (sharedTargetsPresent !== false);
    const stubReady = classification === 'externalize' && externalizationReady
      && deleteReadyBlockingIssues.length === 0
      && referenceSummary.hardRefs.length === 0;
    const deleteReady = classification === 'delete-candidate'
      && externalizationReady
      && deleteReadyBlockingIssues.length === 0
      && referenceSummary.hardRefs.length === 0
      && referenceSummary.softRefs.length === 0;

    fileAudits.push({
      path: filePath,
      classification,
      familyId: family?.id || null,
      catalogEntryIds: catalogEntries.map((entry) => entry.id),
      targetPaths,
      backfillRequired,
      sharedTargetsPresent,
      hardLocalPathRefCount: referenceSummary.hardRefs.length,
      softLocalPathRefCount: referenceSummary.softRefs.length,
      externalizationReady,
      stubReady,
      deleteReady,
      blockers,
    });
  }

  const families: FamilyAudit[] = manifest.families.map((family) => {
    const matched = fileAudits.filter((entry) => entry.familyId === family.id);
    return {
      id: family.id,
      classification: family.classification,
      matchedFiles: matched.length,
      backfillRequiredFiles: matched.filter((entry) => entry.backfillRequired).length,
      catalogCoveredFiles: matched.filter((entry) => entry.catalogEntryIds.length > 0).length,
      sharedPresentFiles: matched.filter((entry) => entry.sharedTargetsPresent === true).length,
      externalizationReadyFiles: matched.filter((entry) => entry.externalizationReady).length,
      stubReadyFiles: matched.filter((entry) => entry.stubReady).length,
      deleteReadyFiles: matched.filter((entry) => entry.deleteReady).length,
      samplePaths: matched.slice(0, 5).map((entry) => entry.path),
    };
  });

  const report: AuditReport = {
    manifest: {
      path: normalizePath(path.relative(repoRoot, path.resolve(options.manifestPath))),
      schemaVersion: manifest.schemaVersion,
      updatedAt: manifest.updatedAt,
    },
    catalog: {
      path: normalizePath(path.relative(repoRoot, path.resolve(options.catalogPath))),
      entries: catalog.entries.length,
    },
    vault: {
      path: options.vaultPath || null,
      selectedReadAdapter: adapterStatus.selectedByCapability.read_file ?? null,
      selectedWriteAdapter: adapterStatus.selectedByCapability.write_note ?? null,
      accessPosture: adapterStatus.accessPosture,
    },
    summary: {
      totalMarkdownFiles: fileAudits.length,
      classifiedFiles: fileAudits.filter((entry) => entry.classification !== 'unclassified').length,
      unclassifiedFiles: fileAudits.filter((entry) => entry.classification === 'unclassified').length,
      keepFiles: fileAudits.filter((entry) => entry.classification === 'keep').length,
      externalizeFiles: fileAudits.filter((entry) => entry.classification === 'externalize').length,
      archiveFiles: fileAudits.filter((entry) => entry.classification === 'archive').length,
      deleteCandidateFiles: fileAudits.filter((entry) => entry.classification === 'delete-candidate').length,
      backfillRequiredFiles: fileAudits.filter((entry) => entry.backfillRequired).length,
      catalogCoveredFiles: fileAudits.filter((entry) => entry.catalogEntryIds.length > 0).length,
      sharedPresentFiles: fileAudits.filter((entry) => entry.sharedTargetsPresent === true).length,
      externalizationReadyFiles: fileAudits.filter((entry) => entry.externalizationReady).length,
      stubReadyFiles: fileAudits.filter((entry) => entry.stubReady).length,
      deleteReadyFiles: fileAudits.filter((entry) => entry.deleteReady).length,
      highSeveritySemanticLintIssues: highSeverityIssues.length,
      deleteReadyBlockingSemanticLintIssues: deleteReadyBlockingIssues.length,
    },
    semanticLint: {
      healthy: semanticLint.healthy,
      issueCount: semanticLint.issueCount,
      highSeverityIssues: highSeverityIssues.map((issue) => ({
        kind: issue.kind,
        message: issue.message,
        evidenceRefs: issue.evidenceRefs,
      })),
      deleteReadyBlockingIssues: deleteReadyBlockingIssues.map((issue) => ({
        kind: issue.kind,
        message: issue.message,
        evidenceRefs: issue.evidenceRefs,
      })),
    },
    families,
    unclassifiedPaths: fileAudits.filter((entry) => entry.classification === 'unclassified').map((entry) => entry.path),
    missingCatalogPaths: fileAudits
      .filter((entry) => entry.backfillRequired && entry.catalogEntryIds.length === 0)
      .map((entry) => entry.path),
    stubReadyPaths: fileAudits.filter((entry) => entry.stubReady).map((entry) => entry.path),
    deleteReadyPaths: fileAudits.filter((entry) => entry.deleteReady).map((entry) => entry.path),
    fileAudits,
  };

  if (options.jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printReport(report);
};

main().catch((error) => {
  console.error('[repo-doc-externalization] fatal:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});