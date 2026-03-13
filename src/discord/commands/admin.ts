import type { ChatInputCommandInteraction } from 'discord.js';
import { buildAdminCard, buildSimpleEmbed, EMBED_ERROR, EMBED_INFO, EMBED_SUCCESS, EMBED_WARN } from '../ui';
import { isAnyLlmConfigured } from '../../services/llmClient';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { isStockFeatureEnabled } from '../../services/stockService';

type BotRuntimeSnapshotLike = {
  ready: boolean;
  wsStatus: number;
  reconnectQueued: boolean;
  reconnectAttempts: number;
};

type AutomationSnapshotLike = {
  healthy: boolean;
  jobs: Record<string, {
    name: string;
    running: boolean;
    lastErrorAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  }>;
};

type AdminDeps = {
  getBotRuntimeSnapshot: () => BotRuntimeSnapshotLike;
  getAutomationRuntimeSnapshot: () => AutomationSnapshotLike;
  hasAdminPermission: (interaction: ChatInputCommandInteraction) => Promise<boolean>;
  markUserLoggedIn: (guildId: string, userId: string) => Promise<'persisted' | 'memory-only'>;
  loginSessionTtlMs: number;
  loginSessionRefreshWindowMs: number;
  loginSessionCleanupIntervalMs: number;
  simpleCommandsEnabled: boolean;
  legacySubscribeCommandEnabled: boolean;
  legacySessionCommandsEnabled: boolean;
  getUsageSummaryLine: () => Promise<string>;
  getGuildUsageSummaryLine: (guildId: string | null) => Promise<string | null>;
  forceRegisterSlashCommands: () => Promise<void>;
  triggerAutomationJob: (jobName: 'youtube-monitor' | 'news-monitor', options: { guildId?: string }) => Promise<{ ok: boolean; message: string }>;
  getManualReconnectCooldownRemainingSec: () => number;
  hasActiveToken: () => boolean;
  requestManualReconnect: (reason: string) => Promise<{ ok: boolean; message: string }>;
};

export const createAdminHandlers = (deps: AdminDeps) => {
  const getRuntimeStatusLines = async (guildId: string | null): Promise<string[]> => {
    const bot = deps.getBotRuntimeSnapshot();
    const automation = deps.getAutomationRuntimeSnapshot();
    const usage = await deps.getUsageSummaryLine();
    const guildUsage = await deps.getGuildUsageSummaryLine(guildId);
    const jobStates = Object.values(automation.jobs)
      .map((job) => {
        const lastState = job.lastErrorAt && (!job.lastSuccessAt || Date.parse(job.lastErrorAt) >= Date.parse(job.lastSuccessAt))
          ? `error(${job.lastError || 'unknown'})`
          : job.running
            ? 'running'
            : 'idle';
        return `${job.name}: ${lastState}`;
      })
      .join(' | ');

    return [
      '[런타임 상태]',
      `Bot ready: ${String(bot.ready)} | wsStatus: ${bot.wsStatus}`,
      `Reconnect queued: ${String(bot.reconnectQueued)} | attempts: ${bot.reconnectAttempts}`,
      '',
      '[자동화 상태]',
      `Automation healthy: ${String(automation.healthy)} | ${jobStates || 'no jobs'}`,
      '',
      '[사용량]',
      usage,
      guildUsage,
    ].filter(Boolean) as string[];
  };

  const handleStatusCommand = async (interaction: ChatInputCommandInteraction) => {
    const lines = await getRuntimeStatusLines(interaction.guildId);
    await interaction.reply({
      ...buildSimpleEmbed('런타임 상태', lines.join('\n'), EMBED_INFO),
      ephemeral: true,
    });
  };

  const handleHelpCommand = async (interaction: ChatInputCommandInteraction) => {
    const simpleUserLines = [
      '`/구독` 하나로 구독 관리 (종류: 영상+링크, 게시글+링크, 뉴스(구글 금융 고정))',
      '`/로그인` 내 계정 권한/사용 가능 상태 진단',
      '`/설정` 현재 사용 모드/설정 확인',
      '`/ping` 상태 확인',
      '카테고리명을 `ai-chat` 또는 `ai-utility`로 지정하면 하위 채널에 모드가 자동 적용됨',
      '`@봇이름 고양이 영상 찾아줘`처럼 멘션으로 자연어 요청',
      '봇 답변에 답글로 이어서 대화 가능',
    ];

    const advancedAdminLines = [
      '`/시작` 세션 시작(호환 명령)',
      '`/상태` 운영/세션 상태 조회 (`종류`: 전체|운영|세션)',
      '`/스킬목록` 사용 가능한 스킬셋 조회',
      '`/정책` 실행 한도/가드레일 확인',
      '`/온보딩` 현재 길드 온보딩 분석 실행',
      '`/학습` 현재 길드 일일 학습/회고 실행',
      '`/중지` 실행 중 세션 중지 요청',
    ];

    await interaction.reply({
      embeds: [
        {
          title: 'Muel 명령어 안내',
          color: 0x2f80ed,
          description: deps.simpleCommandsEnabled
            ? '보이는 명령어를 최소화했습니다. 구독/설정/ping + 자연어 대화로 사용하세요.'
            : '자주 쓰는 핵심 명령만 빠르게 확인하세요.',
          fields: [
            {
              name: deps.simpleCommandsEnabled ? '권장 명령' : '일반 명령',
              value: deps.simpleCommandsEnabled
                ? simpleUserLines.join('\n')
                : [
                  '`/구독` 영상/게시글/뉴스 구독 통합 관리',
                  '`/로그인` 내 계정 권한/사용 가능 상태 진단',
                  '`/설정` 현재 사용 모드/설정 확인',
                  '`/ping` 상태 확인',
                  '`/주가` 현재 주가 조회 (`응답방식` 선택 가능)',
                  '`/차트` 30일 차트 조회 (`응답방식` 선택 가능)',
                  '`/분석` 기업 분석 (`응답방식` 선택 가능)',
                ].join('\n'),
            },
            {
              name: deps.simpleCommandsEnabled ? '고급 모드 안내' : '관리자 명령',
              value: deps.simpleCommandsEnabled
                ? '고급 명령이 필요하면 `DISCORD_SIMPLE_COMMANDS_ENABLED=false` 로 전환하세요.'
                : advancedAdminLines.join('\n'),
            },
            {
              name: '관리자 기준',
              value: 'Discord 서버 `Administrator` 권한이 있거나, 시스템 admin allowlist에 등록된 사용자입니다.',
            },
          ],
        },
      ],
      ephemeral: true,
    });
  };

  const handleSettingsCommand = async (interaction: ChatInputCommandInteraction) => {
    const category = (interaction.options.getString('항목') || 'mode').trim();
    const lines: string[] = [];
    lines.push('빠른 확인: 이 메시지가 보이면 /설정 명령은 정상 동작 중입니다.');

    if (category === 'mode') {
      lines.push('한 줄 안내: 지금은 /구독 + 자연어 대화 중심으로 쓰면 됩니다.');
      lines.push(`SIMPLE_COMMANDS_ENABLED=${String(deps.simpleCommandsEnabled)}`);
      lines.push('현재 권장 UX: /구독, /도움말, /설정, /ping + 자연어 대화');
      lines.push(`LOGIN_SESSION_TTL_MS=${deps.loginSessionTtlMs}`);
      lines.push(`LOGIN_SESSION_REFRESH_WINDOW_MS=${deps.loginSessionRefreshWindowMs}`);
    } else if (category === 'commands') {
      lines.push('한 줄 안내: 핵심은 /구독 하나이고 나머지는 보조 확인용입니다.');
      lines.push('보이는 명령어: /구독, /로그인, /도움말, /설정, /ping');
      lines.push('/구독 사용 예: 동작=추가, 종류=영상 + 링크, 링크=<YouTube 채널 링크>, 디스코드채널=<알림 채널>');
      lines.push('자연어 상호작용: 멘션 또는 답글로 요청');
      lines.push('채널 모드: 카테고리명 규칙(ai-chat, ai-utility, ai-off)으로 자동 적용');
      lines.push(`LEGACY_SUBSCRIBE_COMMAND_ENABLED=${String(deps.legacySubscribeCommandEnabled)}`);
      lines.push(`LEGACY_SESSION_COMMANDS_ENABLED=${String(deps.legacySessionCommandsEnabled)}`);
    } else if (category === 'automation') {
      lines.push('한 줄 안내: 자동화 점검/관리는 /구독에서 시작하면 됩니다.');
      lines.push('자동화는 내부 세션/스케줄러로 동작합니다.');
      lines.push('구독 관련 자동화는 /구독 명령 하나에서 통합 관리합니다.');
      lines.push(`LOGIN_SESSION_CLEANUP_INTERVAL_MS=${deps.loginSessionCleanupIntervalMs}`);
    }

    await interaction.reply({ ...buildSimpleEmbed('설정', lines.join('\n'), EMBED_INFO), ephemeral: true });
  };

  const handleLoginCommand = async (interaction: ChatInputCommandInteraction) => {
    const checks: string[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    const inGuild = Boolean(interaction.guildId);
    checks.push(`서버 채널 사용: ${inGuild ? 'OK' : 'FAIL'}`);
    if (!inGuild) blockers.push('서버 채널에서 다시 시도해주세요.');

    const admin = await deps.hasAdminPermission(interaction);
    checks.push(`관리자 권한: ${admin ? 'OK' : 'LIMITED'}`);

    checks.push(`LLM 설정: ${isAnyLlmConfigured() ? 'OK' : 'MISSING'}`);
    if (!isAnyLlmConfigured()) warnings.push('자연어 자동화 기능은 LLM 키 설정이 필요합니다.');

    checks.push(`주가 기능 키: ${isStockFeatureEnabled() ? 'OK' : 'MISSING'}`);
    checks.push(`Supabase 연결: ${isSupabaseConfigured() ? 'OK' : 'LIMITED'}`);
    checks.push(`명령 최소화 모드: ${deps.simpleCommandsEnabled ? 'ON' : 'OFF'}`);

    if (inGuild && blockers.length === 0 && interaction.guildId) {
      const mode = await deps.markUserLoggedIn(interaction.guildId, interaction.user.id);
      checks.push('사용자 로그인 세션: ACTIVE');
      checks.push(`세션 영속화: ${mode === 'persisted' ? 'OK' : 'MEMORY_ONLY'}`);
      checks.push(`세션 만료 정책: ttl=${deps.loginSessionTtlMs}ms, sliding=${deps.loginSessionRefreshWindowMs}ms`);
      if (mode !== 'persisted') warnings.push('Supabase 미설정 또는 저장 실패로 재시작 후 로그인 유지가 제한될 수 있습니다.');
    }

    const title = blockers.length === 0 ? '로그인/권한 진단: 정상' : '로그인/권한 진단: 점검 필요';
    const summary = blockers.length === 0 ? '로그인 세션이 활성화되었습니다. 이제 주요 기능 사용이 가능합니다.' : blockers.slice(0, 4).join('\n');

    await interaction.reply({
      ...buildSimpleEmbed(
        title,
        [
          '[진단 결과]',
          ...checks,
          '',
          '[안내]',
          blockers.length === 0 ? '이제 /구독 추가/해제와 자연어 요청을 사용할 수 있습니다. 문제가 지속되면 /도움말 확인 후 다시 시도하세요.' : summary,
          warnings.length > 0 ? '[제한 사항]' : '',
          ...(warnings.length > 0 ? warnings : []),
        ].join('\n'),
        blockers.length === 0 ? EMBED_SUCCESS : EMBED_WARN,
      ),
      ephemeral: true,
    });
  };

  const handleAdminSyncCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildSimpleEmbed('권한 오류', 'Admin permission is required.', EMBED_ERROR), ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await deps.forceRegisterSlashCommands();
    await interaction.editReply(buildSimpleEmbed('동기화 요청 완료', '슬래시 명령 재등록을 요청했습니다. 10~60초 후 다시 확인하세요.', EMBED_SUCCESS));
  };

  const handleAutomationRunCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildAdminCard('권한 오류', 'Admin permission is required.', ['요구 권한: Administrator'], EMBED_ERROR), ephemeral: true });
      return;
    }
    const jobName = interaction.options.getString('job', true);
    if (jobName !== 'youtube-monitor' && jobName !== 'news-monitor') {
      await interaction.reply({ ...buildAdminCard('입력 오류', 'Invalid job name.', ['허용 값: youtube-monitor, news-monitor'], EMBED_WARN), ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const result = await deps.triggerAutomationJob(jobName, { guildId: interaction.guildId || undefined });
    await interaction.editReply(buildAdminCard(result.ok ? '자동화 실행 수락' : '자동화 실행 실패', result.message, [`job=${jobName}`, `guild=${interaction.guildId || 'unknown'}`], result.ok ? EMBED_SUCCESS : EMBED_ERROR));
  };

  const handleReconnectCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildSimpleEmbed('권한 오류', 'Admin permission is required.', EMBED_ERROR), ephemeral: true });
      return;
    }
    const remaining = deps.getManualReconnectCooldownRemainingSec();
    if (remaining > 0) {
      await interaction.reply({ ...buildSimpleEmbed('재연결 대기', `Reconnect is on cooldown. Try again in ${remaining}s.`, EMBED_WARN), ephemeral: true });
      return;
    }
    if (!deps.hasActiveToken()) {
      await interaction.reply({ ...buildSimpleEmbed('재연결 실패', 'DISCORD token is not loaded.', EMBED_ERROR), ephemeral: true });
      return;
    }
    await interaction.reply({ ...buildSimpleEmbed('재연결 요청', 'Reconnect requested. Restarting Discord client...', EMBED_INFO), ephemeral: true });
    setTimeout(() => {
      void deps.requestManualReconnect(`slash-command:${interaction.user.id}`);
    }, 300);
  };

  const handleAdminCommand = async (
    interaction: ChatInputCommandInteraction,
    marketHandlers: {
      handleChannelIdCommand: (interaction: ChatInputCommandInteraction) => Promise<void>;
      handleForumIdCommand: (interaction: ChatInputCommandInteraction) => Promise<void>;
    },
  ) => {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case '상태': await handleStatusCommand(interaction); return;
      case '자동화실행':
      case '즉시전송': await handleAutomationRunCommand(interaction); return;
      case '재연결': await handleReconnectCommand(interaction); return;
      case '채널아이디': await marketHandlers.handleChannelIdCommand(interaction); return;
      case '포럼아이디': await marketHandlers.handleForumIdCommand(interaction); return;
      case '동기화': await handleAdminSyncCommand(interaction); return;
      default:
        await interaction.reply({ ...buildSimpleEmbed('명령 오류', '지원되지 않는 관리자 서브명령입니다.', EMBED_WARN), ephemeral: true });
    }
  };

  return {
    getRuntimeStatusLines,
    handleStatusCommand,
    handleHelpCommand,
    handleSettingsCommand,
    handleLoginCommand,
    handleAdminSyncCommand,
    handleAutomationRunCommand,
    handleReconnectCommand,
    handleAdminCommand,
  };
};
