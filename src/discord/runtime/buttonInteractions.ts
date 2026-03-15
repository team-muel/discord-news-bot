import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import { isUserAdmin } from '../../services/adminAllowlistService';
import { getAgentSession } from '../../services/multiAgentService';
import { forgetGuildRagData, forgetUserRagData } from '../../services/privacyForgetService';
import {
  getApproval,
  updateApprovalStatus,
} from '../../services/workerGeneration/workerApprovalStore';
import {
  loadDynamicWorkerFromCode,
  loadDynamicWorkerFromFile,
} from '../../services/workerGeneration/dynamicWorkerRegistry';
import {
  recordWorkerApprovalDecision,
  recordWorkerGenerationResult,
  recordWorkerProposalClick,
} from '../../services/workerGeneration/workerProposalMetrics';
import {
  rerunWorkerPipeline,
  runWorkerGenerationPipeline,
} from '../../services/workerGeneration/workerGenerationPipeline';
import { cleanupSandbox } from '../../services/workerGeneration/workerSandbox';
import { evaluateWorkerActivationGate } from '../../services/agentRuntimeReadinessService';
import { DISCORD_MESSAGES } from '../messages';
import {
  DISCORD_MSG_LIMIT,
  buildCodeActionRow,
  extractCodeBlocks,
} from '../../utils/codeThread';
import { getArtifact, getChain, saveArtifact } from '../../utils/sessionArtifactStore';
import {
  handleSessionControlButton,
  SESSION_BUTTON_ACTIONS,
} from './sessionControl';

const CODE_BUTTON_ACTIONS = new Set(['code_regen', 'code_refactor', 'code_test', 'code_history']);
const WORKER_BUTTON_ACTIONS = new Set(['worker_propose', 'worker_approve', 'worker_reject', 'worker_refactor']);
const FORGET_BUTTON_ACTIONS = new Set(['forget_confirm_user', 'forget_confirm_guild', 'forget_cancel']);

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const handleButtonInteraction = async (params: {
  interaction: ButtonInteraction;
  client: Client;
  workerApprovalChannelId: string;
  startVibeSession: (guildId: string, userId: string, goal: string) => { id: string };
  streamSessionProgress: (
    sink: { update: (content: string) => Promise<unknown> },
    sessionId: string,
    goal: string,
    options: { showDebugBlocks: boolean; maxLinks: number },
  ) => Promise<void>;
}): Promise<boolean> => {
  const { interaction, client, workerApprovalChannelId, startVibeSession, streamSessionProgress } = params;

  const customId = interaction.customId || '';
  const colonIdx = customId.indexOf(':');
  if (colonIdx < 0) {
    return false;
  }

  const action = customId.slice(0, colonIdx);
  const parentSessionId = customId.slice(colonIdx + 1).trim();

  if (!CODE_BUTTON_ACTIONS.has(action)
    && !WORKER_BUTTON_ACTIONS.has(action)
    && !SESSION_BUTTON_ACTIONS.has(action)
    && !FORGET_BUTTON_ACTIONS.has(action)) {
    return false;
  }

  if (!interaction.guildId) {
    await interaction.reply({ content: DISCORD_MESSAGES.bot.guildOnly, ephemeral: true });
    return true;
  }

  if (FORGET_BUTTON_ACTIONS.has(action)) {
    const payloadParts = parentSessionId.split(':');
    const requesterId = payloadParts[payloadParts.length - 1] || '';
    if (!requesterId || requesterId !== interaction.user.id) {
      await interaction.reply({ content: DISCORD_MESSAGES.bot.forgetRequesterOnly, ephemeral: true });
      return true;
    }

    if (action === 'forget_cancel') {
      await interaction.update({ content: DISCORD_MESSAGES.bot.forgetCancelled, components: [] });
      return true;
    }

    if (action === 'forget_confirm_guild') {
      if (!(await isUserAdmin(interaction.user.id))) {
        await interaction.reply({ content: DISCORD_MESSAGES.bot.forgetGuildAdminOnly, ephemeral: true });
        return true;
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await forgetGuildRagData({
          guildId: interaction.guildId,
          requestedBy: interaction.user.id,
          reason: 'button:forget_confirm_guild',
        });
        await interaction.editReply(DISCORD_MESSAGES.bot.forgetGuildDone(result.supabase.totalDeleted, result.obsidian.removedPaths.length));
      } catch (error) {
        await interaction.editReply(DISCORD_MESSAGES.bot.forgetGuildFailed(toErrorMessage(error)));
      }
      return true;
    }

    const targetUserId = payloadParts[0] || '';
    if (!targetUserId) {
      await interaction.reply({ content: DISCORD_MESSAGES.bot.forgetTargetMissing, ephemeral: true });
      return true;
    }
    if (targetUserId !== interaction.user.id && !(await isUserAdmin(interaction.user.id))) {
      await interaction.reply({ content: DISCORD_MESSAGES.bot.forgetOtherUserAdminOnly, ephemeral: true });
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await forgetUserRagData({
        userId: targetUserId,
        guildId: interaction.guildId,
        requestedBy: interaction.user.id,
        reason: 'button:forget_confirm_user',
      });
      await interaction.editReply(DISCORD_MESSAGES.bot.forgetUserDone(result.supabase.totalDeleted, result.obsidian.removedPaths.length));
    } catch (error) {
      await interaction.editReply(DISCORD_MESSAGES.bot.forgetUserFailed(toErrorMessage(error)));
    }
    return true;
  }

  if (SESSION_BUTTON_ACTIONS.has(action)) {
    await handleSessionControlButton({
      interaction,
      action,
      sessionId: parentSessionId,
    });
    return true;
  }

  if (WORKER_BUTTON_ACTIONS.has(action)) {
    if (action === 'worker_propose') {
      const sepIdx = parentSessionId.indexOf(':');
      const goalEncoded = sepIdx >= 0 ? parentSessionId.slice(sepIdx + 1) : '';
      const goal = goalEncoded ? decodeURIComponent(goalEncoded) : parentSessionId;

      await interaction.deferReply({ ephemeral: true });
      recordWorkerProposalClick();
      const pipeResult = await runWorkerGenerationPipeline({
        goal,
        guildId: interaction.guildId,
        requestedBy: interaction.user.id,
      });
      recordWorkerGenerationResult(pipeResult.ok, pipeResult.ok ? undefined : pipeResult.error);

      if (!pipeResult.ok) {
        await interaction.editReply(`❌ 워커 생성 실패: ${pipeResult.error}`);
        return true;
      }

      const appr = pipeResult.approval;
      const validLine = appr.validationPassed
        ? '✅ 검증 통과'
        : `⚠️ 검증 이슈 ${appr.validationErrors.length}개: ${appr.validationErrors.slice(0, 2).join('; ')}`;
      const codeSnippet = appr.generatedCode.length > 1400
        ? `${appr.generatedCode.slice(0, 1400)}\n... (truncated)`
        : appr.generatedCode;

      const adminRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`worker_approve:${appr.id}`).setLabel('✅ 배포 승인').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`worker_reject:${appr.id}`).setLabel('❌ 반려').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`worker_refactor:${appr.id}`).setLabel('🔧 리팩토링 지시').setStyle(ButtonStyle.Secondary),
      );

      const adminContent = [
        '📦 **새 워커 생성 승인 요청**',
        `요청자: <@${interaction.user.id}>`,
        `목적: ${goal.slice(0, 100)}`,
        `액션 이름: \`${appr.actionName}\``,
        `승인 ID: \`${appr.id}\``,
        `상태: ${validLine}`,
        '',
        '**생성된 코드:**',
        `\`\`\`javascript\n${codeSnippet}\n\`\`\``,
      ].join('\n').slice(0, 1950);

      let adminMsgId: string | undefined;
      let adminChId: string | undefined;
      try {
        const targetChId = workerApprovalChannelId || interaction.channelId || '';
        if (targetChId) {
          const adminCh = await client.channels.fetch(targetChId);
          if (adminCh && 'send' in adminCh) {
            const sent = await (adminCh as any).send({ content: adminContent, components: [adminRow] });
            adminMsgId = sent.id as string;
            adminChId = targetChId;
          }
        }
      } catch (error) {
        // best effort only
      }

      await updateApprovalStatus(appr.id, 'pending', { adminMessageId: adminMsgId, adminChannelId: adminChId });
      await interaction.editReply(
        adminMsgId
          ? `📨 관리자 채널에 승인 요청을 보냈습니다.\n승인 ID: \`${appr.id}\``
          : `⚠️ 채널 전송에 실패했습니다. 관리자에게 승인 ID를 전달해주세요: \`${appr.id}\``,
      );
      return true;
    }

    if (!(await isUserAdmin(interaction.user.id))) {
      await interaction.reply({ content: DISCORD_MESSAGES.bot.workerApproveAdminOnly, ephemeral: true });
      return true;
    }

    const appr = await getApproval(parentSessionId);
    if (!appr) {
      await interaction.reply({ content: DISCORD_MESSAGES.bot.approvalNotFound, ephemeral: true });
      return true;
    }

    if (action === 'worker_approve') {
      await interaction.deferUpdate();
      if (!appr.validationPassed) {
        await interaction.followUp({ content: `⚠️ 이 워커는 검증에 실패했습니다: ${appr.validationErrors.join(', ')}`, ephemeral: true });
        return true;
      }

      let gate: Awaited<ReturnType<typeof evaluateWorkerActivationGate>> | null = null;
      try {
        gate = await evaluateWorkerActivationGate({
          guildId: appr.guildId,
          actorId: interaction.user.id,
        });
      } catch {
        await interaction.followUp({
          content: '🚫 운영 준비도 게이트 확인 중 오류가 발생해 워커 활성화를 차단했습니다. 잠시 후 다시 시도하거나 관리자 API /api/bot/agent/runtime/readiness 를 확인해주세요.',
          ephemeral: true,
        });
        return true;
      }

      if (gate && !gate.allowed) {
        const details = gate.reasons.length > 0 ? `\n- ${gate.reasons.join('\n- ')}` : '';
        await interaction.followUp({
          content: `🚫 현재 운영 준비도 게이트를 통과하지 못해 워커 활성화를 차단했습니다.${details}\n\n관리자 API /api/bot/agent/runtime/readiness 로 상태를 먼저 확인해주세요.`,
          ephemeral: true,
        });
        return true;
      }

      let loadResult = appr.sandboxFilePath
        ? await loadDynamicWorkerFromFile(appr.sandboxFilePath, appr.id)
        : { ok: false, error: 'missing sandbox file path' };
      if (!loadResult.ok && appr.generatedCode) {
        loadResult = await loadDynamicWorkerFromCode({
          approvalId: appr.id,
          generatedCode: appr.generatedCode,
          actionNameHint: appr.actionName,
        });
      }
      if (loadResult.ok) {
        recordWorkerApprovalDecision('approved');
        await updateApprovalStatus(parentSessionId, 'approved');
        try {
          const prev = interaction.message.content.split('\n✅')[0].split('\n❌')[0];
          await interaction.message.edit({ content: `${prev}\n\n✅ **워커 활성화 완료** (승인자: <@${interaction.user.id}>)\n액션: \`${appr.actionName}\``, components: [] });
        } catch {
          // ignore edit failure
        }
      } else {
        await interaction.followUp({ content: `❌ 워커 로드 실패: ${loadResult.error}`, ephemeral: true });
      }
      return true;
    }

    if (action === 'worker_reject') {
      await interaction.deferUpdate();
      await cleanupSandbox(appr.sandboxDir);
      recordWorkerApprovalDecision('rejected');
      await updateApprovalStatus(parentSessionId, 'rejected');
      try {
        const prev = interaction.message.content.split('\n✅')[0].split('\n❌')[0];
        await interaction.message.edit({ content: `${prev}\n\n❌ **반려됨** (처리자: <@${interaction.user.id}>)`, components: [] });
      } catch {
        // ignore edit failure
      }
      return true;
    }

    if (action === 'worker_refactor') {
      await interaction.deferReply({ ephemeral: true });
      recordWorkerApprovalDecision('refactor_requested');
      const refactorResult = await rerunWorkerPipeline({
        approvalId: parentSessionId,
        goal: appr.goal,
        guildId: appr.guildId,
        requestedBy: interaction.user.id,
        refactorHint: '더 효율적이고 안전하게 리팩토링해줘',
      });

      if (!refactorResult.ok) {
        await interaction.editReply(`❌ 리팩토링 실패: ${refactorResult.error}`);
        return true;
      }

      const newAppr = refactorResult.approval;
      const codeSnippet = newAppr.generatedCode.length > 1300
        ? `${newAppr.generatedCode.slice(0, 1300)}\n... (truncated)`
        : newAppr.generatedCode;
      const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`worker_approve:${newAppr.id}`).setLabel('✅ 배포 승인').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`worker_reject:${newAppr.id}`).setLabel('❌ 반려').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`worker_refactor:${newAppr.id}`).setLabel('🔧 리팩토링 지시').setStyle(ButtonStyle.Secondary),
      );
      try {
        await interaction.message.edit({
          content: [
            '📦 **워커 리팩토링 결과** (요청자: <@${interaction.user.id}>)',
            `액션: \`${newAppr.actionName}\` | 승인 ID: \`${newAppr.id}\``,
            `상태: ${newAppr.validationPassed ? '✅ 검증 통과' : `⚠️ 이슈 ${newAppr.validationErrors.length}개`}`,
            '',
            '**리팩토링된 코드:**',
            `\`\`\`javascript\n${codeSnippet}\n\`\`\``,
          ].join('\n').slice(0, 1950),
          components: [newRow],
        });
      } catch {
        // ignore edit failure
      }
      await interaction.editReply('🔧 리팩토링이 완료됐습니다. 관리자 메시지를 확인해주세요.');
      return true;
    }

    return true;
  }

  if (action === 'code_history') {
    await interaction.deferReply({ ephemeral: true });
    const chain = getChain(parentSessionId);
    if (chain.length === 0) {
      await interaction.editReply('이 세션의 코드 이력이 없습니다.');
      return true;
    }
    const lines = chain.map((e, i) => {
      const prefix = i === 0 ? '🌱 원본' : `↳ v${i + 1}`;
      return `${prefix} [\`${e.sessionId.slice(0, 8)}\`] ${e.goalSummary} | 파일 ${e.codeBlocks.length}개 | ${e.createdAt.slice(0, 10)}`;
    });
    await interaction.editReply(lines.join('\n'));
    return true;
  }

  const parentArtifact = getArtifact(parentSessionId);
  if (!parentArtifact) {
    await interaction.reply({ content: DISCORD_MESSAGES.bot.parentSessionNotFound, ephemeral: true });
    return true;
  }

  const ACTION_GOALS: Record<string, string> = {
    code_regen: `다음 코드를 재생성해줘. 같은 요구사항이지만 더 나은 구현으로:\n${parentArtifact.fullGoal.slice(0, 400)}`,
    code_refactor: `다음 코드를 리팩터해줘. 가독성·성능·설계를 개선하되 기존 기능은 유지:\n${parentArtifact.fullGoal.slice(0, 400)}`,
    code_test: `다음 코드에 대한 테스트 코드를 추가해줘. 단위 테스트와 핵심 케이스를 포함:\n${parentArtifact.fullGoal.slice(0, 400)}`,
  };
  const newGoal = ACTION_GOALS[action] || parentArtifact.fullGoal;

  await interaction.deferUpdate();

  const thread = interaction.channel;
  if (!thread || !('send' in thread)) {
    return true;
  }

  const ACTION_LABELS: Record<string, string> = {
    code_regen: DISCORD_MESSAGES.bot.codeActionRegen,
    code_refactor: DISCORD_MESSAGES.bot.codeActionRefactor,
    code_test: DISCORD_MESSAGES.bot.codeActionTest,
  };
  const label = ACTION_LABELS[action] || action;

  let newSession: { id: string };
  try {
    newSession = startVibeSession(interaction.guildId, interaction.user.id, newGoal);
    (newSession as any).__parentSessionId = parentSessionId;
  } catch (error) {
    await thread.send(DISCORD_MESSAGES.bot.codeStartFailed(toErrorMessage(error)));
    return true;
  }

  const progressMsg = await thread.send(DISCORD_MESSAGES.bot.codeProgressLines(label, newSession.id).join('\n'));

  await streamSessionProgress(
    { update: (content) => progressMsg.edit(content) },
    newSession.id,
    newGoal,
    { showDebugBlocks: false, maxLinks: 2 },
  );

  const completed = getAgentSession(newSession.id);
  if (completed?.status === 'completed') {
    const rawResult = String(completed.result || '').trim();
    const blocks = extractCodeBlocks(rawResult);
    if (blocks.length > 0) {
      saveArtifact({
        sessionId: completed.id,
        guildId: interaction.guildId,
        goalSummary: newGoal.slice(0, 40),
        fullGoal: newGoal,
        codeBlocks: blocks,
        rawResult,
        threadId: thread.id,
        parentSessionId,
        createdAt: new Date().toISOString(),
      });

      for (const [i, block] of blocks.entries()) {
        const safe = block.length > DISCORD_MSG_LIMIT
          ? `${block.slice(0, DISCORD_MSG_LIMIT)}\n... (truncated)`
          : block;
        const isLast = i === blocks.length - 1;
        try {
          if (isLast) {
            await thread.send({ content: safe, components: [buildCodeActionRow(completed.id)] });
          } else {
            await thread.send(safe);
          }
        } catch {
          try {
            await thread.send(safe);
          } catch {
            // ignore retry failure
          }
        }
      }
    }
  }

  return true;
};
