import type { CommunityPlugin, CommunityPost } from './types';
import { hackerNewsCommunityPlugin } from './hackernews';
import { redditCommunityPlugin } from './reddit';
import { stubCommunityPlugin } from './stub';
import { dedupeByUrl } from './utils';

const PLUGINS: CommunityPlugin[] = [
  redditCommunityPlugin,
  hackerNewsCommunityPlugin,
  stubCommunityPlugin,
];

const PLUGIN_MAP = new Map<string, CommunityPlugin>(PLUGINS.map((plugin) => [plugin.id, plugin]));

const parsePluginOrder = (): string[] => {
  const raw = String(process.env.COMMUNITY_PLUGIN_ORDER || 'reddit,hackernews,stub').trim();
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const parseEnabledSet = (): Set<string> => {
  const raw = String(process.env.COMMUNITY_PLUGIN_ENABLED || '*').trim();
  if (!raw || raw === '*') {
    return new Set(['*']);
  }
  return new Set(raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
};

export const listCommunityPlugins = (): CommunityPlugin[] => {
  const enabled = parseEnabledSet();
  const order = parsePluginOrder();

  const out: CommunityPlugin[] = [];
  for (const id of order) {
    const plugin = PLUGIN_MAP.get(id);
    if (!plugin) {
      continue;
    }
    if (!enabled.has('*') && !enabled.has(plugin.id)) {
      continue;
    }
    out.push(plugin);
  }

  if (out.length === 0) {
    return [stubCommunityPlugin];
  }

  return out;
};

const safeRunPlugin = async (plugin: CommunityPlugin, query: string, limit: number): Promise<CommunityPost[]> => {
  try {
    const rows = await plugin.search({ query, limit });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

export const searchCommunityWithPlugins = async (params: { query: string; limit: number }): Promise<CommunityPost[]> => {
  const selected = listCommunityPlugins();
  const collected: CommunityPost[] = [];

  for (const plugin of selected) {
    const remaining = Math.max(1, params.limit - collected.length);
    const rows = await safeRunPlugin(plugin, params.query, remaining);
    for (const row of rows) {
      collected.push(row);
      if (collected.length >= params.limit) {
        return dedupeByUrl(collected).slice(0, params.limit);
      }
    }
  }

  return dedupeByUrl(collected).slice(0, params.limit);
};
