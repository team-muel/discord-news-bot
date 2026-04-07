/**
 * news.verify action
 *
 * 동일 주제에 대해 여러 뉴스 소스를 교차 확인해
 * 사실 일치/불일치 여부를 판단합니다.
 *
 * 방식:
 *   1. Google News RSS로 상위 결과 N건 수집
 *   2. 각 결과 URL의 본문 fetch (텍스트 요약)
 *   3. 핵심 주장 키워드 교차 분석 → 신뢰도 점수 계산
 *   4. 불일치 징후가 있으면 CONFLICT, 모두 일치하면 CONFIRMED로 표시
 */
import type { ActionDefinition } from './types';
import { isWebHostAllowed } from './policy';
import { compactText, extractQuery } from './queryUtils';
import logger from '../../../logger';
import { parseIntegerEnv } from '../../../utils/env';
import { getErrorMessage } from '../../../utils/errorMessage';

const FETCH_TIMEOUT_MS = 7_000;
const VERIFY_SOURCE_LIMIT = Math.max(2, Math.min(10, parseIntegerEnv(process.env.NEWS_VERIFY_SOURCE_LIMIT, 4)));

// ── Text extraction ──────────────────────────────────────────────────────────

const toTextSnippet = (html: string, maxLen = 500): string =>
  compactText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).slice(0, maxLen);

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

// ── RSS parse (재사용, news.ts와 독립적으로 micro-inline) ─────────────────────

const stripHtmlTags = (v: string) => v.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();

const parseNewsRssLinks = (xml: string, limit: number): { title: string; link: string }[] => {
  const items: { title: string; link: string }[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && items.length < limit) {
    const block = m[1] || '';
    const titleM = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkM = block.match(/<link>([\s\S]*?)<\/link>/i);
    const title = stripHtmlTags(titleM?.[1] || '').slice(0, 120);
    const link = stripHtmlTags(linkM?.[1] || '').trim();
    if (title && link.startsWith('http')) items.push({ title, link });
  }
  return items;
};

// ── Simple keyword overlap scorer ────────────────────────────────────────────

const tokenize = (text: string): Set<string> =>
  new Set(
    text.toLowerCase()
      .replace(/[^가-힣a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2),
  );

const jaccardSim = (a: Set<string>, b: Set<string>): number => {
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
};

// ── Source fetch ──────────────────────────────────────────────────────────────

const fetchSnippet = async (url: string): Promise<string> => {
  try {
    const hostname = new URL(url).hostname;
    if (!isWebHostAllowed(hostname)) return '';
    const res = await withTimeout(
      fetch(url, { headers: { 'user-agent': 'muel-action-runner/1.0' } }),
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return '';
    const html = await res.text();
    return toTextSnippet(html, 600);
  } catch {
    return '';
  }
};

// ── Action ────────────────────────────────────────────────────────────────────

export const newsVerifyAction: ActionDefinition = {
  name: 'news.verify',
  description:
    '동일 주제를 여러 뉴스 소스에서 교차 확인합니다. 핵심 클레임의 일치/불일치 여부를 분석합니다.',
  category: 'content',
  execute: async ({ goal, args }) => {
    const query = extractQuery({
      goal,
      args,
      defaultQuery: '주요 뉴스 검증',
      removePatterns: [/검증|팩트체크|확인해줘|맞아\?|사실이야\?/gi],
    });

    if (!query || query === '주요 뉴스 검증') {
      return {
        ok: false,
        name: 'news.verify',
        summary: '검증할 주제가 없습니다.',
        artifacts: [],
        verification: ['주제 추출 실패'],
        error: 'QUERY_MISSING',
      };
    }

    // Step 1: RSS에서 후보 수집
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    let candidates: { title: string; link: string }[] = [];
    try {
      const rssRes = await withTimeout(
        fetch(rssUrl, { headers: { 'user-agent': 'muel-action-runner/1.0' } }),
        FETCH_TIMEOUT_MS,
      );
      if (rssRes.ok) {
        const xml = await rssRes.text();
        candidates = parseNewsRssLinks(xml, VERIFY_SOURCE_LIMIT);
      }
    } catch (error) {
      logger.debug('[ACTION][news.verify] rss fetch failed: %s', getErrorMessage(error));
    }

    if (candidates.length < 2) {
      return {
        ok: false,
        name: 'news.verify',
        summary: `"${query}" 관련 교차 확인 가능한 소스가 부족합니다 (${candidates.length}건).`,
        artifacts: candidates.map((c) => c.link),
        verification: ['소스 부족'],
        error: 'INSUFFICIENT_SOURCES',
      };
    }

    // Step 2: 각 소스 본문 fetch (병렬, allowlist 필터)
    const snippets: string[] = await Promise.all(
      candidates.map((c) => fetchSnippet(c.link)),
    );

    const fetchedCount = snippets.filter(Boolean).length;

    // Step 3: 단순 키워드 교차 점수
    const texts = snippets.filter(Boolean);
    let conflictDetected = false;
    let avgSim = 0;

    if (texts.length >= 2) {
      const sims: number[] = [];
      for (let i = 0; i < texts.length - 1; i++) {
        const a = tokenize(texts[i]!);
        const b = tokenize(texts[i + 1]!);
        sims.push(jaccardSim(a, b));
      }
      avgSim = sims.reduce((s, v) => s + v, 0) / sims.length;
      conflictDetected = avgSim < 0.05; // 5% 미만 공통 키워드 → 불일치 징후
    }

    const verdict = texts.length < 2
      ? 'UNVERIFIED'
      : conflictDetected
        ? 'CONFLICT'
        : 'CONSISTENT';

    const verdictLabel: Record<string, string> = {
      CONFLICT: '⚠️ 소스 간 내용 불일치 징후',
      CONSISTENT: '✅ 주요 소스 내용 일치',
      UNVERIFIED: '⚪ 본문 수집 불충분 (검증 보류)',
    };

    const artifacts = [
      `판정: [${verdict}] ${verdictLabel[verdict]} (소스 유사도 평균 ${(avgSim * 100).toFixed(1)}%)`,
      '',
      ...candidates.map((c, i) => {
        const snippet = snippets[i] ? `  > ${snippets[i]!.slice(0, 120)}` : '  > (본문 수집 불가)';
        return `[${i + 1}] ${c.title}\n    ${c.link}\n${snippet}`;
      }),
    ];

    const summary = `"${query}" 교차 검증 — ${candidates.length}개 소스, 본문 ${fetchedCount}건 수집 → ${verdict}`;
    const verification = [
      `query="${query}"`,
      `sources=${candidates.length}`,
      `fetched=${fetchedCount}`,
      `avgSimilarity=${(avgSim * 100).toFixed(1)}%`,
      `verdict=${verdict}`,
    ];

    if (verdict === 'UNVERIFIED') {
      return {
        ok: false,
        name: 'news.verify',
        summary,
        artifacts,
        verification,
        error: 'UNVERIFIED_CONTENT',
      };
    }

    return {
      ok: true,
      name: 'news.verify',
      summary,
      artifacts,
      verification,
    };
  },
};
