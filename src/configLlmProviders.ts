/**
 * LLM Provider Configuration
 *
 * All environment variables related to LLM providers, routing, experiments,
 * cost estimation, and response caching are centralized here.
 *
 * Re-exported from config.ts for backward compatibility.
 */
import { parseBooleanEnv, parseBoundedNumberEnv, parseIntegerEnv, parseMinIntEnv, parseMinNumberEnv, parseStringEnv, parseUrlEnv } from './utils/env';

// Primary provider selection
export const AI_PROVIDER = parseStringEnv(process.env.AI_PROVIDER, '').toLowerCase();

// Core timeouts & retry
export const LLM_API_TIMEOUT_MS = parseMinIntEnv(process.env.LLM_API_TIMEOUT_MS, 15000, 1000);
export const LLM_API_TIMEOUT_LARGE_MS = Math.max(LLM_API_TIMEOUT_MS, parseIntegerEnv(process.env.LLM_API_TIMEOUT_LARGE_MS, 90_000));
export const LLM_PROVIDER_TOTAL_TIMEOUT_MS = parseMinIntEnv(process.env.LLM_PROVIDER_TOTAL_TIMEOUT_MS, 25_000, 1_000);
export const LLM_PROVIDER_MAX_ATTEMPTS = parseBoundedNumberEnv(process.env.LLM_PROVIDER_MAX_ATTEMPTS, 3, 1, 6);
export const LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED = parseBooleanEnv(process.env.LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED, true);
export const LLM_HEDGE_DELAY_MS = parseMinIntEnv(process.env.LLM_HEDGE_DELAY_MS, 3000, 0);

// Call logging
export const LLM_CALL_LOG_ENABLED = parseBooleanEnv(process.env.LLM_CALL_LOG_ENABLED, true);
export const LLM_CALL_LOG_TABLE = parseStringEnv(process.env.LLM_CALL_LOG_TABLE, 'agent_llm_call_logs');

// A/B Experiment
export const LLM_EXPERIMENT_ENABLED = parseBooleanEnv(process.env.LLM_EXPERIMENT_ENABLED, false);
export const LLM_EXPERIMENT_NAME = parseStringEnv(process.env.LLM_EXPERIMENT_NAME, 'hf_ab_v1');
export const LLM_EXPERIMENT_HF_PERCENT = parseBoundedNumberEnv(process.env.LLM_EXPERIMENT_HF_PERCENT, 20, 0, 100);
export const LLM_EXPERIMENT_FAIL_OPEN = parseBooleanEnv(process.env.LLM_EXPERIMENT_FAIL_OPEN, true);
export const LLM_EXPERIMENT_GUILD_ALLOWLIST_RAW = parseStringEnv(process.env.LLM_EXPERIMENT_GUILD_ALLOWLIST, '');

// Cost estimation
export const LLM_COST_INPUT_PER_1K_CHARS_USD = parseMinNumberEnv(process.env.LLM_COST_INPUT_PER_1K_CHARS_USD, 0.0005, 0);
export const LLM_COST_OUTPUT_PER_1K_CHARS_USD = parseMinNumberEnv(process.env.LLM_COST_OUTPUT_PER_1K_CHARS_USD, 0.0015, 0);

// Response cache
export const LLM_RESPONSE_CACHE_ENABLED = parseBooleanEnv(process.env.LLM_RESPONSE_CACHE_ENABLED, true);
export const LLM_RESPONSE_CACHE_TTL_MS = parseMinIntEnv(process.env.LLM_RESPONSE_CACHE_TTL_MS, 60_000, 1_000);
export const LLM_RESPONSE_CACHE_MAX_ENTRIES = parseMinIntEnv(process.env.LLM_RESPONSE_CACHE_MAX_ENTRIES, 200, 10);

// Provider ordering (raw strings — parsed by routing layer)
export const LLM_PROVIDER_BASE_ORDER_RAW = parseStringEnv(process.env.LLM_PROVIDER_BASE_ORDER, '');
export const LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER_RAW = parseStringEnv(process.env.LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER, '');
export const LLM_PROVIDER_FALLBACK_CHAIN_RAW = parseStringEnv(process.env.LLM_PROVIDER_FALLBACK_CHAIN, '');
export const LLM_PROVIDER_POLICY_ACTIONS_RAW = parseStringEnv(process.env.LLM_PROVIDER_POLICY_ACTIONS, '');
export const LLM_WORKFLOW_MODEL_BINDINGS_RAW = parseStringEnv(process.env.LLM_WORKFLOW_MODEL_BINDINGS, '');
export const LLM_WORKFLOW_PROFILE_DEFAULTS_RAW = parseStringEnv(process.env.LLM_WORKFLOW_PROFILE_DEFAULTS, '');

// ── OpenAI ──
export const OPENAI_API_KEY = parseStringEnv(process.env.OPENAI_API_KEY, '');
export const OPENAI_ANALYSIS_MODEL = parseStringEnv(process.env.OPENAI_ANALYSIS_MODEL, 'gpt-4o-mini');

// ── Gemini ──
export const GEMINI_API_KEY = parseStringEnv(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY, '');
export const GEMINI_MODEL = parseStringEnv(process.env.GEMINI_MODEL, 'gemini-2.5-flash');

// ── Anthropic ──
export const ANTHROPIC_API_KEY = parseStringEnv(process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY, '');
export const ANTHROPIC_VERSION = parseStringEnv(process.env.ANTHROPIC_VERSION, '2023-06-01');
export const ANTHROPIC_MODEL = parseStringEnv(process.env.ANTHROPIC_MODEL ?? process.env.CLAUDE_MODEL, 'claude-3-5-haiku-latest');

// ── HuggingFace ──
// Note: HF_TOKEN, HF_API_KEY, HUGGINGFACE_API_KEY are all accepted aliases to avoid silent breakage.
export const HF_TOKEN = parseStringEnv(process.env.HF_TOKEN ?? process.env.HF_API_KEY ?? process.env.HUGGINGFACE_API_KEY, '');
export const HUGGINGFACE_CHAT_COMPLETIONS_URL = parseStringEnv(process.env.HUGGINGFACE_CHAT_COMPLETIONS_URL, 'https://router.huggingface.co/v1/chat/completions');
export const HUGGINGFACE_MODEL = parseStringEnv(process.env.HUGGINGFACE_MODEL ?? process.env.HF_MODEL, 'Qwen/Qwen2.5-7B-Instruct');

// ── OpenClaw ──
export const OPENCLAW_API_KEY = parseStringEnv(process.env.OPENCLAW_API_KEY ?? process.env.OPENCLAW_KEY, '');
export const OPENCLAW_BASE_URL = parseUrlEnv(process.env.OPENCLAW_BASE_URL ?? process.env.OPENCLAW_API_BASE_URL ?? process.env.OPENCLAW_URL, '');
export const OPENCLAW_MODEL = parseStringEnv(process.env.OPENCLAW_MODEL, 'openclaw');
export const OPENCLAW_FALLBACK_MODELS_RAW = parseStringEnv(process.env.OPENCLAW_FALLBACK_MODELS, 'muel-fast,muel-precise');
export const OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS = parseMinIntEnv(process.env.OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS, 45_000, 1_000);
export const OPENCLAW_GATEWAY_URL = parseUrlEnv(process.env.OPENCLAW_GATEWAY_URL, '');
export const OPENCLAW_GATEWAY_TOKEN = parseStringEnv(process.env.OPENCLAW_GATEWAY_TOKEN, '');
export const OPENCLAW_GATEWAY_ENABLED = parseBooleanEnv(process.env.OPENCLAW_GATEWAY_ENABLED, true);
export const OPENCLAW_ENABLED = parseBooleanEnv(process.env.OPENCLAW_ENABLED, false);
export const OPENCLAW_DISABLED = parseBooleanEnv(process.env.OPENCLAW_DISABLED, false);
export const OPENCLAW_LACUNA_SKILL_CREATE_ENABLED = parseBooleanEnv(process.env.OPENCLAW_LACUNA_SKILL_CREATE_ENABLED, false);

// ── NemoClaw ──
export const NEMOCLAW_ENABLED = parseBooleanEnv(process.env.NEMOCLAW_ENABLED, false);
export const NEMOCLAW_DISABLED = parseBooleanEnv(process.env.NEMOCLAW_DISABLED, false);
// Characters filtered for shell-safe use in sandbox/gateway identifiers.
export const NEMOCLAW_SANDBOX_NAME = parseStringEnv(process.env.NEMOCLAW_SANDBOX_NAME, 'muel-assistant').replace(/[^a-zA-Z0-9._-]/g, '');
export const NEMOCLAW_INFERENCE_MODEL = parseStringEnv(process.env.NEMOCLAW_INFERENCE_MODEL, 'qwen2.5:7b-instruct');
export const NEMOCLAW_SANDBOX_OLLAMA_URL = parseStringEnv(process.env.NEMOCLAW_SANDBOX_OLLAMA_URL, 'http://localhost:11434');

// ── OpenShell ──
export const OPENSHELL_ENABLED = parseBooleanEnv(process.env.OPENSHELL_ENABLED, false);
export const OPENSHELL_DISABLED = parseBooleanEnv(process.env.OPENSHELL_DISABLED, false);
// Characters filtered for shell-safe SSH host format (user@host:port).
export const OPENSHELL_REMOTE_GATEWAY = parseStringEnv(process.env.OPENSHELL_REMOTE_GATEWAY, '').replace(/[^a-zA-Z0-9@._:-]/g, '');
export const OPENSHELL_SANDBOX_DELEGATION = parseBooleanEnv(process.env.OPENSHELL_SANDBOX_DELEGATION, false);
export const OPENSHELL_DEFAULT_SANDBOX_ID = parseStringEnv(process.env.OPENSHELL_DEFAULT_SANDBOX_ID, '');
export const OPENSHELL_DEFAULT_SANDBOX_IMAGE = parseStringEnv(process.env.OPENSHELL_DEFAULT_SANDBOX_IMAGE, 'ollama');

// ── Shared (WSL) ──
// Characters filtered to keep WSL distro name shell-safe.
export const WSL_DISTRO = parseStringEnv(process.env.WSL_DISTRO, 'Ubuntu-24.04').replace(/[^a-zA-Z0-9._-]/g, '');

// ── MCP Tool Names ──
export const MCP_OPENCODE_TOOL_NAME = parseStringEnv(process.env.MCP_OPENCODE_TOOL_NAME, 'opencode.run');

// ── Ollama ──
export const OLLAMA_BASE_URL = parseUrlEnv(process.env.OLLAMA_BASE_URL, 'http://127.0.0.1:11434');
export const OLLAMA_MODEL = parseStringEnv(process.env.OLLAMA_MODEL ?? process.env.LOCAL_LLM_MODEL, '');

// ── OpenJarvis ──
export const OPENJARVIS_SERVE_URL = parseUrlEnv(process.env.OPENJARVIS_SERVE_URL, 'http://127.0.0.1:8000');
export const OPENJARVIS_ENABLED = parseBooleanEnv(process.env.OPENJARVIS_ENABLED, false);
export const OPENJARVIS_DISABLED = parseBooleanEnv(process.env.OPENJARVIS_DISABLED, false);
export const OPENJARVIS_MODEL = parseStringEnv(process.env.OPENJARVIS_MODEL, '');

// ── LiteLLM ──
export const LITELLM_BASE_URL = parseUrlEnv(process.env.LITELLM_BASE_URL, 'http://127.0.0.1:4000');
export const LITELLM_MASTER_KEY = parseStringEnv(process.env.LITELLM_MASTER_KEY, '');
// Auto-enable when LITELLM_BASE_URL is explicitly set to a non-localhost value,
// so operators don't need to remember a separate LITELLM_ENABLED=true flag.
// process.env.LITELLM_BASE_URL is checked directly here (not the parsed constant)
// to distinguish "explicitly provided" from "defaulted by parseUrlEnv".
const litellmUrlExplicit = Boolean(process.env.LITELLM_BASE_URL) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(LITELLM_BASE_URL);
export const LITELLM_ENABLED = parseBooleanEnv(process.env.LITELLM_ENABLED, litellmUrlExplicit);
export const LITELLM_MODEL = parseStringEnv(process.env.LITELLM_MODEL, 'muel-balanced');

// ── Kimi ──
export const KIMI_API_KEY = parseStringEnv(process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY, '');
export const KIMI_BASE_URL = parseUrlEnv(process.env.KIMI_BASE_URL, 'https://api.moonshot.cn');
export const KIMI_MODEL = parseStringEnv(process.env.KIMI_MODEL, 'moonshot-v1-128k');
