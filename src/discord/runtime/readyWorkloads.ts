import type { Client } from 'discord.js';
import { startDiscordReadyRuntime } from '../../services/runtimeBootstrap';

export const startDiscordReadyWorkloads = (client: Client): void => {
  startDiscordReadyRuntime(client);
};
