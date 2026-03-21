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
          const safePrompt = prompt.replace(/'/g, "'\\''");
          const { stdout } = await runSandboxCmd(name, `echo '${safePrompt}' | cat`);
          return makeResult(true, `Code review via sandbox ${name}`, stdout.trim().split('\n'));
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
