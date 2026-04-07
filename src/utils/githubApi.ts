/**
 * Shared GitHub REST API Client
 *
 * Single module for all GitHub REST API calls across the codebase.
 * Replaces duplicated fetch+auth patterns in:
 *   - src/services/sprint/autonomousGit.ts
 *   - src/services/opencode/opencodePublishWorker.ts
 *   - scripts/obsidian-wiki-pr.ts
 *
 * Features:
 *   - Configurable owner/repo/token per instance (multi-repo support)
 *   - Consistent auth, headers, and error handling
 *   - Retryable error detection (5xx, 429)
 */

import logger from '../logger';

// ──── Types ───────────────────────────────────────────────────────────────────

export type GitHubApiConfig = {
  /** GitHub PAT or token with repo scope. */
  token: string;
  /** Default repo owner (can be overridden per request). */
  owner?: string;
  /** Default repo name (can be overridden per request). */
  repo?: string;
  /** User-Agent header. Default: 'muel-github-client' */
  userAgent?: string;
};

export type GitHubRequestParams = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path relative to repo (e.g. '/pulls'). Prepended with /repos/{owner}/{repo}. */
  path: string;
  /** Override owner for this request. */
  owner?: string;
  /** Override repo for this request. */
  repo?: string;
  body?: Record<string, unknown>;
  /** Expected HTTP status codes. Default: [200, 201] */
  expectedStatus?: number[];
};

export type GitHubApiResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  retryable: boolean;
};

// ──── Client Factory ──────────────────────────────────────────────────────────

export const createGitHubClient = (config: GitHubApiConfig) => {
  const { token, userAgent = 'muel-github-client' } = config;

  const resolveOwnerRepo = (params: Pick<GitHubRequestParams, 'owner' | 'repo'>) => {
    const owner = params.owner || config.owner || '';
    const repo = params.repo || config.repo || '';
    return { owner, repo };
  };

  /**
   * Make a GitHub REST API request to /repos/{owner}/{repo}{path}.
   */
  const request = async <T>(params: GitHubRequestParams): Promise<GitHubApiResult<T>> => {
    if (!token) {
      return { ok: false, status: 0, error: 'GitHub token is required', retryable: false };
    }

    const { owner, repo } = resolveOwnerRepo(params);
    if (!owner || !repo) {
      return { ok: false, status: 0, error: 'GitHub owner and repo are required', retryable: false };
    }

    const url = `https://api.github.com/repos/${owner}/${repo}${params.path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': userAgent,
    };
    if (params.body) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url, {
        method: params.method,
        headers,
        body: params.body ? JSON.stringify(params.body) : undefined,
      });

      const expected = params.expectedStatus || [200, 201];
      const retryable = response.status >= 500 || response.status === 429;

      if (!expected.includes(response.status)) {
        const bodyText = await response.text();
        logger.warn(
          '[GITHUB-API] %s %s failed (%d): %s',
          params.method, params.path, response.status, bodyText.slice(0, 300),
        );
        return {
          ok: false,
          status: response.status,
          error: `GitHub API ${params.method} ${params.path} failed (${response.status}): ${bodyText.slice(0, 200)}`,
          retryable,
        };
      }

      if (response.status === 204) {
        return { ok: true, status: 204, data: {} as T, retryable: false };
      }

      const data = await response.json() as T;
      return { ok: true, status: response.status, data, retryable: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 0, error: `Network error: ${msg}`, retryable: true };
    }
  };

  // ──── Convenience methods ───────────────────────────────────────────────

  /** Get branch HEAD SHA. */
  const getBranchSha = async (branch: string, opts?: { owner?: string; repo?: string }) => {
    const result = await request<{ object: { sha: string } }>({
      method: 'GET',
      path: `/git/ref/heads/${encodeURIComponent(branch)}`,
      ...opts,
    });
    return result.ok ? result.data!.object.sha : null;
  };

  /** Create a new branch from a base SHA. */
  const createBranch = async (
    branchName: string,
    fromSha: string,
    opts?: { owner?: string; repo?: string },
  ) => {
    return request<{ ref: string; object: { sha: string } }>({
      method: 'POST',
      path: '/git/refs',
      body: { ref: `refs/heads/${branchName}`, sha: fromSha },
      expectedStatus: [201],
      ...opts,
    });
  };

  /** Create a pull request. */
  const createPullRequest = async (
    params: { title: string; body: string; head: string; base: string; draft?: boolean },
    opts?: { owner?: string; repo?: string },
  ) => {
    return request<{ html_url: string; number: number }>({
      method: 'POST',
      path: '/pulls',
      body: {
        title: params.title,
        body: params.body.slice(0, 65535),
        head: params.head,
        base: params.base,
        draft: params.draft,
      },
      ...opts,
    });
  };

  /** Create a blob. */
  const createBlob = async (content: string, opts?: { owner?: string; repo?: string }) => {
    return request<{ sha: string }>({
      method: 'POST',
      path: '/git/blobs',
      body: { content, encoding: 'utf-8' },
      ...opts,
    });
  };

  /** Create a tree from items. */
  const createTree = async (
    baseTreeSha: string,
    items: Array<{ path: string; mode: string; type: string; sha: string }>,
    opts?: { owner?: string; repo?: string },
  ) => {
    return request<{ sha: string }>({
      method: 'POST',
      path: '/git/trees',
      body: { base_tree: baseTreeSha, tree: items },
      ...opts,
    });
  };

  /** Create a commit. */
  const createCommit = async (
    message: string,
    treeSha: string,
    parentShas: string[],
    opts?: { owner?: string; repo?: string },
  ) => {
    return request<{ sha: string }>({
      method: 'POST',
      path: '/git/commits',
      body: { message, tree: treeSha, parents: parentShas },
      ...opts,
    });
  };

  /** Get a commit's tree SHA. */
  const getCommitTree = async (commitSha: string, opts?: { owner?: string; repo?: string }) => {
    const result = await request<{ tree: { sha: string } }>({
      method: 'GET',
      path: `/git/commits/${commitSha}`,
      ...opts,
    });
    return result.ok ? result.data!.tree.sha : null;
  };

  /** Update a branch ref to point to a new SHA. */
  const updateBranchRef = async (
    branchName: string,
    sha: string,
    opts?: { owner?: string; repo?: string },
  ) => {
    return request<{ ref: string }>({
      method: 'PATCH',
      path: `/git/refs/heads/${encodeURIComponent(branchName)}`,
      body: { sha },
      ...opts,
    });
  };

  /** Get file contents (base64 decoded). */
  const getFileContents = async (
    filePath: string,
    ref: string,
    opts?: { owner?: string; repo?: string },
  ) => {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const result = await request<{ sha: string; content: string; encoding: string }>({
      method: 'GET',
      path: `/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
      ...opts,
    });
    if (!result.ok) return null;
    const encoded = String(result.data!.content || '').replace(/\n/g, '');
    const decoded = result.data!.encoding === 'base64'
      ? Buffer.from(encoded, 'base64').toString('utf8')
      : '';
    return { sha: result.data!.sha, content: decoded };
  };

  /** Create or update a file via contents API. */
  const putFile = async (
    params: { path: string; branch: string; message: string; content: string; sha?: string },
    opts?: { owner?: string; repo?: string },
  ) => {
    const encodedPath = params.path.split('/').map(encodeURIComponent).join('/');
    const body: Record<string, unknown> = {
      message: params.message,
      content: Buffer.from(params.content, 'utf8').toString('base64'),
      branch: params.branch,
    };
    if (params.sha) body.sha = params.sha;
    return request<{ content: { sha: string } }>({
      method: 'PUT',
      path: `/contents/${encodedPath}`,
      body,
      ...opts,
    });
  };

  /** Delete a file via contents API. */
  const deleteFile = async (
    params: { path: string; branch: string; message: string; sha: string },
    opts?: { owner?: string; repo?: string },
  ) => {
    const encodedPath = params.path.split('/').map(encodeURIComponent).join('/');
    return request<Record<string, unknown>>({
      method: 'DELETE',
      path: `/contents/${encodedPath}`,
      body: {
        message: params.message,
        sha: params.sha,
        branch: params.branch,
      },
      ...opts,
    });
  };

  /** List open PRs matching head and base. */
  const listPullRequests = async (
    params: { state?: string; head?: string; base?: string },
    opts?: { owner?: string; repo?: string },
  ) => {
    const qs = new URLSearchParams();
    if (params.state) qs.set('state', params.state);
    if (params.head) qs.set('head', params.head);
    if (params.base) qs.set('base', params.base);
    return request<Array<{ html_url: string; number: number }>>({
      method: 'GET',
      path: `/pulls?${qs.toString()}`,
      ...opts,
    });
  };

  return {
    request,
    getBranchSha,
    createBranch,
    createPullRequest,
    createBlob,
    createTree,
    createCommit,
    getCommitTree,
    updateBranchRef,
    getFileContents,
    putFile,
    deleteFile,
    listPullRequests,
  };
};

export type GitHubClient = ReturnType<typeof createGitHubClient>;
