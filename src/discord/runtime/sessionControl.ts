import type { ButtonInteraction } from 'discord.js';
import { isUserAdmin } from '../../services/adminAllowlistService';
import {
  cancelAgentSession,
  getAgentSession,
  startAgentSession,
} from '../../services/multiAgentService';
import { DISCORD_MESSAGES } from '../messages';

const getErrorMessage = (error: unknown): string => {
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

export const SESSION_BUTTON_ACTIONS = new Set(['session_run', 'session_remove']);

export const handleSessionControlButton = async (params: {
  interaction: ButtonInteraction;
  action: string;
  sessionId: string;
}): Promise<boolean> => {
  const { interaction, action, sessionId } = params;
  if (!SESSION_BUTTON_ACTIONS.has(action)) {
    return false;
  }

  if (!(await isUserAdmin(interaction.user.id))) {
    await interaction.reply({ content: DISCORD_MESSAGES.bot.sessionControlAdminOnly, ephemeral: true });
    return true;
  }

  if (!interaction.guildId) {
    await interaction.reply({ content: DISCORD_MESSAGES.bot.guildOnly, ephemeral: true });
    return true;
  }

  const target = getAgentSession(sessionId);
  if (!target || target.guildId !== interaction.guildId) {
    await interaction.reply({ content: DISCORD_MESSAGES.bot.sessionNotFoundMaybeClosed, ephemeral: true });
    return true;
  }

  if (action === 'session_run') {
    try {
      const replay = startAgentSession({
        guildId: interaction.guildId,
        requestedBy: interaction.user.id,
        goal: target.goal,
        skillId: target.requestedSkillId,
        priority: target.priority,
        isAdmin: true,
      });
      await interaction.reply({ content: DISCORD_MESSAGES.bot.sessionRunStarted(replay.id), ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: DISCORD_MESSAGES.bot.runFailed(getErrorMessage(error)), ephemeral: true });
    }
    return true;
  }

  const result = cancelAgentSession(sessionId);
  await interaction.reply({
    content: DISCORD_MESSAGES.bot.sessionRemoveResult(result.ok, sessionId, result.message),
    ephemeral: true,
  });
  return true;
};
