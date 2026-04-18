import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkOpenClawGatewayChatSupport: vi.fn(),
  sendGatewayChat: vi.fn(),
  enqueueOpenJarvisHermesRuntimeObjectives: vi.fn(),
  isAnyLlmConfigured: vi.fn(),
  generateTextWithMeta: vi.fn(),
  resolveChannelMeta: vi.fn(),
  channelDisplayPrefix: vi.fn(),
  parentLabel: vi.fn(),
  buildSourceRef: vi.fn(),
}));

vi.mock('../../config', () => ({
  OPENCLAW_ENABLED: true,
}));

vi.mock('../../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../services/openclaw/gatewayHealth', () => ({
  checkOpenClawGatewayChatSupport: mocks.checkOpenClawGatewayChatSupport,
  sendGatewayChat: mocks.sendGatewayChat,
}));

vi.mock('../../services/openjarvis/openjarvisHermesRuntimeControlService', () => ({
  enqueueOpenJarvisHermesRuntimeObjectives: mocks.enqueueOpenJarvisHermesRuntimeObjectives,
}));

vi.mock('../../services/llmClient', () => ({
  isAnyLlmConfigured: mocks.isAnyLlmConfigured,
  generateTextWithMeta: mocks.generateTextWithMeta,
}));

vi.mock('../../utils/discordChannelMeta', () => ({
  resolveChannelMeta: mocks.resolveChannelMeta,
  channelDisplayPrefix: mocks.channelDisplayPrefix,
  parentLabel: mocks.parentLabel,
  buildSourceRef: mocks.buildSourceRef,
}));

vi.mock('../runtimePolicy', () => ({
  CODING_INTENT_PATTERN: /코드|구현|만들/i,
  AUTOMATION_INTENT_PATTERN: /자동화|연동|상태|실행/i,
}));

describe('discordIngressAdapter', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkOpenClawGatewayChatSupport.mockResolvedValue(true);
    mocks.sendGatewayChat.mockResolvedValue('OpenClaw 응답');
    mocks.enqueueOpenJarvisHermesRuntimeObjectives.mockResolvedValue({ ok: true });
    mocks.isAnyLlmConfigured.mockReturnValue(true);
    mocks.generateTextWithMeta.mockResolvedValue({
      text: 'Chat SDK 응답',
      provider: 'openjarvis',
      model: 'qwen2.5:7b',
      latencyMs: 12,
      estimatedCostUsd: 0.0001,
    });
    mocks.resolveChannelMeta.mockReturnValue({
      channelId: 'channel-1',
      channelName: 'ops',
      isPrivateThread: false,
    });
    mocks.channelDisplayPrefix.mockReturnValue('#');
    mocks.parentLabel.mockReturnValue('parent_channel=team');
    mocks.buildSourceRef.mockReturnValue('discord://guild/guild-1/channel/channel-1/message/msg-1');

    const { resetDiscordIngressCutoverSnapshotForTests } = await import('./discordIngressAdapter');
    resetDiscordIngressCutoverSnapshotForTests();
  });

  it('builds a normalized ingress envelope with context, reply mode, and tenant lane', async () => {
    const { buildDiscordIngressEnvelope } = await import('./discordIngressAdapter');

    const envelope = buildDiscordIngressEnvelope({
      request: '  구현   상태   알려줘  ',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-1',
      entryLabel: '/뮤엘',
      surface: 'docs-command',
      replyMode: 'public',
      tenantLane: 'operator-personal',
    });

    expect(envelope).toMatchObject({
      correlationId: 'corr-1',
      request: '구현 상태 알려줘',
      replyMode: 'public',
      tenantLane: 'operator-personal',
      context: {
        channelSummary: '#ops | parent_channel=team',
        sourceRef: 'discord://guild/guild-1/channel/channel-1/message/msg-1',
        skipContinuity: false,
      },
    });
  });

  it('routes through the first adapter that handles the normalized ingress envelope', async () => {
    const { routeDiscordIngress } = await import('./discordIngressAdapter');
    const primaryAdapter = {
      id: 'noop',
      route: vi.fn().mockResolvedValue(null),
    };
    const secondaryAdapter = {
      id: 'custom',
      route: vi.fn().mockResolvedValue({
        answer: 'secondary adapter response',
        adapterId: 'custom',
        continuityQueued: false,
      }),
    };

    const result = await routeDiscordIngress({
      request: '문서 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    }, [primaryAdapter, secondaryAdapter]);

    expect(primaryAdapter.route).toHaveBeenCalledWith(expect.objectContaining({
      request: '문서 알려줘',
      replyMode: 'private',
    }));
    expect(result).toMatchObject({
      answer: 'secondary adapter response',
      adapterId: 'custom',
      continuityQueued: false,
    });
  });

  it('returns legacy fallback telemetry when docs ingress is hard-disabled', async () => {
    const { executeDiscordIngress } = await import('./discordIngressAdapter');
    const adapter = {
      id: 'chat-sdk',
      route: vi.fn().mockResolvedValue({
        answer: 'should not be used',
        adapterId: 'chat-sdk',
        continuityQueued: false,
      }),
    };

    const execution = await executeDiscordIngress({
      request: '문서 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-hard-disable',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    }, {
      preferredAdapterId: 'chat-sdk',
      hardDisable: true,
    }, [adapter]);

    expect(adapter.route).not.toHaveBeenCalled();
    expect(execution).toMatchObject({
      result: null,
      telemetry: {
        correlationId: 'corr-hard-disable',
        selectedAdapterId: 'chat-sdk',
        adapterId: null,
        routeDecision: 'legacy_fallback',
        fallbackReason: 'hard_disabled',
        shadowMode: false,
      },
    });
  });

  it('evaluates adapter in shadow mode while preserving legacy fallback', async () => {
    const { executeDiscordIngress } = await import('./discordIngressAdapter');
    const adapter = {
      id: 'chat-sdk',
      route: vi.fn().mockResolvedValue({
        answer: 'shadow answer',
        adapterId: 'chat-sdk',
        continuityQueued: false,
      }),
    };

    const execution = await executeDiscordIngress({
      request: '문서 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-shadow',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    }, {
      preferredAdapterId: 'chat-sdk',
      shadowMode: true,
    }, [adapter]);

    expect(adapter.route).toHaveBeenCalled();
    expect(execution).toMatchObject({
      result: null,
      telemetry: {
        correlationId: 'corr-shadow',
        selectedAdapterId: 'chat-sdk',
        adapterId: 'chat-sdk',
        routeDecision: 'shadow_only',
        fallbackReason: 'shadow_mode',
        shadowMode: true,
      },
    });
  });

  it('records adapter error telemetry and preserves legacy fallback on transport failure', async () => {
    const { executeDiscordIngress } = await import('./discordIngressAdapter');
    const adapter = {
      id: 'chat-sdk',
      route: vi.fn().mockRejectedValue(new Error('gateway exploded')),
    };

    const execution = await executeDiscordIngress({
      request: '문서 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-error',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    }, {
      preferredAdapterId: 'chat-sdk',
    }, [adapter]);

    expect(execution).toMatchObject({
      result: null,
      telemetry: {
        correlationId: 'corr-error',
        selectedAdapterId: 'chat-sdk',
        adapterId: 'chat-sdk',
        routeDecision: 'legacy_fallback',
        fallbackReason: 'adapter_error',
        shadowMode: false,
      },
    });
  });

  it('records holdout-safe canary fallback and keeps policy snapshots per surface', async () => {
    const {
      executeDiscordIngress,
      getDiscordIngressCutoverSnapshot,
      primeDiscordIngressCutoverPolicy,
    } = await import('./discordIngressAdapter');
    const adapter = {
      id: 'chat-sdk',
      route: vi.fn().mockResolvedValue({
        answer: 'should not run during holdout',
        adapterId: 'chat-sdk',
        continuityQueued: false,
      }),
    };

    primeDiscordIngressCutoverPolicy('docs-command', {
      preferredAdapterId: 'chat-sdk',
      rolloutPercentage: 0,
    });
    primeDiscordIngressCutoverPolicy('muel-message', {
      preferredAdapterId: 'chat-sdk',
      shadowMode: true,
      rolloutPercentage: 100,
    });

    const execution = await executeDiscordIngress({
      request: '문서 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-holdout',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    }, {
      preferredAdapterId: 'chat-sdk',
      rolloutPercentage: 0,
      rolloutKey: 'docs-holdout-user',
    }, [adapter]);

    const snapshot = getDiscordIngressCutoverSnapshot();

    expect(adapter.route).not.toHaveBeenCalled();
    expect(execution).toMatchObject({
      result: null,
      telemetry: {
        correlationId: 'corr-holdout',
        routeDecision: 'legacy_fallback',
        fallbackReason: 'rollout_holdout',
        rolloutPercentage: 0,
        selectedByRollout: false,
        policyMode: 'holdout-only',
      },
    });
    expect(snapshot.policyBySurface['docs-command']).toMatchObject({
      preferredAdapterId: 'chat-sdk',
      rolloutPercentage: 0,
      mode: 'holdout-only',
    });
    expect(snapshot.policyBySurface['muel-message']).toMatchObject({
      preferredAdapterId: 'chat-sdk',
      shadowMode: true,
      rolloutPercentage: 100,
      mode: 'shadow',
    });
    expect(snapshot.surfaces['docs-command']).toMatchObject({
      total: 1,
      holdoutCount: 1,
      selectedByRolloutCount: 0,
      bySource: {
        live: {
          total: 1,
          holdoutCount: 1,
        },
      },
    });
  });

  it('isolates lab rehearsal evidence from live counters while keeping aggregate evidence', async () => {
    const {
      executeDiscordIngress,
      getDiscordIngressCutoverSnapshot,
    } = await import('./discordIngressAdapter');
    const adapter = {
      id: 'openclaw',
      route: vi.fn().mockResolvedValue({
        answer: 'lab ok',
        adapterId: 'openclaw',
        continuityQueued: false,
      }),
    };

    await executeDiscordIngress({
      request: '문서 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-lab',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    }, {
      preferredAdapterId: 'openclaw',
      rolloutPercentage: 100,
      evidenceSource: 'lab',
    }, [adapter]);

    const snapshot = getDiscordIngressCutoverSnapshot();

    expect(snapshot.surfaces['docs-command']).toMatchObject({
      total: 1,
      adapterAcceptCount: 1,
      bySource: {
        live: {
          total: 0,
          adapterAcceptCount: 0,
        },
        lab: {
          total: 1,
          adapterAcceptCount: 1,
        },
      },
    });
    expect(snapshot.totalsBySource.live.total).toBe(0);
    expect(snapshot.totalsBySource.lab.total).toBe(1);
    expect(snapshot.recentEvents[0]?.telemetry.evidenceSource).toBe('lab');
  });

  it('routes the chat-sdk adapter through the direct LLM bridge and preserves provider routing metadata', async () => {
    const {
      buildDiscordIngressEnvelope,
      chatSdkDiscordIngressAdapter,
    } = await import('./discordIngressAdapter');
    const envelope = buildDiscordIngressEnvelope({
      request: '문서 기준으로 런타임 구조 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-chat-sdk',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    });

    const result = await chatSdkDiscordIngressAdapter.route(envelope);

    expect(mocks.generateTextWithMeta).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('당신은 Discord 커뮤니티의 Muel입니다.'),
      user: expect.stringContaining('User request: 문서 기준으로 런타임 구조 알려줘'),
      actionName: 'discord.docs-command',
      guildId: 'guild-1',
      requestedBy: 'user-1',
      maxTokens: 800,
      temperature: 0.2,
    }));
    expect(result).toMatchObject({
      answer: 'Chat SDK 응답',
      adapterId: 'chat-sdk',
      continuityQueued: false,
    });
  });

  it('sanitizes leaked prompt compiler and deliverable wrapper text before returning ingress answers', async () => {
    mocks.generateTextWithMeta.mockResolvedValue({
      text: [
        '[프롬프트 컴파일]',
        '- dropped_noise=false',
        '- intent_tags=ops,coding',
        '- directives=response.short,response.with-verification,response.risk-first',
        'FinOps 모드: normal (daily=0.0509/5.00, monthly=0.2532/100.00)',
        '## Deliverable',
        '중간 과정 노출 없이 최종 답만 반환합니다.',
        '## Verification',
        '- evidence_bundle_id: abc123',
      ].join('\n'),
      provider: 'openjarvis',
      model: 'qwen2.5:7b',
      latencyMs: 15,
      estimatedCostUsd: 0.0001,
    });

    const {
      buildDiscordIngressEnvelope,
      chatSdkDiscordIngressAdapter,
    } = await import('./discordIngressAdapter');
    const envelope = buildDiscordIngressEnvelope({
      request: '중간 과정 노출 없이 답해줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-chat-sdk-sanitize',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    });

    const result = await chatSdkDiscordIngressAdapter.route(envelope);

    expect(result).toMatchObject({
      answer: '중간 과정 노출 없이 최종 답만 반환합니다.',
      adapterId: 'chat-sdk',
      continuityQueued: false,
    });
  });

  it('declines ingress answers that collapse to internal diagnostics only after sanitization', async () => {
    mocks.generateTextWithMeta.mockResolvedValue({
      text: [
        '[프롬프트 컴파일]',
        '- dropped_noise=false',
        '- intent_tags=ops,coding',
        '- directives=response.short,response.with-verification,response.risk-first',
        'FinOps 모드: normal (daily=0.0509/5.00, monthly=0.2532/100.00)',
        'RAG 근거 6건 검색 완료 (query="요구사항: 중간 과정/역할별 산출물 노출 금지 목표: [ROUTE:mixed]")',
        '검증: 없음',
      ].join('\n'),
      provider: 'openjarvis',
      model: 'qwen2.5:7b',
      latencyMs: 15,
      estimatedCostUsd: 0.0001,
    });

    const {
      buildDiscordIngressEnvelope,
      chatSdkDiscordIngressAdapter,
    } = await import('./discordIngressAdapter');
    const envelope = buildDiscordIngressEnvelope({
      request: '중간 과정 노출 없이 답해줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-chat-sdk-empty',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    });

    const result = await chatSdkDiscordIngressAdapter.route(envelope);

    expect(result).toBeNull();
  });

  it('drops why-this-path sections before returning ingress answers', async () => {
    mocks.generateTextWithMeta.mockResolvedValue({
      text: [
        '## Deliverable',
        '최종 답변만 반환합니다.',
        '## Why This Path',
        'intent_tags=mixed,response.risk-first',
      ].join('\n'),
      provider: 'openjarvis',
      model: 'qwen2.5:7b',
      latencyMs: 15,
      estimatedCostUsd: 0.0001,
    });

    const {
      buildDiscordIngressEnvelope,
      chatSdkDiscordIngressAdapter,
    } = await import('./discordIngressAdapter');
    const envelope = buildDiscordIngressEnvelope({
      request: '최종 답변만 줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-chat-sdk-why-this-path',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    });

    const result = await chatSdkDiscordIngressAdapter.route(envelope);

    expect(result).toMatchObject({
      answer: '최종 답변만 반환합니다.',
      adapterId: 'chat-sdk',
      continuityQueued: false,
    });
  });

  it('declines the chat-sdk adapter when no LLM provider is configured', async () => {
    mocks.isAnyLlmConfigured.mockReturnValue(false);

    const {
      buildDiscordIngressEnvelope,
      chatSdkDiscordIngressAdapter,
    } = await import('./discordIngressAdapter');
    const envelope = buildDiscordIngressEnvelope({
      request: '문서 기준으로 런타임 구조 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-chat-sdk-disabled',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    });

    const result = await chatSdkDiscordIngressAdapter.route(envelope);

    expect(result).toBeNull();
    expect(mocks.generateTextWithMeta).not.toHaveBeenCalled();
  });

  it('keeps the canonical surface policy when a rollback rehearsal uses a temporary hard-disable override', async () => {
    const {
      executeDiscordIngress,
      getDiscordIngressCutoverSnapshot,
      primeDiscordIngressCutoverPolicy,
    } = await import('./discordIngressAdapter');
    const adapter = {
      id: 'openclaw',
      route: vi.fn().mockResolvedValue({
        answer: 'live ok',
        adapterId: 'openclaw',
        continuityQueued: false,
      }),
    };

    primeDiscordIngressCutoverPolicy('docs-command', {
      preferredAdapterId: 'openclaw',
      hardDisable: false,
      shadowMode: false,
      rolloutPercentage: 100,
    });

    await executeDiscordIngress({
      request: 'rollback rehearsal',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-rollback-policy',
      entryLabel: '/해줘',
      surface: 'docs-command',
      replyMode: 'private',
      tenantLane: 'operator-personal',
    }, {
      preferredAdapterId: 'openclaw',
      hardDisable: true,
      rolloutPercentage: 100,
      evidenceSource: 'lab',
    }, [adapter]);

    const snapshot = getDiscordIngressCutoverSnapshot();

    expect(snapshot.policyBySurface['docs-command']).toMatchObject({
      preferredAdapterId: 'openclaw',
      hardDisable: false,
      shadowMode: false,
      rolloutPercentage: 100,
      mode: 'default-on',
    });
    expect(snapshot.rollback.forcedFallbackCountBySource.lab).toBe(1);
    expect(snapshot.surfaces['docs-command'].lastTelemetry?.fallbackReason).toBe('hard_disabled');
  });

  it('routes the first concrete adapter through OpenClaw and queues continuity for coding requests', async () => {
    const {
      buildDiscordIngressEnvelope,
      openClawDiscordIngressAdapter,
    } = await import('./discordIngressAdapter');
    const envelope = buildDiscordIngressEnvelope({
      request: '구현 상태 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'channel-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-queue',
      entryLabel: '뮤엘 메시지',
      surface: 'muel-message',
      replyMode: 'channel',
      tenantLane: 'operator-personal',
    });

    const result = await openClawDiscordIngressAdapter.route(envelope);

    expect(mocks.sendGatewayChat).toHaveBeenCalledWith(expect.objectContaining({
      guildId: 'guild-1',
      actionName: 'discord.muel-message',
      user: expect.stringContaining('Discord reply mode: channel'),
    }));
    expect(mocks.sendGatewayChat).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining('tenant_lane: operator-personal'),
    }));
    expect(mocks.enqueueOpenJarvisHermesRuntimeObjectives).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'Discord ingress follow-up (뮤엘 메시지 @ #ops | parent_channel=team): 구현 상태 알려줘',
      runtimeLane: 'operator-personal',
    }));
    expect(result).toMatchObject({
      answer: 'OpenClaw 응답',
      adapterId: 'openclaw',
      continuityQueued: true,
    });
  });

  it('skips continuity promotion for private threads while keeping the reply path intact', async () => {
    mocks.resolveChannelMeta.mockReturnValue({
      channelId: 'thread-1',
      channelName: 'secret-thread',
      isPrivateThread: true,
    });
    mocks.channelDisplayPrefix.mockReturnValue('↳');
    mocks.parentLabel.mockReturnValue('parent_channel=ops');
    mocks.buildSourceRef.mockReturnValue('discord://guild/guild-1/channel/channel-1/thread/thread-1');

    const {
      buildDiscordIngressEnvelope,
      openClawDiscordIngressAdapter,
    } = await import('./discordIngressAdapter');
    const envelope = buildDiscordIngressEnvelope({
      request: '자동화 상태 알려줘',
      guildId: 'guild-1',
      userId: 'user-1',
      channel: { id: 'thread-1' } as any,
      messageId: 'msg-1',
      correlationId: 'corr-private-thread',
      entryLabel: '뮤엘 메시지',
      surface: 'muel-message',
      replyMode: 'channel',
      tenantLane: 'operator-personal',
    });

    const result = await openClawDiscordIngressAdapter.route(envelope);

    expect(mocks.enqueueOpenJarvisHermesRuntimeObjectives).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      answer: 'OpenClaw 응답',
      adapterId: 'openclaw',
      continuityQueued: false,
    });
  });
});