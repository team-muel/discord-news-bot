import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import type { AgentSession } from '../../services/multiAgentService';
import {
  cancelAgentSession,
  getAgentPolicy,
  getAgentSession,
  getMultiAgentRuntimeSnapshot,
  listAgentSkills,
  listGuildAgentSessions,
  startAgentSession,
} from '../../services/multiAgentService';
import { getAgentOpsSnapshot, triggerDailyLearningRun, triggerGuildOnboardingSession } from '../../services/agentOpsService';
import { listGuildAllowedDomains, upsertGuildDomainPolicy } from '../../services/skills/actionGovernanceStore';
import { isUserLearningEnabled, setUserLearningEnabled } from '../../services/userLearningPrefsService';
import { DISCORD_MESSAGES } from '../messages';
import { buildAdminCard, buildSimpleEmbed, EMBED_ERROR, EMBED_INFO, EMBED_SUCCESS, EMBED_WARN } from '../ui';
import { DISCORD_AGENT_RESULT_PREVIEW_LIMIT } from '../runtimePolicy';

export const formatAgentSessionLine = (session: AgentSession) => {
  const safeGoal = String(session.goal || '').replace(/\s+/g, ' ').slice(0, 48);
  return `${session.id} | ${session.status} | priority=${session.priority} | ${session.updatedAt} | ${safeGoal}`;
};

type AgentDeps = {
  client: { guilds: { cache: unknown } } & Record<string, any>;
  hasAdminPermission: (interaction: ChatInputCommandInteraction) => Promise<boolean>;
  handleGroupedSubscribeCommand: (interaction: ChatInputCommandInteraction) => Promise<void>;
  inferSessionSkill: (text: string) => 'ops-plan' | 'ops-execution' | 'ops-critique' | 'guild-onboarding-blueprint' | 'incident-review' | 'webhook';
  streamSessionProgress: (sink: { update: (content: string) => Promise<unknown> }, sessionId: string, goal: string, options: { showDebugBlocks: boolean; maxLinks: number }) => Promise<void>;
  getRuntimeStatusLines: (guildId: string | null) => Promise<string[]>;
  getErrorMessage: (error: unknown) => string;
  getChain: (sessionId: string) => Array<{ sessionId: string; goalSummary: string; codeBlocks: string[]; threadId?: string; createdAt: string }>;
  listGuildArtifacts: (guildId: string, limit?: number) => Array<{ sessionId: string; goalSummary: string; codeBlocks: string[]; threadId?: string; createdAt: string }>;
};

export const createAgentHandlers = (deps: AgentDeps) => {
  const toSessionStatusLabel = (status: string): string => {
    if (status === 'queued') return '대기 중';
    if (status === 'running') return '진행 중';
    if (status === 'completed') return '완료';
    if (status === 'failed') return '실패';
    return '알 수 없음';
  };

  const handleSessionCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildAdminCard(DISCORD_MESSAGES.agent.titlePermissionError, DISCORD_MESSAGES.common.adminPermissionRequired, [DISCORD_MESSAGES.agent.permissionRequirementLine], EMBED_ERROR), ephemeral: true });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({ ...buildAdminCard(DISCORD_MESSAGES.agent.titleUsageError, DISCORD_MESSAGES.common.guildOnly, [], EMBED_WARN), ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === '조회') {
      await interaction.deferReply({ ephemeral: true });
      const sessions = listGuildAgentSessions(interaction.guildId, 10)
        .filter((session) => session.status === 'queued' || session.status === 'running');
      if (sessions.length === 0) {
        await interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titleSessionList, DISCORD_MESSAGES.agent.noRunningSession, [], EMBED_INFO));
        return;
      }

      const preview = sessions.slice(0, 5);
      const lines = preview.map((s, i) => `${i + 1}. ${s.goal.replace(/\s+/g, ' ').slice(0, 60)} (${toSessionStatusLabel(s.status)})`);
      const runRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...preview.map((s, i) => new ButtonBuilder()
          .setCustomId(`session_run:${s.id}`)
          .setLabel(`${i + 1} 실행`)
          .setStyle(ButtonStyle.Primary)),
      );

      await interaction.editReply({
        ...buildAdminCard(DISCORD_MESSAGES.agent.titleSessionList, DISCORD_MESSAGES.agent.runningSessionCount(sessions.length), lines, EMBED_INFO),
        components: [runRow],
      });
      return;
    }

    if (sub === '이력') {
      await interaction.deferReply({ ephemeral: true });
      const artifacts = deps.listGuildArtifacts(interaction.guildId, 10);
      if (artifacts.length === 0) {
        await interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titleSessionHistory, DISCORD_MESSAGES.agent.noHistory, [], EMBED_INFO));
        return;
      }

      const lines = artifacts.slice(0, 10).map((artifact, i) => {
        const goalSummary = String(artifact.goalSummary || '').replace(/\s+/g, ' ').trim() || '요약 없음';
        const created = String(artifact.createdAt || '').slice(0, 19).replace('T', ' ');
        const threadPart = artifact.threadId ? ' | 스레드 작업' : '';
        return `${i + 1}. ${goalSummary} | 코드 ${artifact.codeBlocks.length}개 | ${created}${threadPart}`;
      });

      await interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titleSessionHistory, DISCORD_MESSAGES.agent.historyCount(artifacts.length), lines, EMBED_INFO));
      return;
    }

    if (sub === '구독') {
      await deps.handleGroupedSubscribeCommand(interaction);
      return;
    }

    if (sub === '제거') {
      await interaction.deferReply({ ephemeral: true });
      const sessions = listGuildAgentSessions(interaction.guildId, 10)
        .filter((session) => session.status === 'queued' || session.status === 'running');
      if (sessions.length === 0) {
        await interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titleSessionRemove, DISCORD_MESSAGES.agent.noRemovableSession, [], EMBED_INFO));
        return;
      }

      const preview = sessions.slice(0, 5);
      const lines = preview.map((s, i) => `${i + 1}. ${s.goal.replace(/\s+/g, ' ').slice(0, 60)} (${toSessionStatusLabel(s.status)})`);
      const removeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...preview.map((s, i) => new ButtonBuilder()
          .setCustomId(`session_remove:${s.id}`)
          .setLabel(`${i + 1} 제거`)
          .setStyle(ButtonStyle.Danger)),
      );

      await interaction.editReply({
        ...buildAdminCard(DISCORD_MESSAGES.agent.titleSessionRemove, DISCORD_MESSAGES.agent.runningSessionCount(sessions.length), lines, EMBED_WARN),
        components: [removeRow],
      });
      return;
    }

    await interaction.reply({ ...buildAdminCard(DISCORD_MESSAGES.agent.titleCommandError, DISCORD_MESSAGES.common.unknownSubcommand, [], EMBED_WARN), ephemeral: true });
  };

  const handleAgentCommand = async (interaction: ChatInputCommandInteraction, forcedSub?: string) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildAdminCard(DISCORD_MESSAGES.agent.titlePermissionError, DISCORD_MESSAGES.common.adminPermissionRequired, [DISCORD_MESSAGES.agent.permissionRequirementLine], EMBED_ERROR), ephemeral: true });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({ ...buildAdminCard(DISCORD_MESSAGES.agent.titleUsageError, DISCORD_MESSAGES.common.guildOnly, [], EMBED_WARN), ephemeral: true });
      return;
    }

    const sub = forcedSub || interaction.options.getSubcommand();

    if (sub === '실행' || sub === '시작') {
      const shared = (interaction.options.getString('공개범위') || 'private') === 'public';
      await interaction.deferReply({ ephemeral: !shared });
      const goal = interaction.options.getString('목표', true).trim();
      const skillId = (interaction.options.getString('스킬') || '').trim();
      const priority = (interaction.options.getString('우선순위') || 'balanced').trim();
      if (!goal) {
        await interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titleInputError, DISCORD_MESSAGES.agent.goalRequired, [DISCORD_MESSAGES.agent.goalParameterHint], EMBED_WARN));
        return;
      }

      let session: AgentSession;
      try {
        session = startAgentSession({ guildId: interaction.guildId, requestedBy: interaction.user.id, goal, skillId: skillId || null, priority, isAdmin: true });
      } catch (error) {
        await interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titleSessionStartFailed, deps.getErrorMessage(error), [`guild=${interaction.guildId}`], EMBED_ERROR));
        return;
      }

      await interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titleRequestAccepted, DISCORD_MESSAGES.agent.requestAcceptedLines(session.id, session.goal, session.priority).join('\n'), [`session=${session.id}`, `requestedBy=${interaction.user.id}`], EMBED_INFO));
      await deps.streamSessionProgress({ update: (content) => interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titleProgress, content, [`session=${session.id}`], EMBED_INFO)) }, session.id, session.goal, { showDebugBlocks: session.priority === 'precise' && !shared, maxLinks: 4 });
      return;
    }

    if (sub === '온보딩') {
      await interaction.deferReply({ ephemeral: true });
      const result = triggerGuildOnboardingSession({ guildId: interaction.guildId, guildName: interaction.guild?.name, requestedBy: interaction.user.id, reason: 'slash-command-onboarding' });
      await interaction.editReply(buildSimpleEmbed(result.ok ? DISCORD_MESSAGES.agent.titleOnboardingStarted : DISCORD_MESSAGES.agent.titleOnboardingSkipped, result.ok ? DISCORD_MESSAGES.agent.onboardingSession(String(result.sessionId || '')) : result.message, result.ok ? EMBED_SUCCESS : EMBED_WARN));
      return;
    }

    if (sub === '학습') {
      await interaction.deferReply({ ephemeral: true });
      const customGoal = (interaction.options.getString('목표') || '').trim();
      if (customGoal) {
        try {
          const session = startAgentSession({ guildId: interaction.guildId, requestedBy: interaction.user.id, goal: customGoal, skillId: 'incident-review', priority: 'balanced', isAdmin: true });
          await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleLearningStarted, DISCORD_MESSAGES.agent.onboardingSession(session.id), EMBED_SUCCESS));
        } catch (error) {
          await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleLearningRunFailed, deps.getErrorMessage(error), EMBED_ERROR));
        }
        return;
      }
      const result = triggerDailyLearningRun(deps.client as any, interaction.guildId);
      await interaction.editReply(buildSimpleEmbed(result.ok ? DISCORD_MESSAGES.agent.titleLearningRunResult : DISCORD_MESSAGES.agent.titleLearningRunFailed, result.message, result.ok ? EMBED_SUCCESS : EMBED_ERROR));
      return;
    }

    if (sub === '스킬목록') {
      await interaction.deferReply({ ephemeral: true });
      const skills = listAgentSkills();
      await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleSkillList, DISCORD_MESSAGES.agent.skillListSummary(skills.length, skills.map((s) => `${s.id} | ${s.title} | ${s.description}`).join('\n')), EMBED_INFO));
      return;
    }

    if (sub === '정책') {
      await interaction.deferReply({ ephemeral: true });
      const policy = getAgentPolicy();
      const ops = getAgentOpsSnapshot();
      await interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titlePolicyStatus, [`동시 세션 한도: ${policy.maxConcurrentSessions}`, `목표 최대 길이: ${policy.maxGoalLength}`, `제한 스킬: ${policy.restrictedSkills.join(', ') || '없음'}`, `자동 온보딩: ${String(ops.autoOnboardingEnabled)}`, `일일 학습 루프: ${String(ops.dailyLearningEnabled)} (hour=${ops.dailyLearningHour})`].join('\n'), [`guild=${interaction.guildId}`], EMBED_INFO));
      return;
    }

    if (sub === '상태') {
      await interaction.deferReply({ ephemeral: true });
      const statusType = (interaction.options.getString('종류') || 'all').trim();
      const sessionId = (interaction.options.getString('세션아이디') || '').trim();
      const includeRuntime = statusType === 'all' || statusType === 'runtime';
      const includeSession = statusType === 'all' || statusType === 'session';

      if (!includeSession) {
        const runtimeLines = await deps.getRuntimeStatusLines(interaction.guildId);
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleStatus, runtimeLines.join('\n'), EMBED_INFO));
        return;
      }

      if (sessionId) {
        const session = getAgentSession(sessionId);
        if (!session || session.guildId !== interaction.guildId) {
          await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleQueryFailed, DISCORD_MESSAGES.agent.sessionNotFound, EMBED_WARN));
          return;
        }

        const steps = session.steps.map((step, index) => `${index + 1}. ${step.role}(${step.status}) - ${step.title}`).join('\n');
        const runtime = getMultiAgentRuntimeSnapshot();
        const runtimeLines = includeRuntime ? await deps.getRuntimeStatusLines(interaction.guildId) : [];

        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleSessionStatus, [
          ...runtimeLines,
          '[세션 상태]',
          `세션: ${session.id}`,
          `상태: ${session.status}`,
          `우선순위: ${session.priority}`,
          `생성: ${session.createdAt}`,
          `목표: ${session.goal}`,
          '',
          '[스텝]',
          `스텝:\n${steps}`,
          session.error ? `오류: ${session.error}` : '',
          '',
          '[결과]',
          session.result ? `결과 요약:\n${session.result.slice(0, DISCORD_AGENT_RESULT_PREVIEW_LIMIT)}` : DISCORD_MESSAGES.agent.resultPending,
          '',
          '[런타임 요약]',
          DISCORD_MESSAGES.agent.runtimeSummary(runtime.runningSessions, runtime.completedSessions, runtime.failedSessions),
        ].filter(Boolean).join('\n\n'), EMBED_INFO));
        return;
      }

      const sessions = listGuildAgentSessions(interaction.guildId, 8);
      const runtime = getMultiAgentRuntimeSnapshot();
      const runtimeLines = includeRuntime ? await deps.getRuntimeStatusLines(interaction.guildId) : [];
      if (sessions.length === 0) {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleSessionStatus, [...runtimeLines, DISCORD_MESSAGES.agent.noRecentSessions, DISCORD_MESSAGES.agent.runtimeSummary(runtime.runningSessions, runtime.completedSessions, runtime.failedSessions)].join('\n'), EMBED_INFO));
        return;
      }

      await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleSessionStatus, [
        ...runtimeLines,
        DISCORD_MESSAGES.agent.recentSessionHeader,
        DISCORD_MESSAGES.agent.recentSessionListTitle,
        sessions.map((session) => formatAgentSessionLine(session)).join('\n'),
        '',
        '[런타임 요약]',
        DISCORD_MESSAGES.agent.runtimeSummary(runtime.runningSessions, runtime.completedSessions, runtime.failedSessions),
        DISCORD_MESSAGES.agent.detailLookupHint,
      ].join('\n'), EMBED_INFO));
      return;
    }

    if (sub === '중지') {
      await interaction.deferReply({ ephemeral: true });
      const sessionId = interaction.options.getString('세션아이디', true).trim();
      const session = getAgentSession(sessionId);
      if (!session || session.guildId !== interaction.guildId) {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleStopFailed, DISCORD_MESSAGES.agent.sessionNotFound, EMBED_WARN));
        return;
      }
      const result = cancelAgentSession(sessionId);
      await interaction.editReply(buildSimpleEmbed(result.ok ? DISCORD_MESSAGES.agent.titleStopAccepted : DISCORD_MESSAGES.agent.titleStopFailed, result.ok ? DISCORD_MESSAGES.agent.onboardingSession(sessionId) : result.message, result.ok ? EMBED_SUCCESS : EMBED_ERROR));
      return;
    }

    if (sub === '이력') {
      if (!interaction.guildId) {
        await interaction.reply({ content: DISCORD_MESSAGES.common.guildOnly, ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const sessionId = (interaction.options.getString('세션아이디') || '').trim();
      if (sessionId) {
        const chain = deps.getChain(sessionId);
        if (chain.length === 0) {
          await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleHistoryQuery, DISCORD_MESSAGES.agent.noSessionArtifactHistory, EMBED_WARN));
          return;
        }
        const chainLines = chain.map((e, i) => `${i === 0 ? '🌱 원본' : `↳ v${i + 1}`} [${e.sessionId.slice(0, 8)}] ${e.goalSummary} | 파일 ${e.codeBlocks.length}개${e.threadId ? ' 🧵 스레드 있음' : ''} | ${e.createdAt.slice(0, 10)}`);
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.historyChainTitle(chain.length), chainLines.join('\n'), EMBED_INFO));
        return;
      }
      const recent = deps.listGuildArtifacts(interaction.guildId, 10);
      if (recent.length === 0) {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleHistoryQuery, DISCORD_MESSAGES.agent.noGuildArtifactHistory, EMBED_INFO));
        return;
      }
      const recentLines = recent.map((e) => `[${e.sessionId.slice(0, 8)}] ${e.goalSummary} | 파일 ${e.codeBlocks.length}개${e.threadId ? ' 🧵' : ''} | ${e.createdAt.slice(0, 10)}`);
      await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.recentArtifactTitle(recent.length), `${recentLines.join('\n')}\n\n${DISCORD_MESSAGES.agent.historyLookupHint}`, EMBED_INFO));
      return;
    }

    await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.agent.titleCommandError, DISCORD_MESSAGES.common.unknownCommand, EMBED_WARN), ephemeral: true });
  };

  const handlePolicyCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!(await deps.hasAdminPermission(interaction))) {
      await interaction.reply({ ...buildAdminCard(DISCORD_MESSAGES.agent.titlePermissionError, DISCORD_MESSAGES.common.adminPermissionRequired, [], EMBED_ERROR), ephemeral: true });
      return;
    }
    if (!interaction.guildId) {
      await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.agent.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();

    if (sub === '조회') {
      const policy = getAgentPolicy();
      const ops = getAgentOpsSnapshot();
      const domains = await listGuildAllowedDomains(interaction.guildId);
      const domainBlock = domains.length > 0
        ? domains.map((d) => `• ${d}`).join('\n')
        : DISCORD_MESSAGES.agent.policyDomainEmpty;
      const lines = [
        `동시 세션 한도: ${policy.maxConcurrentSessions}`,
        `목표 최대 길이: ${policy.maxGoalLength}`,
        `제한 스킬: ${policy.restrictedSkills.join(', ') || '없음'}`,
        `자동 온보딩: ${String(ops.autoOnboardingEnabled)}`,
        `일일 학습 루프: ${String(ops.dailyLearningEnabled)} (hour=${ops.dailyLearningHour})`,
        '',
        DISCORD_MESSAGES.agent.policyDomainHeader(domains.length),
        domainBlock,
      ].join('\n');
      await interaction.editReply(buildAdminCard(DISCORD_MESSAGES.agent.titlePolicyView, lines, [`guild=${interaction.guildId}`], EMBED_INFO));
      return;
    }

    if (sub === '도메인추가') {
      const rawDomain = interaction.options.getString('도메인', true).trim();
      try {
        const result = await upsertGuildDomainPolicy({
          guildId: interaction.guildId,
          domain: rawDomain,
          allowed: true,
          actorId: interaction.user.id,
        });
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titlePolicyAddDone, DISCORD_MESSAGES.agent.policyDomainAdded(result.domain), EMBED_SUCCESS));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titlePolicyAddFailed, DISCORD_MESSAGES.agent.errorPrefix(msg), EMBED_ERROR));
      }
      return;
    }

    if (sub === '도메인삭제') {
      const rawDomain = interaction.options.getString('도메인', true).trim();
      try {
        const result = await upsertGuildDomainPolicy({
          guildId: interaction.guildId,
          domain: rawDomain,
          allowed: false,
          actorId: interaction.user.id,
        });
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titlePolicyDeleteDone, DISCORD_MESSAGES.agent.policyDomainRemoved(result.domain), EMBED_WARN));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titlePolicyDeleteFailed, DISCORD_MESSAGES.agent.errorPrefix(msg), EMBED_ERROR));
      }
      return;
    }
  };

  const handleUserLearningCommand = async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply({ ...buildSimpleEmbed(DISCORD_MESSAGES.agent.titleUsageError, DISCORD_MESSAGES.common.guildOnly, EMBED_WARN), ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    if (sub === '조회') {
      const enabled = await isUserLearningEnabled(userId, guildId);
      const statusText = enabled ? DISCORD_MESSAGES.agent.learningEnabled : DISCORD_MESSAGES.agent.learningDisabled;
      await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleLearningState, DISCORD_MESSAGES.agent.learningStatusLine(statusText), EMBED_INFO));
      return;
    }

    if (sub === '활성화') {
      const ok = await setUserLearningEnabled(userId, guildId, true, userId);
      if (ok) {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleLearningEnabled, DISCORD_MESSAGES.agent.learningEnabledDone, EMBED_SUCCESS));
      } else {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleEnableFailed, DISCORD_MESSAGES.common.saveFailedRetry, EMBED_ERROR));
      }
      return;
    }

    if (sub === '비활성화') {
      const ok = await setUserLearningEnabled(userId, guildId, false, userId);
      if (ok) {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleLearningDisabled, DISCORD_MESSAGES.agent.learningDisabledDone, EMBED_WARN));
      } else {
        await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleDisableFailed, DISCORD_MESSAGES.common.saveFailedRetry, EMBED_ERROR));
      }
      return;
    }

    await interaction.editReply(buildSimpleEmbed(DISCORD_MESSAGES.agent.titleCommandError, DISCORD_MESSAGES.common.unknownSubcommand, EMBED_WARN));
  };

  return { handleSessionCommand, handleAgentCommand, handlePolicyCommand, handleUserLearningCommand };
};
