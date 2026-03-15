import { ChannelType, type Guild } from 'discord.js';
import logger from '../logger';
import { upsertObsidianGuildDocument } from './obsidian/authoring';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import { parseBooleanEnv } from '../utils/env';
import { logOutcomeSignal, type OutcomeSignal } from './observability/outcomeSignal';

const AUTO_SYNC_ON_GUILD_JOIN = parseBooleanEnv(process.env.OBSIDIAN_AUTO_TOPOLOGY_SYNC_ON_GUILD_JOIN, true);
const AUTO_SYNC_ON_READY = parseBooleanEnv(process.env.OBSIDIAN_AUTO_TOPOLOGY_SYNC_ON_READY, true);

const logSignal = (guildId: string, outcome: OutcomeSignal, detail: string) => {
  logOutcomeSignal({
    scope: 'discord-event',
    component: 'topology-sync',
    guildId,
    outcome,
    detail,
  });
};

const formatToday = (): string => new Date().toISOString().slice(0, 10);

const safeText = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const channelTypeLabel = (typeValue: number): string => {
  const mapped = ChannelType[typeValue];
  return typeof mapped === 'string' ? mapped : String(typeValue);
};

const renderTopologyMarkdown = (guild: Guild, reason: string): string => {
  const channels = [...guild.channels.cache.values()].sort((a, b) => {
    const posA = (a as any).rawPosition ?? (a as any).position ?? 0;
    const posB = (b as any).rawPosition ?? (b as any).position ?? 0;
    if (posA !== posB) {
      return posA - posB;
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const categories = channels.filter((channel) => channel.type === ChannelType.GuildCategory);
  const typeCount = new Map<string, number>();

  for (const channel of channels) {
    const label = channelTypeLabel(channel.type);
    typeCount.set(label, (typeCount.get(label) || 0) + 1);
  }

  const typeSummary = [...typeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `- ${type}: ${count}`)
    .join('\n');

  const channelLines = channels.map((channel) => {
    const parentName = safeText((channel as any).parent?.name || '');
    const topic = safeText((channel as any).topic || '');
    const bits = [
      `id=${channel.id}`,
      `type=${channelTypeLabel(channel.type)}`,
    ];
    if (parentName) {
      bits.push(`category=${parentName}`);
    }
    if (topic) {
      bits.push(`topic=${topic.slice(0, 120)}`);
    }
    return `- #${safeText(channel.name) || 'unnamed'} | ${bits.join(' | ')}`;
  });

  return [
    '# Discord Guild Topology Snapshot',
    '',
    `- guild_id: ${guild.id}`,
    `- guild_name: ${safeText(guild.name) || 'unknown'}`,
    `- reason: ${safeText(reason) || 'manual'}`,
    `- captured_at: ${new Date().toISOString()}`,
    `- channels_total: ${channels.length}`,
    `- categories_total: ${categories.length}`,
    '',
    '## Channel Type Summary',
    typeSummary || '- none',
    '',
    '## Channels',
    ...channelLines,
  ].join('\n');
};

export const syncGuildTopologySnapshot = async (guild: Guild, reason: string): Promise<void> => {
  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    logSignal(guild.id, 'degraded', 'vault_path_missing');
    return;
  }

  const content = renderTopologyMarkdown(guild, reason);
  const result = await upsertObsidianGuildDocument({
    guildId: guild.id,
    vaultPath,
    fileName: `events/ingest/discord_topology_${formatToday()}`,
    content,
    tags: ['discord-topology', 'auto-snapshot', 'operations'],
    properties: {
      schema: 'muel-note/v1',
      source: 'discord-topology-sync',
      category: 'operations',
      updated_at: new Date().toISOString(),
      guild_name: guild.name,
      reason,
    },
  });

  if (!result.ok) {
    logger.warn('[DISCORD-TOPOLOGY] snapshot failed guild=%s reason=%s error=%s', guild.id, reason, result.reason || 'WRITE_FAILED');
    logSignal(guild.id, 'failure', `snapshot_failed:${result.reason || 'WRITE_FAILED'}`);
    return;
  }

  logSignal(guild.id, 'success', `snapshot_ok:reason=${reason}`);
  logger.info('[DISCORD-TOPOLOGY] snapshot synced guild=%s reason=%s path=%s', guild.id, reason, result.path || 'unknown');
};

export const autoSyncGuildTopologyOnJoin = async (guild: Guild): Promise<void> => {
  if (!AUTO_SYNC_ON_GUILD_JOIN) {
    return;
  }
  await syncGuildTopologySnapshot(guild, 'guildCreate');
};

export const autoSyncGuildTopologiesOnReady = async (guilds: Iterable<Guild>): Promise<void> => {
  if (!AUTO_SYNC_ON_READY) {
    return;
  }

  for (const guild of guilds) {
    try {
      await syncGuildTopologySnapshot(guild, 'clientReady');
    } catch (error) {
      logger.debug('[DISCORD-TOPOLOGY] ready sync skipped guild=%s reason=%s', guild.id, error instanceof Error ? error.message : String(error));
    }
  }
};
