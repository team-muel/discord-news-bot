import { describe, it, expect } from 'vitest';
import { summarizeChange, buildStructuralDiffSection } from './sprintDiffSummarizer';
import type { CodeChange } from './sprintCodeWriter';

describe('sprintDiffSummarizer', () => {
  const makeChange = (original: string, modified: string, filePath = 'src/test.ts'): CodeChange => ({
    filePath,
    originalContent: original,
    newContent: modified,
  });

  describe('summarizeChange', () => {
    it('detects added exports', () => {
      const change = makeChange(
        'export const foo = 1;',
        'export const foo = 1;\nexport const bar = 2;',
      );
      const result = summarizeChange(change);
      expect(result.signatureChanges).toContain('+ export bar');
    });

    it('detects removed imports', () => {
      const change = makeChange(
        "import { a } from 'mod-a';\nimport { b } from 'mod-b';",
        "import { a } from 'mod-a';",
      );
      const result = summarizeChange(change);
      expect(result.signatureChanges).toContain("- import from 'mod-b'");
    });

    it('detects function signature changes', () => {
      const change = makeChange(
        'export function handle(req: Request): void {}',
        'export function handle(req: Request): Promise<void> {}\nexport function validate(input: string): boolean {}',
      );
      const result = summarizeChange(change);
      expect(result.signatureChanges.some((s) => s.includes('validate'))).toBe(true);
    });

    it('computes line stats', () => {
      const change = makeChange('a\nb\nc', 'a\nb\nc\nd\ne');
      const result = summarizeChange(change);
      expect(result.stats.linesAdded).toBe(2);
      expect(result.stats.totalNewLines).toBe(5);
    });

    it('respects headBudget', () => {
      const longContent = 'x'.repeat(5000);
      const change = makeChange('', longContent);
      const result = summarizeChange(change, 100);
      expect(result.headContent.length).toBe(100);
    });

    it('handles empty original (new file)', () => {
      const change = makeChange('', 'export const newThing = true;');
      const result = summarizeChange(change);
      expect(result.signatureChanges).toContain('+ export newThing');
      expect(result.stats.linesRemoved).toBe(0);
    });

    it('detects class changes', () => {
      const change = makeChange(
        'export class Foo {}',
        'export class Foo extends Bar {}',
      );
      const result = summarizeChange(change);
      expect(result.signatureChanges.some((s) => s.includes('class') && s.includes('Bar'))).toBe(true);
    });
  });

  describe('buildStructuralDiffSection', () => {
    it('returns empty for no changes', () => {
      expect(buildStructuralDiffSection([])).toBe('');
    });

    it('includes file path and stats', () => {
      const changes: CodeChange[] = [makeChange('a', 'a\nb\nc', 'src/services/foo.ts')];
      const section = buildStructuralDiffSection(changes);
      expect(section).toContain('src/services/foo.ts');
      expect(section).toContain('Lines:');
    });

    it('includes signature changes when present', () => {
      const changes: CodeChange[] = [
        makeChange(
          'export const old = 1;',
          'export const old = 1;\nexport const added = 2;',
          'src/test.ts',
        ),
      ];
      const section = buildStructuralDiffSection(changes);
      expect(section).toContain('Signature changes');
      expect(section).toContain('+ export added');
    });

    it('respects total budget across multiple files', () => {
      const changes: CodeChange[] = Array.from({ length: 5 }, (_, i) =>
        makeChange('old', 'x'.repeat(3000), `src/file${i}.ts`),
      );
      const section = buildStructuralDiffSection(changes, 6000);
      expect(section.length).toBeLessThan(8000);
    });
  });
});
