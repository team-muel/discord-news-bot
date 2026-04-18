import type { ChatInputCommandInteraction } from 'discord.js';
import { DISCORD_CHAT_COMMAND_NAMES } from '../../../config/runtime/discordCommandCatalog.js';
import { tryHandleDiscordChatSdkSlashCommand } from './chatSdkRuntime';
import { resolveMuelEntryIntent } from '../muelEntryPolicy';

export const LEGACY_MAKE_COMMAND_NAME = '만들어줘';

type DocsSlashHandlers = {
  handleAskCommand: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

type VibeSlashHandlers = {
  handleVibeCommand: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

type EligibleChatSurfaceRouterOptions = {
  codingIntentPattern: RegExp;
  automationIntentPattern: RegExp;
};

const resolveMuelSlashRequest = (interaction: ChatInputCommandInteraction): string => {
  return String(
    interaction.options.getString('질문', false)
    || interaction.options.getString('요청', false)
    || '',
  ).trim();
};

export const tryHandleEligibleChatSurfaceSlashCommand = async (
  interaction: ChatInputCommandInteraction,
  handlers: {
    docs: DocsSlashHandlers;
    vibe: VibeSlashHandlers;
  },
  options: EligibleChatSurfaceRouterOptions,
): Promise<boolean> => {
  if (interaction.commandName === LEGACY_MAKE_COMMAND_NAME) {
    await handlers.vibe.handleVibeCommand(interaction);
    return true;
  }

  if (interaction.commandName === DISCORD_CHAT_COMMAND_NAMES.ASK_COMPAT) {
    if (await tryHandleDiscordChatSdkSlashCommand(interaction)) {
      return true;
    }

    await handlers.docs.handleAskCommand(interaction);
    return true;
  }

  if (interaction.commandName !== DISCORD_CHAT_COMMAND_NAMES.MUEL) {
    return false;
  }

  const request = resolveMuelSlashRequest(interaction);
  const entryIntent = resolveMuelEntryIntent(request, {
    codingIntentPattern: options.codingIntentPattern,
    automationIntentPattern: options.automationIntentPattern,
  });

  if (entryIntent !== 'docs') {
    await handlers.vibe.handleVibeCommand(interaction);
    return true;
  }

  if (await tryHandleDiscordChatSdkSlashCommand(interaction)) {
    return true;
  }

  await handlers.docs.handleAskCommand(interaction);
  return true;
};