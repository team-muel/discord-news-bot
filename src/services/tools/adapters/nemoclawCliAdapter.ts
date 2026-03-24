import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBooleanEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';

const execAsync = promisify(exec);
const TIMEOUT_MS = 15_000;
const REVIEW_TIMEOUT_MS = 60_000;
const IS_WINDOWS = process.platform === 'win32';
const ENABLED = parseBooleanEnv(process.env.NEMOCLAW_ENABLED, false);
const SANDBOX_NAME = String(process.env.NEMOCLAW_SANDBOX_NAME || 'muel-assistant').trim();
const SANDBOX_INFERENCE_MODEL = String(process.env.NEMOCLAW_INFERENCE_MODEL || 'qwen2.5:7b-instruct').trim();
const SANDBOX_OLLAMA_URL = String(process.env.NEMOCLAW_SANDBOX_OLLAMA_URL || 'http://localhost:11434').trim();

const WSL_DISTRO = process.env.WSL_DISTRO || 'Ubuntu-24.04';

const runCli = async (args: string): Promise<{ stdout: string; stderr: string }> => {
  if (IS_WINDOWS) {
    const shellCmd = `export HOME=/root; export NVM_DIR=/root/.nvm; source /root/.nvm/nvm.sh 2>/dev/null; nemoclaw ${args}`;
    return execAsync(
      `wsl -d ${WSL_DISTRO} -e bash -c "${shellCmd.replace(/"/g, '\\"')}"`,
      { timeout: TIMEOUT_MS, windowsHide: true },
    );
  }
  return execAsync(`nemoclaw ${args}`, { timeout: TIMEOUT_MS, windowsHide: true });
};

const runSandboxCmd = async (name: string, cmd: string): Promise<{ stdout: string; stderr: string }> => {
  if (IS_WINDOWS) {
    const shellCmd = `export HOME=/root; source /root/.nvm/nvm.sh 2>/dev/null; ssh openshell-${name} ${cmd}`;
    return execAsync(
      `wsl -d ${WSL_DISTRO} -e bash -c "${shellCmd.replace(/"/g, '\\"')}"`,
      { timeout: REVIEW_TIMEOUT_MS, windowsHide: true },
    );
  }
  return execAsync(`ssh openshell-${name} ${cmd}`, { timeout: REVIEW_TIMEOUT_MS, windowsHide: true });
};

export const nemoclawAdapter: ExternalToolAdapter = {
  id: 'nemoclaw',
  capabilities: ['agent.onboard', 'agent.status', 'agent.connect', 'code.review'],

  isAvailable: async () => {
    if (!ENABLED) return false;
    try {
      await runCli('--version');
      return true;
    } catch {
      return false;
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
        case 'agent.onboard': {
          const { stdout } = await runCli('onboard');
          return makeResult(true, 'NemoClaw onboarded', stdout.trim().split('\n'));
        }
        case 'agent.status': {
          const { stdout } = await runCli(`${name} status`);
          return makeResult(true, `Status for ${name}`, stdout.trim().split('\n'));
        }
        case 'agent.connect': {
          const { stdout } = await runCli(`${name} connect`);
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
            const escapedPayload = curlPayload.replace(/'/g, "'\\''");
            const curlCmd = `curl -s -m 55 ${SANDBOX_OLLAMA_URL}/api/generate -d '${escapedPayload}'`;
            const { stdout: inferenceOut } = await runSandboxCmd(name, curlCmd);
            const parsed = JSON.parse(inferenceOut.trim()) as { response?: string };
            if (parsed.response && parsed.response.length > 10) {
              return makeResult(true, `AI code review via sandbox ${name}`, parsed.response.split('\n').slice(0, 40));
            }
          } catch {
            // Sandbox inference unavailable — fall through to host LLM
          }

          // Fallback: use host-side LLM via OpenAI-compatible endpoint (jarvis serve / litellm / ollama)
          const hostUrls = [
            process.env.OPENJARVIS_SERVE_URL || 'http://127.0.0.1:8000',
            process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000',
            process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
          ];
          for (const baseUrl of hostUrls) {
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);
              const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: SANDBOX_INFERENCE_MODEL,
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
                  return makeResult(true, `Code review via host LLM (${baseUrl})`, content.split('\n').slice(0, 40));
                }
              }
            } catch {
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
