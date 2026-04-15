import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureFeatureAccess: vi.fn(),
  buildUserCard: vi.fn((title: string, description: string, color: number) => ({ title, description, color })),
  getUserPersonaSnapshot: vi.fn(),
  resolveAgentPersonalizationSnapshot: vi.fn(),
  createUserPersonalComment: vi.fn(),
}));

vi.mock('../auth', () => ({
  ensureFeatureAccess: mocks.ensureFeatureAccess,
}));

vi.mock('../ui', () => ({
  buildUserCard: mocks.buildUserCard,
  EMBED_ERROR: 1,
  EMBED_INFO: 2,
  EMBED_SUCCESS: 3,
  EMBED_WARN: 4,
}));

vi.mock('../../services/userPersonaService', () => ({
  getUserPersonaSnapshot: mocks.getUserPersonaSnapshot,
  createUserPersonalComment: mocks.createUserPersonalComment,
}));

vi.mock('../../services/agent/agentPersonalizationService', () => ({
  resolveAgentPersonalizationSnapshot: mocks.resolveAgentPersonalizationSnapshot,
}));

const buildPersonaSnapshot = () => ({
  profile: {
    summary: '운영 요약 선호',
    communicationStyle: 'concise',
    preferredTopics: ['ops'],
    roleTags: ['operator'],
  },
  relations: { outbound: [], inbound: [] },
  notes: [{ summary: '짧고 핵심 위주', confidence: 0.8 }],
  noteVisibility: { hidden: 0 },
});

const buildPersonalizationSnapshot = (overrides?: Partial<{
  priority: 'balanced' | 'fast' | 'precise';
  providerProfile: 'cost-optimized' | 'quality-optimized';
  retrievalProfile: 'baseline' | 'intent_prefix' | 'keyword_expansion' | 'graph_lore';
  reasons: string[];
}>) => ({
  guildId: 'guild-1',
  userId: 'user-1',
  requestedPriority: 'balanced',
  requestedSkillId: null,
  consent: {
    memoryEnabled: true,
    socialGraphEnabled: true,
    profilingEnabled: true,
    actionAuditDisclosureEnabled: true,
    source: 'stored',
    updatedAt: null,
  },
  learning: { enabled: true },
  persona: {
    available: true,
    summary: '요약 선호',
    communicationStyle: 'concise',
    roleTags: ['operator'],
    preferredTopics: ['ops'],
    visibleNoteCount: 1,
    hiddenNoteCount: 0,
    relationCount: 0,
    notes: [],
  },
  workflow: {
    priority: 'balanced',
    stepTitles: [],
    stepCount: 0,
  },
  recommendations: {
    priority: overrides?.priority || 'fast',
    providerProfile: overrides?.providerProfile || 'cost-optimized',
    retrievalProfile: overrides?.retrievalProfile || 'intent_prefix',
    activeRetrievalProfile: null,
    reasons: overrides?.reasons || ['concise_style_signal'],
  },
  effective: {
    priority: overrides?.priority || 'fast',
    prioritySource: 'personalization',
    providerProfile: overrides?.providerProfile || 'cost-optimized',
    providerProfileSource: 'personalization',
    retrievalProfile: overrides?.retrievalProfile || 'intent_prefix',
    retrievalProfileSource: 'personalization',
  },
  promptHints: [],
});

const createInteraction = () => {
  const target = { id: 'target-user' };
  const compare = { id: 'compare-user' };
  return {
    user: { id: 'admin-user' },
    guildId: 'guild-1',
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    options: {
      getUser: (name: string) => {
        if (name === '유저') {
          return target;
        }
        if (name === '비교유저') {
          return compare;
        }
        return null;
      },
    },
  };
};

describe('persona command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureFeatureAccess.mockResolvedValue({ ok: true });
    mocks.getUserPersonaSnapshot.mockResolvedValue(buildPersonaSnapshot());
  });

  it('renders personalization runtime details and admin comparison on /프로필', async () => {
    const interaction = createInteraction();
    mocks.resolveAgentPersonalizationSnapshot
      .mockResolvedValueOnce(buildPersonalizationSnapshot({
        priority: 'fast',
        providerProfile: 'cost-optimized',
        retrievalProfile: 'intent_prefix',
        reasons: ['concise_style_signal'],
      }))
      .mockResolvedValueOnce(buildPersonalizationSnapshot({
        priority: 'precise',
        providerProfile: 'quality-optimized',
        retrievalProfile: 'graph_lore',
        reasons: ['deep_context_signal'],
      }));

    const { createPersonaHandlers } = await import('./persona');
    const handlers = createPersonaHandlers({
      getReplyVisibility: () => 'private',
      hasAdminPermission: vi.fn().mockResolvedValue(true),
      hasValidLoginSession: vi.fn().mockResolvedValue(true),
      getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    });

    await handlers.handleProfileCommand(interaction as any);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.description).toContain('[개인화 런타임]');
    expect(payload.description).toContain('적용 provider profile: cost-optimized');
    expect(payload.description).toContain('[개인화 비교]');
    expect(payload.description).toContain('provider: <@target-user>=cost-optimized, <@compare-user>=quality-optimized');
  });

  it('blocks compare target for non-admin callers', async () => {
    const interaction = createInteraction();
    interaction.options.getUser = (name: string) => {
      if (name === '비교유저') {
        return { id: 'compare-user' };
      }
      return null;
    };

    const { createPersonaHandlers } = await import('./persona');
    const handlers = createPersonaHandlers({
      getReplyVisibility: () => 'private',
      hasAdminPermission: vi.fn().mockResolvedValue(false),
      hasValidLoginSession: vi.fn().mockResolvedValue(true),
      getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    });

    await handlers.handleProfileCommand(interaction as any);

    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.description).toContain('개인화 비교는 관리자만 가능합니다.');
  });
});
