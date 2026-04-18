import fs from 'node:fs';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetObsidianVaultRuntimeInfo,
  mockReadObsidianFileWithAdapter,
} = vi.hoisted(() => ({
  mockGetObsidianVaultRuntimeInfo: vi.fn(),
  mockReadObsidianFileWithAdapter: vi.fn(),
}));

vi.mock('../../utils/obsidianEnv', () => ({
  getObsidianVaultRuntimeInfo: mockGetObsidianVaultRuntimeInfo,
}));

vi.mock('./router', () => ({
  readObsidianFileWithAdapter: mockReadObsidianFileWithAdapter,
}));

import {
  buildKnowledgeAccessProfile,
  buildKnowledgeCatalogCoverageAsync,
  catalogEntryMatchesChangedPath,
  selectKnowledgeBundleEntries,
} from './obsidianCatalogService';

const buildCatalog = () => ({
  schemaVersion: 3,
  updatedAt: '2026-04-18T00:00:00.000Z',
  description: 'test catalog',
  policy: {
    humanFirst: true,
    rules: ['prefer operator-primary docs'],
    avoidAsPrimary: ['ops/knowledge-control/INDEX.md'],
  },
  entries: [
    {
      id: 'control-blueprint',
      title: 'Blueprint',
      sourcePath: 'docs/control/BLUEPRINT.md',
      targetPath: 'ops/control-tower/BLUEPRINT.md',
      tags: ['control', 'start-here'],
      plane: 'control',
      concern: 'control-tower',
      intent: 'architecture',
      audience: 'operator-primary' as const,
      canonical: true,
      startHere: true,
      agentReference: true,
      queries: ['shared routing blueprint'],
    },
    {
      id: 'service-compile-spec',
      title: 'Knowledge Bundle Compile Spec',
      sourcePath: 'docs/planning/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md',
      targetPath: 'ops/services/unified-mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md',
      tags: ['knowledge', 'bundle', 'compile'],
      plane: 'runtime',
      concern: 'service-memory',
      intent: 'architecture',
      audience: 'shared' as const,
      canonical: false,
      startHere: false,
      agentReference: true,
      queries: ['knowledge bundle compile spec'],
    },
    {
      id: 'service-recovery-playbook',
      title: 'Recovery Playbook',
      sourcePath: 'docs/playbooks/unified-mcp-recovery.md',
      targetPath: 'ops/playbooks/unified-mcp-recovery.md',
      tags: ['recovery'],
      plane: 'runtime',
      concern: 'service-memory',
      intent: 'operations',
      audience: 'shared' as const,
      canonical: false,
      startHere: false,
      agentReference: true,
      queries: ['incident recovery'],
    },
    {
      id: 'service-profile',
      title: 'Runtime Profile',
      sourcePath: 'docs/services/unified-mcp-profile.md',
      targetPath: 'ops/services/unified-mcp/PROFILE.md',
      tags: ['runtime'],
      plane: 'runtime',
      concern: 'service-memory',
      intent: 'operations',
      audience: 'operator-primary' as const,
      canonical: true,
      startHere: false,
      agentReference: true,
      queries: ['runtime profile'],
    },
  ],
});

describe('obsidianCatalogService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    mockGetObsidianVaultRuntimeInfo.mockReturnValue({
      configured: true,
      root: '/vault',
      configuredName: 'Obsidian Vault',
      resolvedName: 'Obsidian Vault',
      exists: true,
      topLevelDirectories: ['ops', 'guilds'],
      topLevelFiles: [],
      looksLikeDesktopVault: true,
      looksLikeRepoDocs: false,
    });
    mockReadObsidianFileWithAdapter.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('goal/domain match가 강한 catalog entry를 우선 선택한다', () => {
    const selected = selectKnowledgeBundleEntries({
      catalog: buildCatalog(),
      goal: 'knowledge bundle compile spec for shared routing',
      domains: ['architecture'],
      maxArtifacts: 2,
    });

    expect(selected.map((entry) => entry.id)).toEqual([
      'service-compile-spec',
      'control-blueprint',
    ]);
  });

  it('관련 match가 부족하면 start-here와 canonical operator-primary entry로 fallback한다', () => {
    const selected = selectKnowledgeBundleEntries({
      catalog: buildCatalog(),
      goal: 'misc unrelated request',
      domains: [],
      maxArtifacts: 2,
    });

    expect(selected.map((entry) => entry.id)).toEqual([
      'control-blueprint',
      'service-profile',
    ]);
  });

  it('access profile은 catalog role별 path와 sync coverage를 유지한다', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => {
      const value = String(candidate).replace(/\\/g, '/');
      return value.endsWith('ops/control-tower/BLUEPRINT.md') || value.endsWith('ops/services/unified-mcp/PROFILE.md');
    });

    const profile = buildKnowledgeAccessProfile(buildCatalog());

    expect(profile.humanFirst).toBe(true);
    expect(profile.startHerePaths).toEqual(['ops/control-tower/BLUEPRINT.md']);
    expect(profile.operatorPrimaryPaths).toEqual([
      'ops/control-tower/BLUEPRINT.md',
      'ops/services/unified-mcp/PROFILE.md',
    ]);
    expect(profile.canonicalPaths).toEqual([
      'ops/control-tower/BLUEPRINT.md',
      'ops/services/unified-mcp/PROFILE.md',
    ]);
    expect(profile.coverage).toMatchObject({
      totalEntries: 4,
      presentEntries: 2,
      missingEntries: 2,
      operatorPrimaryEntries: 2,
      operatorPrimaryPresent: 2,
      startHereEntries: 1,
      startHerePresent: 1,
    });
  });

  it('async coverage는 파일시스템과 adapter visibility를 함께 반영한다', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => {
      return String(candidate).replace(/\\/g, '/').endsWith('ops/control-tower/BLUEPRINT.md');
    });
    mockReadObsidianFileWithAdapter.mockImplementation(async ({ filePath }: { filePath: string }) => {
      if (filePath === 'ops/playbooks/unified-mcp-recovery.md') {
        return '# Recovery Playbook';
      }
      return null;
    });

    const coverage = await buildKnowledgeCatalogCoverageAsync(buildCatalog().entries.slice(0, 3));

    expect(coverage).toMatchObject({
      totalEntries: 3,
      presentEntries: 2,
      missingEntries: 1,
      operatorPrimaryEntries: 1,
      operatorPrimaryPresent: 1,
      startHereEntries: 1,
      startHerePresent: 1,
    });
    expect(coverage.missingTargetPaths).toEqual([
      'ops/services/unified-mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md',
    ]);
    expect(mockReadObsidianFileWithAdapter).toHaveBeenCalledWith({
      vaultPath: '/vault',
      filePath: 'ops/playbooks/unified-mcp-recovery.md',
    });
  });

  it('changed path matching은 경로 구분자 차이를 정규화한다', () => {
    const entry = buildCatalog().entries[3];

    expect(catalogEntryMatchesChangedPath(entry, ['docs\\services\\unified-mcp-profile.md'])).toBe(true);
    expect(catalogEntryMatchesChangedPath(entry, ['docs/services/other.md'])).toBe(false);
  });
});