/**
 * LLM Provider routing, fallback chains, policy resolution, and experiment logic.
 */
import crypto from 'crypto';
import {
  AI_PROVIDER,
  ANTHROPIC_API_KEY,
  GEMINI_API_KEY,
  LLM_EXPERIMENT_ENABLED,
  LLM_EXPERIMENT_FAIL_OPEN,
  LLM_EXPERIMENT_GUILD_ALLOWLIST_RAW,
  LLM_EXPERIMENT_HF_PERCENT,
  LLM_EXPERIMENT_NAME,
  LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED,
  LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER_RAW,
  LLM_PROVIDER_BASE_ORDER_RAW,
  LLM_PROVIDER_FALLBACK_CHAIN_RAW,
  LLM_PROVIDER_MAX_ATTEMPTS,
  LLM_PROVIDER_POLICY_ACTIONS_RAW,
  LLM_WORKFLOW_MODEL_BINDINGS_RAW,
  LLM_WORKFLOW_PROFILE_DEFAULTS_RAW,
  OPENAI_API_KEY,
  OPENJARVIS_ENABLED,
  LITELLM_ENABLED,
} from '../../config';
import {
  type LlmProvider,
  type LlmProviderProfile,
  type LlmTextRequest,
  type LlmTextWithMetaResponse,
  isHuggingFaceConfigured,
  isKimiConfigured,
  isOllamaConfigured,
  isOpenClawConfigured,
  isProviderConfigured,
} from './providers';

// ──── Internal Types ─────────────────────────────────────────────────────────

export type LlmExperimentDecision = {
  provider: LlmProvider | null;
  experiment: LlmTextWithMetaResponse['experiment'];
};

type ProviderPolicyRule = {
  pattern: string;
  providers: LlmProvider[];
};

type WorkflowModelBinding = { pattern: string; provider: LlmProvider; model: string };

// ──── Provider Alias / Parsing ───────────────────────────────────────────────

const LLM_EXPERIMENT_GUILD_ALLOWLIST = new Set(
  LLM_EXPERIMENT_GUILD_ALLOWLIST_RAW.split(',').map((v) => v.trim()).filter(Boolean),
);

export const normalizeProviderAlias = (value: string): LlmProvider | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'hf') return 'huggingface';
  if (normalized === 'claude') return 'anthropic';
  if (normalized === 'local') return 'ollama';
  if (normalized === 'jarvis') return 'openjarvis';
  if (normalized === 'moonshot') return 'kimi';
  if (normalized === 'openai' || normalized === 'gemini' || normalized === 'anthropic' || normalized === 'openclaw' || normalized === 'ollama' || normalized === 'huggingface' || normalized === 'openjarvis' || normalized === 'litellm' || normalized === 'kimi') {
    return normalized;
  }
  return null;
};

export const parseProviderList = (raw: string): LlmProvider[] => {
  const seen = new Set<LlmProvider>();
  const providers: LlmProvider[] = [];
  for (const token of String(raw || '').split(',')) {
    const provider = normalizeProviderAlias(token);
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    providers.push(provider);
  }
  return providers;
};

// ──── Provider Ordering ──────────────────────────────────────────────────────

const DEFAULT_BASE_PROVIDER_ORDER: LlmProvider[] = ['litellm', 'openclaw', 'ollama', 'anthropic', 'openai', 'gemini', 'kimi', 'huggingface', 'openjarvis'];
const DEFAULT_AUTOMATIC_FALLBACK_ORDER: LlmProvider[] = ['litellm', 'openclaw', 'ollama', 'anthropic', 'openai', 'kimi', 'gemini', 'huggingface', 'openjarvis'];
const COST_OPTIMIZED_ORDER: readonly LlmProvider[] = ['ollama', 'litellm', 'openclaw', 'huggingface', 'openjarvis', 'kimi', 'gemini', 'anthropic', 'openai'];
const QUALITY_OPTIMIZED_ORDER: readonly LlmProvider[] = ['anthropic', 'openai', 'litellm', 'openclaw', 'kimi', 'gemini', 'openjarvis', 'huggingface', 'ollama'];

const getConfiguredBaseProviderOrder = (): LlmProvider[] => {
  const configured = parseProviderList(LLM_PROVIDER_BASE_ORDER_RAW);
  return configured.length > 0 ? configured : DEFAULT_BASE_PROVIDER_ORDER;
};

const getAutomaticFallbackOrder = (): LlmProvider[] => {
  const configured = parseProviderList(LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER_RAW);
  return configured.length > 0 ? configured : DEFAULT_AUTOMATIC_FALLBACK_ORDER;
};

const getDefaultProviderFallbackChain = (): LlmProvider[] => {
  return parseProviderList(LLM_PROVIDER_FALLBACK_CHAIN_RAW);
};

// ──── Action Policy ──────────────────────────────────────────────────────────

const matchActionPattern = (pattern: string, actionName: string): boolean => {
  const normalizedPattern = String(pattern || '').trim().toLowerCase();
  const normalizedAction = String(actionName || '').trim().toLowerCase();
  if (!normalizedPattern || !normalizedAction) return false;
  if (normalizedPattern === normalizedAction) return true;
  if (normalizedPattern.endsWith('*')) {
    const prefix = normalizedPattern.slice(0, -1);
    return prefix.length > 0 && normalizedAction.startsWith(prefix);
  }
  return normalizedAction.startsWith(`${normalizedPattern}.`);
};

const parseActionPolicyRules = (): ProviderPolicyRule[] => {
  if (!LLM_PROVIDER_POLICY_ACTIONS_RAW) return [];
  return LLM_PROVIDER_POLICY_ACTIONS_RAW
    .split(/[;\n]+/).map((line) => line.trim()).filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex < 1) return null;
      const pattern = line.slice(0, separatorIndex).trim().toLowerCase();
      const providers = parseProviderList(line.slice(separatorIndex + 1));
      if (!pattern || providers.length === 0) return null;
      return { pattern, providers };
    })
    .filter((item): item is ProviderPolicyRule => Boolean(item));
};

const ACTION_POLICY_RULES_CACHE_TTL_MS = 5 * 60_000;
let _cachedActionPolicyRules: ProviderPolicyRule[] | null = null;
let _cachedActionPolicyRulesAt = 0;
const getActionPolicyRulesCached = (): ProviderPolicyRule[] => {
  const now = Date.now();
  if (!_cachedActionPolicyRules || (now - _cachedActionPolicyRulesAt) >= ACTION_POLICY_RULES_CACHE_TTL_MS) {
    _cachedActionPolicyRules = parseActionPolicyRules();
    _cachedActionPolicyRulesAt = now;
  }
  return _cachedActionPolicyRules;
};

const getActionPolicyProviders = (actionName?: string): LlmProvider[] => {
  const safeActionName = String(actionName || '').trim();
  const actionPolicyRules = getActionPolicyRulesCached();
  if (!safeActionName || actionPolicyRules.length === 0) return [];

  const seen = new Set<LlmProvider>();
  const providers: LlmProvider[] = [];
  for (const rule of actionPolicyRules) {
    if (!matchActionPattern(rule.pattern, safeActionName)) continue;
    for (const provider of rule.providers) {
      if (seen.has(provider)) continue;
      seen.add(provider);
      providers.push(provider);
    }
  }
  return providers;
};

// ──── Workflow Model Bindings ────────────────────────────────────────────────

const parseWorkflowModelBindings = (): WorkflowModelBinding[] => {
  if (!LLM_WORKFLOW_MODEL_BINDINGS_RAW) return [];
  return LLM_WORKFLOW_MODEL_BINDINGS_RAW
    .split(/[;\n]+/).map((entry) => entry.trim()).filter(Boolean)
    .map((entry) => {
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
    })
    .filter((b): b is WorkflowModelBinding => Boolean(b));
};

let _cachedWorkflowModelBindings: WorkflowModelBinding[] | null = null;
let _cachedWorkflowModelBindingsAt = 0;
const getWorkflowModelBindingsCached = (): WorkflowModelBinding[] => {
  const now = Date.now();
  if (!_cachedWorkflowModelBindings || (now - _cachedWorkflowModelBindingsAt) >= ACTION_POLICY_RULES_CACHE_TTL_MS) {
    _cachedWorkflowModelBindings = parseWorkflowModelBindings();
    _cachedWorkflowModelBindingsAt = now;
  }
  return _cachedWorkflowModelBindings;
};

export const resolveWorkflowModelBinding = (actionName?: string): { provider: LlmProvider; model: string } | null => {
  const safeAction = String(actionName || '').trim();
  if (!safeAction) return null;
  for (const binding of getWorkflowModelBindingsCached()) {
    if (matchActionPattern(binding.pattern, safeAction)) return { provider: binding.provider, model: binding.model };
  }
  return null;
};

const parseWorkflowProfileDefaults = (): Array<{ pattern: string; profile: LlmProviderProfile }> => {
  if (!LLM_WORKFLOW_PROFILE_DEFAULTS_RAW) return [];
  return LLM_WORKFLOW_PROFILE_DEFAULTS_RAW
    .split(/[;\n]+/).map((entry) => entry.trim()).filter(Boolean)
    .map((entry) => {
      const eqIdx = entry.indexOf('=');
      if (eqIdx < 1) return null;
      const pattern = entry.slice(0, eqIdx).trim().toLowerCase();
      const profile = entry.slice(eqIdx + 1).trim() as LlmProviderProfile;
      if (profile !== 'cost-optimized' && profile !== 'quality-optimized') return null;
      return { pattern, profile };
    })
    .filter((p): p is { pattern: string; profile: LlmProviderProfile } => Boolean(p));
};

let _cachedWorkflowProfileDefaults: Array<{ pattern: string; profile: LlmProviderProfile }> | null = null;
let _cachedWorkflowProfileDefaultsAt = 0;
const getWorkflowProfileDefaultsCached = (): Array<{ pattern: string; profile: LlmProviderProfile }> => {
  const now = Date.now();
  if (!_cachedWorkflowProfileDefaults || (now - _cachedWorkflowProfileDefaultsAt) >= ACTION_POLICY_RULES_CACHE_TTL_MS) {
    _cachedWorkflowProfileDefaults = parseWorkflowProfileDefaults();
    _cachedWorkflowProfileDefaultsAt = now;
  }
  return _cachedWorkflowProfileDefaults;
};

const resolveWorkflowProfile = (actionName?: string): LlmProviderProfile | undefined => {
  const safeAction = String(actionName || '').trim();
  if (!safeAction) return undefined;
  for (const rule of getWorkflowProfileDefaultsCached()) {
    if (matchActionPattern(rule.pattern, safeAction)) return rule.profile;
  }
  return undefined;
};

// ──── Gate Profile Override (guild-scoped) ───────────────────────────────────

type GateOverrideEntry = { profile: LlmProviderProfile; setAt: number };
const _gateOverrides = new Map<string, GateOverrideEntry>();
const GATE_PROFILE_OVERRIDE_TTL_MS = 30_000;
const GATE_OVERRIDE_GLOBAL_KEY = '_global';

export const setGateProviderProfileOverride = (profile: LlmProviderProfile | null, guildId?: string): void => {
  const key = String(guildId || '').trim() || GATE_OVERRIDE_GLOBAL_KEY;
  if (profile) {
    _gateOverrides.set(key, { profile, setAt: Date.now() });
  } else {
    _gateOverrides.delete(key);
  }
};

export const getGateProviderProfileOverride = (guildId?: string): LlmProviderProfile | null => {
  const key = String(guildId || '').trim() || GATE_OVERRIDE_GLOBAL_KEY;
  const entry = _gateOverrides.get(key);
  if (!entry) return null;
  if ((Date.now() - entry.setAt) >= GATE_PROFILE_OVERRIDE_TTL_MS) {
    _gateOverrides.delete(key);
    return null;
  }
  return entry.profile;
};

export const resetGateProviderProfileOverride = (): void => {
  _gateOverrides.clear();
};

// ──── Helpers ────────────────────────────────────────────────────────────────

export const dedupeProviders = (providers: Array<LlmProvider | null | undefined>): LlmProvider[] => {
  const seen = new Set<LlmProvider>();
  const out: LlmProvider[] = [];
  for (const provider of providers) {
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    out.push(provider);
  }
  return out;
};

const shortHash = (value: string): string =>
  crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 16);

// ──── Provider Resolution ────────────────────────────────────────────────────

export const resolveProviderWithoutExperiment = (): LlmProvider | null => {
  const preferred = AI_PROVIDER;
  if (preferred === 'gemini' && GEMINI_API_KEY) return 'gemini';
  if (preferred === 'openai' && OPENAI_API_KEY) return 'openai';
  if (preferred === 'anthropic' && ANTHROPIC_API_KEY) return 'anthropic';
  if (preferred === 'claude' && ANTHROPIC_API_KEY) return 'anthropic';
  if ((preferred === 'huggingface' || preferred === 'hf') && isHuggingFaceConfigured()) return 'huggingface';
  if (preferred === 'openclaw' && isOpenClawConfigured()) return 'openclaw';
  if ((preferred === 'ollama' || preferred === 'local') && isOllamaConfigured()) return 'ollama';
  if ((preferred === 'openjarvis' || preferred === 'jarvis') && OPENJARVIS_ENABLED) return 'openjarvis';
  if (preferred === 'litellm' && LITELLM_ENABLED) return 'litellm';
  if ((preferred === 'kimi' || preferred === 'moonshot') && isKimiConfigured()) return 'kimi';

  for (const provider of getConfiguredBaseProviderOrder()) {
    if (isProviderConfigured(provider)) return provider;
  }
  return null;
};

const isExperimentGuildAllowed = (guildId?: string): boolean => {
  const safeGuildId = String(guildId || '').trim();
  if (!safeGuildId) return false;
  if (LLM_EXPERIMENT_GUILD_ALLOWLIST.size === 0) return true;
  return LLM_EXPERIMENT_GUILD_ALLOWLIST.has(safeGuildId);
};

export const resolveProviderWithExperiment = (params: LlmTextRequest): LlmExperimentDecision => {
  if (params.provider) return { provider: params.provider, experiment: null };

  const baseProvider = resolveProviderWithoutExperiment();
  if (!baseProvider) return { provider: null, experiment: null };

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

const reorderByProfile = (chain: LlmProvider[], profile?: LlmProviderProfile): LlmProvider[] => {
  if (!profile) return chain;
  const order = profile === 'cost-optimized' ? COST_OPTIMIZED_ORDER : QUALITY_OPTIMIZED_ORDER;
  return [...chain].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
};

export const resolveProviderChain = (
  params: LlmTextRequest,
  selectedProvider: LlmProvider,
  selection: LlmExperimentDecision,
): LlmProvider[] => {
  if (params.provider) return [params.provider];

  const actionPolicy = getActionPolicyProviders(params.actionName);
  const chain = dedupeProviders([
    selectedProvider,
    ...actionPolicy,
    ...getDefaultProviderFallbackChain(),
    resolveProviderWithoutExperiment(),
    ...(LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED ? getAutomaticFallbackOrder() : []),
  ]).filter((provider) => isProviderConfigured(provider));

  const effectiveProfile = params.providerProfile || getGateProviderProfileOverride(params.guildId) || resolveWorkflowProfile(params.actionName);
  const profiledChain = reorderByProfile(chain, effectiveProfile);

  const workflowBinding = resolveWorkflowModelBinding(params.actionName);
  const bindingPrioritized = workflowBinding && isProviderConfigured(workflowBinding.provider)
    ? dedupeProviders([workflowBinding.provider, ...profiledChain])
    : profiledChain;

  const isHfExperimentArm = selection.experiment?.arm === 'huggingface' && selectedProvider === 'huggingface';
  if (isHfExperimentArm && !LLM_EXPERIMENT_FAIL_OPEN) return ['huggingface'];
  if (isHfExperimentArm) return dedupeProviders(['huggingface', ...bindingPrioritized]).slice(0, LLM_PROVIDER_MAX_ATTEMPTS);

  const bounded = (bindingPrioritized.length > 0 ? bindingPrioritized : [selectedProvider]).slice(0, LLM_PROVIDER_MAX_ATTEMPTS);
  return bounded.length > 0 ? bounded : [selectedProvider];
};

export const resolveLlmProvider = (): LlmProvider | null => resolveProviderWithoutExperiment();
