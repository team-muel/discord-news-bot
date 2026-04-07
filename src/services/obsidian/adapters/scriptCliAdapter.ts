import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBooleanEnv, parseIntegerEnv, parseStringEnv } from '../../../utils/env';
import type { ObsidianLoreQuery, ObsidianVaultAdapter } from '../types';

const execFileAsync = promisify(execFile);
const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const OBSIDIAN_CLI_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_CLI_ENABLED, true);
const OBSIDIAN_CLI_COMMAND = parseStringEnv(process.env.OBSIDIAN_CLI_COMMAND, '');
const OBSIDIAN_CLI_ARGS_JSON = parseStringEnv(process.env.OBSIDIAN_CLI_ARGS_JSON, '');
const OBSIDIAN_CLI_TIMEOUT_MS = Math.max(500, parseIntegerEnv(process.env.OBSIDIAN_CLI_TIMEOUT_MS, 4_000));
const OBSIDIAN_CLI_MAX_HINTS = Math.max(1, Math.min(20, parseIntegerEnv(process.env.OBSIDIAN_CLI_MAX_HINTS, 8)));

const sanitizeCliArg = (value: unknown, maxLen = 280): string => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\r?\n/g, ' ')
  .replace(/[|&;$`<>]/g, ' ')
  .replace(/\$\(|\)\s*;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLen);

const buildCliArgs = (params: ObsidianLoreQuery): string[] => {
  const safeGuildId = sanitizeCliArg(params.guildId, 40);
  const safeGoal = sanitizeCliArg(params.goal, 320);
  const safeVaultPath = path.resolve(params.vaultPath || '.');
  if (!safeGuildId || !safeGoal) {
    return [];
  }

  if (!OBSIDIAN_CLI_ARGS_JSON) {
    return ['--guild-id', safeGuildId, '--goal', safeGoal, '--vault-path', safeVaultPath];
  }

  try {
    const parsed = JSON.parse(OBSIDIAN_CLI_ARGS_JSON);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => String(value || ''))
      .filter((value) => value.length > 0)
      .map((value) => value
        .replaceAll('{guildId}', safeGuildId)
        .replaceAll('{goal}', safeGoal)
        .replaceAll('{vaultPath}', safeVaultPath))
      .map((value) => sanitizeCliArg(value, 280));
  } catch {
    return ['--guild-id', safeGuildId, '--goal', safeGoal, '--vault-path', safeVaultPath];
  }
};

const readLore = async (params: ObsidianLoreQuery): Promise<string[]> => {
  const args = buildCliArgs(params);
  if (args.length === 0 || !OBSIDIAN_CLI_COMMAND) {
    return [];
  }

  try {
    const { stdout } = await execFileAsync(OBSIDIAN_CLI_COMMAND, args, {
      timeout: OBSIDIAN_CLI_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });

    return String(stdout || '')
      .split(/\r?\n/)
      .map((line) => toSingleLine(line))
      .filter(Boolean)
      .slice(0, OBSIDIAN_CLI_MAX_HINTS)
      .map((line) => `[obsidian-cli] ${line}`);
  } catch {
    return [];
  }
};

export const scriptCliObsidianAdapter: ObsidianVaultAdapter = {
  id: 'script-cli',
  capabilities: ['read_lore'],
  isAvailable: () => OBSIDIAN_CLI_ENABLED && OBSIDIAN_CLI_COMMAND.length > 0,
  readLore,
};
