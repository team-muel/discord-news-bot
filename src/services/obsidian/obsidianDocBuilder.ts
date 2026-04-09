/**
 * obsidianDocBuilder.ts — Structured Obsidian document assembly.
 *
 * Replaces ad-hoc string concatenation with a composable builder that:
 * - Manages frontmatter properties and tags as structured data
 * - Auto-generates wikilink backlinks between related documents
 * - Classifies relation types for graph links
 * - Produces consistent, well-formed Obsidian markdown
 */

import type { ObsidianFrontmatterValue } from './types';

export type ObsidianRelationType =
  | 'spawned-by'    // retro spawned by plan
  | 'follows'       // plan → implement → review flow
  | 'references'    // cites another document
  | 'related'       // general association
  | 'supersedes'    // ADR replaces prior ADR
  | 'caused'        // incident caused postmortem
  | 'fixed-in'      // bug fixed in sprint
  | 'derived-from'; // consolidated memory from raw sources

export type ObsidianLink = {
  target: string;           // vault-relative path without .md
  alias?: string;           // display text: [[target|alias]]
  relationType: ObsidianRelationType;
  strength?: number;        // 0.0–1.0, default by relation type
};

const DEFAULT_STRENGTH: Record<ObsidianRelationType, number> = {
  'spawned-by': 0.9,
  'follows':    0.85,
  'references': 0.7,
  'related':    0.6,
  'supersedes': 0.95,
  'caused':     0.9,
  'fixed-in':   0.85,
  'derived-from': 0.9,
};

const sanitizePropertyKey = (value: string): string => value.replace(/[^a-zA-Z0-9_]/g, '_');

const serializeFrontmatterItem = (value: string): string => {
  const normalized = String(value || '').trim();
  if (!normalized) return "''";
  if (/^[a-zA-Z0-9_./:-]+$/.test(normalized)) {
    return normalized;
  }
  return JSON.stringify(normalized);
};

export const serializeObsidianFrontmatterValue = (value: ObsidianFrontmatterValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => serializeFrontmatterItem(entry)).join(', ')}]`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return serializeFrontmatterItem(value);
};

export const buildObsidianFrontmatter = (params: {
  tags?: string[];
  properties?: Record<string, ObsidianFrontmatterValue | null | undefined>;
}): string => {
  const fmLines: string[] = ['---'];
  const entries = Object.entries(params.properties || {})
    .filter(([, value]) => value !== null && value !== undefined);

  for (const [key, value] of entries) {
    fmLines.push(`${sanitizePropertyKey(key)}: ${serializeObsidianFrontmatterValue(value as ObsidianFrontmatterValue)}`);
  }

  const tags = [...new Set((params.tags || []).map((tag) => String(tag || '').trim()).filter(Boolean))];
  if (tags.length > 0) {
    fmLines.push(`tags: ${serializeObsidianFrontmatterValue(tags)}`);
  }

  fmLines.push('---');
  return fmLines.join('\n');
};

export const hasObsidianFrontmatter = (markdown: string): boolean => /^---\n[\s\S]*?\n---\n?/.test(String(markdown || ''));

export class ObsidianDocBuilder {
  private _title = '';
  private _tags: Set<string> = new Set();
  private _properties: Map<string, ObsidianFrontmatterValue> = new Map();
  private _sections: Array<{ heading: string; level: number; content: string[] }> = [];
  private _links: ObsidianLink[] = [];
  private _currentSection: { heading: string; level: number; content: string[] } | null = null;

  title(value: string): this {
    this._title = value;
    return this;
  }

  tag(...tags: string[]): this {
    for (const t of tags) {
      const safe = t.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      if (safe) this._tags.add(safe);
    }
    return this;
  }

  property(key: string, value: ObsidianFrontmatterValue): this {
    const safeKey = sanitizePropertyKey(key);
    this._properties.set(safeKey, value);
    return this;
  }

  section(heading: string, level: 2 | 3 = 2): this {
    this._flushSection();
    this._currentSection = { heading, level, content: [] };
    return this;
  }

  line(text: string): this {
    if (this._currentSection) {
      this._currentSection.content.push(text);
    }
    return this;
  }

  lines(texts: string[]): this {
    for (const t of texts) this.line(t);
    return this;
  }

  bullet(text: string): this {
    return this.line(`- ${text}`);
  }

  bullets(texts: string[]): this {
    for (const t of texts) this.bullet(t);
    return this;
  }

  table(headers: string[], rows: (string | number)[][]): this {
    if (headers.length === 0) return this;
    this.line('');
    this.line(`| ${headers.join(' | ')} |`);
    this.line(`|${headers.map(() => '---').join('|')}|`);
    for (const row of rows) {
      this.line(`| ${row.join(' | ')} |`);
    }
    this.line('');
    return this;
  }

  /** Add a wikilink with typed relation for graph tracking. */
  link(target: string, relationType: ObsidianRelationType = 'related', alias?: string): this {
    this._links.push({
      target: target.replace(/\.md$/i, ''),
      alias,
      relationType,
      strength: DEFAULT_STRENGTH[relationType],
    });
    return this;
  }

  /** Shorthand: link back to the plan that spawned this document. */
  spawnedBy(planPath: string): this {
    return this.link(planPath, 'spawned-by');
  }

  /** Shorthand: this document follows another in a workflow sequence. */
  follows(prevPath: string): this {
    return this.link(prevPath, 'follows');
  }

  /** Shorthand: link to a reference document. */
  references(refPath: string, alias?: string): this {
    return this.link(refPath, 'references', alias);
  }

  /** Shorthand: this document was derived from source documents. */
  derivedFrom(sourcePath: string, alias?: string): this {
    return this.link(sourcePath, 'derived-from', alias);
  }

  /** Build the final markdown string. */
  build(): { markdown: string; tags: string[]; properties: Record<string, ObsidianFrontmatterValue>; links: ObsidianLink[] } {
    this._flushSection();

    const parts: string[] = [];

    // Title
    if (this._title) {
      parts.push(`# ${this._title}`, '');
    }

    // Sections
    for (const section of this._sections) {
      const prefix = '#'.repeat(section.level);
      parts.push(`${prefix} ${section.heading}`, '');
      parts.push(...section.content);
      parts.push('');
    }

    // Auto-generated links section (if any typed links exist)
    if (this._links.length > 0) {
      parts.push('## Links', '');
      // Group by relation type for readability
      const grouped = new Map<ObsidianRelationType, ObsidianLink[]>();
      for (const link of this._links) {
        const group = grouped.get(link.relationType) || [];
        group.push(link);
        grouped.set(link.relationType, group);
      }
      for (const [relType, links] of grouped) {
        for (const link of links) {
          const wikilink = link.alias ? `[[${link.target}|${link.alias}]]` : `[[${link.target}]]`;
          parts.push(`- ${relType}: ${wikilink}`);
        }
      }
      parts.push('');
    }

    const tags = [...this._tags];
    const properties: Record<string, ObsidianFrontmatterValue> = {};
    for (const [k, v] of this._properties) {
      properties[k] = v;
    }

    return {
      markdown: parts.join('\n').trimEnd() + '\n',
      tags,
      properties,
      links: this._links,
    };
  }

  /**
   * Build with YAML frontmatter included in the markdown output.
   * Use for scripts that write directly to filesystem (e.g., sync-obsidian-code-map).
   * Tags are emitted as a YAML array inside the frontmatter block.
   */
  buildWithFrontmatter(): { markdown: string; tags: string[]; properties: Record<string, ObsidianFrontmatterValue>; links: ObsidianLink[] } {
    const result = this.build();
    const frontmatter = buildObsidianFrontmatter({
      properties: result.properties,
      tags: result.tags,
    });
    return { ...result, markdown: `${frontmatter}\n\n${result.markdown}` };
  }

  private _flushSection(): void {
    if (this._currentSection) {
      this._sections.push(this._currentSection);
      this._currentSection = null;
    }
  }
}

/** Create a new document builder. */
export const doc = (): ObsidianDocBuilder => new ObsidianDocBuilder();
