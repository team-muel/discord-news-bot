import { describe, it, expect } from 'vitest';
import { doc, ObsidianDocBuilder } from './obsidianDocBuilder';

describe('ObsidianDocBuilder', () => {
  it('builds a minimal document with title only', () => {
    const result = doc().title('Hello World').build();
    expect(result.markdown).toBe('# Hello World\n');
    expect(result.tags).toEqual([]);
    expect(result.links).toEqual([]);
  });

  it('sanitizes tags to lowercase alphanumeric', () => {
    const result = doc().tag('My Tag!', 'sprint-42', 'UPPER').build();
    expect(result.tags).toEqual(['my-tag-', 'sprint-42', 'upper']);
  });

  it('deduplicates tags', () => {
    const result = doc().tag('retro', 'retro', 'ops').build();
    expect(result.tags).toEqual(['retro', 'ops']);
  });

  it('sanitizes property keys', () => {
    const result = doc().property('my key!', 'val').build();
    expect(result.properties).toEqual({ my_key_: 'val' });
  });

  it('builds sections with bullets and lines', () => {
    const result = doc()
      .title('Test')
      .section('Overview')
      .line('First line')
      .bullet('Bullet one')
      .bullets(['B2', 'B3'])
      .build();

    expect(result.markdown).toContain('## Overview');
    expect(result.markdown).toContain('First line');
    expect(result.markdown).toContain('- Bullet one');
    expect(result.markdown).toContain('- B2');
    expect(result.markdown).toContain('- B3');
  });

  it('builds a markdown table', () => {
    const result = doc()
      .title('Report')
      .section('Data')
      .table(['Name', 'Value'], [['cpu', 90], ['mem', 70]])
      .build();

    expect(result.markdown).toContain('| Name | Value |');
    expect(result.markdown).toContain('|---|---|');
    expect(result.markdown).toContain('| cpu | 90 |');
    expect(result.markdown).toContain('| mem | 70 |');
  });

  it('skips table when headers are empty', () => {
    const result = doc()
      .section('Empty')
      .table([], [['a', 'b']])
      .build();

    expect(result.markdown).not.toContain('|');
  });

  it('generates typed links section', () => {
    const result = doc()
      .title('Retro')
      .link('plans/sprint-42', 'spawned-by')
      .link('retros/prev', 'follows')
      .build();

    expect(result.markdown).toContain('## Links');
    expect(result.markdown).toContain('- spawned-by: [[plans/sprint-42]]');
    expect(result.markdown).toContain('- follows: [[retros/prev]]');
    expect(result.links).toHaveLength(2);
    expect(result.links[0]).toMatchObject({
      target: 'plans/sprint-42',
      relationType: 'spawned-by',
      strength: 0.9,
    });
  });

  it('strips .md from link targets', () => {
    const result = doc().link('docs/NOTE.md', 'references').build();
    expect(result.links[0].target).toBe('docs/NOTE');
  });

  it('renders alias in wikilinks', () => {
    const result = doc()
      .link('long/path/to/doc', 'references', 'Short Name')
      .build();

    expect(result.markdown).toContain('[[long/path/to/doc|Short Name]]');
  });

  it('shorthand spawnedBy creates spawned-by link', () => {
    const result = doc().spawnedBy('plans/p1').build();
    expect(result.links[0]).toMatchObject({ relationType: 'spawned-by', strength: 0.9 });
  });

  it('shorthand follows creates follows link', () => {
    const result = doc().follows('retros/r1').build();
    expect(result.links[0]).toMatchObject({ relationType: 'follows', strength: 0.85 });
  });

  it('shorthand references creates references link', () => {
    const result = doc().references('docs/ref', 'My Ref').build();
    expect(result.links[0]).toMatchObject({ relationType: 'references', alias: 'My Ref', strength: 0.7 });
  });

  it('shorthand derivedFrom creates derived-from link', () => {
    const result = doc().derivedFrom('memory/raw-123', 'source').build();
    expect(result.links[0]).toMatchObject({ relationType: 'derived-from', strength: 0.9, alias: 'source' });
  });

  it('groups links by relation type', () => {
    const result = doc()
      .link('a', 'references')
      .link('b', 'spawned-by')
      .link('c', 'references')
      .build();

    const linesAfterLinks = result.markdown
      .split('## Links')[1]
      ?.split('\n')
      .filter((l) => l.startsWith('- '));

    expect(linesAfterLinks).toEqual([
      '- references: [[a]]',
      '- references: [[c]]',
      '- spawned-by: [[b]]',
    ]);
  });

  it('omits Links section when no links', () => {
    const result = doc().title('No Links').section('Content').line('text').build();
    expect(result.markdown).not.toContain('## Links');
  });

  it('returns structured properties', () => {
    const result = doc()
      .property('schema', 'retro/v1')
      .property('count', 42)
      .property('active', true)
      .build();

    expect(result.properties).toEqual({ schema: 'retro/v1', count: 42, active: true });
  });

  it('supports level 3 headings', () => {
    const result = doc().section('Sub', 3).line('detail').build();
    expect(result.markdown).toContain('### Sub');
  });

  it('handles lines() batch method', () => {
    const result = doc().section('Items').lines(['one', 'two', 'three']).build();
    expect(result.markdown).toContain('one\ntwo\nthree');
  });

  it('doc() factory returns fresh builder', () => {
    const a = doc().title('A').build();
    const b = doc().title('B').build();
    expect(a.markdown).toContain('# A');
    expect(b.markdown).toContain('# B');
    expect(a.markdown).not.toContain('B');
  });
});
