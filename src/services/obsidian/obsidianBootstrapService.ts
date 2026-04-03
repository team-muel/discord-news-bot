import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import logger from '../../logger';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';

export type GuildKnowledgeManifest = {
  version: number;
  includeGlobs: string[];
  excludeGlobs: string[];
  maxFiles: number;
  sourcePrefix: string;
};

export type GuildBootstrapSummary = {
  guildId: string;
  rootPath: string;
  manifestStatus: 'created' | 'updated' | 'skipped';
  createdFiles: number;
  updatedFiles: number;
  skippedFiles: number;
};

const AUTO_BOOTSTRAP_ON_GUILD_JOIN = parseBooleanEnv(process.env.OBSIDIAN_AUTO_BOOTSTRAP_ON_GUILD_JOIN, true);
const AUTO_BOOTSTRAP_FORCE = parseBooleanEnv(process.env.OBSIDIAN_AUTO_BOOTSTRAP_FORCE, false);
const AUTO_BOOTSTRAP_RUN_OPS_CYCLE = parseBooleanEnv(process.env.OBSIDIAN_AUTO_BOOTSTRAP_RUN_OPS_CYCLE, false);
const AUTO_BOOTSTRAP_OPS_TIMEOUT_SEC = Math.max(60, parseIntegerEnv(process.env.OBSIDIAN_AUTO_BOOTSTRAP_OPS_TIMEOUT_SEC, 1200));

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export const DEFAULT_GUILD_MANIFEST: GuildKnowledgeManifest = {
  version: 1,
  includeGlobs: ['**/*.md'],
  excludeGlobs: ['.obsidian/**', '.trash/**', 'templates/**', 'ops/state/**', 'index/**'],
  maxFiles: 600,
  sourcePrefix: 'knowledge',
};

const validateGuildId = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!/^\d{6,30}$/.test(trimmed)) {
    return '';
  }
  return trimmed;
};

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const writeFileIfNeeded = async (targetPath: string, content: string, force: boolean): Promise<'created' | 'updated' | 'skipped'> => {
  if (!force && await fileExists(targetPath)) {
    return 'skipped';
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf8');
  return force ? 'updated' : 'created';
};

const buildSeedMarkdown = (title: string, guildId: string, category: string): string => {
  const now = new Date().toISOString();
  return [
    '---',
    'schema: "muel-note/v1"',
    'source: "bootstrap"',
    `guild_id: "${guildId}"`,
    `title: "${title}"`,
    `category: "${category}"`,
    `updated_at: "${now}"`,
    '---',
    '',
    `# ${title}`,
    '',
    '- This document was initialized by obsidian bootstrap.',
    '- Replace this content with guild-specific knowledge.',
  ].join('\n');
};

export const bootstrapObsidianGuildKnowledgeTree = async (params: {
  guildId: string;
  vaultPath: string;
  force?: boolean;
}): Promise<GuildBootstrapSummary> => {
  const guildId = validateGuildId(params.guildId);
  if (!guildId) {
    throw new Error('INVALID_GUILD_ID');
  }

  const vaultPath = String(params.vaultPath || '').trim();
  if (!vaultPath) {
    throw new Error('VAULT_PATH_REQUIRED');
  }

  const force = Boolean(params.force);
  const guildRoot = path.join(path.resolve(vaultPath), 'guilds', guildId);
  const directories = [
    'events/ingest',
    'memory/episodic',
    'memory/semantic',
    'policy',
    'playbooks',
    'experiments',
    'ops/state',
    'index',
  ];

  for (const relative of directories) {
    await fs.mkdir(path.join(guildRoot, relative), { recursive: true });
  }

  const manifestPath = path.join(guildRoot, 'index', 'manifest.json');
  const manifestStatus = await writeFileIfNeeded(
    manifestPath,
    JSON.stringify(DEFAULT_GUILD_MANIFEST, null, 2),
    force,
  );

  const seeds = [
    {
      filePath: path.join(guildRoot, 'memory', 'semantic', 'Guild_Lore.md'),
      title: 'Guild Lore',
      category: 'knowledge',
    },
    {
      filePath: path.join(guildRoot, 'memory', 'semantic', 'Server_History.md'),
      title: 'Server History',
      category: 'history',
    },
    {
      filePath: path.join(guildRoot, 'policy', 'Decision_Log.md'),
      title: 'Decision Log',
      category: 'policy',
    },
    {
      filePath: path.join(guildRoot, 'README.md'),
      title: 'Guild Knowledge Root',
      category: 'operations',
    },
  ];

  let createdFiles = 0;
  let updatedFiles = 0;
  let skippedFiles = 0;

  for (const seed of seeds) {
    const status = await writeFileIfNeeded(seed.filePath, buildSeedMarkdown(seed.title, guildId, seed.category), force);
    if (status === 'created') {
      createdFiles += 1;
    } else if (status === 'updated') {
      updatedFiles += 1;
    } else {
      skippedFiles += 1;
    }
  }

  return {
    guildId,
    rootPath: guildRoot,
    manifestStatus,
    createdFiles,
    updatedFiles,
    skippedFiles,
  };
};

const runOpsCycleOnce = async (guildId: string, timeoutSec: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmCommand, ['run', 'obsidian:ops-cycle', '--', '--guild', guildId], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`OBSIDIAN_OPS_CYCLE_TIMEOUT_${timeoutSec}`));
    }, timeoutSec * 1000);

    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`OBSIDIAN_OPS_CYCLE_EXIT_${String(code)}`));
      }
    });
  });
};

export const autoBootstrapGuildKnowledgeOnJoin = async (params: {
  guildId: string;
  guildName?: string;
  reason?: string;
}): Promise<void> => {
  if (!AUTO_BOOTSTRAP_ON_GUILD_JOIN) {
    return;
  }

  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    logger.warn('[OBSIDIAN-BOOTSTRAP] skipped guild=%s reason=vault_path_missing', params.guildId);
    return;
  }

  const summary = await bootstrapObsidianGuildKnowledgeTree({
    guildId: params.guildId,
    vaultPath,
    force: AUTO_BOOTSTRAP_FORCE,
  });

  logger.info(
    '[OBSIDIAN-BOOTSTRAP] guild=%s name=%s reason=%s manifest=%s files(created=%d,updated=%d,skipped=%d)',
    params.guildId,
    params.guildName || 'unknown',
    params.reason || 'guildCreate',
    summary.manifestStatus,
    summary.createdFiles,
    summary.updatedFiles,
    summary.skippedFiles,
  );

  if (!AUTO_BOOTSTRAP_RUN_OPS_CYCLE) {
    return;
  }

  try {
    await runOpsCycleOnce(params.guildId, AUTO_BOOTSTRAP_OPS_TIMEOUT_SEC);
    logger.info('[OBSIDIAN-BOOTSTRAP] initial ops-cycle completed guild=%s', params.guildId);
  } catch (error) {
    logger.warn(
      '[OBSIDIAN-BOOTSTRAP] initial ops-cycle failed guild=%s error=%s',
      params.guildId,
      error instanceof Error ? error.message : String(error),
    );
  }
};
