import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import { buildAdminCard, buildSimpleEmbed, EMBED_ERROR, EMBED_INFO, EMBED_SUCCESS, EMBED_WARN } from '../ui';
import { isAnyLlmConfigured } from '../../services/llmClient';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { isStockFeatureEnabled } from '../../services/stockService';
import { isUserAdmin } from '../../services/adminAllowlistService';
import {
  forgetGuildRagData,
  forgetUserRagData,
  previewForgetGuildRagData,
  previewForgetUserRagData,
} from '../../services/privacyForgetService';
import { getGuildActionPolicy, upsertGuildActionPolicy } from '../../services/skills/actionGovernanceStore';
import { DISCORD_MESSAGES } from '../messages';

type BotRuntimeSnapshotLike = {
  ready: boolean;
  wsStatus: number;
  reconnectQueued: boolean;
  reconnectAttempts: number;
  dynamicWorkerRestoreEnabled?: boolean;
  dynamicWorkerRestoreApprovedCount?: number;
  dynamicWorkerRestoreSuccessCount?: number;
  dynamicWorkerRestoreFailedCount?: number;
  dynamicWorkerRestoreLastError?: string | null;
};

const LEARNING_POLICY_ACTION = 'memory_learning';

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
  getUsageSummaryLine: () => Promise<string>;
  getGuildUsageSummaryLine: (guildId: string | null) => Promise<string | null>;
  forceRegisterSlashCommands: () => Promise<void>;
  triggerAutomationJob: (jobName: string, options: { guildId?: string }) => Promise<{ ok: boolean; message: string }>;
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
      typeof bot.dynamicWorkerRestoreEnabled === 'boolean'
        ? `Dynamic worker restore: enabled=${String(bot.dynamicWorkerRestoreEnabled)} approved=${bot.dynamicWorkerRestoreApprovedCount || 0} restored=${bot.dynamicWorkerRestoreSuccessCount || 0} failed=${bot.dynamicWorkerRestoreFailedCount || 0}`
        : null,
      bot.dynamicWorkerRestoreLastError
        ? `Dynamic restore error: ${bot.dynamicWorkerRestoreLastError}`
        : null,
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
      ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleStatus, lines.join('\n'), EMBED_INFO),
      ephemeral: true,
    });
  };

  const handleHelpCommand = async (interaction: ChatInputCommandInteraction) => {
    const publicCommands = [
      '`/ping` : 봇 응답/지연 상태 확인',
      '`/로그인` : 내 계정 권한/세션 진단 및 수동 갱신',
      '`뮤엘 ...` 또는 `@Muel ...` : 자연어로 대화/요청',
      '`/구독` : 영상/게시글/뉴스 구독 (링크만 넣으면 현재 채널 자동 등록)',
      '`/해줘` : 기존 실행형 요청 호환 명령',
      '`/만들어줘` : 스레드 기반 협업 코딩/자동화 구현',
      '`/학습 조회|활성화|비활성화` : 내 자동 학습 저장 on/off (개인 설정)',
      '`/주가` : 현재가 조회',
      '`/차트` : 30일 차트 조회',
      '`/상태` : 봇/자동화 런타임 상태 확인',
      '`/설정` : 대시보드 이동',
      '`/잊어줘` : 내 데이터 또는 서버 데이터 삭제(확인 UX 제공)',
    ];
    const adminCommands = [
      '`/세션 조회` : 현재 작동 중인 세션 확인/즉시 실행 버튼',
      '`/세션 이력` : 최근 완료 세션 산출물(코드/결과) 요약 목록',
      '`/세션 제거` : 현재 작동 중인 세션 제거 버튼',
      '`/정책 조회` : 세션 한도·뉴스 도메인 허용 목록 조회',
      '`/정책 도메인추가` : 뉴스 캡처 허용 도메인 추가',
      '`/정책 도메인삭제` : 뉴스 캡처 허용 목록에서 도메인 삭제',
      '`/관리설정` : 학습 허용 on/off',
    ];

    await interaction.reply({
      embeds: [
        {
          title: DISCORD_MESSAGES.admin.titleHelp,
          color: 0x2f80ed,
          fields: [
            { name: DISCORD_MESSAGES.admin.fieldPublicCommands, value: publicCommands.join('\n') },
            { name: DISCORD_MESSAGES.admin.fieldAdminCommands, value: adminCommands.join('\n') },
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
    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleSettings, line, EMBED_INFO), ephemeral: true });
  };

  const handleManageSettingsCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titlePermissionError, DISCORD_MESSAGES.common.adminPermissionRequired, EMBED_ERROR), ephemeral: true });
      return;
    }
    if (!interaction.guildId) {
      await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
      return;
    }
    const mode = String(interaction.options.getString('학습') || '').trim().toLowerCase();
    if (mode === 'on' || mode === 'off') {
      await upsertGuildActionPolicy({
        guildId: interaction.guildId,
        actionName: LEARNING_POLICY_ACTION,
        enabled: mode === 'on',
        runMode: 'auto',
        actorId: interaction.user.id,
      });
    }
    const policy = await getGuildActionPolicy(interaction.guildId, LEARNING_POLICY_ACTION);
    const enabled = policy.enabled;
    await interaction.reply({
      ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleManageSettings, `학습 허용: ${enabled ? 'ON' : 'OFF'}\n(영구 저장됨: guild=${interaction.guildId})`, EMBED_INFO),
      ephemeral: true,
    });
  };

  const handleForgetCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
      return;
    }

    const action = String(interaction.options.getString('동작') || 'preview').trim().toLowerCase();
    const scope = String(interaction.options.getString('범위') || 'user').trim().toLowerCase();
    const confirm = String(interaction.options.getString('확인문구') || '').trim();
    const targetUser = interaction.options.getUser('대상유저')?.id || interaction.user.id;
    const admin = await isUserAdmin(interaction.user.id);

    await interaction.deferReply({ ephemeral: true });

    if (action === 'preview') {
      if (scope === 'guild') {
        if (!admin) {
          await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titlePermissionError, '길드 전체 미리보기는 관리자만 가능합니다.', EMBED_ERROR));
          return;
        }
        const preview = await previewForgetGuildRagData(interaction.guildId);
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titleForgetPreviewGuild, [
          `삭제 후보 합계: ${preview.supabase.totalCandidates}`,
          `Obsidian 후보 경로: ${preview.obsidian.candidatePaths.length}`,
          '실행 확인문구: FORGET_GUILD',
        ].join('\n'), EMBED_INFO));
        return;
      }

      const preview = await previewForgetUserRagData({ userId: targetUser, guildId: interaction.guildId });
      await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titleForgetPreviewUser, [
        `대상 user_id: ${targetUser}`,
        `삭제 후보 합계: ${preview.supabase.totalCandidates}`,
        `Obsidian 후보 경로: ${preview.obsidian.candidatePaths.length}`,
        `실행 확인문구: ${targetUser === interaction.user.id ? 'FORGET_USER' : 'FORGET_USER_ADMIN'}`,
      ].join('\n'), EMBED_INFO));
      return;
    }

    if (scope === 'guild') {
      if (!admin) {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titlePermissionError, '길드 전체 삭제는 관리자만 가능합니다.', EMBED_ERROR));
        return;
      }
      if (!confirm) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`forget_confirm_guild:${interaction.user.id}`)
            .setLabel('잊기')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`forget_cancel:${interaction.user.id}`)
            .setLabel('취소')
            .setStyle(ButtonStyle.Secondary),
        );
        await interaction.editReply({
          ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleForgetConfirm, '정말 삭제할까요? 뮤엘이 이 서버에 대한 기억을 모두 잃어버립니다.', EMBED_WARN),
          components: [row],
        });
        return;
      }
      if (confirm !== 'FORGET_GUILD') {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titleConfirmCodeError, '확인문구는 FORGET_GUILD 여야 합니다.', EMBED_WARN));
        return;
      }
      const result = await forgetGuildRagData({
        guildId: interaction.guildId,
        requestedBy: interaction.user.id,
        reason: 'slash:/잊어줘 guild',
      });
      await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titleForgetDoneGuild, [
        `삭제 합계: ${result.supabase.totalDeleted}`,
        `Obsidian 삭제 경로: ${result.obsidian.removedPaths.length}`,
      ].join('\n'), EMBED_SUCCESS));
      return;
    }

    const expected = targetUser === interaction.user.id ? 'FORGET_USER' : 'FORGET_USER_ADMIN';
    if (targetUser !== interaction.user.id && !admin) {
      await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titlePermissionError, '다른 유저 데이터 삭제는 관리자만 가능합니다.', EMBED_ERROR));
      return;
    }
    if (!confirm) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`forget_confirm_user:${targetUser}:${interaction.user.id}`)
          .setLabel('잊기')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`forget_cancel:${interaction.user.id}`)
          .setLabel('취소')
          .setStyle(ButtonStyle.Secondary),
      );
      await interaction.editReply({
        ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleForgetConfirm, `정말 삭제할까요? 뮤엘이 @${targetUser}에 대한 기억을 모두 잃어버립니다.`, EMBED_WARN),
        components: [row],
      });
      return;
    }

    if (confirm !== expected) {
      await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titleConfirmCodeError, `확인문구는 ${expected} 여야 합니다.`, EMBED_WARN));
      return;
    }
    const result = await forgetUserRagData({
      userId: targetUser,
      guildId: interaction.guildId,
      requestedBy: interaction.user.id,
      reason: 'slash:/잊어줘 user',
    });
    await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titleForgetDoneUser, [
      `대상 user_id: ${targetUser}`,
      `삭제 합계: ${result.supabase.totalDeleted}`,
      `Obsidian 삭제 경로: ${result.obsidian.removedPaths.length}`,
    ].join('\n'), EMBED_SUCCESS));
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
      await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titlePermissionError, DISCORD_MESSAGES.common.adminPermissionRequired, EMBED_ERROR), ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await deps.forceRegisterSlashCommands();
    await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.admin.titleSyncDone, DISCORD_MESSAGES.admin.syncRequested, EMBED_SUCCESS));
  };

  const handleAutomationRunCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildAdminCard(DISCORD_MESSAGES.admin.titlePermissionError, DISCORD_MESSAGES.common.adminPermissionRequired, [DISCORD_MESSAGES.admin.permissionRequirementLine], EMBED_ERROR), ephemeral: true });
      return;
    }
    const jobName = interaction.options.getString('job', true);
    const snapshot = deps.getAutomationRuntimeSnapshot();
    const allowedJobs = Object.keys(snapshot.jobs);
    if (!allowedJobs.includes(jobName)) {
      await interaction.reply({ ...buildAdminCard(DISCORD_MESSAGES.admin.titleInputError, DISCORD_MESSAGES.admin.invalidJobName, [DISCORD_MESSAGES.admin.allowedJobs], EMBED_WARN), ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const result = await deps.triggerAutomationJob(jobName, { guildId: interaction.guildId || undefined });
    await interaction.editReply(buildAdminCard(result.ok ? DISCORD_MESSAGES.admin.titleAutomationAccepted : DISCORD_MESSAGES.admin.titleAutomationFailed, result.message, [`job=${jobName}`, `guild=${interaction.guildId || 'unknown'}`], result.ok ? EMBED_SUCCESS : EMBED_ERROR));
  };

  const handleReconnectCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titlePermissionError, DISCORD_MESSAGES.common.adminPermissionRequired, EMBED_ERROR), ephemeral: true });
      return;
    }
    const remaining = deps.getManualReconnectCooldownRemainingSec();
    if (remaining > 0) {
      await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleReconnectWait, DISCORD_MESSAGES.admin.reconnectCooldown(remaining), EMBED_WARN), ephemeral: true });
      return;
    }
    if (!deps.hasActiveToken()) {
      await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleReconnectFailed, DISCORD_MESSAGES.admin.tokenNotLoaded, EMBED_ERROR), ephemeral: true });
      return;
    }
    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.admin.titleReconnectRequested, DISCORD_MESSAGES.admin.reconnectRequested, EMBED_INFO), ephemeral: true });
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
        await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.agent.titleCommandError, DISCORD_MESSAGES.admin.unknownAdminSubcommand, EMBED_WARN), ephemeral: true });
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
    handleForgetCommand,
  };
};
