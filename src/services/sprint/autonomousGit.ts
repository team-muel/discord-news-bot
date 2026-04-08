import logger from '../../logger';
import {
  SPRINT_GIT_ENABLED,
  SPRINT_GITHUB_TOKEN,
  SPRINT_GITHUB_OWNER,
  SPRINT_GITHUB_REPO,
  SPRINT_DRY_RUN,
} from '../../config';
import { getErrorMessage } from '../../utils/errorMessage';
import { createGitHubClient } from '../../utils/githubApi';

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

// ──── Shared GitHub client (lazy init — avoids read at module load when unconfigured) ──

let _ghClient: ReturnType<typeof createGitHubClient> | null = null;
const gh = () => {
  if (!_ghClient) {
    _ghClient = createGitHubClient({
      token: SPRINT_GITHUB_TOKEN,
      owner: SPRINT_GITHUB_OWNER,
      repo: SPRINT_GITHUB_REPO,
      userAgent: 'muel-sprint-git',
    });
  }
  return _ghClient;
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
    const baseSha = await gh().getBranchSha(safeBase);
    if (!baseSha) {
      return { ok: false, branchName, error: `Base branch ${safeBase} not found` };
    }

    const createRes = await gh().createBranch(branchName, baseSha);
    if (!createRes.ok) {
      return { ok: false, branchName, error: `Branch creation failed: ${createRes.error}` };
    }

    logger.info('[SPRINT-GIT] branch created: %s from %s', branchName, safeBase);
    return { ok: true, branchName };
  } catch (error) {
    return { ok: false, branchName, error: getErrorMessage(error) };
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
    const parentSha = await gh().getBranchSha(params.branchName);
    if (!parentSha) return { ok: false, error: 'Branch not found' };

    // Get base tree
    const baseTreeSha = await gh().getCommitTree(parentSha);
    if (!baseTreeSha) return { ok: false, error: 'Parent commit not found' };

    // Create blobs for each file
    const treeItems = [];
    for (const file of params.files) {
      const blobRes = await gh().createBlob(file.content);
      if (!blobRes.ok) return { ok: false, error: `Blob creation failed for ${file.path}` };
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobRes.data!.sha,
      });
    }

    // Create tree
    const treeRes = await gh().createTree(baseTreeSha, treeItems);
    if (!treeRes.ok) return { ok: false, error: 'Tree creation failed' };

    // Create commit
    const commitRes = await gh().createCommit(params.message, treeRes.data!.sha, [parentSha]);
    if (!commitRes.ok) return { ok: false, error: 'Commit creation failed' };

    // Update branch ref
    const updateRes = await gh().updateBranchRef(params.branchName, commitRes.data!.sha);
    if (!updateRes.ok) return { ok: false, error: 'Branch ref update failed' };

    logger.info('[SPRINT-GIT] committed %d files to %s sha=%s', params.files.length, params.branchName, commitRes.data!.sha.slice(0, 8));
    return { ok: true, sha: commitRes.data!.sha };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
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
    const res = await gh().createPullRequest({
      title: params.title,
      body: params.body,
      head: params.branchName,
      base: params.baseBranch || 'main',
    });

    if (!res.ok) {
      return { ok: false, error: `PR creation failed: ${res.error}` };
    }

    logger.info('[SPRINT-GIT] PR created: %s', res.data!.html_url);
    return { ok: true, prUrl: res.data!.html_url, prNumber: res.data!.number };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
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
