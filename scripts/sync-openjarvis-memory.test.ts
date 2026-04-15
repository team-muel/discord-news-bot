import { describe, expect, it } from 'vitest';

import { buildProjectionSummary, pickLatestReportRows, resolveObsidianAdapterSummary } from './sync-openjarvis-memory';

describe('sync-openjarvis-memory helpers', () => {
  it('keeps only the latest row per report kind in default priority order', () => {
    const rows = pickLatestReportRows([
      { report_kind: 'llm_latency_weekly', report_key: 'latency-new' },
      { report_kind: 'go_no_go_weekly', report_key: 'go-1' },
      { report_kind: 'llm_latency_weekly', report_key: 'latency-old' },
      { report_kind: 'self_improvement_patterns', report_key: 'pattern-1' },
    ]);

    expect(rows.map((row) => row.report_key)).toEqual(['go-1', 'latency-new', 'pattern-1']);
  });

  it('builds section counts and lightweight doc metadata for the summary file', () => {
    const summary = buildProjectionSummary({
      generatedAt: '2026-04-12T00:00:00.000Z',
      dryRun: false,
      enabled: true,
      forced: true,
      vaultPath: '/vault',
      obsidianAdapterSummary: 'remote-mcp primary',
      supabaseAvailability: 'ok',
      docs: [
        { section: 'obsidian', fileName: 'runtime-name-and-surface-matrix.md', title: 'Runtime', content: '# Runtime', sourceRef: 'vault:ops/control-tower/CANONICAL_MAP.md' },
        { section: 'repo', fileName: 'architecture-index.md', title: 'Architecture', content: '# Architecture', sourceRef: 'repo:docs/ARCHITECTURE_INDEX.md' },
        { section: 'supabase', fileName: 'go-no-go-weekly.md', title: 'Weekly', content: '# Weekly', sourceRef: 'supabase:agent_weekly_reports:go-1' },
      ],
      memoryIndex: {
        attempted: true,
        status: 'completed',
        completedAt: '2026-04-12T00:00:01.000Z',
        outputSummary: 'indexed 3 docs',
        reason: null,
      },
    });

    expect(summary.counts).toEqual({
      total: 3,
      obsidian: 1,
      repo: 1,
      supabase: 1,
    });
    expect(summary.docs).toEqual([
      { section: 'obsidian', fileName: 'runtime-name-and-surface-matrix.md', sourceRef: 'vault:ops/control-tower/CANONICAL_MAP.md' },
      { section: 'repo', fileName: 'architecture-index.md', sourceRef: 'repo:docs/ARCHITECTURE_INDEX.md' },
      { section: 'supabase', fileName: 'go-no-go-weekly.md', sourceRef: 'supabase:agent_weekly_reports:go-1' },
    ]);
  });

  it('falls back to selected adapters when access posture summary is unavailable', () => {
    expect(resolveObsidianAdapterSummary({
      selectedByCapability: {
        write_note: 'remote-mcp',
        read_file: 'local-fs',
        search_vault: 'remote-mcp',
      },
    })).toBe('adapter-summary-unavailable (write=remote-mcp, read=local-fs, search=remote-mcp)');

    expect(resolveObsidianAdapterSummary(null)).toBe('adapter-summary-unavailable (write=unknown, read=unknown, search=unknown)');
  });
});