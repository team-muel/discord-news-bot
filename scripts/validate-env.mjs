/* eslint-disable no-console */
import 'dotenv/config';

const read = (key) => String(process.env[key] || '').trim();
const readAny = (keys) => {
  for (const key of keys) {
    const value = read(key);
    if (value) return value;
  }
  return '';
};

const isTruthy = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw);
};

const isValidUrl = (value) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const VALID_LLM_PROVIDERS = new Set(['openai', 'gemini', 'anthropic', 'huggingface', 'hf', 'openclaw', 'ollama', 'local', 'claude', 'litellm', 'openjarvis', 'jarvis', 'kimi', 'moonshot']);
const VALID_LLM_PROVIDER_PROFILES = new Set(['cost-optimized', 'quality-optimized']);

const parseProviderList = (raw) => String(raw || '')
  .split(/[;,]/)
  .map((item) => String(item || '').trim().toLowerCase())
  .filter(Boolean);

const parseRuleEntries = (raw) => String(raw || '')
  .split(/[;\n]+/)
  .map((item) => String(item || '').trim())
  .filter(Boolean);

const parseWorkflowModelBindings = (raw) => {
  const bindings = [];
  for (const entry of parseRuleEntries(raw)) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx < 1) {
      add('ERROR', 'LLM_WORKFLOW_MODEL_BINDINGS', `잘못된 binding 형식: ${entry}`);
      continue;
    }
    const pattern = entry.slice(0, eqIdx).trim().toLowerCase();
    const binding = entry.slice(eqIdx + 1).trim();
    const colonIdx = binding.indexOf(':');
    if (!pattern || colonIdx < 1) {
      add('ERROR', 'LLM_WORKFLOW_MODEL_BINDINGS', `binding은 pattern=provider:model 형식이어야 합니다: ${entry}`);
      continue;
    }
    const provider = binding.slice(0, colonIdx).trim().toLowerCase();
    const model = binding.slice(colonIdx + 1).trim();
    if (!VALID_LLM_PROVIDERS.has(provider)) {
      add('ERROR', 'LLM_WORKFLOW_MODEL_BINDINGS', `지원하지 않는 binding provider: ${provider}`);
      continue;
    }
    if (!model) {
      add('ERROR', 'LLM_WORKFLOW_MODEL_BINDINGS', `binding model 누락: ${entry}`);
      continue;
    }
    bindings.push({ pattern, provider, model });
  }
  return bindings;
};

const parseWorkflowProfileDefaults = (raw) => {
  const profiles = [];
  for (const entry of parseRuleEntries(raw)) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx < 1) {
      add('ERROR', 'LLM_WORKFLOW_PROFILE_DEFAULTS', `잘못된 profile 형식: ${entry}`);
      continue;
    }
    const pattern = entry.slice(0, eqIdx).trim().toLowerCase();
    const profile = entry.slice(eqIdx + 1).trim().toLowerCase();
    if (!pattern || !VALID_LLM_PROVIDER_PROFILES.has(profile)) {
      add('ERROR', 'LLM_WORKFLOW_PROFILE_DEFAULTS', `profile은 pattern=cost-optimized|quality-optimized 형식이어야 합니다: ${entry}`);
      continue;
    }
    profiles.push({ pattern, profile });
  }
  return profiles;
};

const findings = [];
let hasError = false;

const add = (level, key, message) => {
  findings.push({ level, key, message });
  if (level === 'ERROR') {
    hasError = true;
  }
};

const requireNonEmpty = (key, why) => {
  if (!read(key)) {
    add('ERROR', key, `필수값 누락: ${why}`);
  }
};

const recommendNonEmpty = (key, why) => {
  if (!read(key)) {
    add('WARN', key, `권장값 누락: ${why}`);
  }
};

const startBot = isTruthy(process.env.START_BOT, false);
const startAutomation = isTruthy(process.env.START_AUTOMATION_JOBS, false);
const aiProvider = read('AI_PROVIDER').toLowerCase();
const deploymentProfile = read('DEPLOYMENT_PROFILE').toLowerCase() || 'auto';

const profileHints = {
  'api-only': {
    startBot: false,
    needsOauth: false,
  },
  'bot-only': {
    startBot: true,
    needsOauth: false,
  },
  'full': {
    startBot: true,
    needsOauth: true,
  },
  'prod': {
    startBot: true,
    needsOauth: true,
  },
};

console.log('[env-check] Muel environment validation start');
console.log(`[env-check] mode START_BOT=${startBot} START_AUTOMATION_JOBS=${startAutomation} AI_PROVIDER=${aiProvider || 'auto'} DEPLOYMENT_PROFILE=${deploymentProfile}`);

if (deploymentProfile && deploymentProfile !== 'auto' && !profileHints[deploymentProfile]) {
  add('WARN', 'DEPLOYMENT_PROFILE', '지원값은 auto|api-only|bot-only|full|prod 입니다.');
}

const activeProfile = profileHints[deploymentProfile] || null;
if (activeProfile) {
  if (activeProfile.startBot && !startBot) {
    add('ERROR', 'START_BOT', `DEPLOYMENT_PROFILE=${deploymentProfile} 에서는 START_BOT=true가 필요합니다.`);
  }
  if (!activeProfile.startBot && startBot) {
    add('WARN', 'START_BOT', `DEPLOYMENT_PROFILE=${deploymentProfile} 에서는 START_BOT=false를 권장합니다.`);
  }
}

// Core
if (!read('NODE_ENV')) {
  add('WARN', 'NODE_ENV', '미설정 시 기본값은 development입니다. 운영 배포는 production을 권장합니다.');
}
if (deploymentProfile === 'prod' && read('NODE_ENV') !== 'production') {
  add('ERROR', 'NODE_ENV', 'DEPLOYMENT_PROFILE=prod 에서는 NODE_ENV=production 이어야 합니다.');
}
requireNonEmpty('JWT_SECRET', '인증 토큰 서명');

if (startBot || startAutomation) {
  if (!read('DISCORD_TOKEN') && !read('DISCORD_BOT_TOKEN')) {
    add('ERROR', 'DISCORD_TOKEN|DISCORD_BOT_TOKEN', '봇/자동화 실행에는 디스코드 토큰이 필요합니다.');
  }
}

if (startBot && (activeProfile?.needsOauth !== false)) {
  if (!readAny(['DISCORD_OAUTH_CLIENT_ID', 'DISCORD_CLIENT_ID'])) {
    add('ERROR', 'DISCORD_OAUTH_CLIENT_ID|DISCORD_CLIENT_ID', '로그인/초대 링크 생성');
  }
  if (!readAny(['DISCORD_OAUTH_CLIENT_SECRET', 'DISCORD_CLIENT_SECRET'])) {
    add('ERROR', 'DISCORD_OAUTH_CLIENT_SECRET|DISCORD_CLIENT_SECRET', 'OAuth 콜백 처리');
  }
}

// AI provider
if (aiProvider === 'openai') {
  requireNonEmpty('OPENAI_API_KEY', 'AI_PROVIDER=openai 선택 시 필요');
}
if (aiProvider === 'gemini') {
  if (!read('GEMINI_API_KEY') && !read('GOOGLE_API_KEY')) {
    add('ERROR', 'GEMINI_API_KEY|GOOGLE_API_KEY', 'AI_PROVIDER=gemini 선택 시 필요');
  }
}
if (aiProvider === 'anthropic' || aiProvider === 'claude') {
  if (!read('ANTHROPIC_API_KEY') && !read('CLAUDE_API_KEY')) {
    add('ERROR', 'ANTHROPIC_API_KEY|CLAUDE_API_KEY', 'AI_PROVIDER=anthropic(또는 claude) 선택 시 필요');
  }
}
if (aiProvider === 'huggingface' || aiProvider === 'hf') {
  if (!readAny(['HF_TOKEN', 'HF_API_KEY', 'HUGGINGFACE_API_KEY'])) {
    add('ERROR', 'HF_TOKEN|HF_API_KEY|HUGGINGFACE_API_KEY', 'AI_PROVIDER=huggingface(또는 hf) 선택 시 필요');
  }
}
if (aiProvider === 'openclaw') {
  if (!read('OPENCLAW_BASE_URL') && !read('OPENCLAW_API_BASE_URL') && !read('OPENCLAW_URL')) {
    add('ERROR', 'OPENCLAW_BASE_URL|OPENCLAW_API_BASE_URL|OPENCLAW_URL', 'AI_PROVIDER=openclaw 선택 시 필요');
  }
  if (!readAny(['OPENCLAW_API_KEY', 'OPENCLAW_KEY'])) {
    add('WARN', 'OPENCLAW_API_KEY|OPENCLAW_KEY', '프록시가 인증을 요구하면 OpenClaw API 키(예: LiteLLM master/virtual key)가 필요합니다.');
  }
}
if (aiProvider === 'ollama' || aiProvider === 'local') {
  recommendNonEmpty('OLLAMA_MODEL', 'AI_PROVIDER=ollama/local 선택 시 모델명을 지정하면 예측 가능성이 높아집니다.');
}
if (aiProvider === 'litellm') {
  recommendNonEmpty('LITELLM_BASE_URL', 'AI_PROVIDER=litellm 선택 시 프록시 URL을 명시하면 운영자가 실제 엔드포인트를 추적하기 쉽습니다.');
  recommendNonEmpty('LITELLM_MODEL', 'AI_PROVIDER=litellm 선택 시 모델 alias를 명시하면 라우팅이 예측 가능해집니다.');
}
if (aiProvider === 'openjarvis' || aiProvider === 'jarvis') {
  recommendNonEmpty('OPENJARVIS_SERVE_URL', 'AI_PROVIDER=openjarvis 선택 시 serve URL을 명시하면 health/debugging이 쉬워집니다.');
  recommendNonEmpty('OPENJARVIS_MODEL', 'AI_PROVIDER=openjarvis 선택 시 실제 serve model을 명시하는 편이 안전합니다.');
}
if (aiProvider === 'kimi' || aiProvider === 'moonshot') {
  if (!read('KIMI_API_KEY') && !read('MOONSHOT_API_KEY')) {
    add('ERROR', 'KIMI_API_KEY|MOONSHOT_API_KEY', 'AI_PROVIDER=kimi(또는 moonshot) 선택 시 필요');
  }
}

const providerBaseOrder = parseProviderList(read('LLM_PROVIDER_BASE_ORDER'));
const invalidBaseProviders = providerBaseOrder.filter((provider) => !VALID_LLM_PROVIDERS.has(provider));
if (invalidBaseProviders.length > 0) {
  add('ERROR', 'LLM_PROVIDER_BASE_ORDER', `지원하지 않는 provider: ${invalidBaseProviders.join(', ')}`);
}
const automaticFallbackOrder = parseProviderList(read('LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER'));
const invalidAutomaticProviders = automaticFallbackOrder.filter((provider) => !VALID_LLM_PROVIDERS.has(provider));
if (invalidAutomaticProviders.length > 0) {
  add('ERROR', 'LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER', `지원하지 않는 provider: ${invalidAutomaticProviders.join(', ')}`);
}
const explicitFallbackChain = parseProviderList(read('LLM_PROVIDER_FALLBACK_CHAIN'));
const invalidFallbackProviders = explicitFallbackChain.filter((provider) => !VALID_LLM_PROVIDERS.has(provider));
if (invalidFallbackProviders.length > 0) {
  add('ERROR', 'LLM_PROVIDER_FALLBACK_CHAIN', `지원하지 않는 provider: ${invalidFallbackProviders.join(', ')}`);
}
const workflowBindings = parseWorkflowModelBindings(read('LLM_WORKFLOW_MODEL_BINDINGS'));
const workflowProfiles = parseWorkflowProfileDefaults(read('LLM_WORKFLOW_PROFILE_DEFAULTS'));
const hasRemoteLlmFallback = Boolean(
  read('OPENAI_API_KEY')
  || read('GEMINI_API_KEY')
  || read('GOOGLE_API_KEY')
  || read('ANTHROPIC_API_KEY')
  || read('CLAUDE_API_KEY')
  || readAny(['HF_TOKEN', 'HF_API_KEY', 'HUGGINGFACE_API_KEY'])
  || read('OPENCLAW_BASE_URL')
  || read('OPENCLAW_API_BASE_URL')
  || read('OPENCLAW_URL'),
);
if ((aiProvider === 'ollama' || aiProvider === 'local' || providerBaseOrder[0] === 'ollama' || providerBaseOrder[0] === 'local') && !hasRemoteLlmFallback) {
  add('WARN', 'OPENCLAW_BASE_URL|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|HF_TOKEN', 'local-first 구성인데 원격 fallback provider가 없습니다. 로컬 LLM 중단 시 세션 실패 가능성이 큽니다.');
}
const expectsOpenJarvisUpperLane = isTruthy(process.env.OPENJARVIS_ENABLED, false)
  && (aiProvider === 'ollama' || aiProvider === 'local' || providerBaseOrder[0] === 'ollama' || providerBaseOrder[0] === 'local');
if (expectsOpenJarvisUpperLane) {
  const hasOpenJarvisOpsBinding = workflowBindings.some(({ pattern, provider }) => provider === 'openjarvis' && ['operate.ops', 'openjarvis.ops', 'eval.*', 'worker.*'].includes(pattern));
  if (!hasOpenJarvisOpsBinding) {
    add('WARN', 'LLM_WORKFLOW_MODEL_BINDINGS', 'local-first + OPENJARVIS_ENABLED 조합이면 operate.ops/openjarvis.ops/eval.*/worker.* 중 일부를 openjarvis model binding으로 두는 편이 운영 계층 분리를 명확하게 유지합니다.');
  }

  const hasOpenJarvisOpsProfile = workflowProfiles.some(({ pattern, profile }) => profile === 'quality-optimized' && ['operate.ops', 'openjarvis.ops', 'eval.*', 'worker.*'].includes(pattern));
  if (!hasOpenJarvisOpsProfile) {
    add('WARN', 'LLM_WORKFLOW_PROFILE_DEFAULTS', 'local-first + OPENJARVIS_ENABLED 조합이면 operate.ops/openjarvis.ops/eval.*/worker.* 를 quality-optimized 로 두는 편이 unattended ops 품질 일관성에 유리합니다.');
  }
}
const requireOpencodeWorker = isTruthy(process.env.OPENJARVIS_REQUIRE_OPENCODE_WORKER, true);
const implementWorkerUrl = read('MCP_IMPLEMENT_WORKER_URL') || read('MCP_OPENCODE_WORKER_URL');
if (!read('MCP_IMPLEMENT_WORKER_URL') && read('MCP_OPENCODE_WORKER_URL')) {
  add('WARN', 'MCP_IMPLEMENT_WORKER_URL', 'legacy executor env MCP_OPENCODE_WORKER_URL 만 설정되어 있습니다. canonical env MCP_IMPLEMENT_WORKER_URL 로 정리하는 편이 향후 contract drift를 줄입니다.');
}
if ((aiProvider === 'ollama' || aiProvider === 'local' || providerBaseOrder[0] === 'ollama' || providerBaseOrder[0] === 'local')
  && startAutomation
  && !requireOpencodeWorker) {
  add('WARN', 'OPENJARVIS_REQUIRE_OPENCODE_WORKER', '로컬 추론 우선 구성이더라도 unattended automation은 원격 worker 강제를 유지하는 편이 안전합니다.');
}
if (requireOpencodeWorker && !implementWorkerUrl) {
  add('ERROR', 'MCP_IMPLEMENT_WORKER_URL|MCP_OPENCODE_WORKER_URL', 'OPENJARVIS_REQUIRE_OPENCODE_WORKER=true 이면 원격 worker URL이 필요합니다. canonical env는 MCP_IMPLEMENT_WORKER_URL 입니다.');
}
const workerRequireAuth = isTruthy(process.env.OPENCODE_LOCAL_WORKER_REQUIRE_AUTH, false);
const hasWorkerAuthToken = Boolean(
  read('MCP_WORKER_AUTH_TOKEN')
  || read('MCP_OPENCODE_WORKER_AUTH_TOKEN')
  || read('AGENT_ROLE_WORKER_AUTH_TOKEN')
  || read('OPENCODE_LOCAL_WORKER_AUTH_TOKEN'),
);
if (requireOpencodeWorker && !hasWorkerAuthToken) {
  add('WARN', 'MCP_WORKER_AUTH_TOKEN|MCP_OPENCODE_WORKER_AUTH_TOKEN', '원격 worker 사용 시 인증 토큰 설정을 권장합니다. 무인증 endpoint 노출 위험이 있습니다.');
}
if (workerRequireAuth && !hasWorkerAuthToken) {
  add('ERROR', 'OPENCODE_LOCAL_WORKER_REQUIRE_AUTH', 'OPENCODE_LOCAL_WORKER_REQUIRE_AUTH=true 인 경우 worker/client 공용 인증 토큰이 필요합니다.');
}

const advisoryWorkerUrls = [
  read('MCP_ARCHITECT_WORKER_URL') || read('MCP_OPENDEV_WORKER_URL'),
  read('MCP_REVIEW_WORKER_URL') || read('MCP_NEMOCLAW_WORKER_URL'),
  read('MCP_OPERATE_WORKER_URL') || read('MCP_OPENJARVIS_WORKER_URL'),
  read('MCP_COORDINATE_WORKER_URL') || read('MCP_LOCAL_ORCHESTRATOR_WORKER_URL'),
].filter(Boolean);
if (advisoryWorkerUrls.length > 0 && !hasWorkerAuthToken) {
  add('WARN', 'AGENT_ROLE_WORKER_AUTH_TOKEN|MCP_WORKER_AUTH_TOKEN', 'advisory role worker를 원격으로 사용하면 인증 토큰 설정을 권장합니다.');
}

const providerMaxAttemptsRaw = Number(read('LLM_PROVIDER_MAX_ATTEMPTS') || 2);
if (Number.isFinite(providerMaxAttemptsRaw) && providerMaxAttemptsRaw > 3) {
  add('WARN', 'LLM_PROVIDER_MAX_ATTEMPTS', '3보다 크면 장애 시 provider chain 지연이 크게 늘어날 수 있습니다.');
}
const providerTotalTimeoutRaw = Number(read('LLM_PROVIDER_TOTAL_TIMEOUT_MS') || 25000);
if (Number.isFinite(providerTotalTimeoutRaw) && providerTotalTimeoutRaw > 45000) {
  add('WARN', 'LLM_PROVIDER_TOTAL_TIMEOUT_MS', '45000ms 초과는 인터랙티브 응답 지연 체감이 커질 수 있습니다.');
}
const plannerSelfConsistencySamplesRaw = Number(read('PLANNER_SELF_CONSISTENCY_SAMPLES') || 3);
if (Number.isFinite(plannerSelfConsistencySamplesRaw) && plannerSelfConsistencySamplesRaw > 2) {
  add('WARN', 'PLANNER_SELF_CONSISTENCY_SAMPLES', '2보다 크면 플래너 단계 LLM 호출 수가 늘어 지연이 커질 수 있습니다.');
}
const finalSelfConsistencySamplesRaw = Number(read('FINAL_SELF_CONSISTENCY_SAMPLES') || 3);
if (Number.isFinite(finalSelfConsistencySamplesRaw) && finalSelfConsistencySamplesRaw > 2) {
  add('WARN', 'FINAL_SELF_CONSISTENCY_SAMPLES', '2보다 크면 최종 합성 단계 지연이 커질 수 있습니다.');
}
const dynamicReasoningLowGoalLengthRaw = Number(read('AGENT_DYNAMIC_REASONING_LOW_GOAL_LENGTH') || 120);
const dynamicReasoningHighGoalLengthRaw = Number(read('AGENT_DYNAMIC_REASONING_HIGH_GOAL_LENGTH') || 320);
if (Number.isFinite(dynamicReasoningLowGoalLengthRaw)
  && Number.isFinite(dynamicReasoningHighGoalLengthRaw)
  && dynamicReasoningLowGoalLengthRaw >= dynamicReasoningHighGoalLengthRaw) {
  add('WARN', 'AGENT_DYNAMIC_REASONING_LOW_GOAL_LENGTH|AGENT_DYNAMIC_REASONING_HIGH_GOAL_LENGTH', 'LOW 값은 HIGH 값보다 작아야 동적 예산 축소가 의도대로 동작합니다.');
}
const langgraphExecutorShadowSampleRateRaw = Number(read('LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE') || 0.2);
if (Number.isFinite(langgraphExecutorShadowSampleRateRaw)
  && (langgraphExecutorShadowSampleRateRaw < 0 || langgraphExecutorShadowSampleRateRaw > 1)) {
  add('ERROR', 'LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE', '0 이상 1 이하 값이어야 합니다.');
}
const langgraphExecutorShadowMaxStepsRaw = Number(read('LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS') || 60);
if (Number.isFinite(langgraphExecutorShadowMaxStepsRaw) && langgraphExecutorShadowMaxStepsRaw > 120) {
  add('WARN', 'LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS', '120보다 크면 shadow replay 오버헤드가 커질 수 있습니다.');
}
const weeklyReportSinksRaw = String(read('LLM_WEEKLY_REPORT_SINKS') || 'supabase,obsidian').trim().toLowerCase();
const weeklyReportSinks = weeklyReportSinksRaw
  .split(/[;,]/)
  .map((item) => item.trim())
  .filter(Boolean);
const validWeeklyReportSinks = new Set(['supabase', 'obsidian', 'markdown', 'stdout']);
if (weeklyReportSinks.length === 0) {
  add('WARN', 'LLM_WEEKLY_REPORT_SINKS', '비어 있으면 기본값 supabase,obsidian이 적용됩니다.');
}
const invalidWeeklyReportSinks = weeklyReportSinks.filter((sink) => !validWeeklyReportSinks.has(sink));
if (invalidWeeklyReportSinks.length > 0) {
  add('ERROR', 'LLM_WEEKLY_REPORT_SINKS', `지원하지 않는 sink: ${invalidWeeklyReportSinks.join(', ')}`);
}
if (weeklyReportSinks.includes('markdown') && weeklyReportSinks.length === 1) {
  add('WARN', 'LLM_WEEKLY_REPORT_SINKS', 'markdown 단독 저장은 권장하지 않습니다. supabase 또는 obsidian sink를 함께 사용하세요.');
}
const botStatusCacheTtlMsRaw = Number(read('BOT_STATUS_CACHE_TTL_MS') || 5000);
if (Number.isFinite(botStatusCacheTtlMsRaw) && (botStatusCacheTtlMsRaw < 1000 || botStatusCacheTtlMsRaw > 60000)) {
  add('WARN', 'BOT_STATUS_CACHE_TTL_MS', '권장 범위는 1000~60000ms 입니다. 너무 짧거나 길면 제어면 상태 API 안정성이 떨어질 수 있습니다.');
}
const botStatusRateWindowMsRaw = Number(read('BOT_STATUS_RATE_WINDOW_MS') || 60000);
if (Number.isFinite(botStatusRateWindowMsRaw) && botStatusRateWindowMsRaw < 1000) {
  add('ERROR', 'BOT_STATUS_RATE_WINDOW_MS', '1000ms 이상이어야 합니다.');
}
const botStatusRateMaxRaw = Number(read('BOT_STATUS_RATE_MAX') || 60);
if (Number.isFinite(botStatusRateMaxRaw) && botStatusRateMaxRaw < 1) {
  add('ERROR', 'BOT_STATUS_RATE_MAX', '1 이상이어야 합니다.');
}
const botAdminActionRateWindowMsRaw = Number(read('BOT_ADMIN_ACTION_RATE_WINDOW_MS') || 60000);
if (Number.isFinite(botAdminActionRateWindowMsRaw) && botAdminActionRateWindowMsRaw < 1000) {
  add('ERROR', 'BOT_ADMIN_ACTION_RATE_WINDOW_MS', '1000ms 이상이어야 합니다.');
}
const botAdminActionRateMaxRaw = Number(read('BOT_ADMIN_ACTION_RATE_MAX') || 20);
if (Number.isFinite(botAdminActionRateMaxRaw) && botAdminActionRateMaxRaw < 1) {
  add('ERROR', 'BOT_ADMIN_ACTION_RATE_MAX', '1 이상이어야 합니다.');
}
const apiIdempotencyTtlSecRaw = Number(read('API_IDEMPOTENCY_TTL_SEC') || 86400);
if (Number.isFinite(apiIdempotencyTtlSecRaw) && apiIdempotencyTtlSecRaw < 60) {
  add('ERROR', 'API_IDEMPOTENCY_TTL_SEC', '60초 이상이어야 합니다.');
}
if (!aiProvider) {
  const hasOpenClaw = Boolean(read('OPENCLAW_BASE_URL') || read('OPENCLAW_API_BASE_URL') || read('OPENCLAW_URL'));
  const hasOllama = Boolean(read('OLLAMA_MODEL'));
  const hasHuggingFace = Boolean(readAny(['HF_TOKEN', 'HF_API_KEY', 'HUGGINGFACE_API_KEY']));
  if (!read('OPENAI_API_KEY') && !read('GEMINI_API_KEY') && !read('GOOGLE_API_KEY') && !read('ANTHROPIC_API_KEY') && !read('CLAUDE_API_KEY') && !hasHuggingFace && !hasOpenClaw && !hasOllama) {
    add('WARN', 'AI_PROVIDER/OPENAI_API_KEY/GEMINI_API_KEY/ANTHROPIC_API_KEY/HF_TOKEN/OPENCLAW_BASE_URL/OLLAMA_MODEL', 'LLM 설정이 없으면 /해줘, 에이전트 세션이 실패합니다.');
  }
}

// Supabase (recommended for multi-guild durability)
if (!read('SUPABASE_URL') || !(read('SUPABASE_SERVICE_ROLE_KEY') || read('SUPABASE_KEY'))) {
  add('WARN', 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_KEY', '멀티서버 상태 유지(구독/세션/메모리)에는 Supabase 구성이 사실상 필요합니다.');
}
if (read('SUPABASE_URL') && !isValidUrl(read('SUPABASE_URL'))) {
  add('ERROR', 'SUPABASE_URL', '유효한 http/https URL이어야 합니다.');
}

// Web / OAuth callback
const publicBaseUrl = read('PUBLIC_BASE_URL') || read('RENDER_EXTERNAL_URL') || read('RENDER_PUBLIC_URL');
if (publicBaseUrl && !isValidUrl(publicBaseUrl)) {
  add('ERROR', 'PUBLIC_BASE_URL', '유효한 http/https URL이어야 합니다.');
}
if (startBot && (activeProfile?.needsOauth !== false)) {
  recommendNonEmpty('PUBLIC_BASE_URL', 'Discord OAuth callback 주소 자동 생성');
  if (!readAny(['FRONTEND_ORIGIN', 'CORS_ALLOWLIST', 'OAUTH_REDIRECT_ALLOWLIST'])) {
    add('WARN', 'FRONTEND_ORIGIN|CORS_ALLOWLIST|OAUTH_REDIRECT_ALLOWLIST', 'CORS/로그인 UI 연동');
  }
}

// Multi-guild command sync checks
if (read('DISCORD_COMMAND_GUILD_ID')) {
  add('WARN', 'DISCORD_COMMAND_GUILD_ID', '설정 시 특정 길드 빠른 동기화가 우선됩니다. 멀티서버 운영에서는 값이 의도한 길드인지 확인하세요.');
}

// Automation & trading optional warnings
if (startAutomation && !read('YOUTUBE_MONITOR_INTERVAL_MS')) {
  add('WARN', 'YOUTUBE_MONITOR_INTERVAL_MS', '자동화 주기를 명시하면 운영 예측성이 높아집니다.');
}

if (findings.length === 0) {
  console.log('[env-check] OK: 필수/권장 점검에서 이슈가 없습니다.');
  process.exit(0);
}

for (const item of findings) {
  console.log(`[${item.level}] ${item.key} - ${item.message}`);
}

if (hasError) {
  console.log('[env-check] FAIL: ERROR 항목을 먼저 해결하세요.');
  process.exit(1);
}

console.log('[env-check] WARN only: 운영 전 권장 항목 확인이 필요합니다.');
process.exit(0);
