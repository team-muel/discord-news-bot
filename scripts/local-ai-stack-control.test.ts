import { describe, expect, it } from 'vitest';

import {
  buildManagedServicePlan,
  deriveObsidianAccessPosture,
  parseEmbeddedJsonPayload,
} from './local-ai-stack-control.mjs';

describe('local-ai-stack-control helpers', () => {
  it('extracts the last JSON payload from noisy command output', () => {
    const payload = parseEmbeddedJsonPayload(`
[n8n-local] bootstrapDir=tmp/n8n-local
{"ok":false,"step":"bootstrap"}
trailing noise
{"ok":true,"step":"doctor","reachable":true}
`);

    expect(payload).toEqual({
      ok: true,
      step: 'doctor',
      reachable: true,
    });
  });

  it('builds the managed service plan for the max-delegation local profile', () => {
    const plan = buildManagedServicePlan({
      AI_PROVIDER: 'ollama',
      OPENJARVIS_ENGINE: 'litellm',
      LITELLM_ENABLED: 'true',
      LITELLM_BASE_URL: 'http://127.0.0.1:4000',
      N8N_ENABLED: 'true',
      N8N_DISABLED: 'false',
      N8N_BASE_URL: 'http://127.0.0.1:5678',
      OPENJARVIS_ENABLED: 'true',
      OPENJARVIS_SERVE_URL: 'http://127.0.0.1:8000',
      MCP_IMPLEMENT_WORKER_URL: 'http://127.0.0.1:8787',
    });

    expect(plan).toEqual({
      litellm: true,
      n8n: true,
      openjarvis: true,
      opencodeWorker: true,
      requiresOllama: true,
    });
  });

  it('classifies direct-vault-first obsidian posture from capability orders', () => {
    const posture = deriveObsidianAccessPosture({
      OBSIDIAN_ADAPTER_ORDER: 'local-fs,native-cli,remote-mcp',
      OBSIDIAN_ADAPTER_ORDER_READ_FILE: 'local-fs,native-cli,remote-mcp',
      OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT: 'local-fs,native-cli,remote-mcp',
      OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE: 'local-fs,native-cli,remote-mcp',
    });

    expect(posture.mode).toBe('direct-vault-primary');
    expect(posture.primaryReadAdapter).toBe('local-fs');
    expect(posture.primaryWriteAdapter).toBe('local-fs');
    expect(posture.primarySearchAdapter).toBe('local-fs');
  });
});