import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');
const BACKUP_PATH = path.join(ROOT, '.env.profile-backup');

const PROFILE_FILES = {
  local: path.join(ROOT, 'config', 'env', 'local.profile.env'),
  production: path.join(ROOT, 'config', 'env', 'production.profile.env'),
};

const usage = () => {
  console.log('Usage: node scripts/apply-env-profile.mjs <local|production> [--dry-run]');
};

const parseAssignments = (text) => {
  const map = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const idx = line.indexOf('=');
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    if (!/^[A-Z0-9_]+$/.test(key)) {
      continue;
    }
    map.set(key, value);
  }
  return map;
};

const findEnvKeyLineIndexes = (lines) => {
  const indexes = new Map();
  lines.forEach((line, index) => {
    const idx = line.indexOf('=');
    if (idx <= 0) {
      return;
    }
    const key = line.slice(0, idx).trim();
    if (/^[A-Z0-9_]+$/.test(key)) {
      indexes.set(key, index);
    }
  });
  return indexes;
};

const applyProfile = async ({ profileName, dryRun }) => {
  const profilePath = PROFILE_FILES[profileName];
  if (!profilePath) {
    usage();
    throw new Error(`Unknown profile: ${profileName}`);
  }

  const [envRaw, profileRaw] = await Promise.all([
    fs.readFile(ENV_PATH, 'utf8').catch(() => ''),
    fs.readFile(profilePath, 'utf8'),
  ]);

  if (!envRaw) {
    throw new Error('.env file not found or empty. Aborting to avoid accidental overwrite.');
  }

  const envLines = envRaw.split(/\r?\n/);
  const assignments = parseAssignments(profileRaw);
  const keyIndexes = findEnvKeyLineIndexes(envLines);

  const changed = [];
  const added = [];

  for (const [key, value] of assignments.entries()) {
    const nextLine = `${key}=${value}`;
    if (keyIndexes.has(key)) {
      const at = keyIndexes.get(key);
      const prev = envLines[at];
      if (prev !== nextLine) {
        envLines[at] = nextLine;
        changed.push(key);
      }
      continue;
    }
    envLines.push(nextLine);
    added.push(key);
  }

  console.log(`[env-profile] profile=${profileName}`);
  console.log(`[env-profile] changed=${changed.length} added=${added.length}`);
  if (changed.length > 0) {
    console.log(`[env-profile] changed keys: ${changed.join(', ')}`);
  }
  if (added.length > 0) {
    console.log(`[env-profile] added keys: ${added.join(', ')}`);
  }

  if (dryRun) {
    console.log('[env-profile] dry-run only. No files written.');
    return;
  }

  await fs.writeFile(BACKUP_PATH, envRaw, 'utf8');
  await fs.writeFile(ENV_PATH, `${envLines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
  console.log(`[env-profile] backup written: ${path.relative(ROOT, BACKUP_PATH)}`);
  console.log('[env-profile] .env updated successfully');
};

const main = async () => {
  const args = process.argv.slice(2);
  const profileName = args.find((arg) => !arg.startsWith('-'));
  const dryRun = args.includes('--dry-run');

  if (!profileName) {
    usage();
    process.exitCode = 1;
    return;
  }

  await applyProfile({ profileName, dryRun });
};

main().catch((error) => {
  console.error(`[env-profile] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
