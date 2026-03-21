import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBooleanEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';

const execAsync = promisify(exec);
const TIMEOUT_MS = 15_000;
const IS_WINDOWS = process.platform === 'win32';
const ENABLED = parseBooleanEnv(process.env.OPENSHELL_ENABLED, false);

const WSL_DISTRO = process.env.WSL_DISTRO || 'Ubuntu-24.04';

const runCli = async (args: string): Promise<{ stdout: string; stderr: string }> => {
  if (IS_WINDOWS) {
    const shellCmd = `export PATH=/root/.local/bin:$PATH; openshell ${args}`;
    return execAsync(
      `wsl -d ${WSL_DISTRO} -e bash -c "${shellCmd.replace(/"/g, '\\"')}"`,
      { timeout: TIMEOUT_MS, windowsHide: true },
    );
  }
  return execAsync(`openshell ${args}`, { timeout: TIMEOUT_MS, windowsHide: true });
};

export const openshellAdapter: ExternalToolAdapter = {
  id: 'openshell',
  capabilities: ['sandbox.create', 'sandbox.list', 'policy.set'],

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
    const makeResult = (ok: boolean, summary: string, output: string[], error?: string): ExternalAdapterResult => ({
      ok,
      adapterId: 'openshell',
      action,
      summary,
      output,
      error,
      durationMs: Date.now() - start,
    });

    try {
      switch (action) {
        case 'sandbox.create': {
          const from = String(args.from || 'ollama');
          const { stdout } = await runCli(`sandbox create --from ${from}`);
          return makeResult(true, `Sandbox created from ${from}`, stdout.trim().split('\n'));
        }
        case 'sandbox.list': {
          const { stdout } = await runCli('sandbox list');
          return makeResult(true, 'Sandbox list retrieved', stdout.trim().split('\n'));
        }
        case 'policy.set': {
          const policy = String(args.policy || '');
          if (!policy) return makeResult(false, 'Policy path required', [], 'MISSING_POLICY');
          const { stdout } = await runCli(`policy set ${policy}`);
          return makeResult(true, `Policy applied: ${policy}`, stdout.trim().split('\n'));
        }
        default:
          return makeResult(false, `Unknown action: ${action}`, [], 'UNKNOWN_ACTION');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult(false, `openshell ${action} failed`, [message], 'EXECUTION_FAILED');
    }
  },
};
