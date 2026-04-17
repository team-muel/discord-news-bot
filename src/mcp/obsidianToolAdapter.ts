/**
 * Obsidian MCP Tool Adapter
 *
 * Exposes Obsidian vault operations as MCP tools for agent consumption.
 * Tools cover the two key facets:
 *   1. Retrieval — search, read, graph metadata, RAG query
 *   2. Operations — write notes, sync status, cache stats, quality audit
 *
 * All write operations route through the sanitization gate in router.ts.
 */

import {
  searchObsidianVaultWithAdapter,
  readObsidianFileWithAdapter,
  getObsidianGraphMetadataWithAdapter,
  writeObsidianNoteWithAdapter,
  getObsidianAdapterRuntimeStatus,
  getObsidianVaultLiveHealthStatus,
  getObsidianOutlineWithAdapter,
  searchObsidianContextWithAdapter,
  readObsidianPropertyWithAdapter,
  setObsidianPropertyWithAdapter,
  listObsidianFilesWithAdapter,
  appendObsidianContentWithAdapter,
  appendDailyNoteWithAdapter,
  readDailyNoteWithAdapter,
  listObsidianTasksWithAdapter,
  toggleObsidianTaskWithAdapter,
} from '../services/obsidian/router';
import { evalCode as obsidianEvalCode } from '../services/obsidian/adapters/nativeCliAdapter';
import {
  buildObsidianKnowledgeReflectionBundle,
  captureObsidianWikiChange,
  compileObsidianRequirement,
  compileObsidianKnowledgeBundle,
  getObsidianKnowledgeControlSurface,
  promoteKnowledgeToObsidian,
  resolveObsidianIncidentGraph,
  resolveInternalKnowledge,
  resolveObsidianKnowledgeArtifactPath,
  runObsidianSemanticLintAudit,
  traceObsidianDecision,
} from '../services/obsidian/knowledgeCompilerService';
import { getObsidianRetrievalBoundarySnapshot, queryObsidianRAG } from '../services/obsidian/obsidianRagService';
import { getCacheStats } from '../services/obsidian/obsidianCacheService';
import { getObsidianLoreSyncLoopStats } from '../services/obsidian/obsidianLoreSyncService';
import { executeObsidianGraphAudit, executeObsidianLoreSync } from '../services/obsidian/obsidianMaintenanceControlService';
import { getLatestObsidianGraphAuditSnapshot } from '../services/obsidian/obsidianQualityService';
import { getObsidianVaultRoot, getObsidianVaultRuntimeInfo } from '../utils/obsidianEnv';
import { isOneOf } from '../utils/validation';
import { buildActiveWorkset, buildOperatorSnapshot } from '../routes/bot-agent/runtimeRoutes';
import type { McpToolCallRequest, McpToolCallResult, McpToolSpec } from './types';

const compact = (value: unknown): string => String(value ?? '').trim();

const VALID_OBSIDIAN_PROMOTION_ARTIFACT_KINDS = ['note', 'requirement', 'ops-note', 'contract', 'retrofit', 'lesson'] as const;
type ValidObsidianPromotionArtifactKind = typeof VALID_OBSIDIAN_PROMOTION_ARTIFACT_KINDS[number];

const VALID_OBSIDIAN_WIKI_CHANGE_KINDS = ['repo-memory', 'architecture-delta', 'service-change', 'ops-change', 'development-slice', 'changelog-worthy'] as const;
type ValidObsidianWikiChangeKind = typeof VALID_OBSIDIAN_WIKI_CHANGE_KINDS[number];

const toTextResult = (text: string, isError = false): McpToolCallResult => ({
  content: [{ type: 'text', text }],
  isError,
});

const toJsonResult = (value: unknown): McpToolCallResult =>
  toTextResult(JSON.stringify(value, null, 2));

// ── Tool Definitions ──────────────────────────────────────────────────────────

export const OBSIDIAN_TOOLS: McpToolSpec[] = [
  {
    name: 'obsidian.search',
    description: 'Obsidian vault에서 키워드 기반 graph-first 검색을 수행합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '검색 키워드' },
        guildId: { type: 'string', description: '길드 ID (선택)' },
        maxResults: { type: 'number', description: '최대 결과 수 (기본: 10)' },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.rag',
    description: '인텐트 기반 RAG 검색 — graph-first 전략으로 vault 지식을 검색합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '질문 또는 검색 쿼리' },
        guildId: { type: 'string', description: '길드 ID (선택)' },
        maxDocs: { type: 'number', description: '최대 문서 수 (기본: 10)' },
        contextMode: { type: 'string', enum: ['full', 'metadata_first'], description: '컨텍스트 모드 (기본: metadata_first)' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.read',
    description: 'Vault 내 특정 파일의 내용을 읽습니다.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'vault 내 상대 파일 경로' },
        guildId: { type: 'string', description: '길드 ID (선택)' },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.graph',
    description: 'Vault의 그래프 메타데이터(backlinks, tags, links)를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.write',
    description: 'Sanitization gate를 통해 vault에 노트를 작성합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: '파일명 (확장자 포함)' },
        content: { type: 'string', description: '마크다운 본문 (frontmatter 포함)' },
        folder: { type: 'string', description: 'vault 내 대상 폴더 (선택)' },
        guildId: { type: 'string', description: '길드 ID (선택)' },
        allowHighLinkDensity: { type: 'boolean', description: '내부 백필처럼 링크가 많은 문서를 허용할지 여부 (선택)' },
      },
      required: ['fileName', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.sync.status',
    description: 'Obsidian Lore 동기화 루프 상태를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.sync.run',
    description: 'Obsidian Lore 동기화를 repo runtime에서 한 번 실행합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.cache.stats',
    description: 'Obsidian 문서 캐시 통계(적중률, TTL, 문서 수)를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.quality.audit',
    description: '최근 그래프 품질 감사 스냅샷을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.quality.audit.run',
    description: 'Obsidian 그래프 품질 감사를 repo runtime에서 한 번 실행합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.adapter.status',
    description: '현재 어댑터 라우팅 상태(활성 어댑터, strict 모드, capability별 선택)를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.knowledge.control',
    description: 'Knowledge compiler 상태, human-first access profile, repo-to-vault catalog coverage, control-tower metadata, supervisor 상태, artifact 본문, 그리고 reflection bundle 추천을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        artifact: { type: 'string', description: 'index|log|lint|supervisor|blueprint|canonical-map|cadence|gate-entrypoints|topic:<slug>|entity:<slug> 또는 생성된 artifact 경로' },
        bundleFor: { type: 'string', description: 'control-tower alias 또는 vault 상대 경로. reflection bundle 추천을 반환합니다.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'knowledge.bundle.compile',
    description: 'Shared Obsidian, backfill catalog, and repo fallback을 합쳐 질문에 필요한 최소 knowledge bundle을 컴파일합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '질문 또는 작업 목표' },
        domains: { type: 'array', items: { type: 'string' }, description: 'planning|requirements|ops|architecture|memory|runtime|company-context' },
        sourceHints: { type: 'array', items: { type: 'string' }, description: 'obsidian|internal-docs|runtime|repo-docs|code-index|local-overlay' },
        explicitSources: { type: 'array', items: { type: 'string' }, description: '사용자가 먼저 제공한 URL, 문서 경로, note identifier를 trigger provenance로 고정합니다.' },
        includeLocalOverlay: { type: 'boolean', description: 'local overlay 포함 여부' },
        maxArtifacts: { type: 'number', description: '최대 artifact 수 (기본: 8)' },
        maxFacts: { type: 'number', description: '최대 fact 수 (기본: 12)' },
        audience: { type: 'string', description: 'engineering|ops|leadership 등 대상 독자' },
      },
      required: ['goal'],
      additionalProperties: false,
    },
  },
  {
    name: 'internal.knowledge.resolve',
    description: 'team/company internal knowledge 질문에 대해 shared MCP internal 경로 우선으로 관련 artifact, fact, access gap을 정리합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '해결하려는 내부 지식 질문 또는 목표' },
        targets: { type: 'array', items: { type: 'string' }, description: '관련 서비스, 문서, 주제 힌트' },
        sourceHints: { type: 'array', items: { type: 'string' }, description: 'internal-docs|obsidian|runtime|repo-docs 등 힌트' },
        includeRelatedArtifacts: { type: 'boolean', description: '관련 artifact를 넓게 포함할지 여부' },
        maxArtifacts: { type: 'number', description: '최대 artifact 수' },
        maxFacts: { type: 'number', description: '최대 fact 수' },
        audience: { type: 'string', description: 'engineering|ops|leadership 등 대상 독자' },
      },
      required: ['goal'],
      additionalProperties: false,
    },
  },
  {
    name: 'requirement.compile',
    description: '자연어 objective와 관련 knowledge bundle을 이용해 문제, 제약, 엔터티, 워크플로, 갭, 다음 artifact를 구조화합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: '정리할 요구사항 목표' },
        targets: { type: 'array', items: { type: 'string' }, description: '관련 서비스, 문서, 주제 힌트' },
        sourceHints: { type: 'array', items: { type: 'string' }, description: 'obsidian|internal-docs|runtime|repo-docs 등 힌트' },
        explicitSources: { type: 'array', items: { type: 'string' }, description: '구현 전에 사람이 봐야 하는 trigger source 목록' },
        maxArtifacts: { type: 'number', description: '최대 artifact 수' },
        maxFacts: { type: 'number', description: '최대 fact 수' },
        audience: { type: 'string', description: 'engineering|ops|leadership 등 대상 독자' },
        desiredArtifact: { type: 'string', description: '원하는 산출물 종류 예: playbook, requirement, decision' },
        promoteImmediately: { type: 'boolean', description: 'shared vault requirement note로 즉시 promotion할지 여부' },
        allowOverwrite: { type: 'boolean', description: 'promotion target overwrite 허용 여부' },
      },
      required: ['objective'],
      additionalProperties: false,
    },
  },
  {
    name: 'operator.snapshot',
    description: '운영자 기준 현재 runtime, loops, workers, operating baseline, obsidian control surface를 하나의 snapshot으로 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: '길드 ID (선택)' },
        days: { type: 'number', description: '집계 기간 (기본: 14)' },
        includeDocs: { type: 'boolean', description: 'obsidian/control 문서 surface 포함 여부 (기본: true)' },
        includeRuntime: { type: 'boolean', description: 'runtime loops/worker/scheduler 포함 여부 (기본: true)' },
        includePendingIntents: { type: 'boolean', description: 'pending intent count 포함 여부' },
        includeInternalKnowledge: { type: 'boolean', description: 'compact internal knowledge summary 포함 여부 (기본: true)' },
        internalKnowledgeGoal: { type: 'string', description: 'internal knowledge summary에 사용할 목표 문장' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wiki.change.capture',
    description: '변경 요약과 changed paths를 받아 shared wiki target 분류, backfill 대상 계산, 선택적 즉시 promotion을 수행합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        changeSummary: { type: 'string', description: '변경 요약' },
        changedPaths: { type: 'array', items: { type: 'string' }, description: '변경된 repo 경로 목록' },
        changeKind: {
          type: 'string',
          enum: ['repo-memory', 'architecture-delta', 'service-change', 'ops-change', 'development-slice', 'changelog-worthy'],
          description: '변경 분류',
        },
        validationRefs: { type: 'array', items: { type: 'string' }, description: '검증 참조' },
        mirrorTargets: { type: 'array', items: { type: 'string' }, description: 'repo mirror 대상' },
        promoteImmediately: { type: 'boolean', description: '가능하면 즉시 vault promotion 시도' },
        allowOverwrite: { type: 'boolean', description: '기존 target overwrite 허용' },
      },
      required: ['changeSummary', 'changeKind'],
      additionalProperties: false,
    },
  },
  {
    name: 'knowledge.promote',
    description: '검증된 사실이나 요약을 durable shared wiki object로 승격합니다. wiki first, mirror second 원칙을 따릅니다.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactKind: { type: 'string', enum: ['note', 'requirement', 'ops-note', 'contract', 'retrofit', 'lesson'], description: '승격할 객체 종류' },
        title: { type: 'string', description: '객체 제목' },
        content: { type: 'string', description: '승격할 본문 또는 요약' },
        sources: { type: 'array', items: { type: 'string' }, description: 'provenance source refs' },
        confidence: { type: 'number', description: '0~1 confidence' },
        tags: { type: 'array', items: { type: 'string' }, description: '추가 태그' },
        owner: { type: 'string', description: 'object owner' },
        canonicalKey: { type: 'string', description: 'stable canonical key' },
        nextAction: { type: 'string', description: '다음 액션' },
        supersedes: { type: 'array', items: { type: 'string' }, description: '대체하는 기존 객체 목록' },
        validAt: { type: 'string', description: 'valid_at timestamp or date' },
        allowOverwrite: { type: 'boolean', description: '기존 target overwrite 허용 여부' },
      },
      required: ['artifactKind', 'title', 'content', 'sources'],
      additionalProperties: false,
    },
  },
  {
    name: 'semantic.lint.audit',
    description: 'compiler lint, shared coverage, graph quality, runtime-vs-doc mismatch를 합친 semantic lint 결과를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        maxIssues: { type: 'number', description: '최대 이슈 수' },
        includeGraphAudit: { type: 'boolean', description: 'graph quality snapshot 포함 여부' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'workset.resolve',
    description: '지금 중요한 object, blocker, next action, evidence를 active workset으로 묶어 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: '길드 ID (선택)' },
        objective: { type: 'string', description: '현재 workset objective' },
        days: { type: 'number', description: '집계 기간 (기본: 14)' },
        includeEvidence: { type: 'boolean', description: 'evidence artifact 포함 여부' },
        maxArtifacts: { type: 'number', description: '최대 evidence artifact 수' },
        maxFacts: { type: 'number', description: 'bundle compile fact 수' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'decision.trace',
    description: '어떤 정책, 구조, 요구사항이 왜 그렇게 되었는지 evidence, contradiction, supersedes chain과 함께 추적합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: '추적할 정책, 구조, 요구사항, 결정 제목' },
        targets: { type: 'array', items: { type: 'string' }, description: '관련 서비스, 문서, canonical key 힌트' },
        sourceHints: { type: 'array', items: { type: 'string' }, description: 'obsidian|internal-docs|runtime|repo-docs 등 힌트' },
        explicitSources: { type: 'array', items: { type: 'string' }, description: '사용자가 먼저 지정한 trigger source' },
        maxArtifacts: { type: 'number', description: '최대 artifact 수' },
        maxFacts: { type: 'number', description: '최대 fact 수' },
        audience: { type: 'string', description: 'engineering|ops|leadership 등 대상 독자' },
      },
      required: ['subject'],
      additionalProperties: false,
    },
  },
  {
    name: 'incident.graph.resolve',
    description: 'incident를 서비스, playbook, improvement, contradiction, next action까지 연결한 compiled graph로 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        incident: { type: 'string', description: 'incident title, symptom, or object identifier' },
        serviceHints: { type: 'array', items: { type: 'string' }, description: '영향받는 서비스 힌트' },
        sourceHints: { type: 'array', items: { type: 'string' }, description: 'obsidian|internal-docs|runtime|repo-docs 등 힌트' },
        explicitSources: { type: 'array', items: { type: 'string' }, description: '사용자가 먼저 지정한 trigger source' },
        maxArtifacts: { type: 'number', description: '최대 artifact 수' },
        maxFacts: { type: 'number', description: '최대 fact 수' },
        includeImprovements: { type: 'boolean', description: 'improvement object를 함께 찾을지 여부' },
        audience: { type: 'string', description: 'engineering|ops|leadership 등 대상 독자' },
      },
      required: ['incident'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.outline',
    description: '파일의 제목(heading) 구조를 트리 형태로 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'vault 내 상대 파일 경로' },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.search.context',
    description: 'grep 스타일 라인 컨텍스트 포함 검색 — path:line:text 형식으로 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색 쿼리' },
        limit: { type: 'number', description: '최대 결과 수 (기본: 50)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.property.read',
    description: '파일의 frontmatter 속성 값을 읽습니다.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'vault 내 상대 파일 경로' },
        name: { type: 'string', description: '속성 이름' },
      },
      required: ['filePath', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.property.set',
    description: '파일의 frontmatter 속성을 설정합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'vault 내 상대 파일 경로' },
        name: { type: 'string', description: '속성 이름' },
        value: { type: 'string', description: '속성 값' },
      },
      required: ['filePath', 'name', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.files',
    description: 'Vault 내 파일 목록을 조회합니다. 폴더와 확장자로 필터링 가능.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: '필터링할 폴더 경로 (선택)' },
        extension: { type: 'string', description: '확장자 필터 (예: md, json) (선택)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.daily.read',
    description: '오늘의 일일 노트 내용을 읽습니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.daily.append',
    description: '오늘의 일일 노트에 내용을 추가합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '추가할 내용' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.tasks',
    description: 'Vault 전체의 마크다운 작업(체크박스)을 나열합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.task.toggle',
    description: '특정 작업의 완료/미완료 상태를 전환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '파일 경로' },
        line: { type: 'number', description: '작업이 있는 줄 번호 (1-indexed)' },
      },
      required: ['filePath', 'line'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.append',
    description: '기존 파일 끝에 내용을 추가합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'vault 내 상대 파일 경로' },
        content: { type: 'string', description: '추가할 내용' },
      },
      required: ['filePath', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.eval',
    description: 'Obsidian 앱 컨텍스트에서 JavaScript를 실행하고 결과를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '실행할 JavaScript 코드' },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
];

// ── Tool Names Set (for routing in unifiedToolAdapter) ────────────────────────

export const OBSIDIAN_TOOL_NAMES = new Set(OBSIDIAN_TOOLS.map((t) => t.name));

// ── Tool Catalog ──────────────────────────────────────────────────────────────

export const listObsidianMcpTools = (): McpToolSpec[] => OBSIDIAN_TOOLS.map((t) => ({ ...t }));

// ── Tool Dispatcher ───────────────────────────────────────────────────────────

export const callObsidianMcpTool = async (request: McpToolCallRequest): Promise<McpToolCallResult> => {
  const name = compact(request.name);
  const args = request.arguments ?? {};
  if (!name) {
    return toTextResult('tool name is required', true);
  }

  const vaultPath = getObsidianVaultRoot();

  // ── obsidian.search ─────────────────────────────────────────────────────
  if (name === 'obsidian.search') {
    const keyword = compact(args.keyword);
    if (!keyword) return toTextResult('keyword is required', true);
    const limit = typeof args.maxResults === 'number' ? args.maxResults : 10;

    const results = await searchObsidianVaultWithAdapter({
      query: keyword,
      vaultPath: vaultPath || '',
      limit,
    });

    if (results.length === 0) {
      return toTextResult('No results found.');
    }
    return toJsonResult(results);
  }

  // ── obsidian.rag ────────────────────────────────────────────────────────
  if (name === 'obsidian.rag') {
    const question = compact(args.question);
    if (!question) return toTextResult('question is required', true);
    const maxDocs = typeof args.maxDocs === 'number' ? args.maxDocs : undefined;
    const contextMode = args.contextMode === 'full' ? 'full' : 'metadata_first';
    const guildId = compact(args.guildId) || undefined;

    const result = await queryObsidianRAG(question, {
      maxDocs,
      contextMode,
      guildId,
    });

    return toJsonResult(result);
  }

  // ── obsidian.read ───────────────────────────────────────────────────────
  if (name === 'obsidian.read') {
    const filePath = compact(args.filePath);
    if (!filePath) return toTextResult('filePath is required', true);
    // Path traversal guard
    if (filePath.includes('..') || /^[a-zA-Z]:/.test(filePath) || filePath.startsWith('/')) {
      return toTextResult('invalid filePath: path traversal or absolute path not allowed', true);
    }

    const content = await readObsidianFileWithAdapter({
      filePath,
      vaultPath: vaultPath || '',
    });

    if (content === null) {
      return toTextResult(`File not found or unreadable: ${filePath}`);
    }
    return toTextResult(content);
  }

  // ── obsidian.graph ──────────────────────────────────────────────────────
  if (name === 'obsidian.graph') {
    if (!vaultPath) {
      return toTextResult('OBSIDIAN_VAULT_PATH not configured', true);
    }
    const metadata = await getObsidianGraphMetadataWithAdapter({ vaultPath });
    const nodeCount = Object.keys(metadata).length;
    if (nodeCount === 0) {
      return toTextResult('Graph metadata is empty (no indexed files).');
    }
    return toJsonResult({ nodeCount, nodes: metadata });
  }

  // ── obsidian.write ──────────────────────────────────────────────────────
  if (name === 'obsidian.write') {
    const fileName = compact(args.fileName);
    const content = compact(args.content);
    if (!fileName) return toTextResult('fileName is required', true);
    if (!content) return toTextResult('content is required', true);
    // File name safety
    if (/[<>:"|?*]/.test(fileName) || fileName.includes('..')) {
      return toTextResult('invalid fileName: unsafe characters or path traversal', true);
    }
    const folder = compact(args.folder) || undefined;
    const guildId = compact(args.guildId) || 'MCP';
    const allowHighLinkDensity = args.allowHighLinkDensity === true;

    const result = await writeObsidianNoteWithAdapter({
      fileName,
      content,
      guildId,
      vaultPath: vaultPath || '',
      ...(folder ? { tags: [folder] } : {}),
      ...(allowHighLinkDensity ? { allowHighLinkDensity: true } : {}),
    });

    if (!result) {
      return toTextResult('Write failed (sanitization blocked or no adapter available)', true);
    }
    return toJsonResult({ ok: true, path: result.path });
  }

  // ── obsidian.sync.status ────────────────────────────────────────────────
  if (name === 'obsidian.sync.status') {
    return toJsonResult(getObsidianLoreSyncLoopStats());
  }

  // ── obsidian.sync.run ─────────────────────────────────────────────────
  if (name === 'obsidian.sync.run') {
    const result = await executeObsidianLoreSync({ forceLocal: true });
    return toTextResult(JSON.stringify(result, null, 2), result.lastStatus !== 'success');
  }

  // ── obsidian.cache.stats ────────────────────────────────────────────────
  if (name === 'obsidian.cache.stats') {
    const stats = await getCacheStats();
    if (!stats) {
      return toTextResult('Cache stats unavailable (Supabase not configured or cache disabled)');
    }
    return toJsonResult(stats);
  }

  // ── obsidian.quality.audit ──────────────────────────────────────────────
  if (name === 'obsidian.quality.audit') {
    const snapshot = await getLatestObsidianGraphAuditSnapshot();
    if (!snapshot) {
      return toTextResult('No audit snapshot available. Run `npm run obsidian:audit` first.');
    }
    return toJsonResult(snapshot);
  }

  // ── obsidian.quality.audit.run ────────────────────────────────────────
  if (name === 'obsidian.quality.audit.run') {
    const result = await executeObsidianGraphAudit({ forceLocal: true });
    return toTextResult(JSON.stringify(result, null, 2), result.result.lastStatus !== 'success');
  }

  // ── obsidian.adapter.status ─────────────────────────────────────────────
  if (name === 'obsidian.adapter.status') {
    const [vaultHealth, retrievalBoundary] = await Promise.all([
      getObsidianVaultLiveHealthStatus(),
      getObsidianRetrievalBoundarySnapshot(),
    ]);
    return toJsonResult({
      ...getObsidianAdapterRuntimeStatus(),
      vaultRuntime: getObsidianVaultRuntimeInfo(),
      vaultHealth,
      cacheStats: retrievalBoundary.supabaseBacked.cacheStats,
      retrievalBoundary,
    });
  }

  // ── obsidian.knowledge.control ────────────────────────────────────────
  if (name === 'obsidian.knowledge.control') {
    const artifactRequest = compact(args.artifact);
    const bundleRequest = compact(args.bundleFor);
    const surface = getObsidianKnowledgeControlSurface();
    const bundle = bundleRequest ? buildObsidianKnowledgeReflectionBundle(bundleRequest) : null;

    if (bundleRequest && !bundle) {
      return toTextResult('bundleFor must be a control-tower alias or vault-relative path', true);
    }

    if (!artifactRequest) {
      return toJsonResult({
        ...surface,
        bundle,
      });
    }

    const artifactPath = resolveObsidianKnowledgeArtifactPath(artifactRequest);
    if (!artifactPath) {
      return toTextResult('artifact must be index|log|lint|supervisor|blueprint|canonical-map|cadence|gate-entrypoints|topic:<slug>|entity:<slug>', true);
    }

    const content = await readObsidianFileWithAdapter({
      vaultPath: vaultPath || '',
      filePath: artifactPath,
    });

    return toJsonResult({
      ...surface,
      bundle,
      artifact: {
        request: artifactRequest,
        path: artifactPath,
        content,
      },
    });
  }

  // ── knowledge.bundle.compile ───────────────────────────────────────────
  if (name === 'knowledge.bundle.compile') {
    const goal = compact(args.goal);
    if (!goal) return toTextResult('goal is required', true);

    const result = await compileObsidianKnowledgeBundle({
      goal,
      domains: Array.isArray(args.domains) ? args.domains.map((value) => compact(value)).filter(Boolean) : [],
      sourceHints: Array.isArray(args.sourceHints) ? args.sourceHints.map((value) => compact(value)).filter(Boolean) : [],
      explicitSources: Array.isArray(args.explicitSources) ? args.explicitSources.map((value) => compact(value)).filter(Boolean) : [],
      includeLocalOverlay: args.includeLocalOverlay === true,
      maxArtifacts: typeof args.maxArtifacts === 'number' ? args.maxArtifacts : undefined,
      maxFacts: typeof args.maxFacts === 'number' ? args.maxFacts : undefined,
      audience: compact(args.audience) || undefined,
    });
    return toJsonResult(result);
  }

  // ── internal.knowledge.resolve ───────────────────────────────────────
  if (name === 'internal.knowledge.resolve') {
    const goal = compact(args.goal);
    if (!goal) return toTextResult('goal is required', true);

    const result = await resolveInternalKnowledge({
      goal,
      targets: Array.isArray(args.targets) ? args.targets.map((value) => compact(value)).filter(Boolean) : [],
      sourceHints: Array.isArray(args.sourceHints) ? args.sourceHints.map((value) => compact(value)).filter(Boolean) : [],
      includeRelatedArtifacts: args.includeRelatedArtifacts === true,
      maxArtifacts: typeof args.maxArtifacts === 'number' ? args.maxArtifacts : undefined,
      maxFacts: typeof args.maxFacts === 'number' ? args.maxFacts : undefined,
      audience: compact(args.audience) || undefined,
    });
    return toJsonResult(result);
  }

  // ── requirement.compile ──────────────────────────────────────────────
  if (name === 'requirement.compile') {
    const objective = compact(args.objective);
    if (!objective) return toTextResult('objective is required', true);

    const result = await compileObsidianRequirement({
      objective,
      targets: Array.isArray(args.targets) ? args.targets.map((value) => compact(value)).filter(Boolean) : [],
      sourceHints: Array.isArray(args.sourceHints) ? args.sourceHints.map((value) => compact(value)).filter(Boolean) : [],
      explicitSources: Array.isArray(args.explicitSources) ? args.explicitSources.map((value) => compact(value)).filter(Boolean) : [],
      maxArtifacts: typeof args.maxArtifacts === 'number' ? args.maxArtifacts : undefined,
      maxFacts: typeof args.maxFacts === 'number' ? args.maxFacts : undefined,
      audience: compact(args.audience) || undefined,
      desiredArtifact: compact(args.desiredArtifact) || undefined,
      promoteImmediately: args.promoteImmediately === true,
      allowOverwrite: args.allowOverwrite === true,
    });
    return toJsonResult(result);
  }

  // ── operator.snapshot ─────────────────────────────────────────────────
  if (name === 'operator.snapshot') {
    const result = await buildOperatorSnapshot({
      guildId: compact(args.guildId) || undefined,
      days: typeof args.days === 'number' ? args.days : undefined,
      includeDocs: args.includeDocs === undefined ? true : args.includeDocs === true,
      includeRuntime: args.includeRuntime === undefined ? true : args.includeRuntime === true,
      includePendingIntents: args.includePendingIntents === true,
      includeInternalKnowledge: args.includeInternalKnowledge === undefined ? true : args.includeInternalKnowledge === true,
      internalKnowledgeGoal: compact(args.internalKnowledgeGoal) || undefined,
    });
    return toJsonResult(result);
  }

  // ── workset.resolve ───────────────────────────────────────────────────
  if (name === 'workset.resolve') {
    const result = await buildActiveWorkset({
      guildId: compact(args.guildId) || undefined,
      objective: compact(args.objective) || undefined,
      days: typeof args.days === 'number' ? args.days : undefined,
      includeEvidence: args.includeEvidence === undefined ? true : args.includeEvidence === true,
      maxArtifacts: typeof args.maxArtifacts === 'number' ? args.maxArtifacts : undefined,
      maxFacts: typeof args.maxFacts === 'number' ? args.maxFacts : undefined,
    });
    return toJsonResult(result);
  }

  // ── decision.trace ───────────────────────────────────────────────────
  if (name === 'decision.trace') {
    const subject = compact(args.subject);
    if (!subject) return toTextResult('subject is required', true);

    const result = await traceObsidianDecision({
      subject,
      targets: Array.isArray(args.targets) ? args.targets.map((value) => compact(value)).filter(Boolean) : [],
      sourceHints: Array.isArray(args.sourceHints) ? args.sourceHints.map((value) => compact(value)).filter(Boolean) : [],
      explicitSources: Array.isArray(args.explicitSources) ? args.explicitSources.map((value) => compact(value)).filter(Boolean) : [],
      maxArtifacts: typeof args.maxArtifacts === 'number' ? args.maxArtifacts : undefined,
      maxFacts: typeof args.maxFacts === 'number' ? args.maxFacts : undefined,
      audience: compact(args.audience) || undefined,
    });
    return toJsonResult(result);
  }

  // ── incident.graph.resolve ───────────────────────────────────────────
  if (name === 'incident.graph.resolve') {
    const incident = compact(args.incident);
    if (!incident) return toTextResult('incident is required', true);

    const result = await resolveObsidianIncidentGraph({
      incident,
      serviceHints: Array.isArray(args.serviceHints) ? args.serviceHints.map((value) => compact(value)).filter(Boolean) : [],
      sourceHints: Array.isArray(args.sourceHints) ? args.sourceHints.map((value) => compact(value)).filter(Boolean) : [],
      explicitSources: Array.isArray(args.explicitSources) ? args.explicitSources.map((value) => compact(value)).filter(Boolean) : [],
      maxArtifacts: typeof args.maxArtifacts === 'number' ? args.maxArtifacts : undefined,
      maxFacts: typeof args.maxFacts === 'number' ? args.maxFacts : undefined,
      includeImprovements: args.includeImprovements === undefined ? true : args.includeImprovements === true,
      audience: compact(args.audience) || undefined,
    });
    return toJsonResult(result);
  }

  // ── wiki.change.capture ───────────────────────────────────────────────
  if (name === 'wiki.change.capture') {
    const changeSummary = compact(args.changeSummary);
    const changeKind = compact(args.changeKind).toLowerCase();
    if (!changeSummary) return toTextResult('changeSummary is required', true);
    if (!changeKind) return toTextResult('changeKind is required', true);
    if (!isOneOf(changeKind, VALID_OBSIDIAN_WIKI_CHANGE_KINDS)) {
      return toTextResult(`changeKind must be one of: ${VALID_OBSIDIAN_WIKI_CHANGE_KINDS.join(', ')}`, true);
    }

    const result = await captureObsidianWikiChange({
      changeSummary,
      changeKind: changeKind as ValidObsidianWikiChangeKind,
      changedPaths: Array.isArray(args.changedPaths) ? args.changedPaths.map((value) => compact(value)).filter(Boolean) : [],
      validationRefs: Array.isArray(args.validationRefs) ? args.validationRefs.map((value) => compact(value)).filter(Boolean) : [],
      mirrorTargets: Array.isArray(args.mirrorTargets) ? args.mirrorTargets.map((value) => compact(value)).filter(Boolean) : [],
      promoteImmediately: args.promoteImmediately === true,
      allowOverwrite: args.allowOverwrite === true,
    });
    return toJsonResult(result);
  }

  // ── knowledge.promote ─────────────────────────────────────────────────
  if (name === 'knowledge.promote') {
    const artifactKind = compact(args.artifactKind);
    const title = compact(args.title);
    const content = compact(args.content);
    if (!artifactKind) return toTextResult('artifactKind is required', true);
    if (!isOneOf(artifactKind, VALID_OBSIDIAN_PROMOTION_ARTIFACT_KINDS)) {
      return toTextResult(`artifactKind must be one of: ${VALID_OBSIDIAN_PROMOTION_ARTIFACT_KINDS.join(', ')}`, true);
    }
    if (!title) return toTextResult('title is required', true);
    if (!content) return toTextResult('content is required', true);

    const result = await promoteKnowledgeToObsidian({
      artifactKind: artifactKind as ValidObsidianPromotionArtifactKind,
      title,
      content,
      sources: Array.isArray(args.sources) ? args.sources.map((value) => compact(value)).filter(Boolean) : [],
      confidence: typeof args.confidence === 'number' ? args.confidence : undefined,
      tags: Array.isArray(args.tags) ? args.tags.map((value) => compact(value)).filter(Boolean) : [],
      owner: compact(args.owner) || undefined,
      canonicalKey: compact(args.canonicalKey) || undefined,
      nextAction: compact(args.nextAction) || undefined,
      supersedes: Array.isArray(args.supersedes) ? args.supersedes.map((value) => compact(value)).filter(Boolean) : [],
      validAt: compact(args.validAt) || undefined,
      allowOverwrite: args.allowOverwrite === true,
    });
    return toJsonResult(result);
  }

  // ── semantic.lint.audit ───────────────────────────────────────────────
  if (name === 'semantic.lint.audit') {
    const result = await runObsidianSemanticLintAudit({
      maxIssues: typeof args.maxIssues === 'number' ? args.maxIssues : undefined,
      includeGraphAudit: args.includeGraphAudit === undefined ? true : args.includeGraphAudit === true,
    });
    return toJsonResult(result);
  }

  // ── obsidian.outline ────────────────────────────────────────────────────
  if (name === 'obsidian.outline') {
    const filePath = compact(args.filePath);
    if (!filePath) return toTextResult('filePath is required', true);
    if (filePath.includes('..') || /^[a-zA-Z]:/.test(filePath) || filePath.startsWith('/')) {
      return toTextResult('invalid filePath: path traversal or absolute path not allowed', true);
    }
    const headings = await getObsidianOutlineWithAdapter(vaultPath || '', filePath);
    if (headings.length === 0) return toTextResult('No headings found.');
    return toJsonResult(headings);
  }

  // ── obsidian.search.context ─────────────────────────────────────────────
  if (name === 'obsidian.search.context') {
    const query = compact(args.query);
    if (!query) return toTextResult('query is required', true);
    const limit = typeof args.limit === 'number' ? args.limit : 50;
    const results = await searchObsidianContextWithAdapter(vaultPath || '', query, limit);
    if (results.length === 0) return toTextResult('No matches found.');
    return toJsonResult(results);
  }

  // ── obsidian.property.read ──────────────────────────────────────────────
  if (name === 'obsidian.property.read') {
    const filePath = compact(args.filePath);
    const propName = compact(args.name);
    if (!filePath || !propName) return toTextResult('filePath and name are required', true);
    if (filePath.includes('..')) return toTextResult('invalid filePath', true);
    const value = await readObsidianPropertyWithAdapter(vaultPath || '', filePath, propName);
    if (value === null) return toTextResult(`Property "${propName}" not found in ${filePath}`);
    return toTextResult(value);
  }

  // ── obsidian.property.set ───────────────────────────────────────────────
  if (name === 'obsidian.property.set') {
    const filePath = compact(args.filePath);
    const propName = compact(args.name);
    const propValue = compact(args.value);
    if (!filePath || !propName) return toTextResult('filePath and name are required', true);
    if (filePath.includes('..')) return toTextResult('invalid filePath', true);
    const ok = await setObsidianPropertyWithAdapter(vaultPath || '', filePath, propName, propValue);
    return ok ? toJsonResult({ ok: true }) : toTextResult('Failed to set property', true);
  }

  // ── obsidian.files ──────────────────────────────────────────────────────
  if (name === 'obsidian.files') {
    const folder = compact(args.folder) || undefined;
    const extension = compact(args.extension) || undefined;
    if (folder?.includes('..')) return toTextResult('invalid folder path', true);
    const files = await listObsidianFilesWithAdapter(vaultPath || '', folder, extension);
    return toJsonResult({ count: files.length, files });
  }

  // ── obsidian.daily.read ─────────────────────────────────────────────────
  if (name === 'obsidian.daily.read') {
    const content = await readDailyNoteWithAdapter();
    if (content === null) return toTextResult('No daily note for today.');
    return toTextResult(content);
  }

  // ── obsidian.daily.append ───────────────────────────────────────────────
  if (name === 'obsidian.daily.append') {
    const content = compact(args.content);
    if (!content) return toTextResult('content is required', true);
    const ok = await appendDailyNoteWithAdapter(content);
    return ok ? toJsonResult({ ok: true }) : toTextResult('Failed to append to daily note', true);
  }

  // ── obsidian.tasks ──────────────────────────────────────────────────────
  if (name === 'obsidian.tasks') {
    const tasks = await listObsidianTasksWithAdapter();
    return toJsonResult({ count: tasks.length, tasks });
  }

  // ── obsidian.task.toggle ────────────────────────────────────────────────
  if (name === 'obsidian.task.toggle') {
    const filePath = compact(args.filePath);
    const line = typeof args.line === 'number' ? args.line : 0;
    if (!filePath || line <= 0) return toTextResult('filePath and line (>0) are required', true);
    if (filePath.includes('..')) return toTextResult('invalid filePath', true);
    const ok = await toggleObsidianTaskWithAdapter(filePath, line);
    return ok ? toJsonResult({ ok: true }) : toTextResult('Failed to toggle task', true);
  }

  // ── obsidian.append ─────────────────────────────────────────────────────
  if (name === 'obsidian.append') {
    const filePath = compact(args.filePath);
    const content = compact(args.content);
    if (!filePath || !content) return toTextResult('filePath and content are required', true);
    if (filePath.includes('..') || /^[a-zA-Z]:/.test(filePath) || filePath.startsWith('/')) {
      return toTextResult('invalid filePath', true);
    }
    const ok = await appendObsidianContentWithAdapter(vaultPath || '', filePath, content);
    return ok ? toJsonResult({ ok: true }) : toTextResult('Failed to append content', true);
  }

  // ── obsidian.eval ───────────────────────────────────────────────────────
  if (name === 'obsidian.eval') {
    const code = compact(args.code);
    if (!code) return toTextResult('code is required', true);
    const result = await obsidianEvalCode(code);
    if (result === null) return toTextResult('eval failed (CLI unavailable or execution error)', true);
    return toTextResult(result);
  }

  return toTextResult(`Unknown obsidian tool: ${name}`, true);
};
