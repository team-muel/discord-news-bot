import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';
import logger from '../../../logger';
import { isAnyLlmConfigured } from '../../llmClient';
import { sendGatewayChat } from '../../openclaw/gatewayHealth';
import {
  NEMOCLAW_ENABLED as ENABLED,
  NEMOCLAW_DISABLED as EXPLICITLY_DISABLED,
  NEMOCLAW_SANDBOX_NAME as SANDBOX_NAME,
  NEMOCLAW_INFERENCE_MODEL as SANDBOX_INFERENCE_MODEL,
  NEMOCLAW_SANDBOX_OLLAMA_URL as SANDBOX_OLLAMA_URL,
  WSL_DISTRO,
} from '../../../config';
import { getErrorMessage } from '../../../utils/errorMessage';
import { runAdapterLlmFallback } from './llmFallback';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 15_000;
const REVIEW_TIMEOUT_MS = 60_000;
const IS_WINDOWS = process.platform === 'win32';

/**
 * Lite mode: when the nemoclaw CLI is not installed on the single-node baseline,
 * but a LiteLLM proxy is available, expose code.review capability via LLM inference only.
 * Full sandbox/onboard/connect features remain unavailable.
 */
let cliAvailable: boolean | null = null;

const sanitizeArg = (value: string, maxLen = 300): string =>
  String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[;&|`$(){}]/g, '').trim().slice(0, maxLen);

const runCli = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  if (IS_WINDOWS) {
    const escaped = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const shellCmd = [
      'export NVM_DIR="$HOME/.nvm"',
      '[ -f "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1',
      'export PATH="$HOME/.local/bin:$PATH"',
      `nemoclaw ${escaped}`,
    ].join('; ');
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
    const shellCmd = [
      'export NVM_DIR="$HOME/.nvm"',
      '[ -f "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1',
      'export PATH="$HOME/.local/bin:$PATH"',
      `openshell sandbox exec -n '${safeName.replace(/'/g, "'\\''")}' -- ${escaped}`,
    ].join('; ');
    return execFileAsync(
      'wsl',
      ['-d', WSL_DISTRO, '-e', 'bash', '-c', shellCmd],
      { timeout: REVIEW_TIMEOUT_MS, windowsHide: true },
    );
  }
  return execFileAsync('openshell', ['sandbox', 'exec', '-n', safeName, '--', ...cmd], { timeout: REVIEW_TIMEOUT_MS, windowsHide: true });
};

export const nemoclawAdapter: ExternalToolAdapter = {
  id: 'nemoclaw',
  description: 'NVIDIA NemoClaw — reference stack for running OpenClaw inside OpenShell. Agent onboarding, status monitoring, and automated code review.',
  capabilities: ['agent.onboard', 'agent.status', 'agent.connect', 'code.review'],
  liteCapabilities: ['code.review'],

  isAvailable: async () => {
    if (EXPLICITLY_DISABLED || !ENABLED) return false;
    try {
      await runCli(['--version']);
      cliAvailable = true;
      return true;
    } catch {
      cliAvailable = false;
      // Lite mode: any LLM configured → code.review only
      return isAnyLlmConfigured();
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
            logger.debug('[NEMOCLAW] sandbox inference unavailable: %s', getErrorMessage(sandboxErr));
            // Sandbox inference unavailable — fall through to OpenClaw Gateway / host LLM
          }

          // Fallback 2: OpenClaw Gateway (session-aware, lower latency than full llmClient pipeline)
          try {
            const gwResult = await sendGatewayChat({
              user: prompt.slice(0, 6000),
              system: 'You are a thorough code reviewer. Identify bugs, security issues, and test gaps.',
              actionName: 'code.review',
              temperature: 0.2,
              maxTokens: 1500,
            });
            if (gwResult && gwResult.length > 10) {
              const mode = cliAvailable === false ? ' (lite mode)' : '';
              return makeResult(true, `Code review via OpenClaw Gateway${mode}`, gwResult.split('\n').slice(0, 40));
            }
          } catch (gwErr) {
            logger.debug('[NEMOCLAW] OpenClaw Gateway fallback skipped: %s', getErrorMessage(gwErr));
          }

          // Fallback 3: use llmClient pipeline (routing, retry, telemetry all handled centrally)
          const fallbackLines = await runAdapterLlmFallback({
            actionName: 'code.review',
            system: 'You are a thorough code reviewer. Identify bugs, security issues, and test gaps.',
            user: prompt.slice(0, 6000),
            temperature: 0.2,
            maxTokens: 1500,
            lineLimit: 40,
            minContentLength: 10,
            debugLabel: '[NEMOCLAW]',
          });
          if (fallbackLines) {
            const mode = cliAvailable === false ? ' (lite mode)' : '';
            return makeResult(true, `Code review via llmClient${mode}`, fallbackLines);
          }

          return makeResult(false, `Code review failed: no inference endpoint available`, [], 'INFERENCE_UNAVAILABLE');
        }
        default:
          return makeResult(false, `Unknown action: ${action}`, [], 'UNKNOWN_ACTION');
      }
    } catch (err) {
      const message = getErrorMessage(err);
      return makeResult(false, `nemoclaw ${action} failed`, [message], 'EXECUTION_FAILED');
    }
  },
};
