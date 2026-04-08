import type { ActionDefinition } from './types';
import { isWebHostAllowed } from './policy';
import { runDelegatedAction } from './mcpDelegatedAction';
import { compactText, extractFirstUrl } from './queryUtils';
import logger from '../../../logger';
import { getErrorMessage } from '../../../utils/errorMessage';

const toTextPreview = (html: string, maxLength = 600): string => {
  return compactText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).slice(0, maxLength);
};

const isDiscourseTopicUrl = (url: URL): boolean => /^\/t\/.+/i.test(url.pathname);

const buildDiscourseTopicJsonUrl = (url: URL): string => {
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  // Discourse topic URLs are typically `/t/id`, `/t/slug/id`, or the same with a trailing `/postNumber`.
  const topicPath = normalizedPath.match(/^(\/t\/(?:[^/]+\/)?\d+)(?:\/\d+)?$/i)?.[1] || normalizedPath;
  const jsonUrl = new URL(url.toString());
  jsonUrl.pathname = topicPath.endsWith('.json') ? topicPath : `${topicPath}.json`;
  jsonUrl.hash = '';
  return jsonUrl.toString();
};

const getRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const getDiscourseTopicPreview = (payload: unknown): string => {
  const data = getRecord(payload);
  if (!data) {
    return '';
  }

  const title = typeof data.title === 'string' ? compactText(data.title) : '';
  const postStream = getRecord(data.post_stream);
  const posts = Array.isArray(postStream?.posts) ? postStream.posts : [];
  const firstPost = posts.map((item) => getRecord(item)).find(Boolean) || null;
  const cooked = typeof firstPost?.cooked === 'string' ? firstPost.cooked : '';
  const excerpt = typeof data.excerpt === 'string' ? data.excerpt : '';
  const body = toTextPreview(cooked || excerpt, 520);

  return compactText([title, body].filter(Boolean).join(' — ')).slice(0, 600);
};

export const webFetchAction: ActionDefinition = {
  name: 'web.fetch',
  description: '허용된 호스트의 웹 페이지를 조회해 핵심 텍스트를 추출합니다(read-only).',
  category: 'tool',
  parameters: [
    { name: 'url', required: true, description: 'Target URL to fetch (must be in allowlist)', example: 'https://example.com/page' },
  ],
  execute: async ({ goal, args }) => {
    const url = extractFirstUrl(goal, args);
    if (!url) {
      return {
        ok: false,
        name: 'web.fetch',
        summary: '조회할 URL이 없습니다.',
        artifacts: [],
        verification: ['입력 URL 미존재'],
        error: 'URL_NOT_FOUND',
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return {
        ok: false,
        name: 'web.fetch',
        summary: '유효하지 않은 URL입니다.',
        artifacts: [],
        verification: ['URL 파싱 실패'],
        error: 'INVALID_URL',
      };
    }

    if (!isWebHostAllowed(parsed.hostname)) {
      return {
        ok: false,
        name: 'web.fetch',
        summary: `허용되지 않은 호스트입니다: ${parsed.hostname}`,
        artifacts: [parsed.origin],
        verification: ['호스트 allowlist 정책 차단'],
        error: 'HOST_NOT_ALLOWED',
      };
    }

    // SSRF guard: block private/loopback/link-local IP addresses
    const PRIVATE_IP_PATTERNS = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.|169\.254\.|::1$|fc|fd|fe80)/i;
    if (PRIVATE_IP_PATTERNS.test(parsed.hostname) || parsed.hostname === 'localhost') {
      return {
        ok: false,
        name: 'web.fetch',
        summary: '내부 네트워크 주소는 허용되지 않습니다.',
        artifacts: [parsed.origin],
        verification: ['SSRF 방어: private/loopback IP 차단'],
        error: 'SSRF_BLOCKED',
      };
    }

    const delegated = await runDelegatedAction({
      actionName: 'web.fetch',
      workerKind: 'web',
      toolName: 'web.fetch',
      args: { url: parsed.toString() },
      successSummary: () => 'MCP 웹 워커 조회 성공',
      strictFailureSummary: 'MCP 웹 워커 호출 실패(엄격 모드)',
    });
    if (delegated) {
      return delegated;
    }

    if (isDiscourseTopicUrl(parsed)) {
      try {
        const discourseRes = await fetch(buildDiscourseTopicJsonUrl(parsed), {
          headers: {
            'user-agent': 'muel-action-runner/1.0',
            accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
          },
        });

        if (discourseRes.ok) {
          const discoursePreview = getDiscourseTopicPreview(await discourseRes.json());
          if (discoursePreview) {
            return {
              ok: true,
              name: 'web.fetch',
              summary: '웹 페이지 조회 성공',
              artifacts: [parsed.toString(), discoursePreview],
              verification: ['HTTP 2xx', 'Discourse topic JSON 추출'],
            };
          }
        }
      } catch (error) {
        logger.debug('[ACTION][web.fetch] discourse JSON fallback url=%s: %s', parsed.toString(), getErrorMessage(error));
      }
    }

    const res = await fetch(parsed.toString(), {
      headers: {
        'user-agent': 'muel-action-runner/1.0',
      },
    });

    if (!res.ok) {
      return {
        ok: false,
        name: 'web.fetch',
        summary: `웹 조회 실패(status=${res.status})`,
        artifacts: [parsed.toString()],
        verification: ['HTTP non-2xx'],
        error: 'WEB_FETCH_FAILED',
      };
    }

    const body = await res.text();
    const preview = toTextPreview(body);
    return {
      ok: true,
      name: 'web.fetch',
      summary: '웹 페이지 조회 성공',
      artifacts: [parsed.toString(), preview || '(본문 요약 없음)'],
      verification: ['HTTP 2xx', '본문 텍스트 추출'],
    };
  },
};
