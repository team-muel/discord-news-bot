import { describe, expect, it } from 'vitest';

import {
  formatLineRange,
  mergeSecurityReviewUnits,
  normalizeDiscoveryResult,
  normalizeMergedSecurityReviewUnit,
  normalizeSecurityCandidateAnchor,
  parseJsonl,
  stringifyJsonl,
} from './securityCandidateContract';

describe('securityCandidateContract', () => {
  it('normalizes a raw candidate anchor', () => {
    const candidate = normalizeSecurityCandidateAnchor({
      id: 'cand-1',
      commitSha: 'abc123',
      filePath: 'src/routes/auth.ts',
      startLine: 10,
      endLine: 12,
      codeSnippet: 'const token = req.cookies?.session;',
      ruleId: 'input-to-auth-boundary',
      fingerprint: 'fp-1',
      candidateKind: 'auth-boundary-review',
    });

    expect(candidate.filePath).toBe('src/routes/auth.ts');
    expect(candidate.endLine).toBe(12);
  });

  it('rejects merged review units with inconsistent merged count', () => {
    expect(() => normalizeMergedSecurityReviewUnit({
      id: 'unit-1',
      commitSha: 'abc123',
      filePath: 'src/routes/auth.ts',
      startLine: 10,
      endLine: 11,
      codeSnippet: 'example',
      rawCandidateIds: ['cand-1', 'cand-2'],
      mergedCount: 1,
      candidateKind: 'auth-boundary-review',
    })).toThrow(/mergedCount/);
  });

  it('parses JSONL and preserves round-trip formatting', () => {
    const jsonl = stringifyJsonl([
      {
        id: 'cand-1',
        commitSha: 'abc123',
        filePath: 'src/routes/auth.ts',
        startLine: 10,
        endLine: 10,
        codeSnippet: 'line',
        ruleId: 'rule',
        fingerprint: 'fp-1',
        candidateKind: 'auth-boundary-review',
      },
    ]);

    const parsed = parseJsonl(jsonl, normalizeSecurityCandidateAnchor);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('cand-1');
  });

  it('normalizes discovery result buckets', () => {
    const result = normalizeDiscoveryResult({
      analyze: [{
        unitId: 'unit-1',
        disposition: 'analyze',
        priorityScore: 85,
        shortReason: 'near output boundary',
        reasonCodes: ['untrusted-input-near-output'],
      }],
      hold: [],
      drop: [],
    });

    expect(result.analyze[0].priorityScore).toBe(85);
  });

  it('formats line range for merged units', () => {
    expect(formatLineRange(38, 40)).toBe('38-40');
    expect(formatLineRange(85, 85)).toBe('85');
  });

  it('merges raw candidates into review units', () => {
    const merged = mergeSecurityReviewUnits([
      normalizeSecurityCandidateAnchor({
        id: 'cand-1',
        commitSha: 'abc123',
        filePath: 'src/routes/auth.ts',
        startLine: 10,
        endLine: 12,
        codeSnippet: 'const token = req.cookies?.session;',
        ruleId: 'input-to-auth-boundary',
        fingerprint: 'fp-1',
        candidateKind: 'auth-boundary-review',
        symbolName: 'requireAdmin',
      }),
      normalizeSecurityCandidateAnchor({
        id: 'cand-2',
        commitSha: 'abc123',
        filePath: 'src/routes/auth.ts',
        startLine: 10,
        endLine: 12,
        codeSnippet: 'const token = req.cookies?.session;\nreturn token;',
        ruleId: 'cookie-auth-review',
        fingerprint: 'fp-2',
        candidateKind: 'auth-boundary-review',
        symbolName: 'requireAdmin',
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].mergedCount).toBe(2);
    expect(merged[0].ruleIds).toEqual(['input-to-auth-boundary', 'cookie-auth-review']);
  });
});