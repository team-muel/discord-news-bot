import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callIndexingMcpTool } from './indexingToolAdapter';
import { __resetCodeIndexCacheForTests } from '../services/opencode/codeIndexService';
import { stringifyJsonl } from '../services/securityCandidateContract';

const parseToolText = async (resultPromise: ReturnType<typeof callIndexingMcpTool>) => {
  const result = await resultPromise;
  expect(result.isError).toBeFalsy();
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text || '{}') as Record<string, unknown>;
};

describe('indexingToolAdapter', () => {
  let repoRoot = '';
  let secondaryRepoRoot = '';

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexing-mcp-'));
    await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(repoRoot, 'tmp', 'security-candidates'), { recursive: true });
    await fs.mkdir(path.join(repoRoot, '.git', 'refs', 'heads'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
    await fs.writeFile(path.join(repoRoot, '.git', 'refs', 'heads', 'main'), 'def456\n', 'utf8');

    await fs.writeFile(
      path.join(repoRoot, 'src', 'example.ts'),
      [
        "import { helperValue } from './support';",
        '',
        'export class ExampleService {',
        '  run(): string {',
        "    return helperValue;",
        '  }',
        '}',
        '',
        'export async function renderThing(input: string): Promise<string> {',
        '  return input.trim();',
        '}',
        '',
        'export const loadThing = async () => {',
        "  return renderThing('ok');",
        '};',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(repoRoot, 'src', 'support.ts'),
      [
        "export const helperValue = 'ready';",
        '',
        'export function useThing(): string {',
        "  return `${helperValue}:${renderThingLabel()}`;",
        '}',
        '',
        'function renderThingLabel(): string {',
        "  return 'label';",
        '}',
      ].join('\n'),
      'utf8',
    );

    await fs.writeFile(
      path.join(repoRoot, 'tmp', 'security-candidates', 'latest.jsonl'),
      stringifyJsonl([
        {
          id: 'cand-1',
          commitSha: 'abc123',
          filePath: 'src/example.ts',
          startLine: 9,
          endLine: 10,
          codeSnippet: 'export async function renderThing(input: string): Promise<string> {',
          ruleId: 'xss.review',
          fingerprint: 'fp-1',
          candidateKind: 'output-boundary-review',
        },
        {
          id: 'cand-2',
          commitSha: 'abc123',
          filePath: 'src/example.ts',
          startLine: 9,
          endLine: 10,
          codeSnippet: 'return input.trim();',
          ruleId: 'output.sanitization.review',
          fingerprint: 'fp-2',
          candidateKind: 'output-boundary-review',
        },
      ]),
      'utf8',
    );

    vi.stubEnv('INDEXING_MCP_REPO_ID', 'test-repo');
    vi.stubEnv('INDEXING_MCP_REPO_ROOT', repoRoot);
    __resetCodeIndexCacheForTests();
  });

  afterEach(async () => {
    __resetCodeIndexCacheForTests();
    vi.unstubAllEnvs();
    if (repoRoot) {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
    if (secondaryRepoRoot) {
      await fs.rm(secondaryRepoRoot, { recursive: true, force: true });
    }
  });

  it('symbol_search는 top-level 심볼을 찾는다', async () => {
    const payload = await parseToolText(callIndexingMcpTool({
      name: 'code.index.symbol_search',
      arguments: {
        repoId: 'test-repo',
        query: 'renderThing',
      },
    }));

    const items = Array.isArray(payload.items) ? payload.items : [];
    expect(items.length).toBeGreaterThan(0);
    expect(JSON.stringify(items[0])).toContain('renderThing');
    expect(payload).toHaveProperty('metadata.repoId', 'test-repo');
    expect(payload).toHaveProperty('metadata.indexVersion');
  });

  it('INDEXING_MCP_REPOS_JSON으로 복수 repo를 resolve한다', async () => {
    secondaryRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'indexing-mcp-shared-'));
    await fs.mkdir(path.join(secondaryRepoRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(secondaryRepoRoot, '.git', 'refs', 'heads'), { recursive: true });
    await fs.writeFile(path.join(secondaryRepoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
    await fs.writeFile(path.join(secondaryRepoRoot, '.git', 'refs', 'heads', 'main'), '987654\n', 'utf8');
    await fs.writeFile(
      path.join(secondaryRepoRoot, 'src', 'shared.ts'),
      [
        'export class SharedIndexService {',
        '  run(): string {',
        "    return 'shared';",
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    vi.stubEnv('INDEXING_MCP_REPOS_JSON', JSON.stringify([
      { repoId: 'test-repo-2', repoRoot: secondaryRepoRoot },
    ]));
    __resetCodeIndexCacheForTests();

    const payload = await parseToolText(callIndexingMcpTool({
      name: 'code.index.symbol_search',
      arguments: {
        repoId: 'test-repo-2',
        query: 'SharedIndexService',
      },
    }));

    expect(JSON.stringify(payload.items || [])).toContain('SharedIndexService');
    expect(payload).toHaveProperty('metadata.repoId', 'test-repo-2');
  });

  it('scope_read는 심볼 범위 스니펫을 반환한다', async () => {
    const search = await parseToolText(callIndexingMcpTool({
      name: 'code.index.symbol_search',
      arguments: {
        repoId: 'test-repo',
        query: 'renderThing',
      },
    }));
    const symbolId = String((Array.isArray(search.items) ? search.items[0] : { symbolId: '' }).symbolId || '');

    const payload = await parseToolText(callIndexingMcpTool({
      name: 'code.index.scope_read',
      arguments: {
        repoId: 'test-repo',
        filePath: 'src/example.ts',
        symbolId,
      },
    }));

    expect(String(payload.snippet || '')).toContain('export async function renderThing');
  });

  it('symbol_references는 단순 참조를 찾는다', async () => {
    const search = await parseToolText(callIndexingMcpTool({
      name: 'code.index.symbol_search',
      arguments: {
        repoId: 'test-repo',
        query: 'renderThing',
      },
    }));
    const symbolId = String((Array.isArray(search.items) ? search.items[0] : { symbolId: '' }).symbolId || '');

    const payload = await parseToolText(callIndexingMcpTool({
      name: 'code.index.symbol_references',
      arguments: {
        repoId: 'test-repo',
        symbolId,
      },
    }));

    expect(JSON.stringify(payload.items || [])).toContain("renderThing('ok')");
    expect(JSON.stringify(payload.items || [])).toContain('"kind":"call"');
  });

  it('security.candidates_list는 JSONL 후보군을 읽는다', async () => {
    const payload = await parseToolText(callIndexingMcpTool({
      name: 'security.candidates_list',
      arguments: {
        repoId: 'test-repo',
      },
    }));

    expect(JSON.stringify(payload.items || [])).toContain('cand-1');
    expect(payload).toHaveProperty('metadata.commitSha', 'abc123');
  });

  it('security.candidates_list는 merged 뷰를 반환할 수 있다', async () => {
    const payload = await parseToolText(callIndexingMcpTool({
      name: 'security.candidates_list',
      arguments: {
        repoId: 'test-repo',
        commitSha: 'abc123',
        view: 'merged',
      },
    }));

    expect(payload).toHaveProperty('view', 'merged');
    expect(payload).toHaveProperty('mergedCount', 1);
    expect(JSON.stringify(payload.items || [])).toContain('rawCandidateIds');
  });

  it('fail-closed 정책은 commit mismatch를 차단한다', async () => {
    vi.stubEnv('INDEXING_MCP_STALE_POLICY', 'fail');

    const result = await callIndexingMcpTool({
      name: 'code.index.symbol_search',
      arguments: {
        repoId: 'test-repo',
        commitSha: 'wrong-commit',
        query: 'renderThing',
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text || '').toContain('commitSha mismatch');
  });

  it('malformed candidate JSONL은 오류로 노출한다', async () => {
    await fs.writeFile(path.join(repoRoot, 'tmp', 'security-candidates', 'latest.jsonl'), '{bad-json}', 'utf8');
    __resetCodeIndexCacheForTests();

    const result = await callIndexingMcpTool({
      name: 'security.candidates_list',
      arguments: {
        repoId: 'test-repo',
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text || '').toContain('invalid security candidate JSONL');
  });
});