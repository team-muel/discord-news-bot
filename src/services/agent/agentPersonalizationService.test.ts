import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSupabaseMockClientByTable } from '../../test/supabaseMock';

const mocks = vi.hoisted(() => ({
  getUserPersonaSnapshot: vi.fn(),
  isUserLearningEnabled: vi.fn(),
  getUserConsentSnapshot: vi.fn(),
  getWorkflowStepTemplates: vi.fn(),
  getGateProviderProfileOverride: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

vi.mock('../userPersonaService', () => ({
  getUserPersonaSnapshot: mocks.getUserPersonaSnapshot,
}));

vi.mock('../userLearningPrefsService', () => ({
  isUserLearningEnabled: mocks.isUserLearningEnabled,
}));

vi.mock('../llmClient', () => ({
  getGateProviderProfileOverride: mocks.getGateProviderProfileOverride,
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
  getSupabaseClient: mocks.getSupabaseClient,
}));

vi.mock('./agentConsentService', () => ({
  getUserConsentSnapshot: mocks.getUserConsentSnapshot,
}));

vi.mock('./agentWorkflowService', () => ({
  getWorkflowStepTemplates: mocks.getWorkflowStepTemplates,
}));

describe('agentPersonalizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isUserLearningEnabled.mockResolvedValue(true);
    mocks.getUserConsentSnapshot.mockResolvedValue({
      memoryEnabled: true,
      socialGraphEnabled: true,
      profilingEnabled: true,
      actionAuditDisclosureEnabled: true,
      source: 'stored',
      updatedAt: null,
    });
    mocks.getWorkflowStepTemplates.mockReturnValue([{ title: 'plan', role: 'planner' }]);
    mocks.getGateProviderProfileOverride.mockReturnValue(null);
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.getSupabaseClient.mockReturnValue(createSupabaseMockClientByTable({
      retrieval_ranker_active_profiles: {
        data: { active_variant: 'keyword_expansion' },
        error: null,
      },
    }));
  });

  it('derives a fast, cost-optimized runtime profile from concise persona signals', async () => {
    mocks.getUserPersonaSnapshot.mockResolvedValue({
      profile: {
        summary: 'Prefers concise answers',
        communicationStyle: 'brief and concise',
        roleTags: ['operator'],
        preferredTopics: ['alerts'],
      },
      notes: [],
      relations: { outbound: [], inbound: [] },
      noteVisibility: { visible: 1, hidden: 0 },
    });

    const { resolveAgentPersonalizationSnapshot } = await import('./agentPersonalizationService');
    const snapshot = await resolveAgentPersonalizationSnapshot({
      guildId: '123456789',
      userId: '987654321',
      requestedPriority: 'balanced',
    });

    expect(snapshot.recommendations.priority).toBe('fast');
    expect(snapshot.recommendations.providerProfile).toBe('cost-optimized');
    expect(snapshot.recommendations.retrievalProfile).toBe('intent_prefix');
    expect(snapshot.effective.priority).toBe('fast');
    expect(snapshot.effective.providerProfile).toBe('cost-optimized');
    expect(snapshot.workflow.priority).toBe('fast');
    expect(mocks.getWorkflowStepTemplates).toHaveBeenCalledWith({
      guildId: '123456789',
      priority: 'fast',
      hasRequestedSkill: false,
    });
    expect(snapshot.promptHints.some((hint) => hint.includes('provider_profile=cost-optimized'))).toBe(true);
  });

  it('uses gate override for the effective provider profile while keeping deep retrieval selection', async () => {
    mocks.getUserPersonaSnapshot.mockResolvedValue({
      profile: {
        summary: 'Needs detailed evidence-heavy responses',
        communicationStyle: 'detailed',
        roleTags: ['researcher'],
        preferredTopics: ['architecture', 'risk'],
      },
      notes: [
        { title: 'evidence', summary: 'asks for step-by-step rationale', visibility: 'guild' },
        { title: 'risk', summary: 'prefers risk analysis', visibility: 'guild' },
      ],
      relations: { outbound: [], inbound: [] },
      noteVisibility: { visible: 2, hidden: 0 },
    });
    mocks.getGateProviderProfileOverride.mockReturnValue('cost-optimized');
    mocks.getSupabaseClient.mockReturnValue(createSupabaseMockClientByTable({
      retrieval_ranker_active_profiles: {
        data: { active_variant: 'graph_lore' },
        error: null,
      },
    }));

    const { resolveAgentPersonalizationSnapshot } = await import('./agentPersonalizationService');
    const snapshot = await resolveAgentPersonalizationSnapshot({
      guildId: '123456789',
      userId: '987654321',
      requestedPriority: 'balanced',
    });

    expect(snapshot.recommendations.priority).toBe('precise');
    expect(snapshot.recommendations.providerProfile).toBe('quality-optimized');
    expect(snapshot.recommendations.retrievalProfile).toBe('graph_lore');
    expect(snapshot.effective.providerProfile).toBe('cost-optimized');
    expect(snapshot.effective.providerProfileSource).toBe('gate_override');
    expect(snapshot.effective.retrievalProfileSource).toBe('active_profile');
  });
});
