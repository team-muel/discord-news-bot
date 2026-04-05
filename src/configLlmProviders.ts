/**
 * LLM Provider Configuration
 *
 * All environment variables related to LLM providers, routing, experiments,
 * cost estimation, and response caching are centralized here.
 *
 * Re-exported from config.ts for backward compatibility.
 */
import { parseBooleanEnv, parseIntegerEnv, parseNumberEnv } from './utils/env';

// Primary provider selection
export const AI_PROVIDER = (process.env.AI_PROVIDER || '').trim().toLowerCase();

// Core timeouts & retry
export const LLM_API_TIMEOUT_MS = Math.max(1000, parseIntegerEnv(process.env.LLM_API_TIMEOUT_MS, 15000));
export const LLM_API_TIMEOUT_LARGE_MS = Math.max(LLM_API_TIMEOUT_MS, parseIntegerEnv(process.env.LLM_API_TIMEOUT_LARGE_MS, 90_000));
export const LLM_PROVIDER_TOTAL_TIMEOUT_MS = Math.max(1_000, parseIntegerEnv(process.env.LLM_PROVIDER_TOTAL_TIMEOUT_MS, 25_000));
export const LLM_PROVIDER_MAX_ATTEMPTS = Math.max(1, Math.min(6, parseIntegerEnv(process.env.LLM_PROVIDER_MAX_ATTEMPTS, 3)));
export const LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED = parseBooleanEnv(process.env.LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED, true);
export const LLM_HEDGE_DELAY_MS = Math.max(0, parseIntegerEnv(process.env.LLM_HEDGE_DELAY_MS, 3000));

// Call logging
export const LLM_CALL_LOG_ENABLED = parseBooleanEnv(process.env.LLM_CALL_LOG_ENABLED, true);
export const LLM_CALL_LOG_TABLE = (process.env.LLM_CALL_LOG_TABLE || 'agent_llm_call_logs').trim();

// A/B Experiment
export const LLM_EXPERIMENT_ENABLED = parseBooleanEnv(process.env.LLM_EXPERIMENT_ENABLED, false);
export const LLM_EXPERIMENT_NAME = (process.env.LLM_EXPERIMENT_NAME || 'hf_ab_v1').trim();
export const LLM_EXPERIMENT_HF_PERCENT = Math.max(0, Math.min(100, parseIntegerEnv(process.env.LLM_EXPERIMENT_HF_PERCENT, 20)));
export const LLM_EXPERIMENT_FAIL_OPEN = parseBooleanEnv(process.env.LLM_EXPERIMENT_FAIL_OPEN, true);
export const LLM_EXPERIMENT_GUILD_ALLOWLIST_RAW = (process.env.LLM_EXPERIMENT_GUILD_ALLOWLIST || '').trim();

// Cost estimation
export const LLM_COST_INPUT_PER_1K_CHARS_USD = Math.max(0, parseNumberEnv(process.env.LLM_COST_INPUT_PER_1K_CHARS_USD, 0.0005));
export const LLM_COST_OUTPUT_PER_1K_CHARS_USD = Math.max(0, parseNumberEnv(process.env.LLM_COST_OUTPUT_PER_1K_CHARS_USD, 0.0015));

// Response cache
export const LLM_RESPONSE_CACHE_ENABLED = parseBooleanEnv(process.env.LLM_RESPONSE_CACHE_ENABLED, true);
export const LLM_RESPONSE_CACHE_TTL_MS = Math.max(1_000, parseIntegerEnv(process.env.LLM_RESPONSE_CACHE_TTL_MS, 60_000));
export const LLM_RESPONSE_CACHE_MAX_ENTRIES = Math.max(10, parseIntegerEnv(process.env.LLM_RESPONSE_CACHE_MAX_ENTRIES, 200));

// Provider ordering (raw strings — parsed by routing layer)
export const LLM_PROVIDER_BASE_ORDER_RAW = (process.env.LLM_PROVIDER_BASE_ORDER || '').trim();
export const LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER_RAW = (process.env.LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER || '').trim();
export const LLM_PROVIDER_FALLBACK_CHAIN_RAW = (process.env.LLM_PROVIDER_FALLBACK_CHAIN || '').trim();
export const LLM_PROVIDER_POLICY_ACTIONS_RAW = (process.env.LLM_PROVIDER_POLICY_ACTIONS || '').trim();
export const LLM_WORKFLOW_MODEL_BINDINGS_RAW = (process.env.LLM_WORKFLOW_MODEL_BINDINGS || '').trim();
export const LLM_WORKFLOW_PROFILE_DEFAULTS_RAW = (process.env.LLM_WORKFLOW_PROFILE_DEFAULTS || '').trim();

// ── OpenAI ──
export const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
export const OPENAI_ANALYSIS_MODEL = (process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini').trim();

// ── Gemini ──
export const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
export const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

// ── Anthropic ──
export const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
export const ANTHROPIC_VERSION = (process.env.ANTHROPIC_VERSION || '2023-06-01').trim();
export const ANTHROPIC_MODEL = (process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest').trim();

// ── HuggingFace ──
export const HF_TOKEN = (process.env.HF_TOKEN || process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY || '').trim();
export const HUGGINGFACE_CHAT_COMPLETIONS_URL = (process.env.HUGGINGFACE_CHAT_COMPLETIONS_URL || 'https://router.huggingface.co/v1/chat/completions').trim();
export const HUGGINGFACE_MODEL = (process.env.HUGGINGFACE_MODEL || process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct').trim();

// ── OpenClaw ──
export const OPENCLAW_API_KEY = (process.env.OPENCLAW_API_KEY || process.env.OPENCLAW_KEY || '').trim();
export const OPENCLAW_BASE_URL = (process.env.OPENCLAW_BASE_URL || process.env.OPENCLAW_API_BASE_URL || process.env.OPENCLAW_URL || '').trim().replace(/\/+$/, '');
export const OPENCLAW_MODEL = (process.env.OPENCLAW_MODEL || 'openclaw').trim();
export const OPENCLAW_FALLBACK_MODELS_RAW = (process.env.OPENCLAW_FALLBACK_MODELS || 'muel-fast,muel-precise').trim();
export const OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS = Math.max(1_000, parseIntegerEnv(process.env.OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS, 45_000));
export const OPENCLAW_GATEWAY_URL = (process.env.OPENCLAW_GATEWAY_URL || '').trim().replace(/\/+$/, '');
export const OPENCLAW_GATEWAY_TOKEN = (process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
export const OPENCLAW_GATEWAY_ENABLED = parseBooleanEnv(process.env.OPENCLAW_GATEWAY_ENABLED, true);
export const OPENCLAW_ENABLED = parseBooleanEnv(process.env.OPENCLAW_ENABLED, false);
export const OPENCLAW_DISABLED = parseBooleanEnv(process.env.OPENCLAW_DISABLED, false);
export const OPENCLAW_LACUNA_SKILL_CREATE_ENABLED = parseBooleanEnv(process.env.OPENCLAW_LACUNA_SKILL_CREATE_ENABLED, false);

// ── NemoClaw ──
export const NEMOCLAW_ENABLED = parseBooleanEnv(process.env.NEMOCLAW_ENABLED, false);
export const NEMOCLAW_DISABLED = parseBooleanEnv(process.env.NEMOCLAW_DISABLED, false);
export const NEMOCLAW_SANDBOX_NAME = String(process.env.NEMOCLAW_SANDBOX_NAME || 'muel-assistant').replace(/[^a-zA-Z0-9._-]/g, '').trim();
export const NEMOCLAW_INFERENCE_MODEL = String(process.env.NEMOCLAW_INFERENCE_MODEL || 'qwen2.5:7b-instruct').trim();
export const NEMOCLAW_SANDBOX_OLLAMA_URL = String(process.env.NEMOCLAW_SANDBOX_OLLAMA_URL || 'http://localhost:11434').trim();

// ── OpenShell ──
export const OPENSHELL_ENABLED = parseBooleanEnv(process.env.OPENSHELL_ENABLED, false);
export const OPENSHELL_DISABLED = parseBooleanEnv(process.env.OPENSHELL_DISABLED, false);
export const OPENSHELL_REMOTE_GATEWAY = String(process.env.OPENSHELL_REMOTE_GATEWAY || '').trim().replace(/[^a-zA-Z0-9@._:-]/g, '');
export const OPENSHELL_SANDBOX_DELEGATION = parseBooleanEnv(process.env.OPENSHELL_SANDBOX_DELEGATION, false);
export const OPENSHELL_DEFAULT_SANDBOX_ID = String(process.env.OPENSHELL_DEFAULT_SANDBOX_ID || '').trim();
export const OPENSHELL_DEFAULT_SANDBOX_IMAGE = String(process.env.OPENSHELL_DEFAULT_SANDBOX_IMAGE || 'ollama').trim();

// ── Shared (WSL) ──
export const WSL_DISTRO = String(process.env.WSL_DISTRO || 'Ubuntu-24.04').replace(/[^a-zA-Z0-9._-]/g, '');

// ── MCP Tool Names ──
export const MCP_OPENCODE_TOOL_NAME = String(process.env.MCP_OPENCODE_TOOL_NAME || 'opencode.run').trim() || 'opencode.run';

// ── Ollama ──
export const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
export const OLLAMA_MODEL = (process.env.OLLAMA_MODEL || process.env.LOCAL_LLM_MODEL || '').trim();

// ── OpenJarvis ──
export const OPENJARVIS_SERVE_URL = (process.env.OPENJARVIS_SERVE_URL || 'http://127.0.0.1:8000').trim().replace(/\/+$/, '');
export const OPENJARVIS_ENABLED = parseBooleanEnv(process.env.OPENJARVIS_ENABLED, false);
export const OPENJARVIS_DISABLED = parseBooleanEnv(process.env.OPENJARVIS_DISABLED, false);
export const OPENJARVIS_MODEL = (process.env.OPENJARVIS_MODEL || '').trim();

// ── LiteLLM ──
export const LITELLM_BASE_URL = (process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000').trim().replace(/\/+$/, '');
export const LITELLM_MASTER_KEY = (process.env.LITELLM_MASTER_KEY || '').trim();
// Auto-enable when LITELLM_BASE_URL is explicitly set to a non-localhost value,
// so operators don't need to remember a separate LITELLM_ENABLED=true flag.
const litellmUrlExplicit = Boolean(process.env.LITELLM_BASE_URL && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(LITELLM_BASE_URL));
export const LITELLM_ENABLED = parseBooleanEnv(process.env.LITELLM_ENABLED, litellmUrlExplicit);
export const LITELLM_MODEL = (process.env.LITELLM_MODEL || 'muel-balanced').trim();

// ── Kimi ──
export const KIMI_API_KEY = (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '').trim();
export const KIMI_BASE_URL = (process.env.KIMI_BASE_URL || 'https://api.moonshot.cn').trim().replace(/\/+$/, '');
export const KIMI_MODEL = (process.env.KIMI_MODEL || 'moonshot-v1-128k').trim();
