import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const ROUTES_DIR = path.join(ROOT, 'src', 'routes');
const APP_FILE = path.join(ROOT, 'src', 'app.ts');
const OUTPUT_FILE = path.join(ROOT, 'docs', 'ROUTES_INVENTORY.md');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const walkRouteFiles = async (dir, prefix = '') => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkRouteFiles(nextPath, nextPrefix));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    files.push({
      relPath: nextPrefix,
      absPath: nextPath,
    });
  }
  return files;
};

const normalizePath = (basePath, routePath) => {
  if (!basePath) {
    return routePath;
  }
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const route = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${base}${route}`.replace(/\/+/g, '/');
};

const readAppMounts = async () => {
  const text = await fs.readFile(APP_FILE, 'utf8');
  const lines = text.split(/\r?\n/);
  const mounts = new Map();

  const mountRegex = /app\.use\((?:'([^']+)'\s*,\s*)?create([A-Za-z]+)Router\(\)\);/;
  for (const line of lines) {
    const match = line.match(mountRegex);
    if (!match) continue;
    const mountPath = match[1] || '';
    const key = match[2].toLowerCase();
    mounts.set(`${key}.ts`, mountPath);
  }

  return mounts;
};

const parseRouteFile = async (filePath, basePath) => {
  const text = await fs.readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const rows = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const methodMatch = line.match(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,\s*(.+)$/);
    if (!methodMatch) continue;

    const method = methodMatch[1].toUpperCase();
    const routePath = methodMatch[2];
    const rest = methodMatch[3];

    if (!HTTP_METHODS.includes(method.toLowerCase())) {
      continue;
    }

    const middlewareTokens = [];
    for (const token of ['requireAuth', 'requireAdmin']) {
      if (rest.includes(token)) middlewareTokens.push(token);
    }
    if (/RateLimiter/.test(rest) || /createRateLimiter/.test(text)) {
      if (rest.includes('RateLimiter')) middlewareTokens.push('rateLimit');
    }

    rows.push({
      method,
      path: normalizePath(basePath, routePath),
      auth: middlewareTokens.includes('requireAuth') ? 'yes' : 'no',
      admin: middlewareTokens.includes('requireAdmin') ? 'yes' : 'no',
      rateLimit: middlewareTokens.includes('rateLimit') ? 'yes' : 'no',
      sourceLine: i + 1,
    });
  }

  return rows;
};

const resolveBasePath = (relPath, mounts) => {
  if (mounts.has(relPath)) {
    return mounts.get(relPath) || '';
  }
  const fileName = path.basename(relPath);
  if (mounts.has(fileName)) {
    return mounts.get(fileName) || '';
  }
  if (relPath.startsWith('bot-agent/')) {
    return mounts.get('bot.ts') || '/api/bot';
  }
  return '';
};

const main = async () => {
  const mounts = await readAppMounts();
  const files = (await walkRouteFiles(ROUTES_DIR)).sort((a, b) => a.relPath.localeCompare(b.relPath));

  const routeRows = [];
  for (const file of files) {
    const basePath = resolveBasePath(file.relPath, mounts);
    const rows = await parseRouteFile(file.absPath, basePath);
    for (const row of rows) {
      routeRows.push({
        ...row,
        source: `src/routes/${file.relPath}:${row.sourceLine}`,
      });
    }
  }

  routeRows.sort((a, b) => {
    if (a.path === b.path) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });

  const lines = [
    '# Routes Inventory',
    '',
    '- Source: src/app.ts + src/routes/**/*.ts',
    '- Notes: middleware detection is static and best-effort for requireAuth/requireAdmin/rate limiter usage.',
    '',
    '| Method | Path | Auth | Admin | Rate Limit | Source |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of routeRows) {
    lines.push(`| ${row.method} | ${row.path} | ${row.auth} | ${row.admin} | ${row.rateLimit} | ${row.source} |`);
  }

  lines.push('');
  await fs.writeFile(OUTPUT_FILE, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`Wrote ${OUTPUT_FILE}\n`);
};

main().catch((error) => {
  process.stderr.write(`Failed to generate route inventory: ${String(error)}\n`);
  process.exit(1);
});
