import { ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';
import logger from '../../logger';
import { summarizeReflectionBundle, upsertObsidianGuildDocument } from '../obsidian/authoring';
import { doc } from '../obsidian/obsidianDocBuilder';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { parseBooleanEnv } from '../../utils/env';
import { logOutcomeSignal, type OutcomeSignal } from '../observability/outcomeSignal';
import { resolveChannelMeta, channelDisplayPrefix, parentLabel, isThreadChannel } from '../../utils/discordChannelMeta';
import { getErrorMessage } from '../../utils/errorMessage';

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

const channelSortPos = (ch: GuildBasedChannel): number =>
  Number(('rawPosition' in ch ? ch.rawPosition : 'position' in ch ? ch.position : 0) || 0);

const renderTopologyMarkdown = (guild: Guild, reason: string): string => {
  const allEntries = [...guild.channels.cache.values()].sort((a, b) => {
    const posA = channelSortPos(a);
    const posB = channelSortPos(b);
    if (posA !== posB) {
      return posA - posB;
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  const channels = allEntries.filter((ch) => !isThreadChannel(ch.type));
  const threads = allEntries.filter((ch) => isThreadChannel(ch.type));
  const categories = channels.filter((ch) => ch.type === ChannelType.GuildCategory);
  const typeCount = new Map<string, number>();

  for (const ch of allEntries) {
    const label = channelTypeLabel(ch.type);
    typeCount.set(label, (typeCount.get(label) || 0) + 1);
  }

  const typeSummaryLines = [...typeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}: ${count}`);

  const channelLines = channels.map((ch) => {
    const meta = resolveChannelMeta(ch);
    const bits = [
      `id=${meta.channelId}`,
      `type=${meta.channelType}`,
    ];
    const parent = parentLabel(meta);
    if (parent) {
      bits.push(parent);
    }
    const topic = safeText('topic' in ch ? ch.topic : '');
    if (topic) {
      bits.push(`topic=${topic.slice(0, 120)}`);
    }
    return `${channelDisplayPrefix(meta)}${meta.channelName || 'unnamed'} | ${bits.join(' | ')}`;
  });

  const threadLines = threads.map((ch) => {
    const meta = resolveChannelMeta(ch);
    const bits = [
      `id=${meta.channelId}`,
      `type=${meta.channelType}`,
    ];
    const parent = parentLabel(meta);
    if (parent) {
      bits.push(parent);
    }
    if (meta.isForumPost) {
      bits.push('forum_post=true');
    }
    if (meta.isPrivateThread) {
      bits.push('private=true');
    }
    return `${channelDisplayPrefix(meta)}${meta.channelName || 'unnamed'} | ${bits.join(' | ')}`;
  });

  const builder = doc()
    .title('Discord Guild Topology Snapshot')
    .tag('discord-topology', 'auto-snapshot', 'operations')
    .property('schema', 'muel-note/v1')
    .property('source', 'discord-topology-sync')
    .property('category', 'operations')
    .property('updated_at', new Date().toISOString())
    .property('guild_name', guild.name)
    .property('reason', reason)
    .section('Metadata')
    .bullet(`guild_id: ${guild.id}`)
    .bullet(`guild_name: ${safeText(guild.name) || 'unknown'}`)
    .bullet(`reason: ${safeText(reason) || 'manual'}`)
    .bullet(`captured_at: ${new Date().toISOString()}`)
    .bullet(`channels_total: ${channels.length}`)
    .bullet(`threads_total: ${threads.length}`)
    .bullet(`categories_total: ${categories.length}`);

  builder.section('Channel Type Summary').bullets(typeSummaryLines.length > 0 ? typeSummaryLines : ['none']);
  builder.section('Channels').bullets(channelLines.length > 0 ? channelLines : ['none']);
  builder.section('Threads').bullets(threadLines.length > 0 ? threadLines : ['none']);
  builder.section('Related').bullets([
    '[[Guild_Lore]]',
    '[[Server_History]]',
  ]);

  return builder.build().markdown;
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
  const reflection = summarizeReflectionBundle(result.reflectionBundle);
  logger.info('[DISCORD-TOPOLOGY] snapshot synced guild=%s reason=%s path=%s concern=%s next=%s', guild.id, reason, result.path || 'unknown', reflection.concern, reflection.nextPath);
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
      logger.debug('[DISCORD-TOPOLOGY] ready sync skipped guild=%s reason=%s', guild.id, getErrorMessage(error));
    }
  }
};
