import { describe, expect, it } from 'vitest';

import {
  canonicalizeActionName,
  expandActionNameAliases,
  normalizeActionNameList,
} from './types';

describe('action name canonicalization', () => {
  it('normalizes legacy role action names to canonical neutral names', () => {
    expect(canonicalizeActionName('opendev.plan')).toBe('architect.plan');
    expect(canonicalizeActionName('nemoclaw.review')).toBe('review.review');
    expect(canonicalizeActionName('openjarvis.ops')).toBe('operate.ops');
    expect(canonicalizeActionName('local.orchestrator.route')).toBe('coordinate.route');
    expect(canonicalizeActionName('local.orchestrator.all')).toBe('coordinate.all');
  });

  it('expands canonical and legacy aliases for the review lane', () => {
    expect(expandActionNameAliases('review.review')).toEqual(['review.review', 'nemoclaw.review']);
    expect(expandActionNameAliases('nemoclaw.review')).toEqual(['review.review', 'nemoclaw.review']);
  });

  it('deduplicates legacy and canonical aliases in allowlists and policy inputs', () => {
    expect(normalizeActionNameList([
      'review.review',
      'nemoclaw.review',
      'architect.plan',
      'opendev.plan',
      'coordinate.route',
      'local.orchestrator.route',
    ])).toEqual([
      'review.review',
      'architect.plan',
      'coordinate.route',
    ]);
  });
});