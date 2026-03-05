import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

const rootDir = process.cwd();
const requirementsPath = path.join(rootDir, 'requirements.txt');
const cacheDir = path.join(rootDir, '.cache');
const pipCacheDir = path.join(cacheDir, 'pip');
const markerPath = path.join(cacheDir, 'python-requirements.sha256');
const pythonCommand = process.env.PYTHON_COMMAND || 'python';

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (!existsSync(requirementsPath)) {
  console.log('[build] requirements.txt not found. Skipping Python dependency install.');
  console.log('No frontend build for backend-only deployment');
  process.exit(0);
}

mkdirSync(cacheDir, { recursive: true });
mkdirSync(pipCacheDir, { recursive: true });

const requirementsText = readFileSync(requirementsPath, 'utf8');
const requirementsHash = createHash('sha256').update(requirementsText).digest('hex');
const previousHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';

const forceInstall = process.env.FORCE_PYTHON_DEPS === '1' || process.env.FORCE_PYTHON_DEPS === 'true';
const shouldInstall = forceInstall || requirementsHash !== previousHash;

if (shouldInstall) {
  console.log('[build] Installing Python dependencies (requirements changed or force enabled)...');
  run(pythonCommand, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--upgrade-strategy',
    'only-if-needed',
    '--cache-dir',
    pipCacheDir,
    '-r',
    requirementsPath,
  ]);
  writeFileSync(markerPath, `${requirementsHash}\n`, 'utf8');
} else {
  console.log('[build] Python dependencies unchanged. Using cache; skipping pip install.');
}

console.log('No frontend build for backend-only deployment');
