/**
 * web.search action
 *
 * URL 없이 자연어 질의 → 검색 → 결과 수집 → 텍스트 추출
 *
 * Provider priority:
 *   1. Serper.dev  (SERPER_API_KEY 환경변수가 있을 때)
 *   2. DuckDuckGo HTML scraping (API 키 불필요, 기본 폴백)
 */
import type { ActionDefinition } from './types';
import { isWebHostAllowed } from './policy';
import { compactText, extractQuery } from './queryUtils';
import { parseIntegerEnv } from '../../../utils/env';

const SERPER_API_KEY = process.env.SERPER_API_KEY || '';
const MAX_RESULTS = Math.max(1, Math.min(10, parseIntegerEnv(process.env.WEB_SEARCH_MAX_RESULTS, 5)));
const FETCH_TIMEOUT_MS = 8_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

const toTextSnippet = (html: string, maxLen = 400): string =>
  compactText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).slice(0, maxLen);

const timeout = (ms: number): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

// ── Serper provider ───────────────────────────────────────────────────────────

type SerperResult = { title: string; link: string; snippet?: string };

const searchViaSerper = async (query: string): Promise<SerperResult[]> => {
  const res = await Promise.race([
    fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': SERPER_API_KEY,
      },
      body: JSON.stringify({ q: query, gl: 'kr', hl: 'ko', num: MAX_RESULTS }),
    }),
    timeout(FETCH_TIMEOUT_MS),
  ]);
  if (!res.ok) throw new Error(`serper ${res.status}`);
  const data: any = await res.json();
  const organic: any[] = data?.organic || [];
  return organic
    .slice(0, MAX_RESULTS)
    .map((r: any) => ({
      title: String(r.title || '').slice(0, 120),
      link: String(r.link || ''),
      snippet: String(r.snippet || '').slice(0, 300),
    }))
    .filter((r) => r.link.startsWith('http'));
};

// ── DuckDuckGo HTML provider (no-key fallback) ────────────────────────────────

const DDG_LINK_RE = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const DDG_SNIPPET_RE = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

const searchViaDuckDuckGo = async (query: string): Promise<SerperResult[]> => {
  const body = `q=${encodeURIComponent(query)}&kl=kr-kr`;
  const res = await Promise.race([
    fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'muel-action-runner/1.0',
        'Accept': 'text/html',
      },
      body,
    }),
    timeout(FETCH_TIMEOUT_MS),
  ]);
  if (!res.ok) throw new Error(`ddg ${res.status}`);
  const html = await res.text();

  const links: { title: string; link: string }[] = [];
  let m: RegExpExecArray | null;
  DDG_LINK_RE.lastIndex = 0;
  while ((m = DDG_LINK_RE.exec(html)) !== null && links.length < MAX_RESULTS * 2) {
    const raw = m[1] || '';
    const title = toTextSnippet(m[2], 120);
    // DDG uses redirect URLs like //duckduckgo.com/l/?kh=-1&uddg=<encoded>
    const uddg = raw.match(/uddg=([^&]+)/)?.[1];
    const link = uddg ? decodeURIComponent(uddg) : (raw.startsWith('http') ? raw : '');
    if (link.startsWith('http')) {
      links.push({ title, link });
    }
  }

  const snippets: string[] = [];
  DDG_SNIPPET_RE.lastIndex = 0;
  while ((m = DDG_SNIPPET_RE.exec(html)) !== null) {
    snippets.push(toTextSnippet(m[1], 300));
  }

  return links.slice(0, MAX_RESULTS).map((l, i) => ({
    title: l.title,
    link: l.link,
    snippet: snippets[i] || '',
  }));
};

// ── Main search dispatcher ────────────────────────────────────────────────────

const runSearch = async (query: string): Promise<SerperResult[]> => {
  if (SERPER_API_KEY) {
    try {
      return await searchViaSerper(query);
    } catch {
      // Fall through to DDG
    }
  }
  return searchViaDuckDuckGo(query);
};

// ── Action definition ─────────────────────────────────────────────────────────

export const webSearchAction: ActionDefinition = {
  name: 'web.search',
  description:
    'URL 없이 자연어 질의어로 웹 검색 → 결과 URL·요약 반환. 허용 도메인 필터 적용.',
  category: 'data',
  execute: async ({ goal, args }) => {
    const query = extractQuery({
      goal,
      args,
      defaultQuery: '웹 검색',
      removePatterns: [
        /웹\s*(으로|에서)?\s*검색(해줘|해|할)?/gi,
        /찾아줘|알아봐줘|검색해줘/gi,
      ],
    });

    if (!query || query === '웹 검색') {
      return {
        ok: false,
        name: 'web.search',
        summary: '검색할 질의어가 없습니다.',
        artifacts: [],
        verification: ['질의어 추출 실패'],
        error: 'QUERY_MISSING',
      };
    }

    let results: { title: string; link: string; snippet?: string }[];
    try {
      results = await runSearch(query);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        name: 'web.search',
        summary: `검색 실패: ${msg}`,
        artifacts: [],
        verification: ['검색 API 호출 실패'],
        error: 'SEARCH_FAILED',
      };
    }

    if (results.length === 0) {
      return {
        ok: false,
        name: 'web.search',
        summary: `"${query}" 검색 결과 없음`,
        artifacts: [],
        verification: ['결과 0건'],
        error: 'NO_RESULTS',
      };
    }

    // allowlist 필터
    const allowed = results.filter((r) => {
      try {
        const h = new URL(r.link).hostname;
        return isWebHostAllowed(h);
      } catch {
        return false;
      }
    });

    const source = SERPER_API_KEY ? 'Serper' : 'DuckDuckGo';
    if (allowed.length === 0) {
      return {
        ok: false,
        name: 'web.search',
        summary: `"${query}" 검색 결과가 허용 도메인 정책을 통과하지 못했습니다.`,
        artifacts: [],
        verification: [`검색 성공(${source})`, 'allowlist filter blocked all results'],
        error: 'ALLOWLIST_BLOCKED',
      };
    }

    const artifacts = allowed.flatMap((r) => [
      `[${r.title}] ${r.link}`,
      ...(r.snippet ? [`  > ${r.snippet}`] : []),
    ]);

    return {
      ok: true,
      name: 'web.search',
      summary: `"${query}" 검색 완료 — ${allowed.length}건 (via ${source})`,
      artifacts,
      verification: [`검색 성공(${source})`, `allowlist 통과 ${allowed.length}건`, `query="${query}"`],
    };
  },
};
