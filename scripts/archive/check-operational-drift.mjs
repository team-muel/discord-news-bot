import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = ['src', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const IGNORE_PATH_PARTS = ['node_modules', 'coverage', 'dist', '.git'];
const GUILD_ID_LITERAL = /\b\d{17,20}\b/g;

const ALLOW_PATTERNS = [
  /docs\//,
  /\.test\./,
  /\.spec\./,
  /SUPABASE_SCHEMA\.sql$/,
  /\.env\.example$/,
];

const findings = [];

const shouldIgnore = (fullPath) => {
  const normalized = fullPath.replace(/\\/g, '/');
  return IGNORE_PATH_PARTS.some((part) => normalized.includes(`/${part}/`) || normalized.endsWith(`/${part}`));
};

const walk = async (dirPath) => {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (shouldIgnore(fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    const normalized = fullPath.replace(/\\/g, '/');
    if (ALLOW_PATTERNS.some((pattern) => pattern.test(normalized))) {
      continue;
    }

    const raw = await fs.readFile(fullPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const matches = line.match(GUILD_ID_LITERAL);
      if (!matches) continue;
      findings.push({
        file: path.relative(ROOT, fullPath).replace(/\\/g, '/'),
        line: i + 1,
        snippet: line.trim().slice(0, 200),
      });
    }
  }
};

for (const relativeDir of TARGET_DIRS) {
  await walk(path.join(ROOT, relativeDir));
}

if (findings.length === 0) {
  console.log('[drift-check] OK: no suspicious Discord-like numeric literals found.');
  process.exit(0);
}

console.error(`[drift-check] FOUND ${findings.length} suspicious numeric literals (possible hardcoding).`);
for (const finding of findings.slice(0, 100)) {
  console.error(`- ${finding.file}:${finding.line} :: ${finding.snippet}`);
}

process.exit(1);
