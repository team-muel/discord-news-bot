import type { ActionDefinition } from './types';
import { parseBooleanEnv, parseIntegerEnv } from '../../../utils/env';

const ACTION_YOUTUBE_USE_PLAYWRIGHT = parseBooleanEnv(process.env.ACTION_YOUTUBE_USE_PLAYWRIGHT, false);
const ACTION_YOUTUBE_PLAYWRIGHT_TIMEOUT_MS = Math.max(3_000, parseIntegerEnv(process.env.ACTION_YOUTUBE_PLAYWRIGHT_TIMEOUT_MS, 8_000));

const dynamicImport = new Function('modulePath', 'return import(modulePath);') as (modulePath: string) => Promise<any>;

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const extractQuery = (goal: string, args?: Record<string, unknown>): string => {
  const argQuery = typeof args?.query === 'string' ? args.query : '';
  if (argQuery.trim()) {
    return compact(argQuery);
  }

  return compact(goal)
    .replace(/세션 스킬 실행:[^\n]*/g, '')
    .replace(/요청:\s*/g, '')
    .replace(/목표:\s*/g, '')
    .trim() || '고양이 영상';
};

const findFirstVideoUrl = async (query: string): Promise<string | null> => {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(searchUrl);
    if (!res.ok) {
      return null;
    }
    const html = await res.text();

    const idMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (!idMatch) {
      return null;
    }

    return `https://www.youtube.com/watch?v=${idMatch[1]}`;
  } catch {
    return null;
  }
};

const findFirstVideoUrlByPlaywright = async (query: string): Promise<string | null> => {
  if (!ACTION_YOUTUBE_USE_PLAYWRIGHT) {
    return null;
  }

  try {
    const playwright = await dynamicImport('playwright');
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
        waitUntil: 'domcontentloaded',
        timeout: ACTION_YOUTUBE_PLAYWRIGHT_TIMEOUT_MS,
      });
      await page.waitForTimeout(700);
      const href = await page.evaluate(() => {
        const anchor = document.querySelector('ytd-video-renderer a#video-title') as HTMLAnchorElement | null;
        if (!anchor?.href) {
          return null;
        }
        return anchor.href;
      });
      return typeof href === 'string' && href.trim() ? href.trim() : null;
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
};

export const youtubeSearchFirstAction: ActionDefinition = {
  name: 'youtube.search.first',
  description: 'YouTube에서 질의어 기준 첫 영상 URL을 추출합니다.',
  execute: async ({ goal, args }) => {
    const query = extractQuery(goal, args);
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const firstVideoUrl = await findFirstVideoUrlByPlaywright(query) || await findFirstVideoUrl(query);

    if (!firstVideoUrl) {
      return {
        ok: false,
        name: 'youtube.search.first',
        summary: 'YouTube 첫 영상 링크를 추출하지 못했습니다.',
        artifacts: [searchUrl],
        verification: [ACTION_YOUTUBE_USE_PLAYWRIGHT ? 'Playwright + HTML 파싱 모두 실패' : '검색 페이지 접속 후 videoId 파싱 실패'],
        error: 'NO_VIDEO_FOUND',
      };
    }

    return {
      ok: true,
      name: 'youtube.search.first',
      summary: 'YouTube 첫 영상 링크 추출 완료',
      artifacts: [firstVideoUrl, searchUrl],
      verification: [ACTION_YOUTUBE_USE_PLAYWRIGHT ? 'Playwright DOM 추출 또는 HTML 파싱 성공' : 'videoId 파싱 성공'],
    };
  },
};
