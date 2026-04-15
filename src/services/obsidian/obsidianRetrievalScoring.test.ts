import { describe, expect, it } from 'vitest';

import { assessRetrievalMetadata, rankDocumentsForRetrieval, type RetrievedDocumentCandidate } from './obsidianRetrievalScoring';

describe('obsidianRetrievalScoring', () => {
  it('marks superseded and invalid documents while boosting grounded successors', () => {
    const documents = new Map([
      ['docs/old.md', {
        content: '# Old',
        frontmatter: {
          status: 'active',
          invalid_at: '2024-01-01T00:00:00.000Z',
          source_refs: ['raw/1.md'],
        },
      }],
      ['docs/new.md', {
        content: '# New',
        frontmatter: {
          status: 'active',
          valid_at: '2999-01-01T00:00:00.000Z',
          supersedes: ['docs/old.md'],
          source_refs: ['raw/1.md', 'raw/2.md'],
        },
      }],
    ]);

    const assessment = assessRetrievalMetadata(documents);

    expect(assessment.summary).toEqual({
      activeDocs: 2,
      invalidDocs: 1,
      supersededDocs: 1,
      sourcedDocs: 2,
    });
    expect(assessment.adjustments.get('docs/old.md')).toBeLessThan(assessment.adjustments.get('docs/new.md') || 0);
  });

  it('applies metadata and connectivity boosts when ranking results', () => {
    const documents = new Map([
      ['docs/a.md', { content: '# A', frontmatter: { status: 'active' } }],
      ['docs/b.md', { content: '# B', frontmatter: { status: 'active', source_refs: ['raw/1.md'] } }],
      ['docs/c.md', { content: '# C', frontmatter: { status: 'active' } }],
    ]);
    const candidates: RetrievedDocumentCandidate[] = [
      { filePath: 'docs/a.md', score: 0.7 },
      { filePath: 'docs/b.md', score: 0.68 },
      { filePath: 'docs/c.md', score: 0.66 },
    ];

    const ranked = rankDocumentsForRetrieval({
      documents,
      candidates,
      graphMetadata: {
        'docs/a.md': { backlinks: [], links: [] },
        'docs/b.md': { backlinks: ['docs/a.md', 'docs/c.md'], links: ['docs/a.md'] },
        'docs/c.md': { backlinks: [], links: ['docs/b.md'] },
      },
      metadataAdjustments: new Map([
        ['docs/a.md', 0],
        ['docs/b.md', 0.1],
        ['docs/c.md', 0],
      ]),
      limit: 2,
    });

    expect([...ranked.keys()]).toEqual(['docs/b.md', 'docs/c.md']);
  });
});