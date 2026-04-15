import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildOpenjarvisOptimizeInvocation, formatOpenjarvisOptimizeProfile } from './openjarvisOptimizeProfile.mjs';

describe('openjarvisOptimizeProfile', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds a dynamic optimize invocation and writes a local TOML profile', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openjarvis-optimize-'));
    tempDirs.push(rootDir);

    const { optimizeArgs, profile } = buildOpenjarvisOptimizeInvocation({
      rootDir,
      source: 'weekly',
      dynamicProfileEnabled: true,
      benchmark: 'supergpqa',
      optimizerModel: 'qwen2.5:7b-instruct',
      optimizerEngine: 'ollama',
      judgeModel: 'qwen2.5:7b-instruct',
      judgeEngine: 'ollama',
      trials: 1,
      maxSamples: 1,
      retrievalHitAtK: 0.18,
      citationRate: 0.22,
      p95LatencyMs: 4200,
      qualityGateOverride: 'fail',
      providerProfileHint: 'quality-optimized',
    });

    expect(optimizeArgs.slice(0, 4)).toEqual(['optimize', 'run', '--config', expect.any(String)]);
    expect(profile.mode).toBe('dynamic');
    expect(profile.configPath).toContain('weekly-adaptive.toml');
    expect(profile.configPath).not.toBeNull();

    const configPath = profile.configPath as string;
    expect(fs.existsSync(path.join(rootDir, configPath))).toBe(true);

    const toml = fs.readFileSync(path.join(rootDir, configPath), 'utf8');
    expect(toml).toContain('benchmark = "supergpqa"');
    expect(toml).toContain('name = "intelligence.system_prompt"');
    expect(toml).toContain('Preserve graph-first retrieval');
  });

  it('formats the optimize profile summary for operator logs', () => {
    const summary = formatOpenjarvisOptimizeProfile({
      mode: 'dynamic',
      benchmark: 'supergpqa',
      configPath: 'tmp/openjarvis-optimize/weekly-adaptive.toml',
      objectiveWeights: {
        accuracy: 0.6,
        mean_latency_seconds: 0.25,
        total_cost_usd: 0.15,
      },
      searchDimensions: ['intelligence.temperature', 'tools.tool_set'],
      signals: {
        retrievalHitAtK: 0.33,
        p95LatencyMs: 2500,
      },
    });

    expect(summary).toContain('mode=dynamic');
    expect(summary).toContain('config=tmp/openjarvis-optimize/weekly-adaptive.toml');
    expect(summary).toContain('search=intelligence.temperature,tools.tool_set');
    expect(summary).toContain('retrieval=0.33');
    expect(summary).toContain('p95_ms=2500');
  });
});