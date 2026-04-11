/**
 * DeepWiki Tool Adapter — exposes DeepWiki HTTP API as an ExternalToolAdapter.
 *
 * Provides AI-generated documentation and analysis for public GitHub repositories
 * via the DeepWiki REST/streaming API. Used by sprint phases for architecture
 * reference, review-time defect discovery, and operational diagnostics.
 *
 * Verified against: AsyncFuncAI/deepwiki-open (api/api.py, api/simple_chat.py)
 *
 * Real API endpoints (backend, NOT the Next.js frontend):
 *   GET  /health                       — health check (returns JSON {status:"ok"})
 *   GET  /api/wiki_cache?owner=&repo=&repo_type=&language= — cached wiki data
 *   POST /chat/completions/stream      — ask question (streaming text response)
 *   GET  /api/processed_projects       — list indexed repositories
 *
 * NOTE: deepwiki.com is the public Next.js frontend — it does NOT expose the
 * backend API directly. Self-host DeepWiki and point DEEPWIKI_BASE_URL at the
 * backend (default port 8001) or use the MCP DeepWiki tool for the hosted service.
 *
 * Capabilities:
 *   - wiki.read: read generated wiki for a public GitHub repo
 *   - wiki.ask: ask a question about a repo's codebase
 *   - wiki.search: search across indexed repositories
 *   - wiki.diagnose: ask for repo-specific defect and diagnostic insights
 *
 * Environment:
 *   DEEPWIKI_BASE_URL — default http://localhost:8001 (self-hosted backend)
 *   DEEPWIKI_TIMEOUT_MS — default 30000 (wiki generation can be slow)
 *   DEEPWIKI_ADAPTER_DISABLED — set true to force-disable (opt-out)
 *   DEEPWIKI_ADAPTER_ENABLED — legacy flag (false = disabled, for backward compat)
 */

import { parseBooleanEnv, parseMinIntEnv, parseUrlEnv } from '../../../utils/env';
import { fetchWithTimeout } from '../../../utils/network';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';
import { makeAdapterResult, isAdapterEnabled } from '../externalAdapterTypes';
import { getErrorMessage } from '../../../utils/errorMessage';

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.DEEPWIKI_ADAPTER_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.DEEPWIKI_ADAPTER_ENABLED;
const isNotDisabled = (): boolean => isAdapterEnabled(EXPLICITLY_DISABLED, LEGACY_ENABLED_RAW);

const BASE_URL = parseUrlEnv(process.env.DEEPWIKI_BASE_URL, 'http://localhost:8001');
const TIMEOUT_MS = parseMinIntEnv(process.env.DEEPWIKI_TIMEOUT_MS, 30_000, 5_000);

// ──── Helpers ─────────────────────────────────────────────────────────────────

const ADAPTER_ID = 'deepwiki' as ExternalAdapterId;
const makeResult = (ok: boolean, action: string, summary: string, output: string[], durationMs: number, error?: string): ExternalAdapterResult =>
  makeAdapterResult(ADAPTER_ID, ok, action, summary, output, durationMs, error);

/** Validate owner/repo format to prevent injection in URL paths. */
const REPO_PATTERN = /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/;

const validateRepo = (repo: unknown): string | null => {
  if (typeof repo !== 'string') return null;
  const trimmed = repo.trim();
  if (!REPO_PATTERN.test(trimmed)) return null;
  return trimmed;
};

const sanitizeText = (value: unknown, maxLength: number): string => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
};

const sanitizeChangedFiles = (value: unknown, limit = 10): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeText(item, 180))
      .filter(Boolean)
      .slice(0, limit);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((item) => sanitizeText(item, 180))
      .filter(Boolean)
      .slice(0, limit);
  }
  return [];
};

const getDiagnosticFocus = (phase: string): string => {
  switch (phase) {
    case 'review':
      return 'regressions, edge cases, contract mismatches, and risky assumptions';
    case 'qa':
      return 'test gaps, failure reproduction hints, and missing runtime diagnostics';
    case 'security-audit':
      return 'security boundaries, secret exposure, auth/authz gaps, and unsafe trust assumptions';
    case 'ops-validate':
      return 'startup health, scheduler safety, alerting gaps, rollback confidence, and observability blind spots';
    default:
      return 'repo-specific defects, diagnostics gaps, and validation blind spots';
  }
};

const buildDiagnosticQuestion = (args: Record<string, unknown>): string => {
  const phase = sanitizeText(args.phase, 40).toLowerCase() || 'review';
  const objective = sanitizeText(args.objective ?? args.goal, 400);
  const changedFiles = sanitizeChangedFiles(args.changedFiles ?? args.files);
  const errorSummary = sanitizeText(
    args.errorSummary ?? args.error ?? args.failure ?? args.telemetrySummary,
    1_200,
  );
  const primaryOutput = sanitizeText(
    args.primaryOutput ?? args.context ?? args.analysis,
    1_500,
  );

  const contextLines = [
    `Phase: ${phase}`,
    objective ? `Objective: ${objective}` : '',
    changedFiles.length > 0 ? `Changed files: ${changedFiles.join(', ')}` : '',
    errorSummary ? `Failure or telemetry context: ${errorSummary}` : '',
    primaryOutput ? `Prior analysis: ${primaryOutput}` : '',
  ].filter(Boolean);

  return [
    'Analyze this repository and surface repo-specific defect and diagnostic insights.',
    ...contextLines,
    '',
    `Focus on ${getDiagnosticFocus(phase)}.`,
    'Respond with concise bullets covering:',
    '1. Likely defects or regressions tied to this repository context.',
    '2. Missing diagnostics, observability, or logging blind spots.',
    '3. Missing tests or verification steps that would catch the issue sooner.',
    '4. The single highest-risk file, service boundary, or workflow and why.',
    'Avoid generic advice. Be specific to this repository and the supplied context.',
  ].join('\n');
};

const fetchDeepWiki = async (
  path: string,
  options?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> => {
  const res = await fetchWithTimeout(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  }, TIMEOUT_MS);
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
};

/**
 * Fetch a streaming endpoint and collect all text chunks into a single string.
 * DeepWiki's /chat/completions/stream returns text/event-stream of plain text chunks.
 */
const fetchStreamingText = async (
  path: string,
  options?: RequestInit,
): Promise<{ ok: boolean; status: number; text: string }> => {
  const res = await fetchWithTimeout(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  }, TIMEOUT_MS);
  if (!res.ok) {
    return { ok: false, status: res.status, text: '' };
  }
  const text = await res.text().catch(() => '');
  return { ok: true, status: res.status, text };
};

// ──── Actions ─────────────────────────────────────────────────────────────────

/**
 * Read the generated wiki overview for a public GitHub repository.
 * Real endpoint: GET /api/wiki_cache?owner={owner}&repo={repo}&repo_type=github&language=en
 */
const readWiki = async (repo: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const validated = validateRepo(repo);
  if (!validated) {
    return makeResult(false, 'wiki.read', 'Invalid repo format (expected owner/repo)', [], 0, 'INVALID_REPO');
  }

  const [owner, repoName] = validated.split('/');

  try {
    const params = new URLSearchParams({
      owner, repo: repoName, repo_type: 'github', language: 'en',
    });
    const { ok, body, status } = await fetchDeepWiki(`/api/wiki_cache?${params.toString()}`);
    if (!ok) {
      return makeResult(false, 'wiki.read', `DeepWiki API ${status}`, [], Date.now() - start, `HTTP_${status}`);
    }

    // Response is WikiCacheData: { wiki_structure, generated_pages, repo, provider, model }
    const content = body as Record<string, unknown>;
    const sections: string[] = [];

    // Extract from wiki_structure
    const structure = content?.wiki_structure as Record<string, unknown> | undefined;
    if (structure) {
      if (typeof structure.title === 'string') sections.push(`# ${structure.title}`);
      if (typeof structure.description === 'string') sections.push(structure.description);
      // Extract page summaries from wiki_structure.pages
      if (Array.isArray(structure.pages)) {
        for (const page of structure.pages) {
          const p = page as Record<string, unknown>;
          if (typeof p?.title === 'string') sections.push(`## ${p.title}`);
          if (typeof p?.content === 'string') sections.push(String(p.content).slice(0, 2000));
        }
      }
    }

    // Fallback: try generated_pages map
    if (sections.length === 0) {
      const pages = content?.generated_pages as Record<string, unknown> | undefined;
      if (pages && typeof pages === 'object') {
        for (const [, page] of Object.entries(pages)) {
          const p = page as Record<string, unknown>;
          if (typeof p?.title === 'string') sections.push(`## ${p.title}`);
          if (typeof p?.content === 'string') sections.push(String(p.content).slice(0, 2000));
        }
      }
    }

    if (sections.length === 0 && content && typeof content === 'object') {
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
 * Real endpoint: POST /chat/completions/stream
 * Body: { repo_url, messages: [{role, content}], type: "github", provider: "google" }
 * Returns: streaming text/event-stream (plain text chunks collected into one string)
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
    const { ok, text, status } = await fetchStreamingText('/chat/completions/stream', {
      method: 'POST',
      body: JSON.stringify({
        repo_url: `https://github.com/${validated}`,
        messages: [{ role: 'user', content: sanitizedQuestion }],
        type: 'github',
        provider: 'google',
        language: 'en',
      }),
    });
    if (!ok) {
      return makeResult(false, 'wiki.ask', `DeepWiki API ${status}`, [], Date.now() - start, `HTTP_${status}`);
    }

    const answer = text.trim() || '(empty response)';

    return makeResult(true, 'wiki.ask', `Answer for ${validated}`, [answer], Date.now() - start);
  } catch (err) {
    return makeResult(
      false, 'wiki.ask', 'DeepWiki unreachable', [],
      Date.now() - start, getErrorMessage(err),
    );
  }
};

const diagnoseWiki = async (repo: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
  const result = await askWiki(repo, buildDiagnosticQuestion(args));
  const validated = validateRepo(repo);
  return {
    ...result,
    action: 'wiki.diagnose',
    ...(result.ok ? { summary: `Diagnosis for ${validated ?? repo}` } : {}),
  };
};

/**
 * Search across DeepWiki-indexed repositories.
 * Real endpoint: GET /api/processed_projects
 * Returns: ProcessedProjectEntry[] (id, owner, repo, name, repo_type, submittedAt, language)
 * Note: No server-side query filtering — filter client-side by name match.
 */
const searchWiki = async (query: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const sanitizedQuery = String(query || '').trim().slice(0, 500);
  if (!sanitizedQuery) {
    return makeResult(false, 'wiki.search', 'Empty query', [], 0, 'EMPTY_QUERY');
  }

  try {
    const { ok, body, status } = await fetchDeepWiki('/api/processed_projects');
    if (!ok) {
      return makeResult(false, 'wiki.search', `DeepWiki API ${status}`, [], Date.now() - start, `HTTP_${status}`);
    }

    const projects = Array.isArray(body) ? body : [];
    const lowerQuery = sanitizedQuery.toLowerCase();
    const filtered = projects.filter((p) => {
      const item = p as Record<string, unknown>;
      const name = String(item.name || '').toLowerCase();
      const owner = String(item.owner || '').toLowerCase();
      const repo = String(item.repo || '').toLowerCase();
      return name.includes(lowerQuery) || owner.includes(lowerQuery) || repo.includes(lowerQuery);
    });

    const summaries = filtered.slice(0, 10).map((r) => {
      const item = r as Record<string, unknown>;
      return `${item.name || `${item.owner}/${item.repo}`} (${item.repo_type || 'github'})`;
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
  description: 'DeepWiki — AI-powered repository documentation and diagnostics. Read wiki pages, diagnose risks, ask questions, and search project documentation.',
  capabilities: ['wiki.read', 'wiki.ask', 'wiki.search', 'wiki.diagnose'],
  liteCapabilities: ['wiki.read', 'wiki.search', 'wiki.diagnose'],

  isAvailable: async () => {
    if (!isNotDisabled()) return false;
    // Auto-detect: probe the API with a lightweight request and verify JSON response
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/health`, { method: 'GET' }, 5_000);
      if (!res.ok) return false;
      const ct = res.headers.get('content-type') || '';
      // Reject HTML responses (e.g. deepwiki.com frontend) — we need the backend API
      if (ct.includes('text/html')) return false;
      return true;
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
      case 'wiki.diagnose': return diagnoseWiki(repo, args);
      default:
        return makeResult(false, action, 'Unknown action', [], 0, `UNSUPPORTED_ACTION:${action}`);
    }
  },
};
