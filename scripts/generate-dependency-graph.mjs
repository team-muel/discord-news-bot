import fs from 'node:fs/promises';
import path from 'node:path';
import madge from 'madge';

const ROOT = process.cwd();
const OUTPUT_FILE = path.join(ROOT, 'docs', 'DEPENDENCY_GRAPH.md');

const ENTRYPOINTS = [
  'server.ts',
  'bot.ts',
  'src/app.ts',
  'src/bot.ts',
  'src/services/multiAgentService.ts',
];

const toMermaid = (graph) => {
  const lines = ['graph LR'];
  const keys = Object.keys(graph).sort();

  for (const from of keys) {
    const toList = [...(graph[from] || [])].sort();
    if (toList.length === 0) {
      lines.push(`  ${JSON.stringify(from)}:::file`);
      continue;
    }

    for (const to of toList) {
      lines.push(`  ${JSON.stringify(from)} --> ${JSON.stringify(to)}`);
    }
  }

  lines.push('  classDef file fill:#f7f7f7,stroke:#777,stroke-width:1px;');
  return lines.join('\n');
};

const topFanIn = (graph, count = 12) => {
  const inbound = new Map();
  for (const [from, toList] of Object.entries(graph)) {
    if (!inbound.has(from)) inbound.set(from, 0);
    for (const to of toList) {
      inbound.set(to, (inbound.get(to) || 0) + 1);
    }
  }

  return [...inbound.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count);
};

const main = async () => {
  const result = await madge(ENTRYPOINTS, {
    baseDir: ROOT,
    tsConfig: path.join(ROOT, 'tsconfig.json'),
    fileExtensions: ['ts', 'js', 'mjs'],
    includeNpm: false,
  });

  const graph = result.obj();
  const fanIn = topFanIn(graph);
  const lines = [
    '# Dependency Graph',
    '',
    `- Entrypoints: ${ENTRYPOINTS.join(', ')}`,

    `- Nodes: ${Object.keys(graph).length}`,
    '',
    '## Top Fan-In (Most Imported Modules)',
    '',
    '| Module | Inbound Imports |',
    '| --- | --- |',
  ];

  for (const [modulePath, inbound] of fanIn) {
    lines.push(`| ${modulePath} | ${inbound} |`);
  }

  lines.push('', '## Mermaid', '', '```mermaid', toMermaid(graph), '```', '');

  await fs.writeFile(OUTPUT_FILE, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`Wrote ${OUTPUT_FILE}\n`);
};

main().catch((error) => {
  process.stderr.write(`Failed to generate dependency graph: ${String(error)}\n`);
  process.exit(1);
});
