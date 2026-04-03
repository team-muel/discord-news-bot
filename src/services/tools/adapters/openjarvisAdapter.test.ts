import { describe, it, expect } from 'vitest';
import { parseBenchResult } from './openjarvisAdapter';

describe('parseBenchResult', () => {
  it('parses valid JSON bench output', () => {
    const result = parseBenchResult([
      '{"score": 0.85, "latency_ms": 120, "throughput": 42.5}',
    ]);
    expect(result.benchScore).toBe(0.85);
    expect(result.latencyMs).toBe(120);
    expect(result.throughput).toBe(42.5);
    expect(result.raw.length).toBe(1);
  });

  it('returns null scores on empty output', () => {
    const result = parseBenchResult([]);
    expect(result.benchScore).toBeNull();
    expect(result.latencyMs).toBeNull();
    expect(result.throughput).toBeNull();
  });

  it('returns null scores on whitespace-only output', () => {
    const result = parseBenchResult(['', '  ']);
    expect(result.benchScore).toBeNull();
  });

  it('extracts score from non-JSON "score: 0.75" format', () => {
    const result = parseBenchResult(['Benchmark complete', 'score: 0.75', 'done']);
    expect(result.benchScore).toBe(0.75);
    expect(result.latencyMs).toBeNull();
  });

  it('handles score with colon-space format', () => {
    const result = parseBenchResult(['SCORE: 92']);
    expect(result.benchScore).toBe(92);
  });

  it('handles malformed JSON gracefully (falls back to regex)', () => {
    const result = parseBenchResult(['{invalid json, score: 0.6']);
    expect(result.benchScore).toBe(0.6);
  });

  it('handles JSON with missing optional fields', () => {
    const result = parseBenchResult(['{"score": 0.9}']);
    expect(result.benchScore).toBe(0.9);
    expect(result.latencyMs).toBeNull();
    expect(result.throughput).toBeNull();
  });

  it('rejects NaN/Infinity scores from JSON', () => {
    const result = parseBenchResult(['{"score": "not-a-number"}']);
    expect(result.benchScore).toBeNull();
  });

  it('handles multi-line JSON output', () => {
    const result = parseBenchResult([
      '{',
      '  "score": 0.88,',
      '  "latency_ms": 200',
      '}',
    ]);
    expect(result.benchScore).toBe(0.88);
    expect(result.latencyMs).toBe(200);
  });

  it('limits raw to 20 lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const result = parseBenchResult(lines);
    expect(result.raw.length).toBe(20);
  });
});
