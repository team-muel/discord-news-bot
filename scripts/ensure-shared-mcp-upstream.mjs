import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DEFAULT_ENV_PATH = path.join(ROOT, '.env');
const DEFAULT_BACKUP_PATH = path.join(ROOT, '.env.shared-mcp-upstream-backup');

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const parseBool = (name, fallback = false) => {
  const value = String(parseArg(name, String(fallback))).trim().toLowerCase();
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value);
};

const parseAssignments = (text) => {
  const map = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1);
    if (/^[A-Z0-9_]+$/.test(key)) {
      map.set(key, value);
    }
  }
  return map;
};

const normalizeComparableUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/g, '');
  } catch {
    return raw.replace(/\/+$/g, '');
  }
};

const deriveWrapperBaseUrl = (value) => {
  const normalized = normalizeComparableUrl(value);
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    parsed.pathname = parsed.pathname.replace(/\/(mcp|obsidian)\/?$/i, '') || '/';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/g, '');
  } catch {
    return normalized.replace(/\/(mcp|obsidian)\/?$/i, '').replace(/\/+$/g, '');
  }
};

const findAssignmentLineIndex = (lines, key) => lines.findIndex((line) => line.startsWith(`${key}=`));

const loadEnvFile = async (envPath) => {
  try {
    return await fs.readFile(envPath, 'utf8');
  } catch {
    return '';
  }
};

const main = async () => {
  const envPath = path.resolve(ROOT, parseArg('envFile', DEFAULT_ENV_PATH));
  const backupPath = path.resolve(ROOT, parseArg('backupFile', DEFAULT_BACKUP_PATH));
  const dryRun = parseBool('dryRun', false);
  const namespace = String(parseArg('namespace', 'gcpcompute')).trim() || 'gcpcompute';
  const id = String(parseArg('id', 'gcpcompute-shared-mcp')).trim() || 'gcpcompute-shared-mcp';
  const label = String(parseArg('label', 'Shared GCP Compute Wrapper')).trim() || 'Shared GCP Compute Wrapper';
  const owner = String(parseArg('owner', 'team-muel')).trim() || 'team-muel';
  const sourceRepo = String(parseArg('sourceRepo', 'team-muel/discord-news-bot')).trim() || 'team-muel/discord-news-bot';

  const envRaw = await loadEnvFile(envPath);
  const envLines = envRaw ? envRaw.split(/\r?\n/) : [];
  const assignments = parseAssignments(envRaw);
  const sharedIngress = assignments.get('MCP_SHARED_MCP_URL')
    || assignments.get('OBSIDIAN_REMOTE_MCP_URL')
    || process.env.MCP_SHARED_MCP_URL
    || process.env.OBSIDIAN_REMOTE_MCP_URL
    || '';

  const wrapperBaseUrl = deriveWrapperBaseUrl(sharedIngress);
  if (!wrapperBaseUrl) {
    throw new Error('MCP_SHARED_MCP_URL or OBSIDIAN_REMOTE_MCP_URL must be configured before bootstrapping the shared wrapper lane.');
  }

  const existingRaw = assignments.get('MCP_UPSTREAM_SERVERS') || process.env.MCP_UPSTREAM_SERVERS || '[]';
  let upstreams;
  try {
    const parsed = JSON.parse(existingRaw || '[]');
    upstreams = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    throw new Error(`MCP_UPSTREAM_SERVERS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const defaultEntry = {
    id,
    label,
    url: wrapperBaseUrl,
    namespace,
    enabled: true,
    plane: 'control',
    audience: 'shared',
    owner,
    sourceRepo,
  };

  const existingIndex = upstreams.findIndex((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const candidateId = String(entry.id || '').trim();
    const candidateNamespace = String(entry.namespace || '').trim();
    const candidateUrl = deriveWrapperBaseUrl(entry.url);
    return candidateId === id || candidateNamespace === namespace || candidateUrl === wrapperBaseUrl;
  });

  const nextUpstreams = [...upstreams];
  if (existingIndex >= 0) {
    nextUpstreams[existingIndex] = {
      ...defaultEntry,
      ...nextUpstreams[existingIndex],
      id,
      label: nextUpstreams[existingIndex]?.label || label,
      url: wrapperBaseUrl,
      namespace,
      enabled: true,
      plane: nextUpstreams[existingIndex]?.plane || 'control',
      audience: nextUpstreams[existingIndex]?.audience || 'shared',
      owner: nextUpstreams[existingIndex]?.owner || owner,
      sourceRepo: nextUpstreams[existingIndex]?.sourceRepo || sourceRepo,
    };
  } else {
    nextUpstreams.push(defaultEntry);
  }

  const nextRaw = JSON.stringify(nextUpstreams);
  const assignment = `MCP_UPSTREAM_SERVERS=${nextRaw}`;
  const lineIndex = findAssignmentLineIndex(envLines, 'MCP_UPSTREAM_SERVERS');
  if (lineIndex >= 0) {
    envLines[lineIndex] = assignment;
  } else {
    if (envLines.length > 0 && envLines[envLines.length - 1].trim() !== '') {
      envLines.push('');
    }
    envLines.push(assignment);
  }

  const summary = {
    ok: true,
    dryRun,
    envFile: path.relative(ROOT, envPath).replace(/\\/g, '/'),
    sharedIngress: normalizeComparableUrl(sharedIngress),
    wrapperBaseUrl,
    entryId: id,
    namespace,
    enabledSharedNamespaces: nextUpstreams
      .filter((entry) => entry && entry.enabled !== false && entry.audience !== 'operator')
      .map((entry) => entry.namespace),
    changed: JSON.stringify(upstreams) !== nextRaw,
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await fs.writeFile(backupPath, envRaw, 'utf8');
  await fs.writeFile(envPath, `${envLines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
  console.log(JSON.stringify({
    ...summary,
    backupFile: path.relative(ROOT, backupPath).replace(/\\/g, '/'),
  }, null, 2));
};

main().catch((error) => {
  console.error(`[shared-mcp-upstream] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});