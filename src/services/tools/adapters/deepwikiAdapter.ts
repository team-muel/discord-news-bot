/**
 * DeepWiki Tool Adapter — exposes DeepWiki MCP API as an ExternalToolAdapter.
 *
 * Provides AI-generated documentation and analysis for public GitHub repositories
 * via the DeepWiki SSE/HTTP API. Used by sprint phases (retro, plan) to reference
 * dependency library architectures and patterns.
 *
 * Capabilities:
 *   - wiki.read: read generated wiki for a public GitHub repo
 *   - wiki.ask: ask a question about a repo's codebase
 *   - wiki.search: search across indexed repositories
 *
 * Environment:
 *   DEEPWIKI_BASE_URL — default https://api.deepwiki.com
 *   DEEPWIKI_TIMEOUT_MS — default 30000 (wiki generation can be slow)
 *   DEEPWIKI_ADAPTER_DISABLED — set true to force-disable (opt-out)
 *   DEEPWIKI_ADAPTER_ENABLED — legacy flag (false = disabled, for backward compat)
 */

import { parseBooleanEnv, parseMinIntEnv, parseUrlEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';
import { getErrorMessage } from '../../../utils/errorMessage';

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.DEEPWIKI_ADAPTER_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.DEEPWIKI_ADAPTER_ENABLED;
const isNotDisabled = (): boolean => !EXPLICITLY_DISABLED && LEGACY_ENABLED_RAW !== 'false';

const BASE_URL = parseUrlEnv(process.env.DEEPWIKI_BASE_URL, 'https://api.deepwiki.com');
const TIMEOUT_MS = parseMinIntEnv(process.env.DEEPWIKI_TIMEOUT_MS, 30_000, 5_000);

// ──── Helpers ─────────────────────────────────────────────────────────────────

const makeResult = (
  ok: boolean,
  action: string,
  summary: string,
  output: string[],
  durationMs: number,
  error?: string,
): ExternalAdapterResult => ({
  ok,
  adapterId: 'deepwiki' as ExternalAdapterId,
  action,
  summary,
  output,
  durationMs,
  ...(error ? { error } : {}),
});

/** Validate owner/repo format to prevent injection in URL paths. */
const REPO_PATTERN = /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/;

const validateRepo = (repo: unknown): string | null => {
  if (typeof repo !== 'string') return null;
  const trimmed = repo.trim();
  if (!REPO_PATTERN.test(trimmed)) return null;
  return trimmed;
};

const fetchDeepWiki = async (
  path: string,
  options?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
};

// ──── Actions ─────────────────────────────────────────────────────────────────

/**
 * Read the generated wiki overview for a public GitHub repository.
 */
const readWiki = async (repo: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const validated = validateRepo(repo);
  if (!validated) {
    return makeResult(false, 'wiki.read', 'Invalid repo format (expected owner/repo)', [], 0, 'INVALID_REPO');
  }

  try {
    const { ok, body, status } = await fetchDeepWiki(`/repo/${encodeURIComponent(validated)}`);
    if (!ok) {
      return makeResult(false, 'wiki.read', `DeepWiki API ${status}`, [], Date.now() - start, `HTTP_${status}`);
    }

    const content = body as Record<string, unknown>;
    const sections: string[] = [];

    if (typeof content?.title === 'string') sections.push(`# ${content.title}`);
    if (typeof content?.description === 'string') sections.push(content.description);
    if (Array.isArray(content?.sections)) {
      for (const sec of content.sections) {
        const s = sec as Record<string, unknown>;
        if (typeof s?.title === 'string') sections.push(`## ${s.title}`);
        if (typeof s?.content === 'string') sections.push(s.content);
      }
    }

    if (sections.length === 0 && typeof content === 'object') {
      sections.push(JSON.stringify(content).slice(0, 4000));
    }

    return makeResult(true, 'wiki.read', `Wiki for ${validated}`, sections, Date.now() - start);
  } catch (err) {
    return makeResult(
      false, 'wiki.read', 'DeepWiki unreachable', [],
      Date.now() - start, getErrorMessage(err),
    );
  }
};

/**
 * Ask a natural language question about a repository's codebase.
 */
const askWiki = async (repo: string, question: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const validated = validateRepo(repo);
  if (!validated) {
    return makeResult(false, 'wiki.ask', 'Invalid repo format', [], 0, 'INVALID_REPO');
  }

  const sanitizedQuestion = String(question || '').trim().slice(0, 1000);
  if (!sanitizedQuestion) {
    return makeResult(false, 'wiki.ask', 'Empty question', [], 0, 'EMPTY_QUESTION');
  }

  try {
    const { ok, body, status } = await fetchDeepWiki(`/repo/${encodeURIComponent(validated)}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question: sanitizedQuestion }),
    });
    if (!ok) {
      return makeResult(false, 'wiki.ask', `DeepWiki API ${status}`, [], Date.now() - start, `HTTP_${status}`);
    }

    const result = body as Record<string, unknown>;
    const answer = typeof result?.answer === 'string' ? result.answer : JSON.stringify(result).slice(0, 4000);

    return makeResult(true, 'wiki.ask', `Answer for ${validated}`, [answer], Date.now() - start);
  } catch (err) {
    return makeResult(
      false, 'wiki.ask', 'DeepWiki unreachable', [],
      Date.now() - start, getErrorMessage(err),
    );
  }
};

/**
 * Search across DeepWiki-indexed repositories.
 */
const searchWiki = async (query: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const sanitizedQuery = String(query || '').trim().slice(0, 500);
  if (!sanitizedQuery) {
    return makeResult(false, 'wiki.search', 'Empty query', [], 0, 'EMPTY_QUERY');
  }

  try {
    const { ok, body, status } = await fetchDeepWiki(`/search?q=${encodeURIComponent(sanitizedQuery)}`);
    if (!ok) {
      return makeResult(false, 'wiki.search', `DeepWiki API ${status}`, [], Date.now() - start, `HTTP_${status}`);
    }

    const results = Array.isArray(body) ? body : ((body as Record<string, unknown>)?.results as unknown[]) || [];
    const summaries = results.slice(0, 10).map((r) => {
      const item = r as Record<string, unknown>;
      return `${item.repo || item.name || 'unknown'}: ${item.description || item.summary || ''}`;
    });

    return makeResult(true, 'wiki.search', `${summaries.length} results`, summaries, Date.now() - start);
  } catch (err) {
    return makeResult(
      false, 'wiki.search', 'DeepWiki unreachable', [],
      Date.now() - start, getErrorMessage(err),
    );
  }
};

// ──── Adapter Export ──────────────────────────────────────────────────────────

export const deepwikiAdapter: ExternalToolAdapter = {
  id: 'deepwiki' as ExternalAdapterId,
  capabilities: ['wiki.read', 'wiki.ask', 'wiki.search'],
  liteCapabilities: ['wiki.read', 'wiki.search'],

  isAvailable: async () => {
    if (!isNotDisabled()) return false;
    // Auto-detect: probe the API with a lightweight request
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetch(`${BASE_URL}/health`, { signal: controller.signal, method: 'GET' });
        // Accept any 2xx/3xx/404 — it means the server is reachable
        return res.status < 500;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  },

  execute: async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
    const repo = String(args.repo || args.repository || '');
    const question = String(args.question || args.query || '');

    switch (action) {
      case 'wiki.read': return readWiki(repo);
      case 'wiki.ask': return askWiki(repo, question);
      case 'wiki.search': return searchWiki(question || repo);
      default:
        return makeResult(false, action, 'Unknown action', [], 0, `UNSUPPORTED_ACTION:${action}`);
    }
  },
};
