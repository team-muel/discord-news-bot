import { sanitizeDiscordId } from '../../utils/discordChannelMeta';
import { RETRIEVAL_VARIANT_KEYS, isRetrievalVariant } from '../../../config/runtime/retrievalVariants.js';
import { getUserPersonaSnapshot } from '../userPersonaService';
import { isUserLearningEnabled } from '../userLearningPrefsService';
import { getGateProviderProfileOverride, type LlmProviderProfile } from '../llmClient';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getUserConsentSnapshot, type AgentUserConsentSnapshot } from './agentConsentService';
import { getWorkflowStepTemplates, type WorkflowPriority } from './agentWorkflowService';

type PersonaNotePreview = {
  title: string;
  summary: string;
  visibility: 'private' | 'guild';
};

export type AgentPersonalizationRetrievalProfile = 'baseline' | 'intent_prefix' | 'keyword_expansion' | 'graph_lore';

export type AgentPersonalizationRecommendation = {
  priority: WorkflowPriority;
  providerProfile: LlmProviderProfile;
  retrievalProfile: AgentPersonalizationRetrievalProfile;
  activeRetrievalProfile: AgentPersonalizationRetrievalProfile | null;
  reasons: string[];
};

export type AgentPersonalizationEffectiveSelection = {
  priority: WorkflowPriority;
  prioritySource: 'requested' | 'personalization';
  providerProfile: LlmProviderProfile;
  providerProfileSource: 'gate_override' | 'personalization';
  retrievalProfile: AgentPersonalizationRetrievalProfile;
  retrievalProfileSource: 'active_profile' | 'personalization';
};

export type AgentPersonalizationSnapshot = {
  guildId: string;
  userId: string;
  requestedPriority: WorkflowPriority;
  requestedSkillId: string | null;
  consent: Pick<AgentUserConsentSnapshot, 'memoryEnabled' | 'socialGraphEnabled' | 'profilingEnabled' | 'actionAuditDisclosureEnabled' | 'source' | 'updatedAt'>;
  learning: {
    enabled: boolean;
  };
  persona: {
    available: boolean;
    summary: string | null;
    communicationStyle: string | null;
    roleTags: string[];
    preferredTopics: string[];
    visibleNoteCount: number;
    hiddenNoteCount: number;
    relationCount: number;
    notes: PersonaNotePreview[];
  };
  workflow: {
    priority: WorkflowPriority;
    stepTitles: string[];
    stepCount: number;
  };
  recommendations: AgentPersonalizationRecommendation;
  effective: AgentPersonalizationEffectiveSelection;
  promptHints: string[];
};

const cleanText = (value: unknown, max = 200): string => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

const uniqueStrings = (values: string[]): string[] => [...new Set(values.map((value) => cleanText(value, 60)).filter(Boolean))];

const normalizePriority = (value: unknown): WorkflowPriority => {
  const lowered = String(value || '').trim().toLowerCase();
  if (lowered === 'fast') {
    return 'fast';
  }
  if (lowered === 'precise') {
    return 'precise';
  }
  return 'balanced';
};

const summarizeList = (values: string[], maxItems: number): string => uniqueStrings(values).slice(0, maxItems).join(', ');

const CONCISE_PATTERN = /(brief|concise|compact|light|fast|quick|short|핵심|짧게|간단|빠르게|요점|요약 위주)/i;
const DEEP_PATTERN = /(detail|detailed|deep|thorough|rigor|careful|audit|evidence|step-by-step|자세|상세|정밀|꼼꼼|근거|분석|리스크|감사)/i;
const RESEARCH_ROLE_PATTERN = /(analyst|research|researcher|auditor|planner|reviewer|engineer|개발|분석|감사)/i;
const VALID_RETRIEVAL_VARIANTS = new Set<AgentPersonalizationRetrievalProfile>(RETRIEVAL_VARIANT_KEYS as AgentPersonalizationRetrievalProfile[]);

const hasAnyPattern = (values: Array<string | null | undefined>, pattern: RegExp): boolean => {
  return values.some((value) => pattern.test(String(value || '')));
};

const readActiveRetrievalProfile = async (guildId: string): Promise<AgentPersonalizationRetrievalProfile | null> => {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('retrieval_ranker_active_profiles')
      .select('active_variant')
      .eq('guild_id', guildId)
      .maybeSingle();

    if (error) {
      return null;
    }

    const activeVariant = String(data?.active_variant || '').trim();
    return isRetrievalVariant(activeVariant) && VALID_RETRIEVAL_VARIANTS.has(activeVariant as AgentPersonalizationRetrievalProfile)
      ? activeVariant as AgentPersonalizationRetrievalProfile
      : null;
  } catch {
    return null;
  }
};

const buildRecommendations = (params: {
  requestedPriority: WorkflowPriority;
  persona: Omit<AgentPersonalizationSnapshot['persona'], 'notes'> & { notes: PersonaNotePreview[] };
  learningEnabled: boolean;
  consent: Pick<AgentUserConsentSnapshot, 'memoryEnabled' | 'socialGraphEnabled' | 'profilingEnabled' | 'actionAuditDisclosureEnabled' | 'source' | 'updatedAt'>;
  activeRetrievalProfile: AgentPersonalizationRetrievalProfile | null;
}): AgentPersonalizationRecommendation => {
  const { requestedPriority, persona, learningEnabled, consent, activeRetrievalProfile } = params;
  const signals = [
    persona.summary,
    persona.communicationStyle,
    ...persona.roleTags,
    ...persona.preferredTopics,
    ...persona.notes.map((note) => note.summary),
  ];
  const reasons: string[] = [];

  const conciseSignal = hasAnyPattern(signals, CONCISE_PATTERN);
  const deepSignal = hasAnyPattern(signals, DEEP_PATTERN)
    || hasAnyPattern(persona.roleTags, RESEARCH_ROLE_PATTERN)
    || persona.preferredTopics.length >= 2
    || persona.visibleNoteCount >= 2;

  let priority: WorkflowPriority = requestedPriority;
  let providerProfile: LlmProviderProfile = requestedPriority === 'fast' ? 'cost-optimized' : 'quality-optimized';
  let retrievalProfile: AgentPersonalizationRetrievalProfile = activeRetrievalProfile || 'keyword_expansion';

  if (conciseSignal) {
    priority = requestedPriority === 'precise' ? 'precise' : 'fast';
    providerProfile = requestedPriority === 'precise' ? 'quality-optimized' : 'cost-optimized';
    retrievalProfile = 'intent_prefix';
    reasons.push('concise_style_signal');
  }

  if (deepSignal) {
    priority = requestedPriority === 'fast' ? 'fast' : 'precise';
    providerProfile = 'quality-optimized';
    retrievalProfile = 'graph_lore';
    reasons.push('deep_context_signal');
  }

  if (!learningEnabled && !deepSignal && requestedPriority !== 'precise') {
    providerProfile = 'cost-optimized';
    reasons.push('learning_disabled');
  }

  if (!consent.profilingEnabled && !deepSignal && requestedPriority !== 'precise') {
    retrievalProfile = activeRetrievalProfile || 'keyword_expansion';
    reasons.push('profiling_disabled');
  }

  if (requestedPriority === 'fast') {
    priority = 'fast';
    providerProfile = conciseSignal ? providerProfile : 'cost-optimized';
    reasons.push('requested_priority_fast');
  } else if (requestedPriority === 'precise') {
    priority = 'precise';
    providerProfile = 'quality-optimized';
    retrievalProfile = deepSignal ? retrievalProfile : 'graph_lore';
    reasons.push('requested_priority_precise');
  }

  if (persona.available && reasons.length === 0) {
    providerProfile = 'quality-optimized';
    retrievalProfile = activeRetrievalProfile || 'graph_lore';
    reasons.push('persona_available');
  }

  if (!persona.available && reasons.length === 0) {
    reasons.push('default_runtime_profile');
  }

  if (activeRetrievalProfile && retrievalProfile === activeRetrievalProfile) {
    reasons.push(`active_retrieval_profile:${activeRetrievalProfile}`);
  }

  return {
    priority,
    providerProfile,
    retrievalProfile,
    activeRetrievalProfile,
    reasons: uniqueStrings(reasons).slice(0, 6),
  };
};

const buildEffectiveSelection = (params: {
  guildId: string;
  requestedPriority: WorkflowPriority;
  recommendations: AgentPersonalizationRecommendation;
}): AgentPersonalizationEffectiveSelection => {
  const gateOverride = getGateProviderProfileOverride(params.guildId);
  return {
    priority: params.requestedPriority === 'balanced' ? params.recommendations.priority : params.requestedPriority,
    prioritySource: params.requestedPriority === 'balanced' ? 'personalization' : 'requested',
    providerProfile: gateOverride || params.recommendations.providerProfile,
    providerProfileSource: gateOverride ? 'gate_override' : 'personalization',
    retrievalProfile: params.recommendations.retrievalProfile,
    retrievalProfileSource: params.recommendations.activeRetrievalProfile === params.recommendations.retrievalProfile
      ? 'active_profile'
      : 'personalization',
  };
};

const buildPromptHints = (snapshot: Omit<AgentPersonalizationSnapshot, 'promptHints'>): string[] => {
  const hints: string[] = [];

  const privacyFlags: string[] = [];
  if (!snapshot.consent.memoryEnabled) {
    privacyFlags.push('memory=off');
  }
  if (!snapshot.consent.profilingEnabled) {
    privacyFlags.push('profiling=off');
  }
  if (!snapshot.consent.socialGraphEnabled) {
    privacyFlags.push('social=off');
  }
  if (privacyFlags.length > 0) {
    hints.push(`[personalization:privacy] ${privacyFlags.join(' ')}; stay close to the current turn.`);
  }

  if (!snapshot.learning.enabled) {
    hints.push('[personalization:learning] Future passive learning is disabled for this requester in this guild.');
  }

  hints.push(
    `[personalization:runtime] pace=${snapshot.effective.priority} provider_profile=${snapshot.effective.providerProfile} retrieval_profile=${snapshot.effective.retrievalProfile}`,
  );

  if (snapshot.persona.available) {
    const parts: string[] = [];
    if (snapshot.persona.communicationStyle) {
      parts.push(`style=${snapshot.persona.communicationStyle}`);
    }
    const topics = summarizeList(snapshot.persona.preferredTopics, 3);
    if (topics) {
      parts.push(`topics=${topics}`);
    }
    const roles = summarizeList(snapshot.persona.roleTags, 3);
    if (roles) {
      parts.push(`roles=${roles}`);
    }
    if (!parts.length && snapshot.persona.summary) {
      parts.push(snapshot.persona.summary);
    }
    if (parts.length > 0) {
      hints.push(`[personalization:profile] ${cleanText(parts.join(' | '), 220)}`);
    }
    for (const note of snapshot.persona.notes.slice(0, 2)) {
      hints.push(`[personalization:note] ${cleanText(note.summary || note.title, 180)}`);
    }
  }

  return hints.slice(0, 4);
};

export const resolveAgentPersonalizationSnapshot = async (params: {
  guildId: string;
  userId: string;
  requestedPriority?: string | null;
  requestedSkillId?: string | null;
}): Promise<AgentPersonalizationSnapshot> => {
  const guildId = sanitizeDiscordId(params.guildId);
  const userId = sanitizeDiscordId(params.userId);
  if (!guildId || !userId) {
    throw new Error('VALIDATION');
  }

  const requestedPriority = normalizePriority(params.requestedPriority);
  const requestedSkillId = cleanText(params.requestedSkillId, 80) || null;

  const [consent, learningEnabled, activeRetrievalProfile] = await Promise.all([
    getUserConsentSnapshot({ guildId, userId }),
    isUserLearningEnabled(userId, guildId),
    readActiveRetrievalProfile(guildId),
  ]);

  const personaSnapshot = consent.profilingEnabled
    ? await getUserPersonaSnapshot({
      guildId,
      targetUserId: userId,
      requesterUserId: userId,
      relationLimit: 2,
      noteLimit: 2,
    }).catch(() => null)
    : null;

  const persona = {
    available: Boolean(personaSnapshot?.profile || (personaSnapshot?.notes.length || 0) > 0),
    summary: personaSnapshot?.profile?.summary || null,
    communicationStyle: personaSnapshot?.profile?.communicationStyle || null,
    roleTags: personaSnapshot?.profile?.roleTags || [],
    preferredTopics: personaSnapshot?.profile?.preferredTopics || [],
    visibleNoteCount: personaSnapshot?.noteVisibility.visible || 0,
    hiddenNoteCount: personaSnapshot?.noteVisibility.hidden || 0,
    relationCount: (personaSnapshot?.relations.outbound.length || 0) + (personaSnapshot?.relations.inbound.length || 0),
    notes: (personaSnapshot?.notes || []).slice(0, 2).map((note) => ({
      title: cleanText(note.title, 80),
      summary: cleanText(note.summary, 180),
      visibility: note.visibility,
    })),
  };

  const recommendations = buildRecommendations({
    requestedPriority,
    persona,
    learningEnabled,
    consent: {
      memoryEnabled: consent.memoryEnabled,
      socialGraphEnabled: consent.socialGraphEnabled,
      profilingEnabled: consent.profilingEnabled,
      actionAuditDisclosureEnabled: consent.actionAuditDisclosureEnabled,
      source: consent.source,
      updatedAt: consent.updatedAt,
    },
    activeRetrievalProfile,
  });
  const effective = buildEffectiveSelection({
    guildId,
    requestedPriority,
    recommendations,
  });
  const workflowSteps = getWorkflowStepTemplates({
    guildId,
    priority: effective.priority,
    hasRequestedSkill: Boolean(requestedSkillId),
  });

  const baseSnapshot: Omit<AgentPersonalizationSnapshot, 'promptHints'> = {
    guildId,
    userId,
    requestedPriority,
    requestedSkillId,
    consent: {
      memoryEnabled: consent.memoryEnabled,
      socialGraphEnabled: consent.socialGraphEnabled,
      profilingEnabled: consent.profilingEnabled,
      actionAuditDisclosureEnabled: consent.actionAuditDisclosureEnabled,
      source: consent.source,
      updatedAt: consent.updatedAt,
    },
    learning: {
      enabled: learningEnabled,
    },
    persona,
    workflow: {
      priority: effective.priority,
      stepTitles: workflowSteps.map((step) => cleanText(step.title, 80)).filter(Boolean),
      stepCount: workflowSteps.length,
    },
    recommendations,
    effective,
  };

  return {
    ...baseSnapshot,
    promptHints: buildPromptHints(baseSnapshot),
  };
};