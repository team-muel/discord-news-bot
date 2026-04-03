import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBooleanEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 15_000;
const ENABLED = parseBooleanEnv(process.env.OPENCLAW_ENABLED, false);

const stripShellMeta = (s: string): string => s.replace(/[|&;$`<>(){}\[\]!#"'\\\n\r]/g, '');

const runCli = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  return execFileAsync('openclaw', args, {
    timeout: TIMEOUT_MS,
    windowsHide: true,
  });
};

export const openclawAdapter: ExternalToolAdapter = {
  id: 'openclaw',
  capabilities: ['agent.chat', 'agent.skill.create', 'agent.session.relay'],

  isAvailable: async () => {
    if (!ENABLED) return false;
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
      adapterId: 'openclaw',
      action,
      summary,
      output,
      error,
      durationMs: Date.now() - start,
    });

    try {
      switch (action) {
        case 'agent.chat': {
          const message = String(args.message || '').slice(0, 2000);
          if (!message) return makeResult(false, 'Message required', [], 'MISSING_MESSAGE');
          const { stdout } = await runCli(['chat', stripShellMeta(message)]);
          return makeResult(true, 'Chat response received', stdout.trim().split('\n'));
        }
        case 'agent.skill.create': {
          const skillName = String(args.name || '').slice(0, 100).replace(/[^a-zA-Z0-9_-]/g, '');
          if (!skillName) return makeResult(false, 'Skill name required', [], 'MISSING_NAME');
          const { stdout } = await runCli(['skill', 'create', skillName]);
          return makeResult(true, `Skill ${skillName} created`, stdout.trim().split('\n'));
        }
        case 'agent.session.relay': {
          const message = String(args.message || '').slice(0, 4000);
          if (!message) return makeResult(false, 'Message required for relay', [], 'MISSING_MESSAGE');
          const channel = String(args.channel || 'discord').slice(0, 50).replace(/[^a-zA-Z0-9_-]/g, '');
          const sessionId = String(args.sessionId || '').slice(0, 100).replace(/[^a-zA-Z0-9_-]/g, '');
          const cliArgs = ['agent', 'relay', '--channel', channel];
          if (sessionId) cliArgs.push('--session', sessionId);
          cliArgs.push(stripShellMeta(message));
          const { stdout } = await runCli(cliArgs);
          return makeResult(true, `Message relayed via ${channel}`, stdout.trim().split('\n'));
        }
        default:
          return makeResult(false, `Unknown action: ${action}`, [], 'UNKNOWN_ACTION');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult(false, `openclaw ${action} failed`, [message], 'EXECUTION_FAILED');
    }
  },
};
