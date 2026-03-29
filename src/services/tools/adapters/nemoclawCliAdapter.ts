import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBooleanEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';
import logger from '../../../logger';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 15_000;
const REVIEW_TIMEOUT_MS = 60_000;
const IS_WINDOWS = process.platform === 'win32';
const ENABLED = parseBooleanEnv(process.env.NEMOCLAW_ENABLED, false);
const SANDBOX_NAME = String(process.env.NEMOCLAW_SANDBOX_NAME || 'muel-assistant').replace(/[^a-zA-Z0-9._-]/g, '').trim();
const SANDBOX_INFERENCE_MODEL = String(process.env.NEMOCLAW_INFERENCE_MODEL || 'qwen2.5:7b-instruct').trim();
const SANDBOX_OLLAMA_URL = String(process.env.NEMOCLAW_SANDBOX_OLLAMA_URL || 'http://localhost:11434').trim();
const LITELLM_BASE_URL = String(process.env.LITELLM_BASE_URL || '').trim().replace(/\/+$/, '');
const LITELLM_MASTER_KEY = String(process.env.LITELLM_MASTER_KEY || process.env.OPENCLAW_API_KEY || '').trim();
const LITELLM_MODEL = String(process.env.LITELLM_MODEL || 'muel-balanced').trim();

/**
 * Lite mode: when the nemoclaw CLI is not installed (e.g. GCP e2-micro without Docker),
 * but a LiteLLM proxy is available, expose code.review capability via LLM inference only.
 * Full sandbox/onboard/connect features remain unavailable.
 */
let cliAvailable: boolean | null = null;

const WSL_DISTRO = String(process.env.WSL_DISTRO || 'Ubuntu-24.04').replace(/[^a-zA-Z0-9._-]/g, '');

const sanitizeArg = (value: string, maxLen = 300): string =>
  String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[;&|`$(){}]/g, '').trim().slice(0, maxLen);

const runCli = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  if (IS_WINDOWS) {
    const escaped = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const shellCmd = `export HOME=/root; export NVM_DIR=/root/.nvm; source /root/.nvm/nvm.sh 2>/dev/null; nemoclaw ${escaped}`;
    return execFileAsync(
      'wsl',
      ['-d', WSL_DISTRO, '-e', 'bash', '-c', shellCmd],
      { timeout: TIMEOUT_MS, windowsHide: true },
    );
  }
  return execFileAsync('nemoclaw', args, { timeout: TIMEOUT_MS, windowsHide: true });
};

const runSandboxCmd = async (name: string, cmd: string[]): Promise<{ stdout: string; stderr: string }> => {
  const safeName = sanitizeArg(name, 80);
  if (IS_WINDOWS) {
    const escaped = cmd.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const shellCmd = `export HOME=/root; source /root/.nvm/nvm.sh 2>/dev/null; ssh openshell-${safeName} ${escaped}`;
    return execFileAsync(
      'wsl',
      ['-d', WSL_DISTRO, '-e', 'bash', '-c', shellCmd],
      { timeout: REVIEW_TIMEOUT_MS, windowsHide: true },
    );
  }
  return execFileAsync('ssh', [`openshell-${safeName}`, ...cmd], { timeout: REVIEW_TIMEOUT_MS, windowsHide: true });
};

export const nemoclawAdapter: ExternalToolAdapter = {
  id: 'nemoclaw',
  capabilities: ['agent.onboard', 'agent.status', 'agent.connect', 'code.review'],
  liteCapabilities: ['code.review'],

  isAvailable: async () => {
    if (!ENABLED) return false;
    try {
      await runCli(['--version']);
      cliAvailable = true;
      return true;
    } catch {
      cliAvailable = false;
      // Lite mode: LiteLLM proxy available → code.review only
      return LITELLM_BASE_URL.length > 0;
    }
  },

  execute: async (action, args) => {
    const start = Date.now();
    const name = String(args.name || SANDBOX_NAME);
    const makeResult = (ok: boolean, summary: string, output: string[], error?: string): ExternalAdapterResult => ({
      ok,
      adapterId: 'nemoclaw',
      action,
      summary,
      output,
      error,
      durationMs: Date.now() - start,
    });

    try {
      switch (action) {
        case 'agent.onboard':
        case 'agent.status':
        case 'agent.connect': {
          // These actions require full CLI — not available in lite mode
          if (cliAvailable === false) {
            return makeResult(false, `${action} requires nemoclaw CLI (lite mode: code.review only)`, [], 'CLI_REQUIRED');
          }
          if (action === 'agent.onboard') {
            const { stdout } = await runCli(['onboard']);
            return makeResult(true, 'NemoClaw onboarded', stdout.trim().split('\n'));
          }
          if (action === 'agent.status') {
            const { stdout } = await runCli([sanitizeArg(name), 'status']);
            return makeResult(true, `Status for ${name}`, stdout.trim().split('\n'));
          }
          // agent.connect
          const { stdout } = await runCli([sanitizeArg(name), 'connect']);
          return makeResult(true, `Connected to ${name}`, stdout.trim().split('\n'));
        }
        case 'code.review': {
          const code = typeof args.code === 'string' ? args.code : '';
          const goal = typeof args.goal === 'string' ? args.goal : 'Review this code';
          const prompt = `Review the following code for bugs, security issues, and test gaps. Goal: ${goal}\n\nCode:\n${code}`;

          // Try sandbox Ollama inference first (real AI review)
          try {
            const safePrompt = JSON.stringify(prompt).slice(0, 4000);
            const curlPayload = JSON.stringify({
              model: SANDBOX_INFERENCE_MODEL,
              prompt: JSON.parse(safePrompt),
              stream: false,
            });
            const { stdout: inferenceOut } = await runSandboxCmd(name, ['curl', '-s', '-m', '55', `${SANDBOX_OLLAMA_URL}/api/generate`, '-d', curlPayload]);
            const parsed = JSON.parse(inferenceOut.trim()) as { response?: string };
            if (parsed.response && parsed.response.length > 10) {
              return makeResult(true, `AI code review via sandbox ${name}`, parsed.response.split('\n').slice(0, 40));
            }
          } catch (sandboxErr) {
            logger.debug('[NEMOCLAW] sandbox inference unavailable: %s', sandboxErr instanceof Error ? sandboxErr.message : String(sandboxErr));
            // Sandbox inference unavailable — fall through to host LLM
          }

          // Fallback: use host-side LLM via OpenAI-compatible endpoint (litellm / jarvis serve / ollama)
          const hostEndpoints: Array<{ url: string; model: string; authHeader?: string }> = [];
          // Prefer LiteLLM proxy first (most reliable on GCP)
          if (LITELLM_BASE_URL) {
            hostEndpoints.push({
              url: LITELLM_BASE_URL,
              model: LITELLM_MODEL,
              authHeader: LITELLM_MASTER_KEY ? `Bearer ${LITELLM_MASTER_KEY}` : undefined,
            });
          }
          // Then local endpoints
          const jarvisUrl = String(process.env.OPENJARVIS_SERVE_URL || 'http://127.0.0.1:8000').trim();
          const ollamaUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim();
          hostEndpoints.push({ url: jarvisUrl, model: SANDBOX_INFERENCE_MODEL });
          hostEndpoints.push({ url: ollamaUrl, model: SANDBOX_INFERENCE_MODEL });

          for (const endpoint of hostEndpoints) {
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);
              const headers: Record<string, string> = { 'Content-Type': 'application/json' };
              if (endpoint.authHeader) {
                headers['Authorization'] = endpoint.authHeader;
              }
              const resp = await fetch(`${endpoint.url.replace(/\/+$/, '')}/v1/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  model: endpoint.model,
                  messages: [
                    { role: 'system', content: 'You are a thorough code reviewer. Identify bugs, security issues, and test gaps.' },
                    { role: 'user', content: prompt.slice(0, 6000) },
                  ],
                  temperature: 0.2,
                  max_tokens: 1500,
                }),
                signal: controller.signal,
              });
              clearTimeout(timer);
              if (resp.ok) {
                const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
                const content = data.choices?.[0]?.message?.content || '';
                if (content.length > 10) {
                  const mode = cliAvailable === false ? ' (lite mode)' : '';
                  return makeResult(true, `Code review via host LLM (${endpoint.url})${mode}`, content.split('\n').slice(0, 40));
                }
              }
            } catch (hostErr) {
              logger.debug('[NEMOCLAW] host endpoint %s failed: %s', endpoint.url, hostErr instanceof Error ? hostErr.message : String(hostErr));
              // Try next host URL
            }
          }

          return makeResult(false, `Code review failed: no inference endpoint available`, [], 'INFERENCE_UNAVAILABLE');
        }
        default:
          return makeResult(false, `Unknown action: ${action}`, [], 'UNKNOWN_ACTION');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult(false, `nemoclaw ${action} failed`, [message], 'EXECUTION_FAILED');
    }
  },
};
