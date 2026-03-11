import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SCHEMA_FILE = path.join(ROOT, 'docs', 'SUPABASE_SCHEMA.sql');
const SERVICES_DIR = path.join(ROOT, 'src', 'services');
const OUTPUT_FILE = path.join(ROOT, 'docs', 'SCHEMA_SERVICE_MAP.md');

const extractTables = (schemaText) => {
  const tables = new Set();
  const regex = /create\s+table\s+if\s+not\s+exists\s+public\.([a-zA-Z0-9_]+)/gi;
  let match;
  while ((match = regex.exec(schemaText)) !== null) {
    tables.add(match[1]);
  }
  return [...tables].sort();
};

const walkTsFiles = async (dirPath) => {
  const out = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkTsFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(fullPath);
    }
  }
  return out;
};

const main = async () => {
  const schema = await fs.readFile(SCHEMA_FILE, 'utf8');
  const tables = extractTables(schema);
  const files = await walkTsFiles(SERVICES_DIR);

  const tableToServices = new Map(tables.map((t) => [t, new Set()]));
  const rpcToServices = new Map();

  for (const filePath of files) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const text = await fs.readFile(filePath, 'utf8');

    for (const table of tables) {
      const fromPattern = new RegExp(`\\.from\\(\\s*['\"]${table}['\"]\\s*\\)`, 'g');
      if (fromPattern.test(text)) {
        tableToServices.get(table).add(rel);
      }
    }

    const rpcRegex = /\.rpc\(\s*['\"]([a-zA-Z0-9_]+)['\"]\s*[,)\]]/g;
    let rpcMatch;
    while ((rpcMatch = rpcRegex.exec(text)) !== null) {
      const rpc = rpcMatch[1];
      if (!rpcToServices.has(rpc)) rpcToServices.set(rpc, new Set());
      rpcToServices.get(rpc).add(rel);
    }
  }

  const generatedAt = new Date().toISOString();
  const lines = [
    '# Schema to Service Map',
    '',
    `- Generated at: ${generatedAt}`,
    '- Source schema: docs/SUPABASE_SCHEMA.sql',
    '- Source scan: src/services/**/*.ts',
    '- Notes: static string matching for .from(...) and .rpc(...) usage.',
    '',
    '## Tables',
    '',
    '| Table | Services |',
    '| --- | --- |',
  ];

  for (const table of tables) {
    const services = [...(tableToServices.get(table) || [])].sort();
    lines.push(`| ${table} | ${services.length > 0 ? services.join('<br/>') : '-'} |`);
  }

  lines.push('', '## RPC Functions', '', '| RPC | Services |', '| --- | --- |');

  const rpcs = [...rpcToServices.keys()].sort();
  if (rpcs.length === 0) {
    lines.push('| - | - |');
  } else {
    for (const rpc of rpcs) {
      const services = [...rpcToServices.get(rpc)].sort();
      lines.push(`| ${rpc} | ${services.join('<br/>')} |`);
    }
  }

  lines.push('');
  await fs.writeFile(OUTPUT_FILE, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`Wrote ${OUTPUT_FILE}\n`);
};

main().catch((error) => {
  process.stderr.write(`Failed to generate schema/service map: ${String(error)}\n`);
  process.exit(1);
});
