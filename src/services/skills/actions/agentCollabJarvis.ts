/**
 * OpenJarvis extended capability actions — research, digest, memory, eval, telemetry, scheduler, skill discovery.
 * Extracted from agentCollab.ts for domain-scoped cohesion.
 */
import { runExternalAction } from '../../tools/toolRouter';
import type { ActionDefinition } from './types';
import {
  compact,
  resolveGoal,
  withRouting,
} from './agentCollabHelpers';

export const jarvisResearchAction: ActionDefinition = {
  name: 'jarvis.research',
  description: 'OpenJarvis deep_research 에이전트를 이용한 심층 리서치를 수행합니다.',
  category: 'agent',
  parameters: [
    { name: 'query', description: 'Research query', required: true },
    { name: 'sources', description: 'Optional source list', required: false },
  ],
  execute: async ({ goal, args }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false, name: 'jarvis.research', summary: 'Research query가 비어 있습니다.',
        artifacts: [], verification: ['query required'], error: 'QUERY_EMPTY', agentRole: 'operate',
      }, 'operate', 'task validation failed');
    }
    const result = await runExternalAction('openjarvis', 'jarvis.research', {
      query, ...(args?.sources ? { sources: args.sources } : {}),
    });
    return withRouting({
      ok: result.ok, name: 'jarvis.research',
      summary: result.ok ? 'Deep research 완료' : (result.error || 'Research 실패'),
      artifacts: result.output.length > 0 ? [result.output.join('\n')] : [],
      verification: [`adapter ok=${result.ok}`, `duration=${result.durationMs}ms`],
      agentRole: 'operate',
    }, 'operate', result.ok ? 'jarvis research completed' : 'jarvis research failed');
  },
};

export const jarvisDigestAction: ActionDefinition = {
  name: 'jarvis.digest',
  description: 'OpenJarvis morning_digest 에이전트를 이용한 일일 브리핑을 생성합니다.',
  category: 'agent',
  parameters: [
    { name: 'topic', description: 'Digest topic (default: daily briefing)', required: false },
    { name: 'sources', description: 'Optional source list', required: false },
  ],
  execute: async ({ args }) => {
    const result = await runExternalAction('openjarvis', 'jarvis.digest', {
      topic: compact(args?.topic) || 'daily briefing',
      ...(args?.sources ? { sources: args.sources } : {}),
      ...(args?.json ? { json: true } : {}),
    });
    return withRouting({
      ok: result.ok, name: 'jarvis.digest',
      summary: result.ok ? 'Digest 생성 완료' : (result.error || 'Digest 실패'),
      artifacts: result.output.length > 0 ? [result.output.join('\n')] : [],
      verification: [`adapter ok=${result.ok}`, `duration=${result.durationMs}ms`],
      agentRole: 'operate',
    }, 'operate', result.ok ? 'jarvis digest completed' : 'jarvis digest failed');
  },
};

export const jarvisMemoryIndexAction: ActionDefinition = {
  name: 'jarvis.memory.index',
  description: 'OpenJarvis 지식 베이스에 문서를 인덱싱합니다.',
  category: 'agent',
  parameters: [
    { name: 'path', description: 'File or directory path to index', required: true },
  ],
  execute: async ({ args }) => {
    const indexPath = compact(args?.path);
    if (!indexPath) {
      return withRouting({
        ok: false, name: 'jarvis.memory.index', summary: '인덱싱 대상 경로가 비어 있습니다.',
        artifacts: [], verification: ['path required'], error: 'PATH_EMPTY', agentRole: 'operate',
      }, 'operate', 'task validation failed');
    }
    const result = await runExternalAction('openjarvis', 'jarvis.memory.index', { path: indexPath });
    return withRouting({
      ok: result.ok, name: 'jarvis.memory.index',
      summary: result.ok ? `인덱싱 완료: ${indexPath}` : (result.error || '인덱싱 실패'),
      artifacts: result.output.length > 0 ? [result.output.join('\n')] : [],
      verification: [`adapter ok=${result.ok}`, `duration=${result.durationMs}ms`],
      agentRole: 'operate',
    }, 'operate', result.ok ? 'memory index completed' : 'memory index failed');
  },
};

export const jarvisMemorySearchAction: ActionDefinition = {
  name: 'jarvis.memory.search',
  description: 'OpenJarvis 지식 베이스에서 의미 검색을 수행합니다.',
  category: 'agent',
  parameters: [
    { name: 'query', description: 'Search query', required: true },
    { name: 'limit', description: 'Max results (default: 5)', required: false },
  ],
  execute: async ({ goal, args }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false, name: 'jarvis.memory.search', summary: '검색 쿼리가 비어 있습니다.',
        artifacts: [], verification: ['query required'], error: 'QUERY_EMPTY', agentRole: 'operate',
      }, 'operate', 'task validation failed');
    }
    const result = await runExternalAction('openjarvis', 'jarvis.memory.search', {
      query, ...(args?.limit ? { limit: Number(args.limit) } : {}),
    });
    return withRouting({
      ok: result.ok, name: 'jarvis.memory.search',
      summary: result.ok ? 'Memory 검색 완료' : (result.error || '검색 실패'),
      artifacts: result.output.length > 0 ? [result.output.join('\n')] : [],
      verification: [`adapter ok=${result.ok}`, `duration=${result.durationMs}ms`],
      agentRole: 'operate',
    }, 'operate', result.ok ? 'memory search completed' : 'memory search failed');
  },
};

export const jarvisEvalAction: ActionDefinition = {
  name: 'jarvis.eval',
  description: 'OpenJarvis 평가 벤치마크를 실행합니다.',
  category: 'agent',
  parameters: [
    { name: 'dataset', description: 'Eval dataset name (default: ipw_mixed)', required: false },
    { name: 'limit', description: 'Max eval samples', required: false },
  ],
  execute: async ({ args }) => {
    const result = await runExternalAction('openjarvis', 'jarvis.eval', {
      dataset: compact(args?.dataset) || 'ipw_mixed',
      ...(args?.limit ? { limit: Number(args.limit) } : {}),
    });
    return withRouting({
      ok: result.ok, name: 'jarvis.eval',
      summary: result.ok ? 'Eval 벤치마크 완료' : (result.error || 'Eval 실패'),
      artifacts: result.output.length > 0 ? [result.output.join('\n')] : [],
      verification: [`adapter ok=${result.ok}`, `duration=${result.durationMs}ms`],
      agentRole: 'operate',
    }, 'operate', result.ok ? 'jarvis eval completed' : 'jarvis eval failed');
  },
};

export const jarvisTelemetryAction: ActionDefinition = {
  name: 'jarvis.telemetry',
  description: 'OpenJarvis 텔레메트리(에너지/레이턴시/처리량) 요약을 조회합니다.',
  category: 'agent',
  parameters: [
    { name: 'window', description: 'Time window (default: 1h)', required: false },
  ],
  execute: async ({ args }) => {
    const result = await runExternalAction('openjarvis', 'jarvis.telemetry', {
      window: compact(args?.window) || '1h',
    });
    return withRouting({
      ok: result.ok, name: 'jarvis.telemetry',
      summary: result.ok ? 'Telemetry 조회 완료' : (result.error || 'Telemetry 실패'),
      artifacts: result.output.length > 0 ? [result.output.join('\n')] : [],
      verification: [`adapter ok=${result.ok}`, `duration=${result.durationMs}ms`],
      agentRole: 'operate',
    }, 'operate', result.ok ? 'telemetry retrieved' : 'telemetry failed');
  },
};

export const jarvisSchedulerListAction: ActionDefinition = {
  name: 'jarvis.scheduler.list',
  description: 'OpenJarvis 스케줄러 태스크 목록을 조회합니다.',
  category: 'agent',
  parameters: [],
  execute: async () => {
    const result = await runExternalAction('openjarvis', 'jarvis.scheduler.list', {});
    return withRouting({
      ok: result.ok, name: 'jarvis.scheduler.list',
      summary: result.ok ? '스케줄러 태스크 목록 조회 완료' : (result.error || '조회 실패'),
      artifacts: result.output.length > 0 ? [result.output.join('\n')] : [],
      verification: [`adapter ok=${result.ok}`, `duration=${result.durationMs}ms`],
      agentRole: 'operate',
    }, 'operate', result.ok ? 'scheduler list completed' : 'scheduler list failed');
  },
};

export const jarvisSkillSearchAction: ActionDefinition = {
  name: 'jarvis.skill.search',
  description: 'OpenJarvis에서 사용 가능한 스킬을 검색합니다.',
  category: 'agent',
  parameters: [
    { name: 'query', description: 'Search query (optional)', required: false },
  ],
  execute: async ({ args }) => {
    const result = await runExternalAction('openjarvis', 'jarvis.skill.search', {
      ...(args?.query ? { query: String(args.query) } : {}),
    });
    return withRouting({
      ok: result.ok, name: 'jarvis.skill.search',
      summary: result.ok ? 'Skill search 완료' : (result.error || 'Search 실패'),
      artifacts: result.output.length > 0 ? [result.output.join('\n')] : [],
      verification: [`adapter ok=${result.ok}`, `duration=${result.durationMs}ms`],
      agentRole: 'operate',
    }, 'operate', result.ok ? 'skill search completed' : 'skill search failed');
  },
};
