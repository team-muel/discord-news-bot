import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertChain = {
  insert: vi.fn().mockResolvedValue({ error: null }),
};

const relationshipEdgeChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  upsert: vi.fn().mockResolvedValue({ error: null }),
};

const actorProfileChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  upsert: vi.fn().mockResolvedValue({ error: null }),
};

const mockClient = {
  from: vi.fn((table: string) => {
    if (table === 'community_interaction_events') return insertChain;
    if (table === 'community_relationship_edges') return relationshipEdgeChain;
    if (table === 'community_actor_profiles') return actorProfileChain;
    throw new Error(`unexpected table:${table}`);
  }),
};

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(() => mockClient),
}));

vi.mock('./agentConsentService', () => ({
  hasSocialGraphConsent: vi.fn(async () => true),
}));

import * as consentService from './agentConsentService';
import { recordCommunityInteractionEvent } from './communityGraphService';

describe('communityGraphService consent gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consentService.hasSocialGraphConsent).mockResolvedValue(true);
    insertChain.insert.mockResolvedValue({ error: null });
    relationshipEdgeChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    relationshipEdgeChain.upsert.mockResolvedValue({ error: null });
    actorProfileChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    actorProfileChain.upsert.mockResolvedValue({ error: null });
  });

  it('social graph consent가 없으면 아무 데이터도 기록하지 않는다', async () => {
    vi.mocked(consentService.hasSocialGraphConsent)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await recordCommunityInteractionEvent({
      guildId: '12345678',
      actorUserId: '11111111',
      targetUserId: '22222222',
      eventType: 'mention',
    });

    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('양쪽 모두 consent가 있으면 기존 적재 경로를 수행한다', async () => {
    await recordCommunityInteractionEvent({
      guildId: '12345678',
      actorUserId: '11111111',
      targetUserId: '22222222',
      eventType: 'reply',
    });

    expect(mockClient.from).toHaveBeenCalledWith('community_interaction_events');
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
  });
});