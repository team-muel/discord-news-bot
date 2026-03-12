import type { ActionDefinition } from './types';
import { isWebHostAllowed } from './policy';
import { runDelegatedAction } from './mcpDelegatedAction';
import { compactText, extractFirstUrl } from './queryUtils';

const toTextPreview = (html: string): string => {
  return compactText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).slice(0, 600);
};

export const webFetchAction: ActionDefinition = {
  name: 'web.fetch',
  description: '허용된 호스트의 웹 페이지를 조회해 핵심 텍스트를 추출합니다(read-only).',
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
