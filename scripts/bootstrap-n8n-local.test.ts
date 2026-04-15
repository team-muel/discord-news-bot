import { describe, expect, it } from 'vitest';

import {
  buildN8nLocalComposeYaml,
  buildN8nLocalEnvFile,
  buildN8nLocalReadme,
  buildN8nNewsMonitorCandidatesSmokeWorkflow,
  buildN8nStarterWorkflowDefinitions,
  buildN8nStarterWorkflowManifest,
  parseN8nCliWorkflowListOutput,
  toN8nWorkflowSeedPayload,
  upsertEnvVarText,
} from './bootstrap-n8n-local.mjs';

describe('bootstrap-n8n-local helpers', () => {
  it('builds a compose file with local-only port binding and persisted data volume', () => {
    const yaml = buildN8nLocalComposeYaml();

    expect(yaml).toContain('docker.n8n.io/n8nio/n8n:latest');
    expect(yaml).toContain('127.0.0.1:${N8N_PORT:-5678}:5678');
    expect(yaml).toContain('./data:/home/node/.n8n');
    expect(yaml).toContain('env_file:');
  });

  it('builds an env file with explicit local auth and webhook base URL', () => {
    const envFile = buildN8nLocalEnvFile({
      baseUrl: 'http://127.0.0.1:5679',
      encryptionKey: 'test-encryption-key',
      timezone: 'UTC',
    });

    expect(envFile).toContain('N8N_HOST=127.0.0.1');
    expect(envFile).toContain('N8N_PORT=5679');
    expect(envFile).toContain('N8N_EDITOR_BASE_URL=http://127.0.0.1:5679');
    expect(envFile).toContain('WEBHOOK_URL=http://127.0.0.1:5679/');
    expect(envFile).toContain('N8N_BASIC_AUTH_ACTIVE=true');
    expect(envFile).toContain('N8N_BASIC_AUTH_PASSWORD=change-me-local-only');
    expect(envFile).toContain('N8N_ENCRYPTION_KEY=test-encryption-key');
  });

  it('documents the starter bundle and CLI/API seed flow', () => {
    const readme = buildN8nLocalReadme({
      baseUrl: 'http://127.0.0.1:5678',
      outputDir: 'tmp/n8n-local',
    });

    expect(readme).toContain('npm run n8n:local:start');
    expect(readme).toContain('npm run n8n:local:api-key:ensure');
    expect(readme).toContain('npm run n8n:local:seed');
    expect(readme).toContain('local self-hosted n8n');
    expect(readme).toContain('auto-provision a local public API key');
    expect(readme).toContain('N8N_API_KEY');
    expect(readme).toContain('starter-workflows.manifest.json');
    expect(readme).toContain('alert-dispatch-starter.workflow.json');
    expect(readme).toContain('imports active by default');
  });

  it('upserts repo env values without rewriting commented hints', () => {
    expect(upsertEnvVarText('# N8N_API_KEY=\nN8N_ENABLED=true\n', 'N8N_API_KEY', 'secret-123')).toBe(
      '# N8N_API_KEY=\nN8N_ENABLED=true\nN8N_API_KEY=secret-123\n',
    );

    expect(upsertEnvVarText('N8N_API_KEY=old\nN8N_ENABLED=true\n', 'N8N_API_KEY', 'secret-123')).toBe(
      'N8N_API_KEY=secret-123\nN8N_ENABLED=true\n',
    );
  });

  it('parses n8n CLI workflow list output', () => {
    expect(parseN8nCliWorkflowListOutput(`abc123|starter one\ndef456|starter two\n`)).toEqual([
      { id: 'abc123', name: 'starter one' },
      { id: 'def456', name: 'starter two' },
    ]);
  });

  it('builds the full starter workflow bundle', () => {
    const definitions = buildN8nStarterWorkflowDefinitions();

    expect(definitions).toHaveLength(7);
    expect(definitions.map((definition) => definition.task)).toEqual([
      'news-rss-fetch',
      'news-summarize',
      'news-monitor-candidates',
      'youtube-feed-fetch',
      'youtube-community-scrape',
      'alert-dispatch',
      'article-context-fetch',
    ]);

    const manual = definitions.filter((definition) => Boolean(definition.manualFollowUp));
    expect(manual.map((definition) => definition.task)).toContain('alert-dispatch');
    expect(manual.map((definition) => definition.task)).toContain('youtube-community-scrape');
    expect(definitions.every((definition) => definition.workflow.active === true)).toBe(true);
  });

  it('builds an importable news-monitor-candidates starter workflow', () => {
    const workflow = buildN8nNewsMonitorCandidatesSmokeWorkflow();

    expect(workflow.name).toContain('news monitor candidates starter');
    expect(workflow.nodes).toHaveLength(2);
    expect(workflow.nodes[0].parameters.path).toBe('muel/news-monitor-candidates');
    expect(workflow.nodes[0].webhookId).toMatch(/^[0-9a-f-]{36}$/);
    expect(workflow.nodes[1].parameters.jsCode).toContain('google.com/finance/markets');
    expect(workflow.nodes[1].parameters.jsCode).toContain('lexicalSignature');
  });

  it('builds a deterministic manifest for the starter bundle', () => {
    const manifest = JSON.parse(buildN8nStarterWorkflowManifest()) as {
      generatedBy: string;
      workflows: Array<{ task: string; fileName: string; manualFollowUp: string }>;
    };

    expect(manifest.generatedBy).toBe('scripts/bootstrap-n8n-local.mjs');
    expect(manifest.workflows).toHaveLength(7);
    expect(manifest.workflows.find((item) => item.task === 'article-context-fetch')?.fileName)
      .toBe('article-context-fetch-starter.workflow.json');
    expect(manifest.workflows.find((item) => item.task === 'alert-dispatch')?.manualFollowUp)
      .toContain('Wire a real sink');
  });

  it('strips workflow objects to a safe public API seed payload', () => {
    const [definition] = buildN8nStarterWorkflowDefinitions();
    const payload = toN8nWorkflowSeedPayload({
      ...definition.workflow,
      versionId: 'ignore-me',
      checksum: 'ignore-me-too',
    });

    expect(payload).toMatchObject({
      name: definition.workflow.name,
      nodes: definition.workflow.nodes,
      connections: definition.workflow.connections,
      settings: definition.workflow.settings,
      pinData: definition.workflow.pinData,
    });
    expect(payload).not.toHaveProperty('versionId');
    expect(payload).not.toHaveProperty('checksum');
    expect(payload).not.toHaveProperty('active');
    expect(payload).not.toHaveProperty('meta');
    expect(payload).not.toHaveProperty('tags');
  });
});