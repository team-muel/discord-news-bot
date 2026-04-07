/* eslint-disable no-console */
/**
 * obsidian-wiki-commit.ts
 *
 * Stages and commits all uncommitted changes in an Obsidian vault directory.
 * Designed to run after an LLM-Wiki ingest/lint cycle.
 *
 * Usage:
 *   tsx scripts/obsidian-wiki-commit.ts [--vault <path>] [--message <msg>] [--dry-run]
 *
 * Env:
 *   OBSIDIAN_SYNC_VAULT_PATH  or  OBSIDIAN_VAULT_PATH  — path to vault git repo
 *   DRY_RUN=true                                       — skip actual commit
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { stat } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

type ParsedArgs = {
  vaultPath: string;
  message: string;
  dryRun: boolean;
};

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  let vaultPath = String(process.env.OBSIDIAN_SYNC_VAULT_PATH ?? process.env.OBSIDIAN_VAULT_PATH ?? '').trim();
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  let message = `wiki: ingest ${now}`;
  let dryRun = String(process.env.DRY_RUN ?? '').toLowerCase() === 'true';

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] ?? '').trim();
    if (current === '--vault' || current === '--vault-path') {
      const value = String(args[i + 1] ?? '').trim();
      if (value) {
        vaultPath = value;
        i += 1;
      }
    } else if (current === '--message' || current === '-m') {
      const value = String(args[i + 1] ?? '').trim();
      if (value) {
        message = value;
        i += 1;
      }
    } else if (current === '--dry-run') {
      dryRun = true;
    }
  }

  return { vaultPath, message, dryRun };
};

const git = async (cwd: string, ...args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
};

const ensureVaultDir = async (vaultPath: string): Promise<string> => {
  const trimmed = vaultPath.trim();
  if (!trimmed) {
    throw new Error('vault path is required. Set OBSIDIAN_SYNC_VAULT_PATH or OBSIDIAN_VAULT_PATH');
  }
  const resolved = path.resolve(trimmed);
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`vault path is not a directory: ${resolved}`);
  }
  return resolved;
};

const main = async (): Promise<void> => {
  const { vaultPath, message, dryRun } = parseArgs();

  const resolved = await ensureVaultDir(vaultPath);
  console.log(`[wiki-commit] vault=${resolved} dryRun=${String(dryRun)}`);

  const status = await git(resolved, 'status', '--porcelain');
  if (!status) {
    console.log('[wiki-commit] no changes to commit');
    return;
  }

  const lineCount = status.split('\n').filter(Boolean).length;
  console.log(`[wiki-commit] ${String(lineCount)} file(s) changed`);

  if (dryRun) {
    console.log('[wiki-commit] dry-run: skipping commit');
    console.log(status);
    return;
  }

  await git(resolved, 'add', '--all');
  const result = await git(resolved, 'commit', '--message', message);
  console.log(`[wiki-commit] committed: ${result.split('\n')[0] ?? ''}`);
};

main().catch((error) => {
  console.error('[wiki-commit] error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
