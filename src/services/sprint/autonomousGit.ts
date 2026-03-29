import logger from '../../logger';
import {
  SPRINT_GIT_ENABLED,
  SPRINT_GITHUB_TOKEN,
  SPRINT_GITHUB_OWNER,
  SPRINT_GITHUB_REPO,
  SPRINT_DRY_RUN,
} from '../../config';

// ──── Types ───────────────────────────────────────────────────────────────────

export type GitBranchResult = { ok: boolean; branchName: string; error?: string };
export type GitCommitResult = { ok: boolean; sha?: string; error?: string };
export type GitPrResult = { ok: boolean; prUrl?: string; prNumber?: number; error?: string };

// ──── Guards ──────────────────────────────────────────────────────────────────

const isConfigured = (): boolean =>
  SPRINT_GIT_ENABLED && Boolean(SPRINT_GITHUB_TOKEN) && Boolean(SPRINT_GITHUB_OWNER) && Boolean(SPRINT_GITHUB_REPO);

const PROTECTED_BRANCHES = new Set(['main', 'master', 'production', 'release']);

const sanitizeBranchName = (raw: string): string =>
  raw.replace(/[^a-zA-Z0-9\-_/.]/g, '-').replace(/-{2,}/g, '-').slice(0, 100);

// ──── GitHub API helpers ──────────────────────────────────────────────────────

const githubApi = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const url = `https://api.github.com/repos/${SPRINT_GITHUB_OWNER}/${SPRINT_GITHUB_REPO}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${SPRINT_GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...options, headers });
};

// ──── Branch operations ───────────────────────────────────────────────────────

export const createSprintBranch = async (sprintId: string, baseBranch = 'main'): Promise<GitBranchResult> => {
  if (!isConfigured()) {
    return { ok: false, branchName: '', error: 'Git integration not configured' };
  }

  const branchName = sanitizeBranchName(`sprint/${sprintId}`);
  const safeBase = sanitizeBranchName(baseBranch);

  if (SPRINT_DRY_RUN) {
    logger.info('[SPRINT-GIT][DRY-RUN] would create branch: %s from %s', branchName, safeBase);
    return { ok: true, branchName };
  }

  if (PROTECTED_BRANCHES.has(branchName)) {
    return { ok: false, branchName, error: 'Cannot create branch with protected name' };
  }

  try {
    // Get base branch SHA
    const baseRef = await githubApi(`/git/ref/heads/${safeBase}`);
    if (!baseRef.ok) {
      return { ok: false, branchName, error: `Base branch ${safeBase} not found` };
    }
    const baseData = await baseRef.json() as { object: { sha: string } };
    const baseSha = baseData.object.sha;

    // Create new branch
    const createRes = await githubApi('/git/refs', {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      return { ok: false, branchName, error: `Branch creation failed: ${errBody.slice(0, 200)}` };
    }

    logger.info('[SPRINT-GIT] branch created: %s from %s', branchName, safeBase);
    return { ok: true, branchName };
  } catch (error) {
    return { ok: false, branchName, error: error instanceof Error ? error.message : String(error) };
  }
};

// ──── Commit operations ───────────────────────────────────────────────────────

export const commitSprintChanges = async (params: {
  branchName: string;
  message: string;
  files: Array<{ path: string; content: string }>;
}): Promise<GitCommitResult> => {
  if (!isConfigured()) {
    return { ok: false, error: 'Git integration not configured' };
  }

  if (PROTECTED_BRANCHES.has(params.branchName)) {
    return { ok: false, error: 'Cannot commit directly to protected branch' };
  }

  if (SPRINT_DRY_RUN) {
    logger.info('[SPRINT-GIT][DRY-RUN] would commit %d files to %s: %s', params.files.length, params.branchName, params.message);
    return { ok: true, sha: 'dry-run-sha' };
  }

  try {
    // Get current branch HEAD
    const refRes = await githubApi(`/git/ref/heads/${params.branchName}`);
    if (!refRes.ok) return { ok: false, error: 'Branch not found' };
    const refData = await refRes.json() as { object: { sha: string } };
    const parentSha = refData.object.sha;

    // Get base tree
    const commitRes = await githubApi(`/git/commits/${parentSha}`);
    if (!commitRes.ok) return { ok: false, error: 'Parent commit not found' };
    const commitData = await commitRes.json() as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // Create blobs for each file
    const treeItems = [];
    for (const file of params.files) {
      const blobRes = await githubApi('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({
          content: file.content,
          encoding: 'utf-8',
        }),
      });
      if (!blobRes.ok) return { ok: false, error: `Blob creation failed for ${file.path}` };
      const blobData = await blobRes.json() as { sha: string };
      treeItems.push({
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blobData.sha,
      });
    }

    // Create tree
    const treeRes = await githubApi('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems,
      }),
    });
    if (!treeRes.ok) return { ok: false, error: 'Tree creation failed' };
    const treeData = await treeRes.json() as { sha: string };

    // Create commit
    const newCommitRes = await githubApi('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: params.message,
        tree: treeData.sha,
        parents: [parentSha],
      }),
    });
    if (!newCommitRes.ok) return { ok: false, error: 'Commit creation failed' };
    const newCommitData = await newCommitRes.json() as { sha: string };

    // Update branch ref
    const updateRefRes = await githubApi(`/git/refs/heads/${params.branchName}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommitData.sha }),
    });
    if (!updateRefRes.ok) return { ok: false, error: 'Branch ref update failed' };

    logger.info('[SPRINT-GIT] committed %d files to %s sha=%s', params.files.length, params.branchName, newCommitData.sha.slice(0, 8));
    return { ok: true, sha: newCommitData.sha };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// ──── PR operations ───────────────────────────────────────────────────────────

export const createSprintPr = async (params: {
  branchName: string;
  title: string;
  body: string;
  baseBranch?: string;
}): Promise<GitPrResult> => {
  if (!isConfigured()) {
    return { ok: false, error: 'Git integration not configured' };
  }

  if (SPRINT_DRY_RUN) {
    logger.info('[SPRINT-GIT][DRY-RUN] would create PR: %s → %s', params.branchName, params.baseBranch || 'main');
    return { ok: true, prUrl: 'https://dry-run/pr', prNumber: 0 };
  }

  try {
    const res = await githubApi('/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title: params.title,
        body: params.body.slice(0, 65535),
        head: params.branchName,
        base: params.baseBranch || 'main',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: `PR creation failed: ${errBody.slice(0, 200)}` };
    }

    const prData = await res.json() as { html_url: string; number: number };
    logger.info('[SPRINT-GIT] PR created: %s', prData.html_url);
    return { ok: true, prUrl: prData.html_url, prNumber: prData.number };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// ──── Startup Health Check ────────────────────────────────────────────────────

export interface GitConfigHealthResult {
  configured: boolean;
  warnings: string[];
}

/**
 * Validates sprint git configuration at startup.
 * Returns warnings for common misconfigurations (e.g. GIT_ENABLED=true but missing token).
 */
export const checkGitConfigHealth = (): GitConfigHealthResult => {
  const warnings: string[] = [];

  if (!SPRINT_GIT_ENABLED) {
    return { configured: false, warnings };
  }

  if (!SPRINT_GITHUB_TOKEN) {
    warnings.push('SPRINT_GIT_ENABLED=true but SPRINT_GITHUB_TOKEN is empty');
  }
  if (!SPRINT_GITHUB_OWNER) {
    warnings.push('SPRINT_GIT_ENABLED=true but SPRINT_GITHUB_OWNER is empty');
  }
  if (!SPRINT_GITHUB_REPO) {
    warnings.push('SPRINT_GIT_ENABLED=true but SPRINT_GITHUB_REPO is empty');
  }

  if (warnings.length > 0) {
    for (const w of warnings) {
      logger.warn('[SPRINT-GIT] %s', w);
    }
  } else {
    logger.info('[SPRINT-GIT] git config healthy: owner=%s repo=%s', SPRINT_GITHUB_OWNER, SPRINT_GITHUB_REPO);
  }

  return { configured: true, warnings };
};

// ──── Sprint PR body builder ──────────────────────────────────────────────────

export const buildSprintPrBody = (params: {
  sprintId: string;
  objective: string;
  phaseResults: Record<string, { phase: string; status: string; output: string }>;
  changedFiles: string[];
}): string => {
  const lines = [
    `## Sprint: ${params.sprintId}`,
    '',
    `**Objective:** ${params.objective}`,
    '',
    '### Phase Results',
    '',
    '| Phase | Status | Summary |',
    '|-------|--------|---------|',
  ];

  for (const [, result] of Object.entries(params.phaseResults)) {
    const emoji = result.status === 'success' ? '✅' : result.status === 'failed' ? '❌' : '⏳';
    lines.push(`| ${result.phase} | ${emoji} ${result.status} | ${result.output.slice(0, 100)} |`);
  }

  lines.push('', '### Changed Files', '');
  for (const file of params.changedFiles) {
    lines.push(`- \`${file}\``);
  }

  lines.push(
    '',
    '---',
    '*This PR was auto-generated by the Sprint Pipeline.*',
  );

  return lines.join('\n');
};
