import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGitHubClient } from './githubApi';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('githubApi - createGitHubClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const client = createGitHubClient({
    token: 'test-token',
    owner: 'team-muel',
    repo: 'discord-news-bot',
  });

  it('request sends correct auth headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 1 }),
    });

    const result = await client.request({ method: 'GET', path: '/pulls' });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/team-muel/discord-news-bot/pulls');
    expect(opts.headers.Authorization).toBe('Bearer test-token');
    expect(opts.headers.Accept).toContain('github');
  });

  it('request returns error for missing token', async () => {
    const noTokenClient = createGitHubClient({ token: '', owner: 'a', repo: 'b' });
    const result = await noTokenClient.request({ method: 'GET', path: '/test' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('request returns error for missing owner/repo', async () => {
    const noRepoClient = createGitHubClient({ token: 'tok' });
    const result = await noRepoClient.request({ method: 'GET', path: '/test' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('owner and repo');
  });

  it('request allows owner/repo override per call', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.request({ method: 'GET', path: '/issues', owner: 'other-org', repo: 'other-repo' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/other-org/other-repo/issues');
  });

  it('request detects retryable errors (5xx, 429)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const result = await client.request({ method: 'GET', path: '/test' });

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.status).toBe(503);
  });

  it('getBranchSha returns sha on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ object: { sha: 'abc123' } }),
    });

    const sha = await client.getBranchSha('main');
    expect(sha).toBe('abc123');
  });

  it('getBranchSha returns null on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    const sha = await client.getBranchSha('nonexistent');
    expect(sha).toBeNull();
  });

  it('createPullRequest sends correct body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ html_url: 'https://github.com/pr/1', number: 1 }),
    });

    const result = await client.createPullRequest({
      title: 'Test PR',
      body: 'Description',
      head: 'feat/test',
      base: 'main',
    });

    expect(result.ok).toBe(true);
    expect(result.data?.number).toBe(1);

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.title).toBe('Test PR');
    expect(body.head).toBe('feat/test');
  });

  it('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await client.request({ method: 'GET', path: '/test' });

    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toContain('Network error');
  });
});
