import type { Client } from 'discord.js';
import { startDiscordReadyRuntime } from '../../services/runtime/runtimeBootstrap';

export const startDiscordReadyWorkloads = (client: Client): void => {
  startDiscordReadyRuntime(client);
};
