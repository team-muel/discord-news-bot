import type { CommunityPlugin } from './types';
import { compact } from './utils';

export const redditCommunityPlugin: CommunityPlugin = {
  id: 'reddit',
  description: 'Reddit public search JSON source.',
  search: async ({ query, limit }) => {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${Math.max(1, Math.min(25, limit))}&sort=relevance&t=week`;
    const response = await fetch(url, {
      headers: {
        'user-agent': 'muel-crawler-worker/1.0',
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as any;
    const children = Array.isArray(data?.data?.children) ? data.data.children : [];

    const out = children
      .map((row: any) => row?.data)
      .filter(Boolean)
      .map((row: any) => {
        const permalink = String(row?.permalink || '').trim();
        const urlValue = permalink.startsWith('/') ? `https://www.reddit.com${permalink}` : String(row?.url || '').trim();
        return {
          source: 'reddit',
          title: compact(row?.title || ''),
          url: urlValue,
          excerpt: compact(row?.selftext || '').slice(0, 220),
          score: Number(row?.score || 0),
        };
      })
      .filter((row: any) => row.title && row.url)
      .slice(0, limit);

    return out;
  },
};
