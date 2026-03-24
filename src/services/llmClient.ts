import crypto from 'crypto';
import { logStructuredError } from './structuredErrorLogService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const HUGGINGFACE_CHAT_COMPLETIONS_URL = String(process.env.HUGGINGFACE_CHAT_COMPLETIONS_URL || 'https://router.huggingface.co/v1/chat/completions').trim();
const LLM_API_TIMEOUT_MS = Math.max(1000, Number(process.env.LLM_API_TIMEOUT_MS || 15000));
const LLM_API_TIMEOUT_LARGE_MS = Math.max(LLM_API_TIMEOUT_MS, Number(process.env.LLM_API_TIMEOUT_LARGE_MS || 90_000));
const LLM_PROVIDER_TOTAL_TIMEOUT_MS = Math.max(1_000, Number(process.env.LLM_PROVIDER_TOTAL_TIMEOUT_MS || 25_000));
const LLM_PROVIDER_MAX_ATTEMPTS = Math.max(1, Math.min(6, Number(process.env.LLM_PROVIDER_MAX_ATTEMPTS || 2) || 2));
const LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED || 'false').trim());
const LLM_CALL_LOG_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.LLM_CALL_LOG_ENABLED || 'true').trim());
const LLM_CALL_LOG_TABLE = String(process.env.LLM_CALL_LOG_TABLE || 'agent_llm_call_logs').trim();
const LLM_EXPERIMENT_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.LLM_EXPERIMENT_ENABLED || 'false').trim());
const LLM_EXPERIMENT_NAME = String(process.env.LLM_EXPERIMENT_NAME || 'hf_ab_v1').trim();
const LLM_EXPERIMENT_HF_PERCENT = Math.max(0, Math.min(100, Number(process.env.LLM_EXPERIMENT_HF_PERCENT || 20) || 20));
const LLM_EXPERIMENT_FAIL_OPEN = !/^(0|false|off|no)$/i.test(String(process.env.LLM_EXPERIMENT_FAIL_OPEN || 'true').trim());
const LLM_EXPERIMENT_GUILD_ALLOWLIST = new Set(
  String(process.env.LLM_EXPERIMENT_GUILD_ALLOWLIST || '')
    .split(',')
    .map((v) => String(v || '').trim())
    .filter(Boolean),
);
const LLM_COST_INPUT_PER_1K_CHARS_USD = Math.max(0, Number(process.env.LLM_COST_INPUT_PER_1K_CHARS_USD || 0.0005) || 0.0005);
const LLM_COST_OUTPUT_PER_1K_CHARS_USD = Math.max(0, Number(process.env.LLM_COST_OUTPUT_PER_1K_CHARS_USD || 0.0015) || 0.0015);

export type LlmProvider = 'openai' | 'gemini' | 'anthropic' | 'openclaw' | 'ollama' | 'huggingface' | 'openjarvis' | 'litellm' | 'kimi';

export type LlmProviderProfile = 'cost-optimized' | 'quality-optimized';

type ProviderPolicyRule = {
  pattern: string;
  providers: LlmProvider[];
};

export type LlmTextRequest = {
  system: string;
  user: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  provider?: LlmProvider;
  providerProfile?: LlmProviderProfile;
  model?: string;
  guildId?: string;
  sessionId?: string;
  requestedBy?: string;
  experimentKey?: string;
  actionName?: string;
};

export type LlmTextWithMetaResponse = {
  text: string;
  provider: LlmProvider;
  model?: string;
  latencyMs?: number;
  estimatedCostUsd?: number;
  experiment?: {
    name: string;
    arm: 'control' | 'huggingface';
    keyHash: string;
  } | null;
  avgLogprob?: number;
  /** M-07: Normalized quality score [0..1] across providers. Based on latency, logprob, and output completeness. */
  normalizedQualityScore?: number;
};

type LlmExperimentDecision = {
  provider: LlmProvider | null;
  experiment: LlmTextWithMetaResponse['experiment'];
};

const getOpenAiKey = () => String(process.env.OPENAI_API_KEY || '').trim();
const getGeminiKey = () => String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const getAnthropicKey = () => String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
const getHuggingFaceKey = () => String(process.env.HF_TOKEN || process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY || '').trim();
const getOpenClawApiKey = () => String(process.env.OPENCLAW_API_KEY || process.env.OPENCLAW_KEY || '').trim();
const getOpenClawFallbackModels = () => String(process.env.OPENCLAW_FALLBACK_MODELS || 'muel-fast,muel-precise')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS = Math.max(1_000, Number(process.env.OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS || 45_000));
const openclawModelCooldownUntilMs = new Map<string, number>();
const getOpenClawBaseUrl = () => String(
  process.env.OPENCLAW_BASE_URL
    || process.env.OPENCLAW_API_BASE_URL
    || process.env.OPENCLAW_URL
    || '',
).trim().replace(/\/+$/, '');
const isOpenClawConfigured = () => Boolean(getOpenClawBaseUrl());
const getOllamaBaseUrl = () => String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
const getOllamaModel = () => String(process.env.OLLAMA_MODEL || process.env.LOCAL_LLM_MODEL || '').trim();
const isOllamaConfigured = () => Boolean(getOllamaModel() || ['ollama', 'local'].includes(String(process.env.AI_PROVIDER || '').trim().toLowerCase()));
const isHuggingFaceConfigured = () => Boolean(getHuggingFaceKey());
const getOpenJarvisServeUrl = () => String(process.env.OPENJARVIS_SERVE_URL || 'http://127.0.0.1:8000').trim().replace(/\/+$/, '');
const isOpenJarvisConfigured = () => !/^(0|false|off|no)$/i.test(String(process.env.OPENJARVIS_ENABLED || 'false').trim());
const getOpenJarvisModel = () => String(process.env.OPENJARVIS_MODEL || '').trim();
const getLiteLLMBaseUrl = () => String(process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000').trim().replace(/\/+$/, '');
const getLiteLLMKey = () => String(process.env.LITELLM_MASTER_KEY || '').trim();
const isLiteLLMConfigured = () => !/^(0|false|off|no)$/i.test(String(process.env.LITELLM_ENABLED || 'false').trim());
const getLiteLLMModel = () => String(process.env.LITELLM_MODEL || 'muel-local').trim();
const getKimiKey = () => String(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '').trim();
const getKimiBaseUrl = () => String(process.env.KIMI_BASE_URL || 'https://api.moonshot.cn').trim().replace(/\/+$/, '');
const isKimiConfigured = () => Boolean(getKimiKey());
const getKimiModel = () => String(process.env.KIMI_MODEL || 'moonshot-v1-128k').trim();
const DEFAULT_BASE_PROVIDER_ORDER: LlmProvider[] = ['openai', 'anthropic', 'gemini', 'kimi', 'huggingface', 'openclaw', 'litellm', 'openjarvis', 'ollama'];
const DEFAULT_AUTOMATIC_FALLBACK_ORDER: LlmProvider[] = ['openclaw', 'openai', 'anthropic', 'kimi', 'gemini', 'huggingface', 'litellm', 'openjarvis', 'ollama'];

const normalizeProviderAlias = (value: string): LlmProvider | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'hf') {
    return 'huggingface';
  }
  if (normalized === 'claude') {
    return 'anthropic';
  }
  if (normalized === 'local') {
    return 'ollama';
  }
  if (normalized === 'jarvis') {
    return 'openjarvis';
  }
  if (normalized === 'moonshot') {
    return 'kimi';
  }
  if (normalized === 'openai' || normalized === 'gemini' || normalized === 'anthropic' || normalized === 'openclaw' || normalized === 'ollama' || normalized === 'huggingface' || normalized === 'openjarvis' || normalized === 'litellm' || normalized === 'kimi') {
    return normalized;
  }
  return null;
};

const parseProviderList = (raw: string): LlmProvider[] => {
  const seen = new Set<LlmProvider>();
  const providers: LlmProvider[] = [];
  for (const token of String(raw || '').split(',')) {
    const provider = normalizeProviderAlias(token);
    if (!provider || seen.has(provider)) {
      continue;
    }
    seen.add(provider);
    providers.push(provider);
  }
  return providers;
};

const isProviderConfigured = (provider: LlmProvider): boolean => {
  if (provider === 'openai') return Boolean(getOpenAiKey());
  if (provider === 'gemini') return Boolean(getGeminiKey());
  if (provider === 'anthropic') return Boolean(getAnthropicKey());
  if (provider === 'huggingface') return isHuggingFaceConfigured();
  if (provider === 'openclaw') return isOpenClawConfigured();
  if (provider === 'ollama') return isOllamaConfigured();
  if (provider === 'openjarvis') return isOpenJarvisConfigured();
  if (provider === 'litellm') return isLiteLLMConfigured();
  if (provider === 'kimi') return isKimiConfigured();
  return false;
};

const parseActionPolicyRules = (): ProviderPolicyRule[] => {
  const raw = String(process.env.LLM_PROVIDER_POLICY_ACTIONS || '').trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(/[;\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex < 1) {
        return null;
      }
      const pattern = line.slice(0, separatorIndex).trim().toLowerCase();
      const providers = parseProviderList(line.slice(separatorIndex + 1));
      if (!pattern || providers.length === 0) {
        return null;
      }
      return { pattern, providers };
    })
    .filter((item): item is ProviderPolicyRule => Boolean(item));
};

const matchActionPattern = (pattern: string, actionName: string): boolean => {
  const normalizedPattern = String(pattern || '').trim().toLowerCase();
  const normalizedAction = String(actionName || '').trim().toLowerCase();
  if (!normalizedPattern || !normalizedAction) {
    return false;
  }
  if (normalizedPattern === normalizedAction) {
    return true;
  }
  if (normalizedPattern.endsWith('*')) {
    const prefix = normalizedPattern.slice(0, -1);
    return prefix.length > 0 && normalizedAction.startsWith(prefix);
  }
  return normalizedAction.startsWith(`${normalizedPattern}.`);
};

const getConfiguredBaseProviderOrder = (): LlmProvider[] => {
  const configured = parseProviderList(String(process.env.LLM_PROVIDER_BASE_ORDER || '').trim());
  return configured.length > 0 ? configured : DEFAULT_BASE_PROVIDER_ORDER;
};

const getAutomaticFallbackOrder = (): LlmProvider[] => {
  const configured = parseProviderList(String(process.env.LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER || '').trim());
  return configured.length > 0 ? configured : DEFAULT_AUTOMATIC_FALLBACK_ORDER;
};

const getDefaultProviderFallbackChain = (): LlmProvider[] => {
  return parseProviderList(String(process.env.LLM_PROVIDER_FALLBACK_CHAIN || ''));
};

let _cachedActionPolicyRules: ProviderPolicyRule[] | null = null;
const getActionPolicyRulesCached = (): ProviderPolicyRule[] => {
  if (!_cachedActionPolicyRules) _cachedActionPolicyRules = parseActionPolicyRules();
  return _cachedActionPolicyRules;
};

const getActionPolicyProviders = (actionName?: string): LlmProvider[] => {
  const safeActionName = String(actionName || '').trim();
  const actionPolicyRules = getActionPolicyRulesCached();
  if (!safeActionName || actionPolicyRules.length === 0) {
    return [];
  }

  const seen = new Set<LlmProvider>();
  const providers: LlmProvider[] = [];
  for (const rule of actionPolicyRules) {
    if (!matchActionPattern(rule.pattern, safeActionName)) {
      continue;
    }
    for (const provider of rule.providers) {
      if (seen.has(provider)) {
        continue;
      }
      seen.add(provider);
      providers.push(provider);
    }
  }
  return providers;
};

/**
 * M-06: Workflow slot model binding/fallback matrix.
 * Env format: LLM_WORKFLOW_MODEL_BINDINGS="worker.generation=openai:gpt-4o;news.*=gemini:gemini-2.0-flash;code.*=anthropic:claude-sonnet-4-20250514"
 * Each entry: actionPattern=provider:model
 * Provider profile defaults per action: LLM_WORKFLOW_PROFILE_DEFAULTS="worker.generation=quality-optimized;news.*=cost-optimized"
 */
type WorkflowModelBinding = { pattern: string; provider: LlmProvider; model: string };

const parseWorkflowModelBindings = (): WorkflowModelBinding[] => {
  const raw = String(process.env.LLM_WORKFLOW_MODEL_BINDINGS || '').trim();
  if (!raw) return [];
  return raw.split(/[;\n]+/).map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const eqIdx = entry.indexOf('=');
    if (eqIdx < 1) return null;
    const pattern = entry.slice(0, eqIdx).trim().toLowerCase();
    const binding = entry.slice(eqIdx + 1).trim();
    const colonIdx = binding.indexOf(':');
    if (colonIdx < 1) return null;
    const provider = normalizeProviderAlias(binding.slice(0, colonIdx).trim());
    const model = binding.slice(colonIdx + 1).trim();
    if (!provider || !model) return null;
    return { pattern, provider, model };
  }).filter((b): b is WorkflowModelBinding => Boolean(b));
};

let _cachedWorkflowModelBindings: WorkflowModelBinding[] | null = null;
const getWorkflowModelBindingsCached = (): WorkflowModelBinding[] => {
  if (!_cachedWorkflowModelBindings) _cachedWorkflowModelBindings = parseWorkflowModelBindings();
  return _cachedWorkflowModelBindings;
};

const resolveWorkflowModelBinding = (actionName?: string): { provider: LlmProvider; model: string } | null => {
  const safeAction = String(actionName || '').trim();
  if (!safeAction) return null;
  for (const binding of getWorkflowModelBindingsCached()) {
    if (matchActionPattern(binding.pattern, safeAction)) {
      return { provider: binding.provider, model: binding.model };
    }
  }
  return null;
};

const parseWorkflowProfileDefaults = (): Array<{ pattern: string; profile: LlmProviderProfile }> => {
  const raw = String(process.env.LLM_WORKFLOW_PROFILE_DEFAULTS || '').trim();
  if (!raw) return [];
  return raw.split(/[;\n]+/).map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const eqIdx = entry.indexOf('=');
    if (eqIdx < 1) return null;
    const pattern = entry.slice(0, eqIdx).trim().toLowerCase();
    const profile = entry.slice(eqIdx + 1).trim() as LlmProviderProfile;
    if (profile !== 'cost-optimized' && profile !== 'quality-optimized') return null;
    return { pattern, profile };
  }).filter((p): p is { pattern: string; profile: LlmProviderProfile } => Boolean(p));
};

let _cachedWorkflowProfileDefaults: Array<{ pattern: string; profile: LlmProviderProfile }> | null = null;
const getWorkflowProfileDefaultsCached = (): Array<{ pattern: string; profile: LlmProviderProfile }> => {
  if (!_cachedWorkflowProfileDefaults) _cachedWorkflowProfileDefaults = parseWorkflowProfileDefaults();
  return _cachedWorkflowProfileDefaults;
};

const resolveWorkflowProfile = (actionName?: string): LlmProviderProfile | undefined => {
  const safeAction = String(actionName || '').trim();
  if (!safeAction) return undefined;
  for (const rule of getWorkflowProfileDefaultsCached()) {
    if (matchActionPattern(rule.pattern, safeAction)) {
      return rule.profile;
    }
  }
  return undefined;
};

const dedupeProviders = (providers: Array<LlmProvider | null | undefined>): LlmProvider[] => {
  const seen = new Set<LlmProvider>();
  const out: LlmProvider[] = [];
  for (const provider of providers) {
    if (!provider || seen.has(provider)) {
      continue;
    }
    seen.add(provider);
    out.push(provider);
  }
  return out;
};

const shortHash = (value: string): string => {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 16);
};

const estimateLlmCallCostUsd = (inputChars: number, outputChars: number): number => {
  const inCost = (Math.max(0, inputChars) / 1000) * LLM_COST_INPUT_PER_1K_CHARS_USD;
  const outCost = (Math.max(0, outputChars) / 1000) * LLM_COST_OUTPUT_PER_1K_CHARS_USD;
  return Number((inCost + outCost).toFixed(8));
};

const isExperimentGuildAllowed = (guildId?: string): boolean => {
  const safeGuildId = String(guildId || '').trim();
  if (!safeGuildId) {
    return false;
  }
  if (LLM_EXPERIMENT_GUILD_ALLOWLIST.size === 0) {
    return true;
  }
  return LLM_EXPERIMENT_GUILD_ALLOWLIST.has(safeGuildId);
};

const resolveProviderWithoutExperiment = (): LlmProvider | null => {
  const preferred = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (preferred === 'gemini' && getGeminiKey()) {
    return 'gemini';
  }
  if (preferred === 'openai' && getOpenAiKey()) {
    return 'openai';
  }
  if (preferred === 'anthropic' && getAnthropicKey()) {
    return 'anthropic';
  }
  if (preferred === 'claude' && getAnthropicKey()) {
    return 'anthropic';
  }
  if ((preferred === 'huggingface' || preferred === 'hf') && isHuggingFaceConfigured()) {
    return 'huggingface';
  }
  if (preferred === 'openclaw' && isOpenClawConfigured()) {
    return 'openclaw';
  }
  if ((preferred === 'ollama' || preferred === 'local') && isOllamaConfigured()) {
    return 'ollama';
  }
  if ((preferred === 'openjarvis' || preferred === 'jarvis') && isOpenJarvisConfigured()) {
    return 'openjarvis';
  }
  if (preferred === 'litellm' && isLiteLLMConfigured()) {
    return 'litellm';
  }
  if ((preferred === 'kimi' || preferred === 'moonshot') && isKimiConfigured()) {
    return 'kimi';
  }

  for (const provider of getConfiguredBaseProviderOrder()) {
    if (isProviderConfigured(provider)) {
      return provider;
    }
  }

  return null;
};

const resolveProviderWithExperiment = (params: LlmTextRequest): LlmExperimentDecision => {
  if (params.provider) {
    return { provider: params.provider, experiment: null };
  }

  const baseProvider = resolveProviderWithoutExperiment();
  if (!baseProvider) {
    return { provider: null, experiment: null };
  }

  if (!LLM_EXPERIMENT_ENABLED || !isHuggingFaceConfigured() || !isExperimentGuildAllowed(params.guildId)) {
    return { provider: baseProvider, experiment: null };
  }

  if (baseProvider === 'huggingface') {
    return {
      provider: 'huggingface',
      experiment: {
        name: LLM_EXPERIMENT_NAME,
        arm: 'huggingface',
        keyHash: shortHash(params.experimentKey || params.guildId || params.user || ''),
      },
    };
  }

  const bucketSeed = [
    String(params.experimentKey || '').trim(),
    String(params.guildId || '').trim(),
    String(params.sessionId || '').trim(),
    String(params.requestedBy || '').trim(),
    String(params.user || '').slice(0, 120),
  ].filter(Boolean).join('|');
  const hashHex = crypto.createHash('sha256').update(bucketSeed || 'default', 'utf8').digest('hex').slice(0, 8);
  const bucket = parseInt(hashHex, 16) % 100;
  const useHfArm = bucket < LLM_EXPERIMENT_HF_PERCENT;
  return {
    provider: useHfArm ? 'huggingface' : baseProvider,
    experiment: {
      name: LLM_EXPERIMENT_NAME,
      arm: useHfArm ? 'huggingface' : 'control',
      keyHash: shortHash(bucketSeed || 'default'),
    },
  };
};

const COST_OPTIMIZED_ORDER: readonly LlmProvider[] = ['ollama', 'huggingface', 'litellm', 'openjarvis', 'openclaw', 'kimi', 'gemini', 'anthropic', 'openai'];
const QUALITY_OPTIMIZED_ORDER: readonly LlmProvider[] = ['anthropic', 'openai', 'kimi', 'openclaw', 'gemini', 'openjarvis', 'litellm', 'huggingface', 'ollama'];

/** M-06/M-07: Gate-driven provider profile override. Set by actionRunner when gate verdict recommends a profile switch. */
let _gateProviderProfileOverride: LlmProviderProfile | null = null;
export const setGateProviderProfileOverride = (profile: LlmProviderProfile | null): void => {
  _gateProviderProfileOverride = profile;
};
export const getGateProviderProfileOverride = (): LlmProviderProfile | null => _gateProviderProfileOverride;

const reorderByProfile = (chain: LlmProvider[], profile?: LlmProviderProfile): LlmProvider[] => {
  if (!profile) return chain;
  const order = profile === 'cost-optimized' ? COST_OPTIMIZED_ORDER : QUALITY_OPTIMIZED_ORDER;
  return [...chain].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
};

const resolveProviderChain = (
  params: LlmTextRequest,
  selectedProvider: LlmProvider,
  selection: LlmExperimentDecision,
): LlmProvider[] => {
  if (params.provider) {
    return [params.provider];
  }

  const actionPolicy = getActionPolicyProviders(params.actionName);
  const chain = dedupeProviders([
    selectedProvider,
    ...actionPolicy,
    ...getDefaultProviderFallbackChain(),
    resolveProviderWithoutExperiment(),
    ...(LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED ? getAutomaticFallbackOrder() : []),
  ]).filter((provider) => isProviderConfigured(provider));

  const effectiveProfile = params.providerProfile || _gateProviderProfileOverride || resolveWorkflowProfile(params.actionName);
  const profiledChain = reorderByProfile(chain, effectiveProfile);

  // M-06: If workflow model binding specifies a provider, prioritize it
  const workflowBinding = resolveWorkflowModelBinding(params.actionName);
  const bindingPrioritized = workflowBinding && isProviderConfigured(workflowBinding.provider)
    ? dedupeProviders([workflowBinding.provider, ...profiledChain])
    : profiledChain;

  const isHfExperimentArm = selection.experiment?.arm === 'huggingface' && selectedProvider === 'huggingface';
  if (isHfExperimentArm && !LLM_EXPERIMENT_FAIL_OPEN) {
    return ['huggingface'];
  }
  if (isHfExperimentArm) {
    return dedupeProviders(['huggingface', ...bindingPrioritized]).slice(0, LLM_PROVIDER_MAX_ATTEMPTS);
  }

  const bounded = (bindingPrioritized.length > 0 ? bindingPrioritized : [selectedProvider]).slice(0, LLM_PROVIDER_MAX_ATTEMPTS);
  return bounded.length > 0 ? bounded : [selectedProvider];
};

const persistLlmCallLog = async (params: {
  request: LlmTextRequest;
  provider: LlmProvider;
  model?: string;
  latencyMs: number;
  success: boolean;
  errorCode?: string | null;
  outputText?: string;
  avgLogprob?: number;
  experiment?: LlmTextWithMetaResponse['experiment'];
  estimatedCostUsd?: number;
  qualityScore?: number;
}): Promise<void> => {
  if (!LLM_CALL_LOG_ENABLED || !isSupabaseConfigured()) {
    return;
  }

  try {
    const inputChars = String(params.request.system || '').length + String(params.request.user || '').length;
    const outputChars = String(params.outputText || '').length;
    const client = getSupabaseClient();
    await client.from(LLM_CALL_LOG_TABLE).insert({
      guild_id: String(params.request.guildId || '').trim() || null,
      session_id: String(params.request.sessionId || '').trim() || null,
      requested_by: String(params.request.requestedBy || '').trim() || null,
      action_name: String(params.request.actionName || '').trim() || null,
      provider: params.provider,
      model: String(params.model || '').trim() || null,
      experiment_name: String(params.experiment?.name || '').trim() || null,
      experiment_arm: String(params.experiment?.arm || '').trim() || null,
      experiment_key_hash: String(params.experiment?.keyHash || '').trim() || null,
      latency_ms: Math.max(0, Math.trunc(params.latencyMs || 0)),
      success: params.success,
      error_code: String(params.errorCode || '').trim() || null,
      prompt_chars: inputChars,
      output_chars: outputChars,
      avg_logprob: params.avgLogprob ?? null,
      estimated_cost_usd: typeof params.estimatedCostUsd === 'number'
        ? Math.max(0, Number(params.estimatedCostUsd))
        : estimateLlmCallCostUsd(inputChars, outputChars),
      quality_score: typeof params.qualityScore === 'number' ? params.qualityScore : null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // LLM observability logging is best-effort and must not block runtime flow.
  }
};

const fetchWithTimeout = async (input: string, init: RequestInit, timeoutMs?: number): Promise<Response> => {
  const controller = new AbortController();
  const effectiveTimeout = timeoutMs ?? LLM_API_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      await logStructuredError({
        code: 'API_TIMEOUT',
        source: 'llmClient.fetchWithTimeout',
        message: `LLM API timeout after ${effectiveTimeout}ms`,
        meta: { url: input },
      }, error);
      throw new Error('API_TIMEOUT');
    }
    await logStructuredError({
      code: 'LLM_NETWORK_ERROR',
      source: 'llmClient.fetchWithTimeout',
      message: `LLM network error: ${String(error?.message || 'unknown')}`,
      meta: {
        url: input,
        errorName: String(error?.name || ''),
      },
    }, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const isAnyLlmConfigured = (): boolean => Boolean(
  getOpenAiKey()
    || getGeminiKey()
    || getAnthropicKey()
    || isHuggingFaceConfigured()
    || isOpenClawConfigured()
    || isOllamaConfigured()
    || isOpenJarvisConfigured()
    || isLiteLLMConfigured(),
);

export const resolveLlmProvider = (): LlmProvider | null => {
  return resolveProviderWithoutExperiment();
};

const requestOpenAiWithMeta = async (
  params: LlmTextRequest,
  includeLogprobs: boolean,
): Promise<LlmTextWithMetaResponse> => {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');
  }

  const response = await fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model || process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini',
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      ...(includeLogprobs ? { logprobs: true } : {}),
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestOpenAi',
      message: `OPENAI_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'openai', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`OPENAI_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  const tokenLogprobs = Array.isArray(data?.choices?.[0]?.logprobs?.content)
    ? data.choices[0].logprobs.content
        .map((item: Record<string, unknown>) => Number(item?.logprob))
        .filter((n: number) => Number.isFinite(n))
    : [];
  const avgLogprob = tokenLogprobs.length > 0
    ? tokenLogprobs.reduce((acc: number, n: number) => acc + n, 0) / tokenLogprobs.length
    : undefined;

  return {
    text,
    provider: 'openai',
    avgLogprob,
  };
};

const requestGemini = async (params: LlmTextRequest): Promise<string> => {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
  }

  const model = params.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: params.system }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: params.user }],
        },
      ],
      generationConfig: {
        temperature: params.temperature ?? 0.2,
        topP: params.topP,
        maxOutputTokens: params.maxTokens ?? 1000,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestGemini',
      message: `GEMINI_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'gemini', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`GEMINI_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => String(part?.text || '')).join('\n') || '';
  return text.trim();
};

const requestAnthropic = async (params: LlmTextRequest): Promise<string> => {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY_NOT_CONFIGURED');
  }

  const response = await fetchWithTimeout(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model || process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest',
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestAnthropic',
      message: `ANTHROPIC_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'anthropic', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`ANTHROPIC_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((block: any) => String(block?.type || '') === 'text')
    .map((block: any) => String(block?.text || ''))
    .join('\n')
    .trim();
  return text;
};

const requestHuggingFace = async (params: LlmTextRequest): Promise<string> => {
  const apiKey = getHuggingFaceKey();
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY_NOT_CONFIGURED');
  }

  const model = params.model || process.env.HUGGINGFACE_MODEL || process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
  const response = await fetchWithTimeout(HUGGINGFACE_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestHuggingFace',
      message: `HUGGINGFACE_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'huggingface', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`HUGGINGFACE_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.choices?.[0]?.message?.content || '').trim();
};

const requestOpenClaw = async (params: LlmTextRequest): Promise<string> => {
  const baseUrl = getOpenClawBaseUrl();
  if (!baseUrl) {
    throw new Error('OPENCLAW_BASE_URL_NOT_CONFIGURED');
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    await logStructuredError({
      code: 'OPENCLAW_BASE_URL_INVALID',
      source: 'llmClient.requestOpenClaw',
      message: 'OPENCLAW_BASE_URL must start with http:// or https://',
      meta: {
        provider: 'openclaw',
        baseUrlPreview: baseUrl.slice(0, 120),
      },
    });
    throw new Error('OPENCLAW_BASE_URL_INVALID');
  }

  const apiKey = getOpenClawApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const primaryModel = params.model || process.env.OPENCLAW_MODEL || 'openclaw';
  const fallbackModels = getOpenClawFallbackModels().filter((model) => model !== primaryModel);
  const modelsToTry = [primaryModel, ...fallbackModels];

  const isRetryableQuotaError = (status: number, body: string): boolean => {
    if (status === 429) {
      return true;
    }
    const normalized = String(body || '').toLowerCase();
    return normalized.includes('quota')
      || normalized.includes('rate limit')
      || normalized.includes('resource_exhausted')
      || normalized.includes('exceeded your current quota');
  };

  const parseRetryDelayMs = (body: string): number => {
    const text = String(body || '');
    const retryDelayMatch = text.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
    if (retryDelayMatch?.[1]) {
      return Math.max(1_000, Number(retryDelayMatch[1]) * 1000);
    }

    const pleaseRetryMatch = text.match(/Please retry in\s*([0-9.]+)s/i);
    if (pleaseRetryMatch?.[1]) {
      return Math.max(1_000, Math.round(Number(pleaseRetryMatch[1]) * 1000));
    }

    return OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS;
  };

  type FailedAttempt = {
    model: string;
    status: number;
    requestUrl: string;
    body: string;
  };

  const attempts: FailedAttempt[] = [];

  for (let index = 0; index < modelsToTry.length; index += 1) {
    const model = modelsToTry[index];
    const cooldownUntil = openclawModelCooldownUntilMs.get(model) || 0;
    if (cooldownUntil > Date.now()) {
      attempts.push({
        model,
        status: 429,
        requestUrl: `${baseUrl}/v1/chat/completions`,
        body: `MODEL_COOLDOWN_ACTIVE until=${new Date(cooldownUntil).toISOString()}`,
      });
      continue;
    }

    const payload = JSON.stringify({
      model,
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    });

    let requestUrl = `${baseUrl}/v1/chat/completions`;
    let response = await fetchWithTimeout(requestUrl, {
      method: 'POST',
      headers,
      body: payload,
    });

    if (response.status === 404) {
      const firstBody = await response.text();
      const fallbackUrl = `${baseUrl}/chat/completions`;
      const fallbackResponse = await fetchWithTimeout(fallbackUrl, {
        method: 'POST',
        headers,
        body: payload,
      });

      if (fallbackResponse.ok) {
        const data = (await fallbackResponse.json()) as Record<string, any>;
        return String(data?.choices?.[0]?.message?.content || '').trim();
      }

      const fallbackBody = await fallbackResponse.text();
      attempts.push({
        model,
        status: fallbackResponse.status,
        requestUrl: fallbackUrl,
        body: `${firstBody.slice(0, 200)}\n${fallbackBody.slice(0, 200)}`,
      });

      if (isRetryableQuotaError(fallbackResponse.status, fallbackBody)) {
        openclawModelCooldownUntilMs.set(model, Date.now() + parseRetryDelayMs(fallbackBody));
      }

      const canRetry = index < modelsToTry.length - 1 && isRetryableQuotaError(fallbackResponse.status, fallbackBody);
      if (canRetry) {
        continue;
      }
      break;
    }

    if (!response.ok) {
      const body = await response.text();
      attempts.push({ model, status: response.status, requestUrl, body: body.slice(0, 300) });
      if (isRetryableQuotaError(response.status, body)) {
        openclawModelCooldownUntilMs.set(model, Date.now() + parseRetryDelayMs(body));
      }
      const canRetry = index < modelsToTry.length - 1 && isRetryableQuotaError(response.status, body);
      if (canRetry) {
        continue;
      }
      break;
    }

    const data = (await response.json()) as Record<string, any>;
    return String(data?.choices?.[0]?.message?.content || '').trim();
  }

  const last = attempts[attempts.length - 1] || {
    model: primaryModel,
    status: 500,
    requestUrl: `${baseUrl}/v1/chat/completions`,
    body: 'unknown_error',
  };

  await logStructuredError({
    code: 'LLM_REQUEST_FAILED',
    source: 'llmClient.requestOpenClaw',
    message: `OPENCLAW_REQUEST_FAILED status=${last.status}`,
    meta: {
      provider: 'openclaw',
      status: last.status,
      requestUrl: last.requestUrl,
      model: last.model,
      attempts: attempts.map((item) => ({ model: item.model, status: item.status, requestUrl: item.requestUrl })),
      bodyPreview: String(last.body || '').slice(0, 300),
    },
  });
  throw new Error(`OPENCLAW_REQUEST_FAILED: ${String(last.body || '').slice(0, 300)}`);
};

const requestOllama = async (params: LlmTextRequest): Promise<string> => {
  const baseUrl = getOllamaBaseUrl();
  const model = params.model || getOllamaModel() || 'qwen2.5:3b-instruct';

  const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.2,
        top_p: params.topP,
        num_predict: params.maxTokens ?? 1000,
      },
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  }, LLM_API_TIMEOUT_LARGE_MS);

  if (!response.ok) {
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestOllama',
      message: `OLLAMA_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'ollama', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`OLLAMA_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.message?.content || '').trim();
};

const requestOpenAiCompatible = async (
  params: LlmTextRequest,
  baseUrl: string,
  model: string,
  providerName: string,
  apiKey?: string,
): Promise<string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  }, LLM_API_TIMEOUT_LARGE_MS);

  if (!response.ok) {
    const respBody = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: `llmClient.request${providerName}`,
      message: `${providerName.toUpperCase()}_REQUEST_FAILED status=${response.status}`,
      meta: { provider: providerName.toLowerCase(), status: response.status, bodyPreview: respBody.slice(0, 300) },
    });
    throw new Error(`${providerName.toUpperCase()}_REQUEST_FAILED: ${respBody.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.choices?.[0]?.message?.content || '').trim();
};

const requestOpenJarvis = (params: LlmTextRequest): Promise<string> =>
  requestOpenAiCompatible(params, getOpenJarvisServeUrl(), params.model || getOpenJarvisModel() || 'qwen2.5:7b-instruct', 'OpenJarvis');

const requestLiteLLM = (params: LlmTextRequest): Promise<string> =>
  requestOpenAiCompatible(params, getLiteLLMBaseUrl(), params.model || getLiteLLMModel(), 'LiteLLM', getLiteLLMKey() || undefined);

const requestKimi = (params: LlmTextRequest): Promise<string> =>
  requestOpenAiCompatible(params, getKimiBaseUrl(), params.model || getKimiModel(), 'Kimi', getKimiKey());

const computeNormalizedQualityScore = (response: LlmTextWithMetaResponse, latencyMs: number): number => {
  // Latency component: 1.0 at 0ms, 0.0 at 30s+, sigmoid-like decay
  const latencyScore = 1 / (1 + latencyMs / 5000);
  // Logprob component: higher (less negative) avgLogprob = better confidence. Scale [-5..0] to [0..1]
  const logprobScore = typeof response.avgLogprob === 'number' && Number.isFinite(response.avgLogprob)
    ? Math.max(0, Math.min(1, (response.avgLogprob + 5) / 5))
    : 0.5; // neutral when unavailable
  // Completeness component: penalize very short or empty responses
  const outputLen = String(response.text || '').length;
  const completenessScore = outputLen >= 50 ? 1.0 : outputLen >= 10 ? 0.7 : outputLen > 0 ? 0.3 : 0;
  // Weighted combination: latency 25%, confidence 50%, completeness 25%
  return Number((latencyScore * 0.25 + logprobScore * 0.50 + completenessScore * 0.25).toFixed(4));
};

export const generateText = async (params: LlmTextRequest): Promise<string> => {
  const response = await generateTextWithMeta(params);
  return response.text;
};

export const generateTextWithMeta = async (
  params: LlmTextRequest & { includeLogprobs?: boolean },
): Promise<LlmTextWithMetaResponse> => {
  const selection = resolveProviderWithExperiment(params);
  const provider = selection.provider || resolveLlmProvider();
  if (!provider) {
    throw new Error('LLM_PROVIDER_NOT_CONFIGURED');
  }

  const startedAt = Date.now();
  const requestInputChars = String(params.system || '').length + String(params.user || '').length;
  const providerChain = resolveProviderChain(params, provider, selection);
  const providerChainDeadlineMs = startedAt + LLM_PROVIDER_TOTAL_TIMEOUT_MS;

  const cachedWorkflowBinding = resolveWorkflowModelBinding(params.actionName);
  const resolveModel = (p: LlmProvider): string | undefined => {
    if (params.model) return params.model;
    // M-06: Check workflow slot model binding first (cached per-call)
    if (cachedWorkflowBinding && cachedWorkflowBinding.provider === p) return cachedWorkflowBinding.model;
    if (p === 'openai') return process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini';
    if (p === 'gemini') return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (p === 'anthropic') return process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest';
    if (p === 'huggingface') return process.env.HUGGINGFACE_MODEL || process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
    if (p === 'openclaw') return process.env.OPENCLAW_MODEL || 'openclaw';
    if (p === 'ollama') return getOllamaModel() || 'qwen2.5:3b-instruct';
    if (p === 'openjarvis') return getOpenJarvisModel() || 'qwen2.5:7b-instruct';
    if (p === 'litellm') return getLiteLLMModel();
    if (p === 'kimi') return getKimiModel();
    return undefined;
  };

  const callProvider = async (targetProvider: LlmProvider): Promise<LlmTextWithMetaResponse> => {
    if (targetProvider === 'openai') {
      const response = await requestOpenAiWithMeta(params, Boolean(params.includeLogprobs));
      return { ...response, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'anthropic') {
      return { text: await requestAnthropic(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'huggingface') {
      return { text: await requestHuggingFace(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'openclaw') {
      return { text: await requestOpenClaw(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'ollama') {
      return { text: await requestOllama(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'openjarvis') {
      return { text: await requestOpenJarvis(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'litellm') {
      return { text: await requestLiteLLM(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'kimi') {
      return { text: await requestKimi(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    return { text: await requestGemini(params), provider: 'gemini', model: resolveModel('gemini') };
  };

  try {
    let response: LlmTextWithMetaResponse | null = null;
    let lastError: unknown = null;
    let finalProvider: LlmProvider = provider;

    for (const targetProvider of providerChain) {
      if (Date.now() > providerChainDeadlineMs) {
        lastError = new Error('LLM_PROVIDER_CHAIN_TIMEOUT');
        break;
      }
      try {
        response = await callProvider(targetProvider);
        finalProvider = targetProvider;
        break;
      } catch (error) {
        lastError = error;
        finalProvider = targetProvider;
      }
    }

    if (!response) {
      throw (lastError instanceof Error ? lastError : new Error('LLM_REQUEST_FAILED'));
    }

    const latencyMs = Math.max(0, Date.now() - startedAt);
    const estimatedCostUsd = estimateLlmCallCostUsd(requestInputChars, String(response.text || '').length);
    const qualityScore = computeNormalizedQualityScore(response, latencyMs);
    const enriched: LlmTextWithMetaResponse = {
      ...response,
      provider: finalProvider,
      latencyMs,
      estimatedCostUsd,
      experiment: selection.experiment || null,
      normalizedQualityScore: qualityScore,
    };

    void persistLlmCallLog({
      request: params,
      provider: enriched.provider,
      model: enriched.model,
      latencyMs,
      success: true,
      outputText: enriched.text,
      avgLogprob: enriched.avgLogprob,
      experiment: enriched.experiment,
      estimatedCostUsd,
      qualityScore,
    });

    return enriched;
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const message = error instanceof Error ? error.message : String(error);
    void persistLlmCallLog({
      request: params,
      provider,
      model: resolveModel(provider),
      latencyMs,
      success: false,
      errorCode: message.split(':')[0] || 'UNKNOWN',
      experiment: selection.experiment || null,
    });
    throw error;
  }
};
