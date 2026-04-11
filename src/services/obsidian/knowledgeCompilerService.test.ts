import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListFiles,
  mockReadFile,
  mockSearchVault,
  mockGetAdapterRuntimeStatus,
  mockGetLatestGraphAudit,
  mockWriteNote,
} = vi.hoisted(() => ({
  mockListFiles: vi.fn(),
  mockReadFile: vi.fn(),
  mockSearchVault: vi.fn(),
  mockGetAdapterRuntimeStatus: vi.fn(),
  mockGetLatestGraphAudit: vi.fn(),
  mockWriteNote: vi.fn(),
}));

vi.mock('./router', () => ({
  getObsidianAdapterRuntimeStatus: mockGetAdapterRuntimeStatus,
  listObsidianFilesWithAdapter: mockListFiles,
  readObsidianFileWithAdapter: mockReadFile,
  searchObsidianVaultWithAdapter: mockSearchVault,
  writeObsidianNoteWithAdapter: mockWriteNote,
}));

vi.mock('../../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: vi.fn().mockReturnValue('/vault'),
  getObsidianVaultRuntimeInfo: vi.fn().mockReturnValue({
    configured: true,
    root: '/vault',
    configuredName: 'Obsidian Vault',
    resolvedName: 'Obsidian Vault',
    exists: true,
    topLevelDirectories: ['chat', 'guilds', 'ops'],
    topLevelFiles: [],
    looksLikeDesktopVault: true,
    looksLikeRepoDocs: false,
  }),
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./obsidianQualityService', () => ({
  getLatestObsidianGraphAuditSnapshot: mockGetLatestGraphAudit,
}));

describe('knowledgeCompilerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetAdapterRuntimeStatus.mockReturnValue({
      strictMode: false,
      configuredOrder: ['remote-mcp', 'local-fs'],
      configuredOrderByCapability: {},
      effectiveOrderByCapability: {},
      adapters: [
        { id: 'remote-mcp', available: true, capabilities: ['search_vault', 'read_file'], deprioritized: false },
        { id: 'local-fs', available: true, capabilities: ['search_vault', 'read_file'], deprioritized: false },
      ],
      selectedByCapability: {
        search_vault: 'remote-mcp',
        read_file: 'remote-mcp',
      },
      routingState: { remoteMcpCircuitOpen: false, remoteMcpCircuitReason: null },
      remoteMcp: {},
      vault: {
        configured: true,
        root: '/vault',
        configuredName: 'Obsidian Vault',
        resolvedName: 'Obsidian Vault',
        exists: true,
        topLevelDirectories: ['chat', 'guilds', 'ops'],
        topLevelFiles: [],
        looksLikeDesktopVault: true,
        looksLikeRepoDocs: false,
      },
    });

    mockGetLatestGraphAudit.mockResolvedValue({
      generatedAt: '2026-04-11T00:00:00.000Z',
      vaultPath: '/vault',
      totals: { files: 100, unresolvedLinks: 2, ambiguousLinks: 0, orphanFiles: 5, deadendFiles: 3, missingRequiredPropertyFiles: 1 },
      topTags: [{ tag: 'architecture', count: 20 }],
      thresholds: { unresolvedLinks: 10, ambiguousLinks: 5, orphanFiles: 20, deadendFiles: 10, missingRequiredPropertyFiles: 5 },
      pass: true,
    });

    mockListFiles.mockImplementation(async (_vaultPath: string, folder?: string) => {
      if (folder === 'guilds/guild-1/chat/answers') {
        return [
          { filePath: 'guilds/guild-1/chat/answers/2026-04-09/current.md', name: 'current', extension: 'md', sizeBytes: 0, modifiedAt: 20 },
          { filePath: 'guilds/guild-1/chat/answers/2026-04-09/previous.md', name: 'previous', extension: 'md', sizeBytes: 0, modifiedAt: 10 },
        ];
      }
      return [];
    });

    mockSearchVault.mockImplementation(async ({ query }: { query: string }) => {
      if (/shared|company|routing|mcp/i.test(query)) {
        return [
          { filePath: 'ops/control-tower/BLUEPRINT.md', title: 'Shared Knowledge Routing', score: 0.93 },
        ];
      }
      if (/incident|outage|recovery|rollback/i.test(query)) {
        return [
          { filePath: 'ops/incidents/2026-04-11_unified-mcp-routing.md', title: 'Unified MCP Routing Incident', score: 0.91 },
          { filePath: 'ops/playbooks/unified-mcp-recovery.md', title: 'Unified MCP Recovery', score: 0.86 },
          { filePath: 'ops/improvement/unified-mcp-routing-hardening.md', title: 'Unified MCP Routing Hardening', score: 0.81 },
        ];
      }
      return [];
    });

    mockReadFile.mockImplementation(async ({ filePath }: { filePath: string }) => {
      if (filePath === 'guilds/guild-1/chat/answers/2026-04-09/previous.md') {
        return [
          '---',
          'title: Previous answer',
          'schema: chat-answer/v1',
          'source: api-chat',
          'created: 2026-04-09T00:00:00.000Z',
          'observed_at: 2026-04-09T00:00:00.000Z',
          'status: answered',
          'canonical_key: chat/thread-1',
          'retrieval_intent: development',
          'source_refs: [chat/inbox/2026-04-09/thread-root.md]',
          'tags: [chat, answer, external-query]',
          '---',
          '',
          '# Previous answer',
          '',
          'Earlier answer body.',
        ].join('\n');
      }
      if (filePath === 'ops/control-tower/BLUEPRINT.md') {
        return [
          '---',
          'title: Shared Knowledge Routing',
          'status: active',
          'canonical_key: control/shared-knowledge-routing',
          'source_refs: [docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md]',
          '---',
          '',
          '# Shared Knowledge Routing',
          '',
          'Prefer shared MCP and shared Obsidian before repo-local archaeology.',
        ].join('\n');
      }
      if (filePath === 'ops/incidents/2026-04-11_unified-mcp-routing.md') {
        return [
          '---',
          'title: Unified MCP Routing Incident',
          'status: active',
          'canonical_key: incident/unified-mcp-routing',
          'source_refs: [ops/services/unified-mcp/PROFILE.md, ops/playbooks/unified-mcp-recovery.md]',
          'supersedes: [ops/incidents/2026-04-10_unified-mcp-routing.md]',
          '---',
          '',
          '# Unified MCP Routing Incident',
          '',
          'Routing degraded before the documented fallback path engaged.',
        ].join('\n');
      }
      if (filePath === 'ops/playbooks/unified-mcp-recovery.md') {
        return [
          '---',
          'title: Unified MCP Recovery',
          'status: active',
          'canonical_key: playbook/unified-mcp-recovery',
          'source_refs: [ops/incidents/2026-04-11_unified-mcp-routing.md]',
          '---',
          '',
          '# Unified MCP Recovery',
          '',
          'Recovery sequence for Unified MCP worker and routing fallback.',
        ].join('\n');
      }
      if (filePath === 'ops/improvement/unified-mcp-routing-hardening.md') {
        return [
          '---',
          'title: Unified MCP Routing Hardening',
          'status: active',
          'canonical_key: improvement/unified-mcp-routing-hardening',
          'source_refs: [ops/incidents/2026-04-11_unified-mcp-routing.md]',
          '---',
          '',
          '# Unified MCP Routing Hardening',
          '',
          'Hardening follow-up after the routing outage.',
        ].join('\n');
      }
      if (filePath === 'ops/services/unified-mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md') {
        return [
          '---',
          'title: Knowledge Bundle Compile Spec',
          'status: active',
          'canonical_key: service-mcp-knowledge-bundle-compile-spec',
          'source_refs: [docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md]',
          '---',
          '',
          '# Knowledge Bundle Compile Spec',
          '',
          'Canonical shared wiki object for the MCP tool contract.',
        ].join('\n');
      }
      return null;
    });

    mockWriteNote.mockImplementation(async ({ fileName }: { fileName: string }) => ({ path: fileName }));
  });

  it('rebuilds index, log, topic, and entity artifacts for knowledge-bearing notes', async () => {
    const {
      buildObsidianKnowledgeReflectionBundle,
      captureObsidianWikiChange,
      compileObsidianRequirement,
      compileObsidianKnowledgeBundle,
      getObsidianKnowledgeCompilationStats,
      getObsidianKnowledgeControlSurface,
      promoteKnowledgeToObsidian,
      resolveObsidianIncidentGraph,
      resolveInternalKnowledge,
      resolveObsidianKnowledgeArtifactPath,
      runObsidianSemanticLintAudit,
      traceObsidianDecision,
      runKnowledgeCompilationForNote,
    } = await import('./knowledgeCompilerService');

    const result = await runKnowledgeCompilationForNote({
      guildId: 'guild-1',
      vaultPath: '/vault',
      filePath: 'guilds/guild-1/chat/answers/2026-04-09/current.md',
      content: [
        '---',
        'title: Current answer',
        'schema: chat-answer/v1',
        'source: api-chat',
        'created: 2026-04-09T00:10:00.000Z',
        'observed_at: 2026-04-09T00:10:00.000Z',
        'status: answered',
        'canonical_key: chat/thread-1',
        'retrieval_intent: development',
        'source_refs: [chat/inbox/2026-04-09/thread-root.md, guilds/guild-1/chat/context.md]',
        'tags: [chat, answer, external-query]',
        '---',
        '',
        '# Current answer',
        '',
        'Current answer body.',
      ].join('\n'),
    });

    expect(result.compiled).toBe(true);
    expect(result.indexedNotes).toBe(2);
    expect(result.topics).toContain('development');
    expect(result.entityKey).toBe('chat/thread-1');
    expect(mockWriteNote).toHaveBeenCalledTimes(5);

    const writtenPaths = mockWriteNote.mock.calls.map((call) => call[0].fileName);
    expect(writtenPaths).toContain('ops/knowledge-control/INDEX.md');
    expect(writtenPaths).toContain('ops/knowledge-control/LOG.md');
    expect(writtenPaths).toContain('ops/knowledge-control/LINT.md');
    expect(writtenPaths).toContain('ops/knowledge-control/topics/development.md');
    expect(writtenPaths).toContain('ops/knowledge-control/entities/chat-thread-1.md');

    const entityWrite = mockWriteNote.mock.calls.find((call) => call[0].fileName === 'ops/knowledge-control/entities/chat-thread-1.md');
    expect(entityWrite?.[0]?.content).toContain('Current answer');
    expect(entityWrite?.[0]?.content).toContain('thread-root');
    expect(entityWrite?.[0]?.skipKnowledgeCompilation).toBe(true);

    const lintWrite = mockWriteNote.mock.calls.find((call) => call[0].fileName === 'ops/knowledge-control/LINT.md');
    expect(lintWrite?.[0]?.content).toContain('No lint issues detected.');
    expect(lintWrite?.[0]?.skipKnowledgeCompilation).toBe(true);

    expect(result.artifacts).toContain('ops/knowledge-control/LINT.md');

    const stats = getObsidianKnowledgeCompilationStats();
    expect(stats.lastLintSummary).toMatchObject({
      issueCount: 0,
      missingSourceRefs: 0,
      staleActiveNotes: 0,
      invalidLifecycleNotes: 0,
      canonicalCollisions: 0,
    });

    const surface = getObsidianKnowledgeControlSurface();
    expect(surface.controlPaths).toContain('ops/control-tower/BLUEPRINT.md');
    expect(surface.blueprint).toMatchObject({
      model: '4-plane-control-tower',
      reflectionChecklist: expect.arrayContaining(['search visibility verified in the user-visible vault']),
    });
    expect(surface.backfillCatalog).toMatchObject({
      schemaVersion: 3,
      policy: {
        humanFirst: true,
      },
    });
    expect(surface.backfillCatalog.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'control-architecture-index', targetPath: 'ops/control-tower/ARCHITECTURE_INDEX.md', audience: 'operator-primary' }),
      expect.objectContaining({ id: 'control-decision-table', targetPath: 'ops/quality/DECISION_TABLE.md', canonical: true }),
    ]));
    expect(surface.accessProfile).toMatchObject({
      humanFirst: true,
      startHerePaths: expect.arrayContaining(['ops/control-tower/BLUEPRINT.md', 'ops/control-tower/GATE_ENTRYPOINTS.md']),
      operatorPrimaryPaths: expect.arrayContaining(['ops/control-tower/ARCHITECTURE_INDEX.md', 'ops/control-tower/OBSIDIAN_OPERATING_SYSTEM.md']),
      agentReferencePaths: expect.arrayContaining(['ops/improvement/rules/knowledge-reflection-pipeline.md']),
      avoidAsPrimary: expect.arrayContaining(['ops/knowledge-control/INDEX.md']),
      coverage: expect.objectContaining({
        totalEntries: surface.backfillCatalog.entries.length,
      }),
    });
    expect(surface.bundleSupport).toMatchObject({
      enabled: true,
      queryParam: 'bundleFor',
    });
    expect(surface.pathIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'ops/control-tower/BLUEPRINT.md', plane: 'control', concern: 'control-tower', generated: false }),
      expect.objectContaining({ path: 'ops/knowledge-control/INDEX.md', plane: 'record', concern: 'knowledge-control', generated: true }),
    ]));
    expect(resolveObsidianKnowledgeArtifactPath('blueprint')).toBe('ops/control-tower/BLUEPRINT.md');
    expect(resolveObsidianKnowledgeArtifactPath('canonical-map')).toBe('ops/control-tower/CANONICAL_MAP.md');

    const bundle = buildObsidianKnowledgeReflectionBundle('ops/services/unified-mcp/PROFILE.md');
    expect(bundle).toMatchObject({
      targetPath: 'ops/services/unified-mcp/PROFILE.md',
      plane: 'runtime',
      concern: 'service-memory',
      requiredPaths: expect.arrayContaining(['ops/services/unified-mcp/PROFILE.md', 'ops/knowledge-control/INDEX.md', 'ops/knowledge-control/LOG.md']),
      gatePaths: expect.arrayContaining(['ops/control-tower/GATE_ENTRYPOINTS.md', 'ops/quality/gates/2026-04-10_visible-reflection-gate.md']),
    });
    expect(bundle?.suggestedPatterns).toContain('ops/services/unified-mcp/DEPENDENCY_MAP.md');

    const guildBundle = buildObsidianKnowledgeReflectionBundle('guilds/123456789012345678/events/ingest/discord_topology_2026-04-10.md');
    expect(guildBundle).toMatchObject({
      plane: 'record',
      concern: 'guild-memory',
      customerImpact: false,
    });
    expect(guildBundle?.suggestedPaths).toContain('guilds/123456789012345678/Guild_Lore.md');

    const journalBundle = buildObsidianKnowledgeReflectionBundle('guilds/123456789012345678/sprint-journal/20260410_sprint-demo.md');
    expect(journalBundle).toMatchObject({
      plane: 'learning',
      concern: 'recursive-improvement',
      customerImpact: false,
    });
    expect(journalBundle?.suggestedPaths).toContain('ops/improvement/rules/knowledge-reflection-pipeline.md');

    const compiledBundle = await compileObsidianKnowledgeBundle({
      goal: 'knowledge bundle compile spec',
      domains: ['architecture'],
      sourceHints: ['obsidian'],
      explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
      maxArtifacts: 4,
      maxFacts: 6,
    });
    expect(compiledBundle.summary).toContain('Compiled');
    expect(compiledBundle.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRole: 'trigger',
        locator: 'https://www.anthropic.com/engineering/managed-agents',
      }),
      expect.objectContaining({
        title: 'Knowledge Bundle Compile Spec',
        artifactType: 'obsidian-note',
        locator: 'ops/services/unified-mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md',
      }),
    ]));
    expect(compiledBundle.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ gapType: 'promotion-needed' }),
    ]));
    expect(compiledBundle.inputs.explicitSources).toEqual(['https://www.anthropic.com/engineering/managed-agents']);
    expect(compiledBundle.resolutionTrace).toContain('explicit-source');
    expect(compiledBundle.resolutionTrace).toContain('repo-docs');

    const internalKnowledge = await resolveInternalKnowledge({
      goal: 'shared internal knowledge routing',
      targets: ['shared MCP', 'company-context'],
      sourceHints: ['obsidian'],
    });
    expect(internalKnowledge.preferredPath).toBe('shared-mcp-internal');
    expect(internalKnowledge.accessNotes).toEqual(expect.arrayContaining([
      expect.stringContaining('shared MCP-backed Obsidian adapter'),
      expect.stringContaining('shared MCP internal knowledge surface'),
    ]));
    expect(internalKnowledge.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactType: 'obsidian-note', locator: 'ops/control-tower/BLUEPRINT.md' }),
    ]));
    expect(internalKnowledge.gaps.some((gap) => gap.gapType === 'access')).toBe(false);

    const compiledRequirement = await compileObsidianRequirement({
      objective: 'Implement shared MCP and Obsidian-first routing without local markdown-first regressions',
      targets: ['knowledge bundle compile spec', 'shared MCP'],
      sourceHints: ['obsidian'],
      explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
      desiredArtifact: 'requirement',
      promoteImmediately: true,
    });
    expect(compiledRequirement.problem).toContain('Implement shared MCP');
    expect(compiledRequirement.workflows).toEqual(expect.arrayContaining([
      'shared MCP routing and internal knowledge resolution',
      'shared Obsidian wikiization and backfill',
    ]));
    expect(compiledRequirement.recommendedNextArtifacts).toEqual(expect.arrayContaining([
      expect.stringContaining('requirement:'),
    ]));
    expect(compiledRequirement.sourceArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRole: 'trigger',
        locator: 'https://www.anthropic.com/engineering/managed-agents',
      }),
    ]));
    expect(compiledRequirement.promotion).toMatchObject({
      requested: true,
      written: true,
    });
    expect(compiledRequirement.promotion?.writtenPath).toContain('plans/requirements/');
    expect(mockWriteNote).toHaveBeenCalledWith(expect.objectContaining({
      fileName: expect.stringContaining('plans/requirements/'),
    }));
    const promotedRequirementWrite = mockWriteNote.mock.calls.find((call) => String(call[0]?.fileName || '').includes('plans/requirements/'));
    expect(promotedRequirementWrite?.[0]?.content).toContain('## Source Artifacts');
    expect(promotedRequirementWrite?.[0]?.content).toContain('[trigger] anthropic.com/engineering/managed-agents');

    const promotedKnowledge = await promoteKnowledgeToObsidian({
      artifactKind: 'note',
      title: 'Shared Routing',
      content: 'Promoted shared routing knowledge with provenance and stable ownership.',
      sources: ['repo:docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md'],
      confidence: 0.91,
      canonicalKey: 'repo/shared-routing',
      nextAction: 'Backfill shared context mirrors after promotion.',
    });
    expect(promotedKnowledge).toMatchObject({
      status: 'written',
      targetPath: 'ops/contexts/repos/shared-routing.md',
      canonicalKey: 'repo/shared-routing',
    });
    expect(mockWriteNote).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'ops/contexts/repos/shared-routing.md',
    }));

    const semanticLint = await runObsidianSemanticLintAudit();
    expect(semanticLint.healthy).toBe(false);
    expect(semanticLint.issueCount).toBeGreaterThan(0);
    expect(semanticLint.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'coverage-gap' }),
      expect.objectContaining({ kind: 'graph-quality' }),
    ]));
    expect(semanticLint.persistence).toMatchObject({
      attempted: true,
      summaryPath: 'ops/improvement/negative-knowledge/semantic-lint/CURRENT.md',
    });
    expect(mockWriteNote).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'ops/improvement/negative-knowledge/semantic-lint/CURRENT.md',
    }));
    expect(mockWriteNote.mock.calls.some((call) => String(call[0]?.fileName || '').includes('ops/improvement/negative-knowledge/semantic-lint/issues/'))).toBe(true);

    const captureResult = await captureObsidianWikiChange({
      changeSummary: 'knowledge bundle compile rollout',
      changeKind: 'development-slice',
      changedPaths: ['docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md'],
      validationRefs: ['npx vitest run src/services/obsidian/knowledgeCompilerService.test.ts'],
      mirrorTargets: ['CHANGELOG-ARCH'],
      promoteImmediately: true,
    });
    expect(captureResult.classification).toContain('service_profile');
    expect(captureResult.matchedCatalogEntries).toContain('service-mcp-knowledge-bundle-compile-spec');
    expect(captureResult.writtenArtifacts).toEqual([]);
    expect(captureResult.gaps).toEqual([]);
    expect(captureResult.followUps).toEqual(expect.arrayContaining([
      expect.stringContaining('Skipped compatibility-stub source docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md'),
    ]));
    expect(mockWriteNote).not.toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'ops/services/unified-mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md',
    }));

    const decisionTrace = await traceObsidianDecision({
      subject: 'shared MCP routing policy',
      explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
    });
    expect(decisionTrace.subject).toBe('shared MCP routing policy');
    expect(decisionTrace.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepKind: 'artifact' }),
    ]));
    expect(Array.isArray(decisionTrace.contradictions)).toBe(true);
    if (decisionTrace.contradictions.length > 0) {
      expect(['coverage-gap', 'runtime-doc-mismatch']).toContain(decisionTrace.contradictions[0]?.kind);
    }

    const incidentGraph = await resolveObsidianIncidentGraph({
      incident: 'unified mcp routing outage',
      serviceHints: ['unified-mcp'],
    });
    expect(incidentGraph.affectedServices).toContain('unified-mcp');
    expect(incidentGraph.summary).toContain('Resolved incident graph');
    expect(incidentGraph.nextActions.length).toBeGreaterThan(0);
    expect(incidentGraph.customerImpactLikely).toBe(true);
  });

  it('skips raw inbox notes', async () => {
    const { runKnowledgeCompilationForNote } = await import('./knowledgeCompilerService');

    const result = await runKnowledgeCompilationForNote({
      guildId: 'guild-1',
      vaultPath: '/vault',
      filePath: 'chat/inbox/2026-04-09/request.md',
      content: [
        '---',
        'title: Request',
        'schema: chat-inbox/v1',
        'status: open',
        'created: 2026-04-09T00:00:00.000Z',
        '---',
        '',
        '# Request',
        '',
        'Need help with local-first retrieval.',
      ].join('\n'),
    });

    expect(result.compiled).toBe(false);
    expect(result.reason).toBe('raw_or_ops_path');
    expect(mockWriteNote).not.toHaveBeenCalled();
  });
});