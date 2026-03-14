import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { searchObsidianVaultWithAdapter } from '../src/services/obsidian/router';

type QueryStat = {
  query: string;
  limit: number;
  runs: number;
  avgMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  resultCountAvg: number;
};

const DEFAULT_RUNS = 15;
const DEFAULT_QUERIES = [
  'tag:ops',
  'tag:policy',
  'incident postmortem',
  'memory retrieval',
  'trading strategy',
  'news summary',
];

function parseRuns(): number {
  const raw = Number(process.env.BENCH_RUNS ?? DEFAULT_RUNS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_RUNS;
  }
  return Math.max(1, Math.trunc(raw));
}

function parseQueries(): string[] {
  const raw = String(process.env.BENCH_QUERIES || '').trim();
  if (!raw) {
    return DEFAULT_QUERIES;
  }

  return raw
    .split(',')
    .map((q) => q.trim())
    .filter(Boolean);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function benchSingleQuery(vaultPath: string, query: string, runs: number): Promise<QueryStat> {
  const latencies: number[] = [];
  const counts: number[] = [];
  const limit = 8;

  for (let i = 0; i < runs; i += 1) {
    const startedAt = performance.now();
    const results = await searchObsidianVaultWithAdapter({ vaultPath, query, limit });
    const elapsedMs = performance.now() - startedAt;

    latencies.push(elapsedMs);
    counts.push(results.length);
  }

  return {
    query,
    limit,
    runs,
    avgMs: average(latencies),
    p95Ms: percentile(latencies, 95),
    minMs: Math.min(...latencies),
    maxMs: Math.max(...latencies),
    resultCountAvg: average(counts),
  };
}

function toMarkdownReport(params: {
  vaultPath: string;
  runs: number;
  stats: QueryStat[];
  startedAtIso: string;
}): string {
  const rows = params.stats
    .map((stat) => `| ${stat.query} | ${stat.runs} | ${stat.limit} | ${stat.avgMs.toFixed(2)} | ${stat.p95Ms.toFixed(2)} | ${stat.minMs.toFixed(2)} | ${stat.maxMs.toFixed(2)} | ${stat.resultCountAvg.toFixed(2)} |`)
    .join('\n');

  const allAvg = average(params.stats.map((s) => s.avgMs));
  const allP95 = average(params.stats.map((s) => s.p95Ms));

  return [
    '# Obsidian Search Benchmark',
    '',
    `- Started at: ${params.startedAtIso}`,
    `- Vault path: ${params.vaultPath}`,
    `- Runs per query: ${params.runs}`,
    `- Query count: ${params.stats.length}`,
    '',
    '## Summary',
    '',
    `- Mean avg latency: ${allAvg.toFixed(2)} ms`,
    `- Mean p95 latency: ${allP95.toFixed(2)} ms`,
    '',
    '## Per Query',
    '',
    '| Query | Runs | Limit | Avg (ms) | P95 (ms) | Min (ms) | Max (ms) | Avg Results |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    rows,
    '',
    '## Notes',
    '',
    '- This benchmark measures end-to-end search latency via adapter router.',
    '- First-run warmup costs are included; increase BENCH_RUNS for stable medians.',
  ].join('\n');
}

async function main(): Promise<void> {
  const vaultPath = path.resolve(String(process.env.BENCH_VAULT_PATH || process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || 'docs').trim() || 'docs');
  const runs = parseRuns();
  const queries = parseQueries();

  if (queries.length === 0) {
    throw new Error('No benchmark queries configured.');
  }

  const startedAtIso = new Date().toISOString();
  const stats: QueryStat[] = [];

  for (const query of queries) {
    const stat = await benchSingleQuery(vaultPath, query, runs);
    stats.push(stat);
  }

  const report = toMarkdownReport({
    vaultPath,
    runs,
    stats,
    startedAtIso,
  });

  const reportPath = path.resolve('docs/OBSIDIAN_SEARCH_BENCHMARK.md');
  await fs.writeFile(reportPath, report, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[bench] report written: ${reportPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[bench] failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
