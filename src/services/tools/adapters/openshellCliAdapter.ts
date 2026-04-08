import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';
import {
  OPENSHELL_ENABLED as ENABLED,
  OPENSHELL_DISABLED as EXPLICITLY_DISABLED,
  OPENSHELL_REMOTE_GATEWAY as REMOTE_GATEWAY,
  WSL_DISTRO,
} from '../../../config';
import { getErrorMessage } from '../../../utils/errorMessage';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 15_000;
const IS_WINDOWS = process.platform === 'win32';

const sanitizeArg = (value: string, maxLen = 200): string =>
  String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[;&|`$(){}]/g, '').trim().slice(0, maxLen);

const runCli = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  if (IS_WINDOWS) {
    const shellCmd = `export PATH=/root/.local/bin:$PATH; openshell ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;
    return execFileAsync(
      'wsl',
      ['-d', WSL_DISTRO, '-e', 'bash', '-c', shellCmd],
      { timeout: TIMEOUT_MS, windowsHide: true },
    );
  }
  return execFileAsync('openshell', args, { timeout: TIMEOUT_MS, windowsHide: true });
};

export const openshellAdapter: ExternalToolAdapter = {
  id: 'openshell',
  description: 'NVIDIA OpenShell — safe sandbox runtime for autonomous agents. Create/manage K3s containers with YAML policy enforcement.',
  capabilities: ['sandbox.create', 'sandbox.list', 'sandbox.exec', 'sandbox.destroy', 'policy.set'],

  isAvailable: async () => {
    if (EXPLICITLY_DISABLED || !ENABLED) return false;
    try {
      await runCli(['--version']);
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
          const from = sanitizeArg(String(args.from || 'ollama'));
          try {
            const { stdout } = await runCli(['sandbox', 'create', '--from', from]);
            return makeResult(true, `Sandbox created from ${from}`, stdout.trim().split('\n'));
          } catch (localErr) {
            // D-04: Fallback to remote gateway when local Docker/WSL fails
            if (REMOTE_GATEWAY) {
              const { stdout } = await runCli(['sandbox', 'create', '--from', from, '--remote', REMOTE_GATEWAY]);
              return makeResult(true, `Sandbox created from ${from} via remote ${REMOTE_GATEWAY}`, stdout.trim().split('\n'));
            }
            throw localErr;
          }
        }
        case 'sandbox.list': {
          const { stdout } = await runCli(['sandbox', 'list']);
          return makeResult(true, 'Sandbox list retrieved', stdout.trim().split('\n'));
        }
        case 'sandbox.exec': {
          const sandboxId = sanitizeArg(String(args.sandboxId || ''));
          const command = sanitizeArg(String(args.command || ''), 2000);
          if (!sandboxId) return makeResult(false, 'Sandbox ID required', [], 'MISSING_SANDBOX_ID');
          if (!command) return makeResult(false, 'Command required', [], 'MISSING_COMMAND');
          const mode = sanitizeArg(String(args.mode || 'read_only'), 20);
          const cliArgs = ['sandbox', 'exec', sandboxId, '--', command];
          if (mode === 'workspace_write') cliArgs.splice(3, 0, '--write');
          const { stdout } = await runCli(cliArgs);
          return makeResult(true, `Sandbox ${sandboxId} exec completed`, stdout.trim().split('\n'));
        }
        case 'sandbox.destroy': {
          const sandboxId = sanitizeArg(String(args.sandboxId || ''));
          if (!sandboxId) return makeResult(false, 'Sandbox ID required', [], 'MISSING_SANDBOX_ID');
          const { stdout } = await runCli(['sandbox', 'destroy', sandboxId]);
          return makeResult(true, `Sandbox ${sandboxId} destroyed`, stdout.trim().split('\n'));
        }
        case 'policy.set': {
          const policy = sanitizeArg(String(args.policy || ''));
          if (!policy) return makeResult(false, 'Policy path required', [], 'MISSING_POLICY');
          const { stdout } = await runCli(['policy', 'set', policy]);
          return makeResult(true, `Policy applied: ${policy}`, stdout.trim().split('\n'));
        }
        default:
          return makeResult(false, `Unknown action: ${action}`, [], 'UNKNOWN_ACTION');
      }
    } catch (err) {
      const message = getErrorMessage(err);
      return makeResult(false, `openshell ${action} failed`, [message], 'EXECUTION_FAILED');
    }
  },
};
