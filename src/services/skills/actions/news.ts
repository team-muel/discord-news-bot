import type { ActionDefinition } from './types';
import { runDelegatedAction } from './mcpDelegatedAction';
import { extractQuery } from './queryUtils';
import { delegateNewsRssFetch } from '../../automation/n8nDelegationService';

const stripCdata = (value: string): string => value.replace(/<!\[CDATA\[|\]\]>/g, '').trim();

const decodeXml = (value: string): string => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const parseRssItems = (xml: string, limit: number): string[] => {
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const items: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) && items.length < limit) {
    const block = match[1] || '';
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);

    const title = decodeXml(stripCdata(titleMatch?.[1] || '')).replace(/\s+/g, ' ').trim();
    const link = decodeXml(stripCdata(linkMatch?.[1] || '')).trim();
    const source = decodeXml(stripCdata(sourceMatch?.[1] || '')).trim();
    const pubDate = decodeXml(stripCdata(pubDateMatch?.[1] || '')).trim();

    if (!title || !link) {
      continue;
    }

    const meta = [source, pubDate].filter(Boolean).join(' | ');
    items.push(meta ? `${title}\\n${link}\\n${meta}` : `${title}\\n${link}`);
  }

  return items;
};

const extractNewsQuery = (goal: string, args?: Record<string, unknown>): string => {
  return extractQuery({
    goal,
    args,
    defaultQuery: '시장 주요 뉴스',
    removePatterns: [/뉴스|news/gi],
  });
};

export const newsGoogleSearchAction: ActionDefinition = {
  name: 'news.google.search',
  description: 'Google News RSS 기반으로 질의어 관련 최신 뉴스 링크를 수집합니다.',
  category: 'content',
  parameters: [
    { name: 'query', required: true, description: 'News search keyword(s)', example: 'AI semiconductor 2026' },
  ],
  execute: async ({ goal, args }) => {
    const query = extractNewsQuery(goal, args);
    const limit = 5;

    const delegated = await runDelegatedAction({
      actionName: 'news.google.search',
      workerKind: 'news',
      toolName: 'news.google.search',
      args: { query, limit },
      successSummary: () => 'MCP 뉴스 워커 조회 성공',
      strictFailureSummary: 'MCP 뉴스 워커 호출 실패(엄격 모드)',
    });
    if (delegated) {
      return delegated;
    }

    // n8n delegation: try delegating RSS fetch to n8n before inline fallback
    const n8nResult = await delegateNewsRssFetch(query, limit);
    if (n8nResult.delegated && n8nResult.ok && n8nResult.data?.items) {
      const items = n8nResult.data.items
        .filter((item) => item.title && item.link)
        .slice(0, limit)
        .map((item) => {
          const meta = [item.source, item.pubDate].filter(Boolean).join(' | ');
          return meta ? `${item.title}\\n${item.link}\\n${meta}` : `${item.title}\\n${item.link}`;
        });
      if (items.length > 0) {
        return {
          ok: true,
          name: 'news.google.search',
          summary: `n8n 위임으로 뉴스 ${items.length}건 수집`,
          artifacts: items,
          verification: ['n8n delegation path', `durationMs=${n8nResult.durationMs}`],
        };
      }
    }

    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    try {
      const response = await fetch(rssUrl, {
        headers: {
          'user-agent': 'muel-action-runner/1.0',
          accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        },
      });

      if (!response.ok) {
        return {
          ok: false,
          name: 'news.google.search',
          summary: `뉴스 RSS 조회 실패(status=${response.status})`,
          artifacts: [rssUrl],
          verification: ['worker fallback path', `rss fetch non-2xx status=${response.status}`],
          error: 'RSS_FETCH_FAILED',
        };
      }

      const xml = await response.text();
      const items = parseRssItems(xml, limit);
      if (items.length === 0) {
        return {
          ok: false,
          name: 'news.google.search',
          summary: '뉴스 RSS에서 결과를 파싱하지 못했습니다.',
          artifacts: [rssUrl],
          verification: ['worker fallback path', 'rss parse empty'],
          error: 'RSS_PARSE_EMPTY',
        };
      }

      return {
        ok: true,
        name: 'news.google.search',
        summary: `워커 없이 RSS 폴백으로 뉴스 ${items.length}건 수집`,
        artifacts: items,
        verification: ['worker fallback path', 'rss fallback fetch+parse success'],
      };
    } catch (error) {
      return {
        ok: false,
        name: 'news.google.search',
        summary: '뉴스 워커/폴백 조회 모두 실패했습니다.',
        artifacts: [rssUrl],
        verification: ['worker fallback path', 'rss fallback failed'],
        error: 'RSS_FALLBACK_FAILED',
      };
    }
  },
};
