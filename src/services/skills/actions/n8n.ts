/**
 * n8n Agent Actions — expose n8n capabilities as first-class planner actions.
 *
 * Actions:
 * - n8n.status: Check n8n health, delegation config, and available workflows
 * - n8n.workflow.list: Discover active n8n workflows
 * - n8n.workflow.execute: Execute a workflow by ID
 * - n8n.workflow.trigger: Trigger a webhook workflow with arbitrary data
 */
import { runExternalAction, getExternalAdaptersStatus } from '../../tools/toolRouter';
import {
  getDelegationStatus,
  delegateNewsRssFetch,
  delegateNewsSummarize,
  delegateNewsMonitorCandidates,
  delegateYoutubeFeedFetch,
  delegateYoutubeCommunityScrape,
  delegateAlertDispatch,
  delegateArticleContextFetch,
} from '../../automation/n8nDelegationService';
import type { ActionDefinition, ActionExecutionResult } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const withOperateRouting = (
  result: ActionExecutionResult,
  reason: string,
): ActionExecutionResult => ({
  ...result,
  agentRole: 'operate',
  handoff: {
    fromAgent: 'operate',
    toAgent: 'operate',
    reason,
  },
});

// ─── n8n.status ───────────────────────────────────────────────────────────────

export const n8nStatusAction: ActionDefinition = {
  name: 'n8n.status',
  description: 'n8n 연결 상태, 위임 설정, 사용 가능한 워크플로 정보를 확인합니다.',
  category: 'automation',
  parameters: [],
  execute: async () => {
    const delegation = getDelegationStatus();

    // Probe adapter availability
    const adapters = await getExternalAdaptersStatus();
    const n8nAdapter = adapters.find((a) => a.id === 'n8n');

    // If available, also fetch workflow list for a full picture
    let workflowSummary = '(n8n 미연결)';
    if (n8nAdapter?.available) {
      const listResult = await runExternalAction('n8n' as never, 'workflow.list', { limit: 25 });
      if (listResult.ok && listResult.output.length > 0) {
        try {
          const parsed = JSON.parse(listResult.output[0]) as { data?: Array<{ id: string; name: string; active: boolean }> };
          const workflows = parsed.data || [];
          workflowSummary = workflows.length > 0
            ? workflows.map((w) => `[${w.id}] ${w.name} (active=${w.active})`).join('\n')
            : '활성 워크플로 없음';
        } catch {
          workflowSummary = listResult.output[0].slice(0, 500);
        }
      }
    }

    const statusLines = [
      `n8n 어댑터: ${n8nAdapter?.available ? '연결됨' : '미연결'}`,
      `위임 활성화: ${delegation.enabled}`,
      `위임 우선 모드: ${delegation.delegationFirst}`,
      `가용성 캐시: ${delegation.n8nCacheAvailable ?? '미확인'}`,
      '',
      '--- 위임 태스크 설정 ---',
      ...Object.entries(delegation.tasks).map(([task, cfg]) =>
        `${task}: ${cfg.configured ? '설정됨' : '미설정'}`,
      ),
      '',
      '--- 활성 워크플로 ---',
      workflowSummary,
    ];

    return withOperateRouting({
      ok: true,
      name: 'n8n.status',
      summary: `n8n ${n8nAdapter?.available ? '정상 연결' : '미연결'} / 위임 ${delegation.enabled ? 'ON' : 'OFF'}`,
      artifacts: statusLines,
      verification: ['adapter probe', 'delegation config', 'workflow list'],
    }, 'n8n status check');
  },
};

// ─── n8n.workflow.list ────────────────────────────────────────────────────────

export const n8nWorkflowListAction: ActionDefinition = {
  name: 'n8n.workflow.list',
  description: 'n8n에 등록된 활성 워크플로 목록을 조회합니다.',
  category: 'automation',
  parameters: [
    { name: 'limit', required: false, description: '조회할 최대 워크플로 수 (기본 25)', example: '25' },
  ],
  execute: async ({ args }) => {
    const limit = Math.min(100, Math.max(1, Number(args?.limit) || 25));

    const result = await runExternalAction('n8n' as never, 'workflow.list', { limit });

    if (!result.ok) {
      return withOperateRouting({
        ok: false,
        name: 'n8n.workflow.list',
        summary: `n8n 워크플로 목록 조회 실패: ${result.error || result.summary}`,
        artifacts: [],
        verification: ['adapter call failed'],
        error: result.error || 'N8N_LIST_FAILED',
      }, 'n8n workflow list failed');
    }

    let summary = 'n8n 워크플로 목록 조회 성공';
    const artifacts: string[] = [];

    if (result.output.length > 0) {
      try {
        const parsed = JSON.parse(result.output[0]) as { data?: Array<{ id: string; name: string; active: boolean }> };
        const workflows = parsed.data || [];
        summary = `활성 워크플로 ${workflows.length}건 조회됨`;
        for (const w of workflows) {
          artifacts.push(`[${w.id}] ${w.name} (active=${w.active})`);
        }
      } catch {
        artifacts.push(result.output[0].slice(0, 1000));
      }
    }

    return withOperateRouting({
      ok: true,
      name: 'n8n.workflow.list',
      summary,
      artifacts,
      verification: ['workflow.list ok', `durationMs=${result.durationMs}`],
      durationMs: result.durationMs,
    }, 'n8n workflow list');
  },
};

// ─── n8n.workflow.execute ─────────────────────────────────────────────────────

export const n8nWorkflowExecuteAction: ActionDefinition = {
  name: 'n8n.workflow.execute',
  description: 'n8n 워크플로를 ID로 직접 실행합니다. 워크플로 ID와 입력 데이터를 전달합니다.',
  category: 'automation',
  parameters: [
    { name: 'workflowId', required: true, description: '실행할 n8n 워크플로 ID', example: '1234' },
    { name: 'data', required: false, description: '워크플로에 전달할 입력 데이터 (JSON 객체)', example: '{"key":"value"}' },
  ],
  execute: async ({ args }) => {
    const workflowId = String(args?.workflowId || '').trim();
    if (!workflowId) {
      return withOperateRouting({
        ok: false,
        name: 'n8n.workflow.execute',
        summary: 'workflowId가 필요합니다.',
        artifacts: [],
        verification: ['workflowId validation failed'],
        error: 'MISSING_WORKFLOW_ID',
      }, 'n8n workflow execute validation');
    }

    // Validate workflowId: only alphanumeric and hyphens for safety
    if (!/^[\w-]+$/.test(workflowId)) {
      return withOperateRouting({
        ok: false,
        name: 'n8n.workflow.execute',
        summary: '유효하지 않은 workflowId입니다.',
        artifacts: [],
        verification: ['workflowId format validation'],
        error: 'INVALID_WORKFLOW_ID',
      }, 'n8n workflow execute validation');
    }

    const data = args?.data && typeof args.data === 'object' ? args.data : {};

    const result = await runExternalAction('n8n' as never, 'workflow.execute', { workflowId, data });

    if (!result.ok) {
      return withOperateRouting({
        ok: false,
        name: 'n8n.workflow.execute',
        summary: `워크플로 ${workflowId} 실행 실패: ${result.error || result.summary}`,
        artifacts: result.output.slice(0, 3),
        verification: ['workflow.execute failed'],
        error: result.error || 'N8N_EXECUTE_FAILED',
        durationMs: result.durationMs,
      }, 'n8n workflow execute failed');
    }

    return withOperateRouting({
      ok: true,
      name: 'n8n.workflow.execute',
      summary: `워크플로 ${workflowId} 실행 완료`,
      artifacts: result.output.slice(0, 3),
      verification: ['workflow.execute ok', `durationMs=${result.durationMs}`],
      durationMs: result.durationMs,
    }, 'n8n workflow execute');
  },
};

// ─── n8n.workflow.trigger ─────────────────────────────────────────────────────

export const n8nWorkflowTriggerAction: ActionDefinition = {
  name: 'n8n.workflow.trigger',
  description: 'n8n 웹훅 워크플로를 경로로 트리거합니다. 임의의 데이터를 전달할 수 있습니다.',
  category: 'automation',
  parameters: [
    { name: 'webhookPath', required: true, description: '트리거할 웹훅 경로', example: 'my-workflow' },
    { name: 'data', required: false, description: '웹훅에 전달할 데이터 (JSON 객체)', example: '{"message":"hello"}' },
  ],
  execute: async ({ args }) => {
    const webhookPath = String(args?.webhookPath || args?.path || '').trim();
    if (!webhookPath) {
      return withOperateRouting({
        ok: false,
        name: 'n8n.workflow.trigger',
        summary: 'webhookPath가 필요합니다.',
        artifacts: [],
        verification: ['webhookPath validation failed'],
        error: 'MISSING_WEBHOOK_PATH',
      }, 'n8n workflow trigger validation');
    }

    // Security: only allow alphanumeric, hyphens, slashes (same as n8nAdapter)
    if (!/^[a-zA-Z0-9\-/]+$/.test(webhookPath)) {
      return withOperateRouting({
        ok: false,
        name: 'n8n.workflow.trigger',
        summary: '유효하지 않은 웹훅 경로입니다.',
        artifacts: [],
        verification: ['webhookPath format validation'],
        error: 'INVALID_WEBHOOK_PATH',
      }, 'n8n workflow trigger validation');
    }

    const data = args?.data && typeof args.data === 'object' ? args.data : {};

    const result = await runExternalAction('n8n' as never, 'workflow.trigger', {
      webhookPath,
      data,
      method: 'POST',
    });

    if (!result.ok) {
      return withOperateRouting({
        ok: false,
        name: 'n8n.workflow.trigger',
        summary: `웹훅 ${webhookPath} 트리거 실패: ${result.error || result.summary}`,
        artifacts: result.output.slice(0, 3),
        verification: ['workflow.trigger failed'],
        error: result.error || 'N8N_TRIGGER_FAILED',
        durationMs: result.durationMs,
      }, 'n8n workflow trigger failed');
    }

    return withOperateRouting({
      ok: true,
      name: 'n8n.workflow.trigger',
      summary: `웹훅 ${webhookPath} 트리거 성공`,
      artifacts: result.output.slice(0, 3),
      verification: ['workflow.trigger ok', `durationMs=${result.durationMs}`],
      durationMs: result.durationMs,
    }, 'n8n workflow trigger');
  },
};

// ─── Delegation Task Actions ──────────────────────────────────────────────────
// Expose n8n delegation tasks as first-class agent-discoverable actions.
// These wrap the typed delegation service functions so the planner can
// choose to delegate work to n8n without callers needing to know the
// webhook details.

const delegationResult = (
  name: string,
  res: { delegated: boolean; ok: boolean; data: unknown; error?: string; durationMs: number },
): ActionExecutionResult => {
  if (!res.delegated) {
    return withOperateRouting({
      ok: false,
      name,
      summary: 'n8n 위임 불가 (미설정 또는 미연결)',
      artifacts: [],
      verification: ['delegation not available'],
      error: 'DELEGATION_UNAVAILABLE',
    }, `${name} delegation unavailable`);
  }
  if (!res.ok) {
    return withOperateRouting({
      ok: false,
      name,
      summary: `n8n 위임 실패: ${res.error || 'unknown'}`,
      artifacts: [],
      verification: ['delegation failed'],
      error: res.error || 'DELEGATION_FAILED',
      durationMs: res.durationMs,
    }, `${name} delegation failed`);
  }
  const artifacts = res.data ? [JSON.stringify(res.data, null, 2).slice(0, 3000)] : [];
  return withOperateRouting({
    ok: true,
    name,
    summary: `n8n 위임 성공 (${res.durationMs}ms)`,
    artifacts,
    verification: ['delegation ok', `durationMs=${res.durationMs}`],
    durationMs: res.durationMs,
  }, `${name} delegation`);
};

export const n8nDelegateNewsRssAction: ActionDefinition = {
  name: 'n8n.delegate.news-rss',
  description: 'n8n으로 뉴스 RSS 피드를 가져옵니다. 검색어와 제한 수를 지정합니다.',
  category: 'automation',
  parameters: [
    { name: 'query', required: true, description: '검색할 뉴스 키워드', example: 'AI semiconductor' },
    { name: 'limit', required: false, description: '최대 결과 수 (기본 10)', example: '10' },
  ],
  execute: async ({ args }) => {
    const query = String(args?.query || '').trim();
    if (!query) {
      return withOperateRouting({ ok: false, name: 'n8n.delegate.news-rss', summary: 'query가 필요합니다.', artifacts: [], verification: ['validation'], error: 'MISSING_QUERY' }, 'validation');
    }
    const limit = Math.min(50, Math.max(1, Number(args?.limit) || 10));
    return delegationResult('n8n.delegate.news-rss', await delegateNewsRssFetch(query, limit));
  },
};

export const n8nDelegateNewsSummarizeAction: ActionDefinition = {
  name: 'n8n.delegate.news-summarize',
  description: 'n8n으로 뉴스 기사를 요약합니다. 제목, 링크, 설명을 전달합니다.',
  category: 'automation',
  parameters: [
    { name: 'title', required: true, description: '기사 제목', example: 'NVIDIA reports record Q4' },
    { name: 'link', required: true, description: '기사 URL', example: 'https://example.com/article' },
    { name: 'description', required: false, description: '기사 설명', example: 'Article summary...' },
  ],
  execute: async ({ args }) => {
    const title = String(args?.title || '').trim();
    const link = String(args?.link || '').trim();
    if (!title || !link) {
      return withOperateRouting({ ok: false, name: 'n8n.delegate.news-summarize', summary: 'title과 link가 필요합니다.', artifacts: [], verification: ['validation'], error: 'MISSING_PARAMS' }, 'validation');
    }
    const description = String(args?.description || '');
    return delegationResult('n8n.delegate.news-summarize', await delegateNewsSummarize(title, link, description));
  },
};

export const n8nDelegateNewsMonitorAction: ActionDefinition = {
  name: 'n8n.delegate.news-monitor',
  description: 'n8n으로 뉴스 모니터링 후보 기사를 가져옵니다.',
  category: 'automation',
  parameters: [
    { name: 'limit', required: false, description: '최대 후보 수 (기본 20)', example: '20' },
  ],
  execute: async ({ args }) => {
    const limit = Math.min(100, Math.max(1, Number(args?.limit) || 20));
    return delegationResult('n8n.delegate.news-monitor', await delegateNewsMonitorCandidates(limit));
  },
};

export const n8nDelegateYoutubeFeedAction: ActionDefinition = {
  name: 'n8n.delegate.youtube-feed',
  description: 'n8n으로 YouTube 채널 피드를 가져옵니다.',
  category: 'automation',
  parameters: [
    { name: 'channelUrl', required: true, description: 'YouTube 채널 URL', example: 'https://youtube.com/@channel' },
  ],
  execute: async ({ args }) => {
    const channelUrl = String(args?.channelUrl || '').trim();
    if (!channelUrl) {
      return withOperateRouting({ ok: false, name: 'n8n.delegate.youtube-feed', summary: 'channelUrl이 필요합니다.', artifacts: [], verification: ['validation'], error: 'MISSING_CHANNEL_URL' }, 'validation');
    }
    return delegationResult('n8n.delegate.youtube-feed', await delegateYoutubeFeedFetch(channelUrl));
  },
};

export const n8nDelegateYoutubeScrapAction: ActionDefinition = {
  name: 'n8n.delegate.youtube-community',
  description: 'n8n으로 YouTube 커뮤니티 페이지를 스크래핑합니다.',
  category: 'automation',
  parameters: [
    { name: 'communityUrl', required: true, description: 'YouTube 커뮤니티 URL', example: 'https://youtube.com/@channel/community' },
  ],
  execute: async ({ args }) => {
    const communityUrl = String(args?.communityUrl || '').trim();
    if (!communityUrl) {
      return withOperateRouting({ ok: false, name: 'n8n.delegate.youtube-community', summary: 'communityUrl이 필요합니다.', artifacts: [], verification: ['validation'], error: 'MISSING_COMMUNITY_URL' }, 'validation');
    }
    return delegationResult('n8n.delegate.youtube-community', await delegateYoutubeCommunityScrape(communityUrl));
  },
};

export const n8nDelegateAlertAction: ActionDefinition = {
  name: 'n8n.delegate.alert',
  description: 'n8n으로 알림을 발송합니다. 제목, 메시지, 태그를 전달합니다.',
  category: 'automation',
  parameters: [
    { name: 'title', required: true, description: '알림 제목', example: 'Price Alert' },
    { name: 'message', required: true, description: '알림 내용', example: 'AAPL crossed $200' },
    { name: 'tags', required: false, description: '태그 (JSON 객체)', example: '{"severity":"high"}' },
  ],
  execute: async ({ args }) => {
    const title = String(args?.title || '').trim();
    const message = String(args?.message || '').trim();
    if (!title || !message) {
      return withOperateRouting({ ok: false, name: 'n8n.delegate.alert', summary: 'title과 message가 필요합니다.', artifacts: [], verification: ['validation'], error: 'MISSING_PARAMS' }, 'validation');
    }
    let tags: Record<string, string> = {};
    if (args?.tags && typeof args.tags === 'object' && !Array.isArray(args.tags)) {
      tags = args.tags as Record<string, string>;
    }
    return delegationResult('n8n.delegate.alert', await delegateAlertDispatch(title, message, tags));
  },
};

export const n8nDelegateArticleContextAction: ActionDefinition = {
  name: 'n8n.delegate.article-context',
  description: 'n8n으로 기사 URL의 제목과 설명을 가져옵니다.',
  category: 'automation',
  parameters: [
    { name: 'url', required: true, description: '기사 URL', example: 'https://example.com/news/article' },
  ],
  execute: async ({ args }) => {
    const url = String(args?.url || '').trim();
    if (!url) {
      return withOperateRouting({ ok: false, name: 'n8n.delegate.article-context', summary: 'url이 필요합니다.', artifacts: [], verification: ['validation'], error: 'MISSING_URL' }, 'validation');
    }
    return delegationResult('n8n.delegate.article-context', await delegateArticleContextFetch(url));
  },
};
