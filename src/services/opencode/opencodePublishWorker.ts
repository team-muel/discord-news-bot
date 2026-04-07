import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { acquireDistributedLease, releaseDistributedLease } from '../infra/distributedLockService';
import { getErrorMessage } from '../../utils/errorMessage';

type PublishJobRow = {
  id: number;
  guild_id: string;
  change_request_id: number;
  requested_by: string;
  status: string;
  provider: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
};

type ChangeRequestRow = {
  id: number;
  guild_id: string;
  title: string;
  summary: string | null;
  target_base_branch: string;
  proposed_branch: string | null;
  status: string;
  risk_tier: string | null;
  score_card: Record<string, unknown> | null;
  evidence_bundle_id: string | null;
  diff_patch: string | null;
};

type DiffHunk = {
  oldStart: number;
  lines: string[];
};

type DiffFile = {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
};

class PublishWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'PublishWorkerError';
    this.code = code;
    this.retryable = retryable;
  }
}

const CHANGE_REQUEST_TABLE = String(process.env.OPENCODE_CHANGE_REQUEST_TABLE || 'agent_opencode_change_requests').trim();
const PUBLISH_QUEUE_TABLE = String(process.env.OPENCODE_PUBLISH_QUEUE_TABLE || 'agent_opencode_publish_queue').trim();

const WORKER_ENABLED = parseBooleanEnv(process.env.OPENCODE_PUBLISH_WORKER_ENABLED, false);
const WORKER_INTERVAL_MS = Math.max(2000, parseIntegerEnv(process.env.OPENCODE_PUBLISH_WORKER_INTERVAL_MS, 5000));
const WORKER_BATCH_SIZE = Math.max(1, Math.min(10, parseIntegerEnv(process.env.OPENCODE_PUBLISH_WORKER_BATCH_SIZE, 2)));
const WORKER_MAX_ATTEMPTS = Math.max(1, Math.min(10, parseIntegerEnv(process.env.OPENCODE_PUBLISH_MAX_ATTEMPTS, 3)));
const WORKER_STALE_RUNNING_MS = Math.max(60_000, parseIntegerEnv(process.env.OPENCODE_PUBLISH_STALE_RUNNING_MS, 900_000));
const WORKER_LOCK_ENABLED = parseBooleanEnv(process.env.OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED, true);
const WORKER_LOCK_FAIL_OPEN = parseBooleanEnv(process.env.OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN, false);
const WORKER_LOCK_LEASE_MS = Math.max(
  Math.max(30_000, WORKER_INTERVAL_MS * 3),
  parseIntegerEnv(process.env.OPENCODE_PUBLISH_DISTRIBUTED_LOCK_LEASE_MS, Math.max(30_000, WORKER_INTERVAL_MS * 3)),
);
const WORKER_LOCK_NAME = String(process.env.OPENCODE_PUBLISH_DISTRIBUTED_LOCK_NAME || 'opencode.publish.worker').trim();
const WORKER_LOCK_OWNER = `opencode-publish:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;

const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const DEFAULT_REPO_OWNER = String(process.env.OPENCODE_TARGET_REPO_OWNER || '').trim();
const DEFAULT_REPO_NAME = String(process.env.OPENCODE_TARGET_REPO_NAME || '').trim();
const REQUIRE_EVIDENCE_FOR_HIGH_RISK = parseBooleanEnv(process.env.OPENCODE_PUBLISH_REQUIRE_EVIDENCE_FOR_HIGH_RISK, true);
const MIN_SCORE_CARD_TOTAL = Number.isFinite(Number(process.env.OPENCODE_PUBLISH_MIN_SCORE_CARD_TOTAL))
  ? Math.max(0, Math.min(100, Number(process.env.OPENCODE_PUBLISH_MIN_SCORE_CARD_TOTAL)))
  : 0;
const PATCH_MAX_FILES = Math.max(1, Math.min(500, parseIntegerEnv(process.env.OPENCODE_PUBLISH_PATCH_MAX_FILES, 120)));
const PATCH_MAX_LINES = Math.max(10, Math.min(20_000, parseIntegerEnv(process.env.OPENCODE_PUBLISH_PATCH_MAX_LINES, 4000)));

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let started = false;

const TOOL_LEARNING_LOG_TABLE = String(process.env.TOOL_LEARNING_LOG_TABLE || 'agent_tool_learning_logs').trim();

const nowIso = () => new Date().toISOString();

const toRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const toText = (value: unknown, fallback = ''): string => {
  const text = String(value || '').trim();
  return text || fallback;
};

const toLower = (value: unknown): string => String(value || '').trim().toLowerCase();

const parseScoreCardTotal = (value: unknown): number | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const candidates = [row.total, row.totalScore, row.total_score, row.overall, row.overallScore];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const getAttemptCount = (job: PublishJobRow): number => {
  const result = toRecord(job.result);
  const attempts = Number(result.attempts);
  if (Number.isFinite(attempts) && attempts >= 0) {
    return Math.trunc(attempts);
  }
  return 0;
};

const recordLearningSignal = async (params: {
  guildId: string;
  requestedBy: string;
  toolName: string;
  outcomeScore: number;
  reason: string;
  metadata: Record<string, unknown>;
}) => {
  try {
    const client = getSupabaseClient();
    await client.from(TOOL_LEARNING_LOG_TABLE).insert({
      guild_id: params.guildId,
      requested_by: toText(params.requestedBy, 'opencode-publish-worker').slice(0, 120),
      scope: 'task_routing',
      tool_name: toText(params.toolName, 'opencode.publish').slice(0, 120),
      input_text: null,
      output_summary: toText(params.reason, '').slice(0, 500),
      outcome_score: Math.max(0, Math.min(1, Number(params.outcomeScore))),
      reason: toText(params.reason, '').slice(0, 500),
      metadata: params.metadata,
      created_at: nowIso(),
    });
  } catch {
    // Best-effort learning signal must not break publish path.
  }
};

const parseDiffFiles = (diffPatch: string): DiffFile[] => {
  const lines = diffPatch.replace(/\r\n/g, '\n').split('\n');
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  const pushCurrent = () => {
    if (current) {
      files.push(current);
    }
    current = null;
    currentHunk = null;
  };

  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      pushCurrent();
      current = {
        oldPath: fileMatch[1],
        newPath: fileMatch[2],
        hunks: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('--- ')) {
      const raw = line.slice(4).trim();
      current.oldPath = raw === '/dev/null' ? '/dev/null' : raw.replace(/^a\//, '');
      continue;
    }

    if (line.startsWith('+++ ')) {
      const raw = line.slice(4).trim();
      current.newPath = raw === '/dev/null' ? '/dev/null' : raw.replace(/^b\//, '');
      continue;
    }

    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hunkMatch) {
      currentHunk = {
        oldStart: Number(hunkMatch[1]),
        lines: [],
      };
      current.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-')) {
      currentHunk.lines.push(line);
      continue;
    }

    if (line.startsWith('\\ No newline at end of file')) {
      continue;
    }
  }

  pushCurrent();
  return files;
};

const applyDiffFile = (file: DiffFile, originalContent: string | null): { mode: 'upsert' | 'delete'; content: string | null } => {
  if (file.newPath === '/dev/null') {
    return { mode: 'delete', content: null };
  }

  const originalLines = (file.oldPath === '/dev/null' || originalContent === null)
    ? []
    : originalContent.replace(/\r\n/g, '\n').split('\n');

  const out: string[] = [];
  let cursor = 1;

  for (const hunk of file.hunks) {
    while (cursor < hunk.oldStart && cursor <= originalLines.length) {
      out.push(originalLines[cursor - 1]);
      cursor += 1;
    }

    for (const entry of hunk.lines) {
      const op = entry[0];
      const value = entry.slice(1);
      if (op === ' ') {
        const actual = originalLines[cursor - 1];
        if (actual !== value) {
          throw new PublishWorkerError('PATCH_CONTEXT_MISMATCH', `Context mismatch on ${file.newPath}`, false);
        }
        out.push(value);
        cursor += 1;
        continue;
      }
      if (op === '-') {
        const actual = originalLines[cursor - 1];
        if (actual !== value) {
          throw new PublishWorkerError('PATCH_DELETE_MISMATCH', `Delete mismatch on ${file.newPath}`, false);
        }
        cursor += 1;
        continue;
      }
      if (op === '+') {
        out.push(value);
      }
    }
  }

  while (cursor <= originalLines.length) {
    out.push(originalLines[cursor - 1]);
    cursor += 1;
  }

  return {
    mode: 'upsert',
    content: out.join('\n'),
  };
};

const githubRequest = async <T>(params: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  expectedStatus?: number[];
}): Promise<T> => {
  if (!GITHUB_TOKEN) {
    throw new PublishWorkerError('GITHUB_AUTH', 'GITHUB_TOKEN is required', false);
  }

  const response = await fetch(`https://api.github.com${params.path}`, {
    method: params.method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'muel-opencode-publish-worker',
      ...(params.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });

  const expected = params.expectedStatus || [200, 201];
  if (!expected.includes(response.status)) {
    const bodyText = await response.text();
    const retryable = response.status >= 500 || response.status === 429;
    logger.warn('[OPENCODE-PUBLISH] GitHub API %s %s failed (%d): %s', params.method, params.path, response.status, bodyText.slice(0, 500));
    throw new PublishWorkerError(
      'GITHUB_HTTP_ERROR',
      `GitHub API ${params.method} ${params.path} failed (${response.status})`,
      retryable,
    );
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
};

const getRepoTarget = (payload: Record<string, unknown>): { owner: string; repo: string } => {
  const owner = toText(payload.repoOwner || payload.owner || DEFAULT_REPO_OWNER);
  const repo = toText(payload.repoName || payload.repo || DEFAULT_REPO_NAME);
  if (!owner || !repo) {
    throw new PublishWorkerError('REPO_NOT_CONFIGURED', 'Target repository owner/name is required', false);
  }
  return { owner, repo };
};

const encodeRef = (ref: string) => ref.split('/').map(encodeURIComponent).join('/');

const getBranchHeadSha = async (owner: string, repo: string, branch: string): Promise<string> => {
  const ref = await githubRequest<{ object: { sha: string } }>({
    method: 'GET',
    path: `/repos/${owner}/${repo}/git/ref/heads/${encodeRef(branch)}`,
    expectedStatus: [200],
  });
  return String(ref.object?.sha || '').trim();
};

const ensureBranch = async (owner: string, repo: string, baseBranch: string, branchName: string): Promise<void> => {
  const baseSha = await getBranchHeadSha(owner, repo, baseBranch);
  try {
    await githubRequest({
      method: 'POST',
      path: `/repos/${owner}/${repo}/git/refs`,
      body: {
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      },
      expectedStatus: [201],
    });
  } catch (error) {
    if (error instanceof PublishWorkerError && error.code === 'GITHUB_HTTP_ERROR' && String(error.message).includes('(422)')) {
      return;
    }
    throw error;
  }
};

const getFile = async (owner: string, repo: string, path: string, ref: string): Promise<{ sha: string; content: string } | null> => {
  if (!path) {
    return null;
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'muel-opencode-publish-worker',
    },
  });

  if (response.status === 404) {
    return null;
  }
  if (response.status >= 500 || response.status === 429) {
    const bodyText = await response.text();
    throw new PublishWorkerError('GITHUB_HTTP_ERROR', `GET file failed (${response.status}): ${bodyText.slice(0, 500)}`, true);
  }
  if (!response.ok) {
    const bodyText = await response.text();
    throw new PublishWorkerError('GITHUB_HTTP_ERROR', `GET file failed (${response.status}): ${bodyText.slice(0, 500)}`, false);
  }

  const payload = await response.json() as { sha?: string; content?: string; encoding?: string };
  const encoded = String(payload.content || '').replace(/\n/g, '');
  const decoded = payload.encoding === 'base64' ? Buffer.from(encoded, 'base64').toString('utf8') : '';
  return {
    sha: String(payload.sha || '').trim(),
    content: decoded,
  };
};

const putFile = async (params: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  content: string;
  sha?: string;
}) => {
  await githubRequest({
    method: 'PUT',
    path: `/repos/${params.owner}/${params.repo}/contents/${params.path.split('/').map(encodeURIComponent).join('/')}`,
    body: {
      message: params.message,
      content: Buffer.from(params.content, 'utf8').toString('base64'),
      branch: params.branch,
      sha: params.sha,
    },
    expectedStatus: [200, 201],
  });
};

const deleteFile = async (params: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  sha: string;
}) => {
  await githubRequest({
    method: 'DELETE',
    path: `/repos/${params.owner}/${params.repo}/contents/${params.path.split('/').map(encodeURIComponent).join('/')}`,
    body: {
      message: params.message,
      branch: params.branch,
      sha: params.sha,
    },
    expectedStatus: [200],
  });
};

const createOrGetPullRequest = async (params: {
  owner: string;
  repo: string;
  title: string;
  body: string;
  base: string;
  branch: string;
}): Promise<{ number: number; html_url: string }> => {
  try {
    return await githubRequest<{ number: number; html_url: string }>({
      method: 'POST',
      path: `/repos/${params.owner}/${params.repo}/pulls`,
      body: {
        title: params.title,
        body: params.body,
        head: params.branch,
        base: params.base,
      },
      expectedStatus: [201],
    });
  } catch (error) {
    if (!(error instanceof PublishWorkerError) || error.code !== 'GITHUB_HTTP_ERROR' || !error.message.includes('(422)')) {
      throw error;
    }

    const query = new URLSearchParams({
      state: 'open',
      head: `${params.owner}:${params.branch}`,
      base: params.base,
    });
    const existing = await githubRequest<Array<{ number: number; html_url: string }>>({
      method: 'GET',
      path: `/repos/${params.owner}/${params.repo}/pulls?${query.toString()}`,
      expectedStatus: [200],
    });

    if (existing.length > 0) {
      return existing[0];
    }
    throw error;
  }
};

const processGitHubPublish = async (params: {
  job: PublishJobRow;
  request: ChangeRequestRow;
}): Promise<{ prUrl: string; branch: string; prNumber: number }> => {
  const payload = toRecord(params.job.payload);
  const { owner, repo } = getRepoTarget(payload);

  const baseBranch = toText(payload.targetBaseBranch || params.request.target_base_branch || 'main', 'main');
  const branch = toText(
    payload.proposedBranch || params.request.proposed_branch || `agent/${params.job.guild_id}/${params.job.change_request_id}-${Date.now()}`,
  )
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9/_-]/g, '')
    .slice(0, 120);

  const diffPatch = toText(params.request.diff_patch);
  if (!diffPatch) {
    throw new PublishWorkerError('PATCH_MISSING', 'diff_patch is required for publish worker', false);
  }

  const files = parseDiffFiles(diffPatch);
  if (files.length === 0) {
    throw new PublishWorkerError('PATCH_PARSE_FAILED', 'No diff files parsed from diff_patch', false);
  }
  if (files.length > PATCH_MAX_FILES) {
    throw new PublishWorkerError('PATCH_TOO_LARGE', `Patch file count exceeds limit (${files.length} > ${PATCH_MAX_FILES})`, false);
  }

  const patchLineCount = files.reduce((sum, file) => sum + file.hunks.reduce((inner, hunk) => inner + hunk.lines.length, 0), 0);
  if (patchLineCount > PATCH_MAX_LINES) {
    throw new PublishWorkerError('PATCH_TOO_LARGE', `Patch line count exceeds limit (${patchLineCount} > ${PATCH_MAX_LINES})`, false);
  }

  await ensureBranch(owner, repo, baseBranch, branch);

  for (const file of files) {
    const targetPath = file.newPath === '/dev/null' ? file.oldPath : file.newPath;
    if (!targetPath || targetPath === '/dev/null') {
      continue;
    }

    const current = await getFile(owner, repo, targetPath, branch);
    const transformed = applyDiffFile(file, current?.content || null);

    if (transformed.mode === 'delete') {
      if (!current?.sha) {
        continue;
      }
      await deleteFile({
        owner,
        repo,
        path: targetPath,
        branch,
        sha: current.sha,
        message: `[agent] remove ${targetPath}`,
      });
      continue;
    }

    await putFile({
      owner,
      repo,
      path: targetPath,
      branch,
      sha: current?.sha,
      content: transformed.content || '',
      message: `[agent] apply change request #${params.request.id}: ${targetPath}`,
    });
  }

  const pr = await createOrGetPullRequest({
    owner,
    repo,
    title: params.request.title,
    body: params.request.summary || `Auto-generated from change request ${params.request.id}`,
    base: baseBranch,
    branch,
  });

  return {
    prUrl: pr.html_url,
    branch,
    prNumber: pr.number,
  };
};

const claimQueuedJob = async (): Promise<PublishJobRow | null> => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(PUBLISH_QUEUE_TABLE)
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(Math.max(5, WORKER_BATCH_SIZE * 3));

  if (error) {
    throw new PublishWorkerError('QUEUE_READ_FAILED', error.message || 'QUEUE_READ_FAILED', true);
  }

  const candidates = (data || []) as Array<Record<string, unknown>>;
  for (const row of candidates) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) {
      continue;
    }

    const { data: claimed, error: claimError } = await client
      .from(PUBLISH_QUEUE_TABLE)
      .update({
        status: 'running',
        started_at: nowIso(),
        ended_at: null,
        error: null,
        updated_at: nowIso(),
      })
      .eq('id', id)
      .eq('status', 'queued')
      .select('*')
      .maybeSingle();

    if (claimError) {
      continue;
    }
    if (claimed) {
      return claimed as unknown as PublishJobRow;
    }
  }

  return null;
};

const getChangeRequest = async (job: PublishJobRow): Promise<ChangeRequestRow> => {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(CHANGE_REQUEST_TABLE)
    .select('*')
    .eq('id', job.change_request_id)
    .eq('guild_id', job.guild_id)
    .maybeSingle();

  if (error) {
    throw new PublishWorkerError('REQUEST_READ_FAILED', error.message || 'REQUEST_READ_FAILED', true);
  }
  if (!data) {
    throw new PublishWorkerError('REQUEST_NOT_FOUND', 'Change request not found', false);
  }

  const request = data as unknown as ChangeRequestRow;
  if (request.status !== 'approved' && request.status !== 'queued_for_publish') {
    throw new PublishWorkerError('REQUEST_NOT_APPROVED', `Invalid request status: ${request.status}`, false);
  }

  return request;
};

const markJobSucceeded = async (job: PublishJobRow, params: { prUrl: string; branch: string; prNumber: number }) => {
  const client = getSupabaseClient();
  await client
    .from(PUBLISH_QUEUE_TABLE)
    .update({
      status: 'succeeded',
      ended_at: nowIso(),
      updated_at: nowIso(),
      error: null,
      result: {
        ...toRecord(job.result),
        attempts: getAttemptCount(job) + 1,
        branch: params.branch,
        prNumber: params.prNumber,
        prUrl: params.prUrl,
        completedAt: nowIso(),
      },
    })
    .eq('id', job.id);

  await client
    .from(CHANGE_REQUEST_TABLE)
    .update({
      status: 'published',
      publish_url: params.prUrl,
      updated_at: nowIso(),
    })
    .eq('id', job.change_request_id)
    .eq('guild_id', job.guild_id);

  await recordLearningSignal({
    guildId: job.guild_id,
    requestedBy: job.requested_by,
    toolName: 'opencode.publish.github',
    outcomeScore: 1,
    reason: 'publish_succeeded',
    metadata: {
      jobId: job.id,
      changeRequestId: job.change_request_id,
      provider: job.provider,
      prUrl: params.prUrl,
      prNumber: params.prNumber,
    },
  });
};

const markJobFailed = async (job: PublishJobRow, error: PublishWorkerError) => {
  const client = getSupabaseClient();
  const attempts = getAttemptCount(job) + 1;
  const retryable = error.retryable && attempts < WORKER_MAX_ATTEMPTS;

  const nextStatus = retryable ? 'queued' : 'failed';
  await client
    .from(PUBLISH_QUEUE_TABLE)
    .update({
      status: nextStatus,
      error: `${error.code}: ${error.message}`.slice(0, 2000),
      ended_at: nowIso(),
      started_at: retryable ? null : job.started_at,
      updated_at: nowIso(),
      result: {
        ...toRecord(job.result),
        attempts,
        lastErrorCode: error.code,
        lastErrorAt: nowIso(),
        retryable,
      },
    })
    .eq('id', job.id);

  if (!retryable) {
    await client
      .from(CHANGE_REQUEST_TABLE)
      .update({
        status: 'failed',
        review_note: `${error.code}: ${error.message}`.slice(0, 2000),
        updated_at: nowIso(),
      })
      .eq('id', job.change_request_id)
      .eq('guild_id', job.guild_id)
      .in('status', ['approved', 'queued_for_publish']);
  }

  await recordLearningSignal({
    guildId: job.guild_id,
    requestedBy: job.requested_by,
    toolName: 'opencode.publish.github',
    outcomeScore: retryable ? 0.2 : 0,
    reason: error.code,
    metadata: {
      jobId: job.id,
      changeRequestId: job.change_request_id,
      provider: job.provider,
      retryable,
      attempts,
      errorCode: error.code,
      message: error.message.slice(0, 300),
    },
  });
};

const recoverStaleRunningJobs = async () => {
  const client = getSupabaseClient();
  const staleBefore = new Date(Date.now() - WORKER_STALE_RUNNING_MS).toISOString();
  const { data, error } = await client
    .from(PUBLISH_QUEUE_TABLE)
    .select('*')
    .eq('status', 'running')
    .lt('started_at', staleBefore)
    .limit(50);

  if (error) {
    logger.warn('[OPENCODE_PUBLISH] stale-running scan failed: %s', error.message || String(error));
    return;
  }

  const staleJobs = (data || []) as Array<Record<string, unknown>>;
  for (const row of staleJobs) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) {
      continue;
    }

    await client
      .from(PUBLISH_QUEUE_TABLE)
      .update({
        status: 'queued',
        started_at: null,
        ended_at: nowIso(),
        updated_at: nowIso(),
        error: 'STALE_RUNNING_RECOVERED',
        result: {
          ...toRecord((row as Record<string, unknown>).result),
          staleRecoveredAt: nowIso(),
        },
      })
      .eq('id', id)
      .eq('status', 'running');
  }

  if (staleJobs.length > 0) {
    logger.warn('[OPENCODE_PUBLISH] recovered stale running jobs: %d', staleJobs.length);
  }
};

const processSingleJob = async (job: PublishJobRow) => {
  const request = await getChangeRequest(job);
  const riskTier = toLower(request.risk_tier || 'medium') || 'medium';
  const evidenceBundleId = toText(request.evidence_bundle_id || '');
  const scoreCardTotal = parseScoreCardTotal(request.score_card);

  if (REQUIRE_EVIDENCE_FOR_HIGH_RISK && (riskTier === 'high' || riskTier === 'critical') && !evidenceBundleId) {
    throw new PublishWorkerError('EVIDENCE_REQUIRED', `evidence_bundle_id is required for risk tier ${riskTier}`, false);
  }

  if (MIN_SCORE_CARD_TOTAL > 0 && scoreCardTotal !== null && scoreCardTotal < MIN_SCORE_CARD_TOTAL) {
    throw new PublishWorkerError(
      'SCORE_BELOW_THRESHOLD',
      `score_card total below threshold (${scoreCardTotal} < ${MIN_SCORE_CARD_TOTAL})`,
      false,
    );
  }

  const provider = toText(job.provider, 'github').toLowerCase();
  if (provider !== 'github') {
    throw new PublishWorkerError('PROVIDER_UNSUPPORTED', `Unsupported provider: ${provider}`, false);
  }

  const result = await processGitHubPublish({ job, request });
  await markJobSucceeded(job, result);

  logger.info(
    '[OPENCODE_PUBLISH] succeeded jobId=%d changeRequestId=%d guildId=%s pr=%s',
    job.id,
    job.change_request_id,
    job.guild_id,
    result.prUrl,
  );
};

const runTick = async () => {
  if (inFlight) {
    return;
  }

  let lockAcquired = false;
  if (WORKER_LOCK_ENABLED) {
    const lease = await acquireDistributedLease({
      name: WORKER_LOCK_NAME,
      owner: WORKER_LOCK_OWNER,
      leaseMs: WORKER_LOCK_LEASE_MS,
    });
    if (!lease.ok) {
      if (!WORKER_LOCK_FAIL_OPEN) {
        return;
      }
      logger.warn('[OPENCODE_PUBLISH] lock fail-open enabled reason=%s', lease.reason || 'unknown');
    } else {
      lockAcquired = true;
    }
  }

  inFlight = true;

  try {
    await recoverStaleRunningJobs();

    for (let i = 0; i < WORKER_BATCH_SIZE; i += 1) {
      const job = await claimQueuedJob();
      if (!job) {
        break;
      }

      try {
        await processSingleJob(job);
      } catch (error) {
        const normalized = error instanceof PublishWorkerError
          ? error
          : new PublishWorkerError('PUBLISH_FAILED', getErrorMessage(error), false);
        await markJobFailed(job, normalized);
        logger.warn(
          '[OPENCODE_PUBLISH] failed jobId=%d changeRequestId=%d code=%s retryable=%s message=%s',
          job.id,
          job.change_request_id,
          normalized.code,
          String(normalized.retryable),
          normalized.message,
        );
      }
    }
  } finally {
    inFlight = false;
    if (lockAcquired) {
      await releaseDistributedLease({
        name: WORKER_LOCK_NAME,
        owner: WORKER_LOCK_OWNER,
      });
    }
  }
};

export const startOpencodePublishWorker = () => {
  if (started || !WORKER_ENABLED) {
    return;
  }

  if (!isSupabaseConfigured()) {
    logger.warn('[OPENCODE_PUBLISH] disabled: supabase is not configured');
    return;
  }

  started = true;
  void runTick();
  timer = setInterval(() => {
    void runTick();
  }, WORKER_INTERVAL_MS);
  timer.unref();

  logger.info(
    '[OPENCODE_PUBLISH] started enabled=%s intervalMs=%d batchSize=%d maxAttempts=%d staleRunningMs=%d lockEnabled=%s lockLeaseMs=%d lockName=%s',
    String(WORKER_ENABLED),
    WORKER_INTERVAL_MS,
    WORKER_BATCH_SIZE,
    WORKER_MAX_ATTEMPTS,
    WORKER_STALE_RUNNING_MS,
    String(WORKER_LOCK_ENABLED),
    WORKER_LOCK_LEASE_MS,
    WORKER_LOCK_NAME,
  );
};

export const stopOpencodePublishWorker = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
};

export const getOpencodePublishWorkerStats = () => ({
  enabled: WORKER_ENABLED,
  started,
  inFlight,
  running: Boolean(timer),
  intervalMs: WORKER_INTERVAL_MS,
  batchSize: WORKER_BATCH_SIZE,
  maxAttempts: WORKER_MAX_ATTEMPTS,
  distributedLockEnabled: WORKER_LOCK_ENABLED,
  distributedLockLeaseMs: WORKER_LOCK_LEASE_MS,
});
