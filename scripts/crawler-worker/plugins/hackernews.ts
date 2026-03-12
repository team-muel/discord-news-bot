import type { CommunityPlugin } from './types';
import { compact } from './utils';

export const hackerNewsCommunityPlugin: CommunityPlugin = {
  id: 'hackernews',
  description: 'Hacker News Algolia search source.',
  search: async ({ query, limit }) => {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${Math.max(1, Math.min(30, limit))}`;
    const response = await fetch(url, {
      headers: {
        'user-agent': 'muel-crawler-worker/1.0',
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as any;
    const hits = Array.isArray(data?.hits) ? data.hits : [];

    return hits
      .map((hit: any) => ({
        source: 'hackernews',
        title: compact(hit?.title || ''),
        url: String(hit?.url || hit?.story_url || '').trim() || `https://news.ycombinator.com/item?id=${String(hit?.objectID || '').trim()}`,
        excerpt: compact(hit?.story_text || hit?._highlightResult?.title?.value || '').slice(0, 220),
        score: Number(hit?.points || 0),
      }))
      .filter((row: any) => row.title && row.url)
      .slice(0, limit);
  },
};
