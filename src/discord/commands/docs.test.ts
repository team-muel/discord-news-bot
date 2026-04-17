import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureFeatureAccess: vi.fn(),
  buildUserCard: vi.fn((title: string, description: string, color: number) => ({ title, description, color })),
  seedFeedbackReactions: vi.fn().mockResolvedValue(undefined),
  getSemanticAnswerCache: vi.fn(),
  putSemanticAnswerCache: vi.fn(),
  buildRagQueryPlanForGuild: vi.fn(),
  recordTaskRoutingMetric: vi.fn(),
}));

vi.mock('../auth', () => ({
  ensureFeatureAccess: mocks.ensureFeatureAccess,
}));

vi.mock('../ui', () => ({
  buildUserCard: mocks.buildUserCard,
  EMBED_ERROR: 1,
  EMBED_INFO: 2,
  EMBED_WARN: 3,
}));

vi.mock('../session', () => ({
  seedFeedbackReactions: mocks.seedFeedbackReactions,
}));

vi.mock('../../services/semanticAnswerCacheService', () => ({
  getSemanticAnswerCache: mocks.getSemanticAnswerCache,
  putSemanticAnswerCache: mocks.putSemanticAnswerCache,
}));

vi.mock('../../services/taskRoutingService', () => ({
  buildRagQueryPlanForGuild: mocks.buildRagQueryPlanForGuild,
}));

vi.mock('../../services/taskRoutingMetricsService', () => ({
  recordTaskRoutingMetric: mocks.recordTaskRoutingMetric,
}));

const createInteraction = (question: string, commandName = '뮤엘') => ({
  id: 'interaction-1',
  guildId: 'guild-1',
  user: { id: 'user-1' },
  commandName,
  channel: { id: 'channel-1', name: 'ops', type: 0 },
  options: {
    getString: (name: string) => {
      if (name === '질문') {
        return question;
      }
      return null;
    },
  },
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  fetchReply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
  followUp: vi.fn().mockResolvedValue(undefined),
  reply: vi.fn().mockResolvedValue(undefined),
});

describe('docs command ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureFeatureAccess.mockResolvedValue({ ok: true, autoLoggedIn: false });
    mocks.getSemanticAnswerCache.mockResolvedValue(null);
    mocks.buildRagQueryPlanForGuild.mockResolvedValue({
      route: 'mixed',
      confidence: 0.8,
      reasons: ['default_mixed_fallback'],
      overrideUsed: false,
      maxDocs: 6,
      contextMode: 'full',
      toolHints: [],
    });
  });

  it('prefers the injected Chat SDK ingress for slash ask commands', async () => {
    const queryObsidianRAG = vi.fn();
    const executeDocsCommandIngress = vi.fn().mockResolvedValue({
      result: {
        answer: 'Chat SDK answer',
        adapterId: 'chat-sdk',
        continuityQueued: false,
      },
      telemetry: {
        correlationId: 'interaction-1',
        surface: 'docs-command',
        guildId: 'guild-1',
        replyMode: 'private',
        selectedAdapterId: 'chat-sdk',
        adapterId: 'chat-sdk',
        routeDecision: 'adapter_accept',
        fallbackReason: null,
        shadowMode: false,
      },
    });
    const interaction = createInteraction('오늘 자동화 상태 점검해줘');

    const { createDocsHandlers } = await import('./docs');
    const handlers = createDocsHandlers({
      getReplyVisibility: () => 'private',
      queryObsidianRAG,
      generateText: vi.fn(),
      isAnyLlmConfigured: vi.fn().mockReturnValue(true),
      getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
      executeDocsCommandIngress,
    });

    await handlers.handleAskCommand(interaction as any);

    expect(executeDocsCommandIngress).toHaveBeenCalledWith(expect.objectContaining({
      request: '오늘 자동화 상태 점검해줘',
      guildId: 'guild-1',
      userId: 'user-1',
      correlationId: 'interaction-1',
      entryLabel: '/뮤엘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    }));
    expect(queryObsidianRAG).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
      description: expect.stringContaining('Chat SDK answer'),
    }));
    expect(mocks.recordTaskRoutingMetric).toHaveBeenCalledWith(expect.objectContaining({
      extra: expect.objectContaining({
        ingress: expect.objectContaining({
          correlationId: 'interaction-1',
          routeDecision: 'adapter_accept',
        }),
      }),
    }));
    expect(mocks.seedFeedbackReactions).toHaveBeenCalledWith({ id: 'reply-1' });
  });

  it('falls back to the existing docs path when Chat SDK ingress does not handle the request', async () => {
    const queryObsidianRAG = vi.fn().mockResolvedValue({
      documentCount: 0,
      executionTimeMs: 12,
      intent: 'ops',
      sourceFiles: [],
      cacheStatus: { hits: 0 },
      contextMode: 'full',
      documentContext: '',
      metadataSignals: undefined,
      graphDensity: null,
    });
    const executeDocsCommandIngress = vi.fn().mockResolvedValue({
      result: null,
      telemetry: {
        correlationId: 'interaction-1',
        surface: 'docs-command',
        guildId: 'guild-1',
        replyMode: 'private',
        selectedAdapterId: 'chat-sdk',
        adapterId: 'chat-sdk',
        routeDecision: 'legacy_fallback',
        fallbackReason: 'adapter_declined',
        shadowMode: false,
      },
    });
    const interaction = createInteraction('문서 기준으로 런타임 구조 알려줘', '해줘');

    const { createDocsHandlers } = await import('./docs');
    const handlers = createDocsHandlers({
      getReplyVisibility: () => 'private',
      queryObsidianRAG,
      generateText: vi.fn(),
      isAnyLlmConfigured: vi.fn().mockReturnValue(true),
      getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
      executeDocsCommandIngress,
    });

    await handlers.handleAskCommand(interaction as any);

    expect(queryObsidianRAG).toHaveBeenCalledWith('문서 기준으로 런타임 구조 알려줘', expect.objectContaining({
      guildId: 'guild-1',
    }));
    expect(mocks.recordTaskRoutingMetric).toHaveBeenCalledWith(expect.objectContaining({
      extra: expect.objectContaining({
        ingress: expect.objectContaining({
          routeDecision: 'legacy_fallback',
          fallbackReason: 'adapter_declined',
        }),
      }),
    }));
  });
});
