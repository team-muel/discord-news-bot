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

const guildLearningPolicy = new Map<string, boolean>();

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
    const publicCommands = [
      '/ping',
      '/로그인',
      '/뮤엘 또는 @Muel',
      '/구독 (영상/게시글/뉴스, 링크만 넣으면 현재 채널 자동 등록)',
      '/해줘',
      '/만들어줘',
      '/주가',
      '/차트',
      '/상태',
      '/설정 (대시보드 이동)',
    ];
    const adminCommands = [
      '/세션 조회',
      '/세션 제거',
      '/정책',
      '/관리설정',
    ];

    await interaction.reply({
      embeds: [
        {
          title: 'Muel 명령어 안내',
          color: 0x2f80ed,
          fields: [
            { name: '기본 명령어', value: publicCommands.join('\n') },
            { name: '관리자 명령어', value: adminCommands.join('\n') },
          ],
        },
      ],
      ephemeral: true,
    });
  };

  const handleSettingsCommand = async (interaction: ChatInputCommandInteraction) => {
    const base = String(process.env.PUBLIC_BASE_URL || process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
    const dashboardUrl = base ? `${base.replace(/\/$/, '')}/dashboard` : '';
    const line = dashboardUrl
      ? `대시보드로 이동: ${dashboardUrl}`
      : '대시보드 URL이 설정되지 않았습니다. PUBLIC_BASE_URL 또는 FRONTEND_ORIGIN을 설정해주세요.';
    await interaction.reply({ ...buildSimpleEmbed('설정', line, EMBED_INFO), ephemeral: true });
  };

  const handleManageSettingsCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildSimpleEmbed('권한 오류', 'Admin permission is required.', EMBED_ERROR), ephemeral: true });
      return;
    }
    if (!interaction.guildId) {
      await interaction.reply({ ...buildSimpleEmbed('사용 위치 오류', '서버 채널에서만 사용할 수 있습니다.', EMBED_WARN), ephemeral: true });
      return;
    }
    const mode = String(interaction.options.getString('학습') || '').trim().toLowerCase();
    if (mode === 'on') guildLearningPolicy.set(interaction.guildId, true);
    if (mode === 'off') guildLearningPolicy.set(interaction.guildId, false);
    const enabled = guildLearningPolicy.get(interaction.guildId) ?? true;
    await interaction.reply({
      ...buildSimpleEmbed('관리 설정', `학습 허용: ${enabled ? 'ON' : 'OFF'}\n(현재는 런타임 설정이며 재시작 시 초기화될 수 있습니다.)`, EMBED_INFO),
      ephemeral: true,
    });
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
    handleManageSettingsCommand,
  };
};
