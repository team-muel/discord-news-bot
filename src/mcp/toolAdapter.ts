import { listActions, getAction } from '../services/skills/actions/registry';
import { runGoalPipeline } from '../services/skills/actionRunner';
import { NODE_ENV } from '../config';
import { generateText, isAnyLlmConfigured, resolveLlmProvider } from '../services/llmClient';
import { getOpenJarvisMemorySyncStatus, runOpenJarvisMemorySync } from '../services/openjarvis/openjarvisMemorySyncStatusService';
import { listProxiedTools, listUpstreamDiagnostics } from './proxyAdapter';
import type { McpToolCallRequest, McpToolCallResult, McpToolSpec } from './types';
import { getErrorMessage } from '../utils/errorMessage';

const MCP_GUILD_ID = 'MCP';
const MCP_REQUESTER = 'mcp-adapter';
const MCP_RUNTIME_LANE = 'system-internal';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const toObject = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const toTextResult = (text: string, isError = false): McpToolCallResult => ({
  content: [{ type: 'text', text }],
  isError,
});

const loadApiFirstAgentFallbackService = async () => import('../services/automation/apiFirstAgentFallbackService');

const loadAgentPersonalizationService = async () => import('../services/agent/agentPersonalizationService');

const loadOpenJarvisAutopilotStatusService = async () => import('../services/openjarvis/openjarvisAutopilotStatusService');

const loadOpenJarvisHermesRuntimeControlService = async () => import('../services/openjarvis/openjarvisHermesRuntimeControlService');

const parseAutomationPlanningArgs = (args: Record<string, unknown>) => ({
  objective: compact(args.objective),
  trigger: ['webhook', 'schedule', 'manual', 'event'].includes(compact(args.trigger))
    ? compact(args.trigger) as 'webhook' | 'schedule' | 'manual' | 'event'
    : undefined,
  structuredDataAvailable: args.structuredDataAvailable === true,
  clearApiAnswer: args.clearApiAnswer === true,
  requiresReasoning: args.requiresReasoning === true,
  requiresLongRunningWait: args.requiresLongRunningWait === true,
  requiresDurableKnowledge: args.requiresDurableKnowledge !== false,
  policySensitive: args.policySensitive === true,
  executionPreference: ['local', 'remote', 'hybrid'].includes(compact(args.executionPreference))
    ? compact(args.executionPreference) as 'local' | 'remote' | 'hybrid'
    : undefined,
  candidateApis: Array.isArray(args.candidateApis) ? args.candidateApis.map((entry) => compact(entry)).filter(Boolean) : undefined,
  candidateMcpTools: Array.isArray(args.candidateMcpTools) ? args.candidateMcpTools.map((entry) => compact(entry)).filter(Boolean) : undefined,
  runtimeLane: ['operator-personal', 'public-guild', 'system-internal'].includes(compact(args.runtimeLane))
    ? compact(args.runtimeLane) as 'operator-personal' | 'public-guild' | 'system-internal'
    : undefined,
  sharedBenefitPhase: ['constraint-only', 'phase-1', 'required-now'].includes(compact(args.sharedBenefitPhase))
    ? compact(args.sharedBenefitPhase) as 'constraint-only' | 'phase-1' | 'required-now'
    : undefined,
  dynamicWorkflowRequested: args.dynamicWorkflowRequested === true,
  existingWorkflowName: compact(args.existingWorkflowName) || undefined,
  existingWorkflowTasks: Array.isArray(args.existingWorkflowTasks)
    ? args.existingWorkflowTasks.map((entry) => compact(entry)).filter(Boolean)
    : undefined,
  includeWorkflowPayload: args.includeWorkflowPayload === true,
  includeSeedPayload: args.includeSeedPayload === true,
});

const MCP_TOOLS: McpToolSpec[] = [
  {
    name: 'stock.quote',
    description: '티커 심볼의 시세를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '예: AAPL, TSLA' },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'stock.chart',
    description: '티커 심볼의 차트 URL을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '예: AAPL, TSLA' },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'investment.analysis',
    description: '질의 텍스트 기반 투자 분석을 생성합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '분석 요청 텍스트' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'action.catalog',
    description: '현재 등록된 액션 이름 목록을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'action.execute.direct',
    description: '등록된 액션을 직접 실행합니다(개발/운영 점검용).',
    inputSchema: {
      type: 'object',
      properties: {
        actionName: { type: 'string', description: '예: web.fetch' },
        goal: { type: 'string', description: '액션 실행 목표 텍스트' },
        args: { type: 'object', description: '액션 인자' },
      },
      required: ['actionName', 'goal'],
      additionalProperties: false,
    },
  },
  {
    name: 'diag.llm',
    description: 'Diagnostic: test generateText() directly to verify LLM connectivity.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Test prompt (default: "say hi")' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'diag.upstreams',
    description: 'Configured upstream namespaces, federation metadata, filters, and cached catalog status를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: 'True면 upstream tool catalog를 먼저 새로 읽습니다. 기본값은 true입니다.' },
        includeDisabled: { type: 'boolean', description: '비활성 upstream도 포함합니다.' },
        includeUrls: { type: 'boolean', description: 'True면 upstream base URL도 반환합니다.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'automation.capability.catalog',
    description: '현재 저장소의 API-first, MCP wrapping, Hermes fallback 자산 배치를 요약합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        refreshUpstreams: { type: 'boolean', description: 'True면 upstream 진단 전에 프록시 도구 카탈로그를 새로 읽습니다.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'automation.route.preview',
    description: '주어진 자동화 목표를 API-first & Agent-Fallback 관점에서 어떻게 배치할지 미리 계산합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: '자동화 목표 또는 작업 설명' },
        trigger: { type: 'string', enum: ['webhook', 'schedule', 'manual', 'event'] },
        structuredDataAvailable: { type: 'boolean' },
        clearApiAnswer: { type: 'boolean' },
        requiresReasoning: { type: 'boolean' },
        requiresLongRunningWait: { type: 'boolean' },
        requiresDurableKnowledge: { type: 'boolean' },
        policySensitive: { type: 'boolean' },
        executionPreference: { type: 'string', enum: ['local', 'remote', 'hybrid'] },
        candidateApis: { type: 'array', items: { type: 'string' } },
        candidateMcpTools: { type: 'array', items: { type: 'string' } },
      },
      required: ['objective'],
      additionalProperties: false,
    },
  },
  {
    name: 'automation.optimizer.plan',
    description: 'Autopilot용 tool-layer optimizer plan을 계산합니다. route, cost, observability, shared scale-out, workflow draft를 함께 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: '자동화 목표 또는 작업 설명' },
        trigger: { type: 'string', enum: ['webhook', 'schedule', 'manual', 'event'] },
        structuredDataAvailable: { type: 'boolean' },
        clearApiAnswer: { type: 'boolean' },
        requiresReasoning: { type: 'boolean' },
        requiresLongRunningWait: { type: 'boolean' },
        requiresDurableKnowledge: { type: 'boolean' },
        policySensitive: { type: 'boolean' },
        executionPreference: { type: 'string', enum: ['local', 'remote', 'hybrid'] },
        candidateApis: { type: 'array', items: { type: 'string' } },
        candidateMcpTools: { type: 'array', items: { type: 'string' } },
        runtimeLane: { type: 'string', enum: ['operator-personal', 'public-guild', 'system-internal'] },
        sharedBenefitPhase: { type: 'string', enum: ['constraint-only', 'phase-1', 'required-now'] },
        dynamicWorkflowRequested: { type: 'boolean' },
        existingWorkflowName: { type: 'string' },
        existingWorkflowTasks: { type: 'array', items: { type: 'string' } },
        includeWorkflowPayload: { type: 'boolean' },
        includeSeedPayload: { type: 'boolean' },
      },
      required: ['objective'],
      additionalProperties: false,
    },
  },
  {
    name: 'automation.workflow.draft',
    description: '기존 n8n starter workflow를 재사용해 새 workflow draft 또는 update plan을 계산합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: '자동화 목표 또는 작업 설명' },
        trigger: { type: 'string', enum: ['webhook', 'schedule', 'manual', 'event'] },
        structuredDataAvailable: { type: 'boolean' },
        clearApiAnswer: { type: 'boolean' },
        requiresReasoning: { type: 'boolean' },
        requiresLongRunningWait: { type: 'boolean' },
        requiresDurableKnowledge: { type: 'boolean' },
        policySensitive: { type: 'boolean' },
        executionPreference: { type: 'string', enum: ['local', 'remote', 'hybrid'] },
        candidateApis: { type: 'array', items: { type: 'string' } },
        candidateMcpTools: { type: 'array', items: { type: 'string' } },
        runtimeLane: { type: 'string', enum: ['operator-personal', 'public-guild', 'system-internal'] },
        sharedBenefitPhase: { type: 'string', enum: ['constraint-only', 'phase-1', 'required-now'] },
        existingWorkflowName: { type: 'string' },
        existingWorkflowTasks: { type: 'array', items: { type: 'string' } },
        includeWorkflowPayload: { type: 'boolean' },
        includeSeedPayload: { type: 'boolean' },
      },
      required: ['objective'],
      additionalProperties: false,
    },
  },
  {
    name: 'automation.hermes_runtime',
    description: 'Hermes runtime readiness를 standalone 진단 블록으로 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionPath: { type: 'string' },
        vaultPath: { type: 'string' },
        capacityTarget: { type: 'number' },
        gcpCapacityRecovery: { type: 'boolean' },
        runtimeLane: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'automation.hermes_runtime.remediate',
    description: 'Hermes runtime blocker에 연결된 remediation action을 실행합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'string', enum: ['start-supervisor-loop', 'open-progress-packet', 'open-execution-board'] },
        sessionPath: { type: 'string' },
        vaultPath: { type: 'string' },
        capacityTarget: { type: 'number' },
        gcpCapacityRecovery: { type: 'boolean' },
        runtimeLane: { type: 'string' },
        dryRun: { type: 'boolean' },
        visibleTerminal: { type: 'boolean' },
      },
      required: ['actionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'automation.hermes_runtime.chat_note',
    description: 'Hermes runtime snapshot을 Obsidian chat/inbox note로 생성해 로컬 상호작용 표면에 반사합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        guildId: { type: 'string' },
        sessionPath: { type: 'string' },
        vaultPath: { type: 'string' },
        capacityTarget: { type: 'number' },
        gcpCapacityRecovery: { type: 'boolean' },
        runtimeLane: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'automation.hermes_runtime.queue_objective',
    description: 'Hermes continuity handoff packet의 Safe Autonomous Queue에 다음 bounded objective를 추가합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string' },
        objectives: { type: 'array', items: { type: 'string' } },
        sessionPath: { type: 'string' },
        vaultPath: { type: 'string' },
        capacityTarget: { type: 'number' },
        gcpCapacityRecovery: { type: 'boolean' },
        runtimeLane: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'automation.hermes_runtime.chat_launch',
    description: '다음 queued objective 또는 현재 objective를 VS Code `code chat` 세션으로 기동합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string' },
        prompt: { type: 'string' },
        chatMode: { type: 'string' },
        addFilePaths: { type: 'array', items: { type: 'string' } },
        maximize: { type: 'boolean' },
        newWindow: { type: 'boolean' },
        reuseWindow: { type: 'boolean' },
        dryRun: { type: 'boolean' },
        sessionPath: { type: 'string' },
        vaultPath: { type: 'string' },
        capacityTarget: { type: 'number' },
        gcpCapacityRecovery: { type: 'boolean' },
        runtimeLane: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'automation.session_start_prep',
    description: '세션 시작 시 OpenJarvis hot-state, Hermes supervisor, 공유 Obsidian projection을 한 번에 준비합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string' },
        objectives: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
        guildId: { type: 'string' },
        createChatNote: { type: 'boolean' },
        startSupervisor: { type: 'boolean' },
        dryRun: { type: 'boolean' },
        visibleTerminal: { type: 'boolean' },
        sessionPath: { type: 'string' },
        vaultPath: { type: 'string' },
        capacityTarget: { type: 'number' },
        gcpCapacityRecovery: { type: 'boolean' },
        runtimeLane: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'automation.session_open_bundle',
    description: '현재 OpenJarvis hot-state를 compact session-open bundle로 반환합니다. GPT나 Hermes가 긴 계획 문서 대신 먼저 읽을 최소 부팅 요약입니다.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionPath: { type: 'string' },
        vaultPath: { type: 'string' },
        capacityTarget: { type: 'number' },
        gcpCapacityRecovery: { type: 'boolean' },
        runtimeLane: { type: 'string' },
        guildId: { type: 'string' },
        userId: { type: 'string' },
        priority: { type: 'string', enum: ['fast', 'balanced', 'precise'] },
        skillId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'automation.openjarvis.memory_sync.status',
    description: 'OpenJarvis memory projection freshness, document counts, indexing status를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'automation.openjarvis.memory_sync.run',
    description: 'OpenJarvis memory projection sync를 큐잉합니다. 기본은 dry-run이며 force와 guildId를 지원합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean' },
        force: { type: 'boolean' },
        guildId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
];

export const listMcpTools = (): McpToolSpec[] => MCP_TOOLS.map((tool) => ({ ...tool }));

export const callMcpTool = async (request: McpToolCallRequest): Promise<McpToolCallResult> => {
  const args = toObject(request.arguments);

  if (request.name === 'stock.quote') {
    const symbol = compact(args.symbol).toUpperCase();
    if (!symbol) {
      return toTextResult('symbol is required', true);
    }

    const result = await runGoalPipeline({
      goal: `stock.quote ${symbol}`,
      guildId: MCP_GUILD_ID,
      requestedBy: MCP_REQUESTER,
      runtimeLane: MCP_RUNTIME_LANE,
    });

    if (!result.hasSuccess) {
      return toTextResult(`quote not available for ${symbol}`, true);
    }

    return toTextResult(result.output);
  }

  if (request.name === 'stock.chart') {
    const symbol = compact(args.symbol).toUpperCase();
    if (!symbol) {
      return toTextResult('symbol is required', true);
    }

    const result = await runGoalPipeline({
      goal: `stock.chart ${symbol}`,
      guildId: MCP_GUILD_ID,
      requestedBy: MCP_REQUESTER,
      runtimeLane: MCP_RUNTIME_LANE,
    });

    if (!result.hasSuccess) {
      return toTextResult(`chart not available for ${symbol}`, true);
    }

    return toTextResult(result.output);
  }

  if (request.name === 'investment.analysis') {
    const query = compact(args.query);
    if (!query) {
      return toTextResult('query is required', true);
    }

    const result = await runGoalPipeline({
      goal: `investment.analysis ${query}`,
      guildId: MCP_GUILD_ID,
      requestedBy: MCP_REQUESTER,
      runtimeLane: MCP_RUNTIME_LANE,
    });

    return toTextResult(result.output || 'empty analysis', !result.hasSuccess);
  }

  if (request.name === 'action.catalog') {
    const names = listActions().map((action) => action.name);
    return toTextResult(JSON.stringify(names, null, 2));
  }

  if (request.name === 'action.execute.direct') {
    if (NODE_ENV === 'production') {
      return toTextResult('action.execute.direct is disabled in production', true);
    }
    const actionName = compact(args.actionName);
    const goal = compact(args.goal);
    if (!actionName || !goal) {
      return toTextResult('actionName and goal are required', true);
    }

    const action = getAction(actionName);
    if (!action) {
      return toTextResult(`unknown action: ${actionName}`, true);
    }

    const result = await runGoalPipeline({
      goal: `${actionName} ${goal}`,
      guildId: MCP_GUILD_ID,
      requestedBy: MCP_REQUESTER,
      runtimeLane: MCP_RUNTIME_LANE,
    });

    return toTextResult(JSON.stringify({ handled: result.handled, output: result.output, hasSuccess: result.hasSuccess }, null, 2), !result.hasSuccess);
  }

  if (request.name === 'diag.llm') {
    const prompt = compact(args.prompt) || 'say hi';
    const configured = isAnyLlmConfigured();
    const provider = resolveLlmProvider();
    if (!configured) {
      return toTextResult(JSON.stringify({ configured: false, provider, error: 'no LLM configured' }), true);
    }
    try {
      const start = Date.now();
      const text = await generateText({ system: 'Reply briefly.', user: prompt, actionName: 'diag.llm', maxTokens: 50 });
      return toTextResult(JSON.stringify({ configured: true, provider, latencyMs: Date.now() - start, text: text.slice(0, 200) }));
    } catch (err) {
      return toTextResult(JSON.stringify({ configured: true, provider, error: getErrorMessage(err) }), true);
    }
  }

  if (request.name === 'diag.upstreams') {
    const refresh = args.refresh !== false;
    const includeDisabled = args.includeDisabled === true;
    const includeUrls = args.includeUrls === true;

    if (refresh) {
      await listProxiedTools();
    }

    return toTextResult(JSON.stringify(listUpstreamDiagnostics({ includeDisabled, includeUrl: includeUrls }), null, 2));
  }

  if (request.name === 'automation.capability.catalog') {
    const { buildAutomationCapabilityCatalog } = await loadApiFirstAgentFallbackService();
    const catalog = await buildAutomationCapabilityCatalog({
      refreshUpstreams: args.refreshUpstreams === true,
    });
    return toTextResult(JSON.stringify(catalog, null, 2));
  }

  if (request.name === 'automation.route.preview') {
    const { previewApiFirstAgentFallbackRoute } = await loadApiFirstAgentFallbackService();
    const automationArgs = parseAutomationPlanningArgs(args);
    const objective = automationArgs.objective;
    if (!objective) {
      return toTextResult('objective is required', true);
    }

    const preview = await previewApiFirstAgentFallbackRoute(automationArgs);

    return toTextResult(JSON.stringify(preview, null, 2));
  }

  if (request.name === 'automation.optimizer.plan') {
    const { buildAutomationOptimizerPlan } = await loadApiFirstAgentFallbackService();
    const automationArgs = parseAutomationPlanningArgs(args);
    if (!automationArgs.objective) {
      return toTextResult('objective is required', true);
    }

    const plan = await buildAutomationOptimizerPlan(automationArgs);
    return toTextResult(JSON.stringify(plan, null, 2));
  }

  if (request.name === 'automation.workflow.draft') {
    const { buildAutomationWorkflowDraft } = await loadApiFirstAgentFallbackService();
    const automationArgs = parseAutomationPlanningArgs(args);
    if (!automationArgs.objective) {
      return toTextResult('objective is required', true);
    }

    const draft = await buildAutomationWorkflowDraft(automationArgs);
    return toTextResult(JSON.stringify(draft, null, 2));
  }

  if (request.name === 'automation.hermes_runtime') {
    const { getOpenJarvisAutopilotStatus } = await loadOpenJarvisAutopilotStatusService();
    const status = await getOpenJarvisAutopilotStatus({
      sessionPath: compact(args.sessionPath) || null,
      vaultPath: compact(args.vaultPath) || null,
      capacityTarget: Number.isFinite(Number(args.capacityTarget)) ? Number(args.capacityTarget) : null,
      gcpCapacityRecoveryRequested: args.gcpCapacityRecovery === true,
      runtimeLane: compact(args.runtimeLane) || null,
    });

    return toTextResult(JSON.stringify(status.hermes_runtime, null, 2));
  }

  if (request.name === 'automation.hermes_runtime.remediate') {
    const { runOpenJarvisHermesRuntimeRemediation } = await loadOpenJarvisHermesRuntimeControlService();
    const actionId = compact(args.actionId);
    if (!actionId) {
      return toTextResult('actionId is required', true);
    }

    const result = await runOpenJarvisHermesRuntimeRemediation({
      actionId,
      sessionPath: compact(args.sessionPath) || null,
      vaultPath: compact(args.vaultPath) || null,
      capacityTarget: Number.isFinite(Number(args.capacityTarget)) ? Number(args.capacityTarget) : null,
      gcpCapacityRecoveryRequested: args.gcpCapacityRecovery === true,
      runtimeLane: compact(args.runtimeLane) || null,
      dryRun: args.dryRun === true,
      visibleTerminal: args.visibleTerminal !== false,
    });

    return toTextResult(JSON.stringify(result, null, 2), !result.ok);
  }

  if (request.name === 'automation.hermes_runtime.chat_note') {
    const { createOpenJarvisHermesRuntimeChatNote } = await loadOpenJarvisHermesRuntimeControlService();
    const result = await createOpenJarvisHermesRuntimeChatNote({
      title: compact(args.title) || null,
      guildId: compact(args.guildId) || null,
      sessionPath: compact(args.sessionPath) || null,
      vaultPath: compact(args.vaultPath) || null,
      capacityTarget: Number.isFinite(Number(args.capacityTarget)) ? Number(args.capacityTarget) : null,
      gcpCapacityRecoveryRequested: args.gcpCapacityRecovery === true,
      runtimeLane: compact(args.runtimeLane) || null,
      requesterId: MCP_REQUESTER,
      requesterKind: 'bearer',
    });

    return toTextResult(JSON.stringify(result, null, 2), !result.ok);
  }

  if (request.name === 'automation.hermes_runtime.queue_objective') {
    const { enqueueOpenJarvisHermesRuntimeObjectives } = await loadOpenJarvisHermesRuntimeControlService();
    const result = await enqueueOpenJarvisHermesRuntimeObjectives({
      objective: compact(args.objective) || null,
      objectives: Array.isArray(args.objectives) ? args.objectives.map((entry) => compact(entry)).filter(Boolean) : [],
      sessionPath: compact(args.sessionPath) || null,
      vaultPath: compact(args.vaultPath) || null,
      capacityTarget: Number.isFinite(Number(args.capacityTarget)) ? Number(args.capacityTarget) : null,
      gcpCapacityRecoveryRequested: args.gcpCapacityRecovery === true,
      runtimeLane: compact(args.runtimeLane) || null,
    });

    return toTextResult(JSON.stringify(result, null, 2), !result.ok);
  }

  if (request.name === 'automation.hermes_runtime.chat_launch') {
    const { launchOpenJarvisHermesChatSession } = await loadOpenJarvisHermesRuntimeControlService();
    const result = await launchOpenJarvisHermesChatSession({
      objective: compact(args.objective) || null,
      prompt: compact(args.prompt) || null,
      chatMode: compact(args.chatMode) || null,
      addFilePaths: Array.isArray(args.addFilePaths) ? args.addFilePaths.map((entry) => compact(entry)).filter(Boolean) : [],
      maximize: args.maximize !== false,
      newWindow: args.newWindow === true,
      reuseWindow: args.reuseWindow !== false,
      dryRun: args.dryRun === true,
      sessionPath: compact(args.sessionPath) || null,
      vaultPath: compact(args.vaultPath) || null,
      capacityTarget: Number.isFinite(Number(args.capacityTarget)) ? Number(args.capacityTarget) : null,
      gcpCapacityRecoveryRequested: args.gcpCapacityRecovery === true,
      runtimeLane: compact(args.runtimeLane) || null,
    });

    return toTextResult(JSON.stringify(result, null, 2), !result.ok);
  }

  if (request.name === 'automation.session_start_prep') {
    const { prepareOpenJarvisHermesSessionStart } = await loadOpenJarvisHermesRuntimeControlService();
    const result = await prepareOpenJarvisHermesSessionStart({
      objective: compact(args.objective) || null,
      objectives: Array.isArray(args.objectives) ? args.objectives.map((entry) => compact(entry)).filter(Boolean) : [],
      title: compact(args.title) || null,
      guildId: compact(args.guildId) || null,
      createChatNote: args.createChatNote !== false,
      startSupervisor: args.startSupervisor !== false,
      dryRun: args.dryRun === true,
      visibleTerminal: args.visibleTerminal !== false,
      sessionPath: compact(args.sessionPath) || null,
      vaultPath: compact(args.vaultPath) || null,
      capacityTarget: Number.isFinite(Number(args.capacityTarget)) ? Number(args.capacityTarget) : null,
      gcpCapacityRecoveryRequested: args.gcpCapacityRecovery === true,
      runtimeLane: compact(args.runtimeLane) || null,
      requesterId: MCP_REQUESTER,
      requesterKind: 'bearer',
    });

    return toTextResult(JSON.stringify(result, null, 2), !result.ok);
  }

  if (request.name === 'automation.session_open_bundle') {
    const { resolveAgentPersonalizationSnapshot } = await loadAgentPersonalizationService();
    const { getOpenJarvisSessionOpenBundle } = await loadOpenJarvisAutopilotStatusService();
    const guildId = compact(args.guildId);
    const userId = compact(args.userId);
    if ((guildId && !userId) || (!guildId && userId)) {
      return toTextResult('guildId and userId must be provided together for personalization', true);
    }

    const personalizationSnapshot = guildId && userId
      ? await resolveAgentPersonalizationSnapshot({
        guildId,
        userId,
        requestedPriority: compact(args.priority) || 'balanced',
        requestedSkillId: compact(args.skillId) || null,
      })
      : null;

    const bundle = await getOpenJarvisSessionOpenBundle({
      sessionPath: compact(args.sessionPath) || null,
      vaultPath: compact(args.vaultPath) || null,
      capacityTarget: Number.isFinite(Number(args.capacityTarget)) ? Number(args.capacityTarget) : null,
      gcpCapacityRecoveryRequested: args.gcpCapacityRecovery === true,
      runtimeLane: compact(args.runtimeLane) || null,
      personalizationSnapshot,
    });

    return toTextResult(JSON.stringify(bundle, null, 2));
  }

  if (request.name === 'automation.openjarvis.memory_sync.status') {
    const status = getOpenJarvisMemorySyncStatus();
    return toTextResult(JSON.stringify(status, null, 2));
  }

  if (request.name === 'automation.openjarvis.memory_sync.run') {
    const result = await runOpenJarvisMemorySync({
      dryRun: args.dryRun !== false,
      force: args.force === true,
      guildId: compact(args.guildId) || undefined,
    });

    return toTextResult(JSON.stringify(result, null, 2), !result.ok);
  }

  return toTextResult(`unknown tool: ${request.name}`, true);
};
