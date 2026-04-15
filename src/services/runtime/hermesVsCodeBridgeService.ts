import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { getErrorMessage } from '../../utils/errorMessage';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { readObsidianFileWithAdapter, writeObsidianNoteWithAdapter } from '../obsidian/router';

export type HermesVsCodeBridgeAction = 'open-agents' | 'goto' | 'diff' | 'open' | 'wait' | 'chat';
export type HermesVsCodeBridgeCompletion = 'completed' | 'queued' | 'skipped';
export type HermesVsCodeBridgeErrorCode =
  | 'CODE_CLI_MISSING'
  | 'PACKET_PATH_MISSING'
  | 'PACKET_NOT_FOUND'
  | 'PACKET_READ_FAILED'
  | 'PACKET_WRITE_FAILED'
  | 'VALIDATION'
  | 'COMMAND_FAILED';

export type HermesVsCodeBridgeStatus = {
  configured: boolean;
  repoRoot: string;
  codeCliPath: string | null;
  codeCliExists: boolean;
  vaultPath: string | null;
  packetPath: string | null;
  packetRelativePath: string | null;
  packetExists: boolean;
  allowedActions: HermesVsCodeBridgeAction[];
  issues: string[];
};

export type HermesVsCodeBridgeRunParams = {
  action: string | null | undefined;
  filePath?: string | null;
  targetPath?: string | null;
  leftPath?: string | null;
  rightPath?: string | null;
  line?: number | null;
  column?: number | null;
  reason?: string | null;
  packetPath?: string | null;
  codeCliPath?: string | null;
  vaultPath?: string | null;
  prompt?: string | null;
  chatMode?: string | null;
  addFilePaths?: string[] | null;
  maximize?: boolean;
  newWindow?: boolean;
  reuseWindow?: boolean;
  dryRun?: boolean;
};

export type HermesVsCodeBridgePacketLog = {
  attempted: boolean;
  packetPath: string | null;
  packetRelativePath: string | null;
  logged: boolean;
  entry: string | null;
  error: string | null;
};

export type HermesVsCodeBridgeRunResult = {
  ok: boolean;
  action: HermesVsCodeBridgeAction | null;
  dryRun: boolean;
  completion: HermesVsCodeBridgeCompletion;
  command: string | null;
  pid: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdoutLines: string[];
  stderrLines: string[];
  statusBefore: HermesVsCodeBridgeStatus;
  statusAfter: HermesVsCodeBridgeStatus;
  packetLog: HermesVsCodeBridgePacketLog;
  errorCode: HermesVsCodeBridgeErrorCode | null;
  error: string | null;
};

type ResolvedPacket = {
  vaultPath: string;
  absolutePath: string;
  relativePath: string;
};

type ResolvedAction =
  | { action: 'open-agents'; args: string[]; targetSummary: string }
  | { action: 'goto'; args: string[]; targetSummary: string }
  | { action: 'diff'; args: string[]; targetSummary: string }
  | { action: 'open'; args: string[]; targetSummary: string }
  | { action: 'wait'; args: string[]; targetSummary: string }
  | { action: 'chat'; args: string[]; targetSummary: string };

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(moduleDir, '../../../');
const DEFAULT_PACKET_RELATIVE_PATH = 'plans/execution/HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS.md';
const COMMAND_TIMEOUT_MS = 15_000;
const GENERATED_LOG_PREFIX = '- hermes_vscode_bridge: ';
const MAX_GENERATED_LOG_LINES = 12;
const ALLOWED_ACTIONS: HermesVsCodeBridgeAction[] = ['open-agents', 'goto', 'diff', 'open', 'wait', 'chat'];

const cleanText = (value: unknown, maxLength = 240): string => {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
};

const cleanPromptText = (value: unknown, maxLength = 4_000): string => {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, maxLength);
};

const toOptionalPath = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  return normalized ? path.resolve(normalized) : null;
};

const isAllowedAction = (value: unknown): value is HermesVsCodeBridgeAction => {
  return ALLOWED_ACTIONS.includes(String(value || '').trim() as HermesVsCodeBridgeAction);
};

const toPositiveInt = (value: unknown, max: number): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > max) {
    return null;
  }
  return numeric;
};

const normalizeForComparison = (value: string): string => {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
};

const isWithinRoot = (candidatePath: string, rootPath: string): boolean => {
  const normalizedCandidate = normalizeForComparison(candidatePath);
  const normalizedRoot = normalizeForComparison(rootPath);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
};

const resolveCodeCliPath = (overridePath?: string | null): string | null => {
  const override = cleanText(overridePath, 400);
  if (override) {
    return path.resolve(override);
  }

  const defaultPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
  return fs.existsSync(defaultPath) ? defaultPath : null;
};

const resolveVaultPath = (overridePath?: string | null): string | null => {
  const override = cleanText(overridePath, 400);
  if (override) {
    return path.resolve(override);
  }

  const configured = cleanText(getObsidianVaultRoot(), 400);
  return configured ? path.resolve(configured) : null;
};

const resolvePacket = (params?: { vaultPath?: string | null; packetPath?: string | null }): ResolvedPacket | null => {
  const vaultPath = resolveVaultPath(params?.vaultPath);
  if (!vaultPath) {
    return null;
  }

  const packetOverride = cleanText(params?.packetPath, 500);
  const absolutePath = packetOverride
    ? (path.isAbsolute(packetOverride) ? path.resolve(packetOverride) : path.resolve(vaultPath, packetOverride))
    : path.resolve(vaultPath, DEFAULT_PACKET_RELATIVE_PATH);
  const relativePath = path.relative(vaultPath, absolutePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return {
    vaultPath,
    absolutePath,
    relativePath,
  };
};

const collectAllowedRoots = (packet: ResolvedPacket | null): string[] => {
  const roots = [REPO_ROOT];
  if (packet?.vaultPath) {
    roots.push(packet.vaultPath);
  }
  return roots;
};

const resolveAllowedExistingPath = (rawPath: unknown, allowedRoots: string[]): string | null => {
  const normalized = cleanText(rawPath, 500);
  if (!normalized) {
    return null;
  }

  const absolutePath = path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(REPO_ROOT, normalized);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  const allowed = allowedRoots.some((rootPath) => isWithinRoot(absolutePath, rootPath));
  return allowed ? absolutePath : null;
};

const resolveAllowedExistingPaths = (rawPaths: unknown, allowedRoots: string[]): string[] => {
  const values = Array.isArray(rawPaths)
    ? rawPaths
    : String(rawPaths || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const value of values) {
    const filePath = resolveAllowedExistingPath(value, allowedRoots);
    if (!filePath || seen.has(filePath)) {
      continue;
    }
    seen.add(filePath);
    resolved.push(filePath);
  }
  return resolved;
};

const buildCommandString = (codeCliPath: string, args: string[]): string => {
  return [codeCliPath, ...args].map((item) => item.includes(' ') ? `"${item}"` : item).join(' ');
};

const quotePowerShellLiteral = (value: string): string => {
  const normalized = String(value || '');
  if (!normalized) {
    return "''";
  }
  return `'${normalized.replace(/'/g, "''")}'`;
};

export const buildHermesVsCodeBridgePowerShellCommand = (codeCliPath: string, args: string[]): string => {
  return ['&', quotePowerShellLiteral(codeCliPath), ...args.map(quotePowerShellLiteral)].join(' ');
};

const executeCodeCli = async (codeCliPath: string, args: string[]): Promise<{ stdoutLines: string[]; stderrLines: string[] }> => {
  if (process.platform === 'win32' && codeCliPath.toLowerCase().endsWith('.cmd')) {
    await queueCodeCli(codeCliPath, args);
    return {
      stdoutLines: [],
      stderrLines: [],
    };
  }

  const { stdout, stderr } = await execFileAsync(codeCliPath, args, {
    cwd: REPO_ROOT,
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  return {
    stdoutLines: String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20),
    stderrLines: String(stderr || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20),
  };
};

const queueCodeCli = async (codeCliPath: string, args: string[]): Promise<number | null> => {
  const child = process.platform === 'win32' && codeCliPath.toLowerCase().endsWith('.cmd')
    ? spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      buildHermesVsCodeBridgePowerShellCommand(codeCliPath, args),
    ], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    : spawn(codeCliPath, args, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

  return await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid ?? null);
    });
  });
};

const patchEvidenceSection = (content: string, entry: string): string => {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const headingIndex = lines.findIndex((line) => /^#\s+Evidence And References\s*$/.test(line));
  if (headingIndex < 0) {
    const joined = lines.join('\n').trimEnd();
    return `${joined}\n\n# Evidence And References\n\n${entry}\n`;
  }

  let sectionEnd = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^#\s+/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }

  const before = lines.slice(0, headingIndex + 1);
  const sectionBody = lines.slice(headingIndex + 1, sectionEnd);
  const after = lines.slice(sectionEnd);
  const staticLines = sectionBody.filter((line) => !line.startsWith(GENERATED_LOG_PREFIX));
  const generatedLines = sectionBody.filter((line) => line.startsWith(GENERATED_LOG_PREFIX));
  const nextGeneratedLines = [...generatedLines, entry].slice(-MAX_GENERATED_LOG_LINES);
  const nextSectionBody = [...staticLines, ...nextGeneratedLines];
  const merged = [...before, ...nextSectionBody, ...after].join('\n').replace(/\n{3,}/g, '\n\n');
  return merged.endsWith('\n') ? merged : `${merged}\n`;
};

const logBridgeInvocationToPacket = async (params: {
  packet: ResolvedPacket;
  entry: string;
}): Promise<void> => {
  const existing = await readObsidianFileWithAdapter({
    vaultPath: params.packet.vaultPath,
    filePath: params.packet.relativePath,
  });
  if (existing === null) {
    throw new Error('PACKET_READ_FAILED');
  }

  const nextContent = patchEvidenceSection(existing, params.entry);
  const writeResult = await writeObsidianNoteWithAdapter({
    guildId: 'system',
    vaultPath: params.packet.vaultPath,
    fileName: params.packet.relativePath,
    content: nextContent,
    tags: ['hermes', 'workspace', 'progress'],
    properties: {
      source: 'hermes-vscode-bridge',
      guild_id: 'system',
    },
    trustedSource: true,
    allowHighLinkDensity: true,
    skipKnowledgeCompilation: true,
  });
  if (!writeResult) {
    throw new Error('PACKET_WRITE_FAILED');
  }
};

const buildPacketEntry = (params: {
  action: HermesVsCodeBridgeAction;
  targetSummary: string;
  completion: HermesVsCodeBridgeCompletion;
  reason?: string | null;
  command: string;
}): string => {
  const segments = [
    `${GENERATED_LOG_PREFIX}${new Date().toISOString()}`,
    `action=${params.action}`,
    `target=${cleanText(params.targetSummary, 180)}`,
    `completion=${params.completion}`,
    `command=${cleanText(params.command, 220)}`,
  ];
  const reason = cleanText(params.reason, 160);
  if (reason) {
    segments.push(`reason=${reason}`);
  }
  return segments.join(' | ');
};

const resolveAction = (params: HermesVsCodeBridgeRunParams, packet: ResolvedPacket | null): ResolvedAction | null => {
  if (!isAllowedAction(params.action)) {
    return null;
  }

  const allowedRoots = collectAllowedRoots(packet);
  switch (params.action) {
    case 'open-agents':
      return {
        action: 'open-agents',
        args: ['--agents'],
        targetSummary: 'agents window',
      };
    case 'goto': {
      const target = resolveAllowedExistingPath(params.filePath, allowedRoots);
      const line = toPositiveInt(params.line, 200_000);
      const column = toPositiveInt(params.column, 5_000);
      if (!target || line === null) {
        return null;
      }
      const gotoTarget = `${target}:${line}${column === null ? '' : `:${column}`}`;
      return {
        action: 'goto',
        args: ['-r', '-g', gotoTarget],
        targetSummary: gotoTarget,
      };
    }
    case 'diff': {
      const left = resolveAllowedExistingPath(params.leftPath, allowedRoots);
      const right = resolveAllowedExistingPath(params.rightPath, allowedRoots);
      if (!left || !right) {
        return null;
      }
      return {
        action: 'diff',
        args: ['-r', '-d', left, right],
        targetSummary: `${left} <> ${right}`,
      };
    }
    case 'open': {
      const target = params.targetPath
        ? resolveAllowedExistingPath(params.targetPath, allowedRoots)
        : REPO_ROOT;
      if (!target) {
        return null;
      }
      return {
        action: 'open',
        args: ['-r', target],
        targetSummary: target,
      };
    }
    case 'wait': {
      const target = resolveAllowedExistingPath(params.targetPath, allowedRoots);
      if (!target) {
        return null;
      }
      return {
        action: 'wait',
        args: ['-w', target],
        targetSummary: target,
      };
    }
    case 'chat': {
      const prompt = cleanPromptText(params.prompt, 4_000);
      if (!prompt) {
        return null;
      }
      const addFilePaths = resolveAllowedExistingPaths(params.addFilePaths, allowedRoots);
      const args = ['chat'];
      const chatMode = cleanText(params.chatMode, 40);
      if (chatMode) {
        args.push('-m', chatMode);
      }
      if (params.maximize === true) {
        args.push('--maximize');
      }
      if (params.newWindow === true) {
        args.push('-n');
      } else if (params.reuseWindow !== false) {
        args.push('-r');
      }
      for (const filePath of addFilePaths) {
        args.push('-a', filePath);
      }
      args.push(prompt);
      return {
        action: 'chat',
        args,
        targetSummary: `chat:${cleanText(prompt, 120)}`,
      };
    }
    default:
      return null;
  }
};

export const getHermesVsCodeBridgeStatus = (params?: {
  codeCliPath?: string | null;
  packetPath?: string | null;
  vaultPath?: string | null;
}): HermesVsCodeBridgeStatus => {
  const codeCliPath = resolveCodeCliPath(params?.codeCliPath);
  const packet = resolvePacket({
    vaultPath: params?.vaultPath,
    packetPath: params?.packetPath,
  });
  const issues: string[] = [];
  if (!codeCliPath || !fs.existsSync(codeCliPath)) {
    issues.push('VS Code CLI path is missing; configure the standard Windows install or pass an explicit codeCliPath.');
  }
  if (!packet) {
    issues.push('Active workstream packet path could not be resolved from the Obsidian vault root.');
  } else if (!fs.existsSync(packet.absolutePath)) {
    issues.push('Active workstream packet is missing; the bridge fails closed until packet logging is possible.');
  }

  return {
    configured: issues.length === 0,
    repoRoot: REPO_ROOT,
    codeCliPath,
    codeCliExists: Boolean(codeCliPath && fs.existsSync(codeCliPath)),
    vaultPath: packet?.vaultPath || resolveVaultPath(params?.vaultPath),
    packetPath: packet?.absolutePath || null,
    packetRelativePath: packet?.relativePath || null,
    packetExists: Boolean(packet && fs.existsSync(packet.absolutePath)),
    allowedActions: [...ALLOWED_ACTIONS],
    issues,
  };
};

export const runHermesVsCodeBridge = async (params: HermesVsCodeBridgeRunParams): Promise<HermesVsCodeBridgeRunResult> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const packet = resolvePacket({
    vaultPath: params.vaultPath,
    packetPath: params.packetPath,
  });
  const statusBefore = getHermesVsCodeBridgeStatus({
    codeCliPath: params.codeCliPath,
    packetPath: params.packetPath,
    vaultPath: params.vaultPath,
  });
  const dryRun = params.dryRun === true;
  const resolvedAction = resolveAction(params, packet);
  const codeCliPath = resolveCodeCliPath(params.codeCliPath);
  const packetLog: HermesVsCodeBridgePacketLog = {
    attempted: false,
    packetPath: packet?.absolutePath || null,
    packetRelativePath: packet?.relativePath || null,
    logged: false,
    entry: null,
    error: null,
  };

  const finalize = (partial: Omit<HermesVsCodeBridgeRunResult, 'startedAt' | 'finishedAt' | 'durationMs' | 'statusBefore' | 'statusAfter' | 'packetLog' | 'dryRun'>): HermesVsCodeBridgeRunResult => ({
    ...partial,
    dryRun,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    statusBefore,
    statusAfter: getHermesVsCodeBridgeStatus({
      codeCliPath: params.codeCliPath,
      packetPath: params.packetPath,
      vaultPath: params.vaultPath,
    }),
    packetLog,
  });

  if (!codeCliPath || !fs.existsSync(codeCliPath)) {
    return finalize({
      ok: false,
      action: null,
      completion: 'skipped',
      command: null,
      pid: null,
      stdoutLines: [],
      stderrLines: [],
      errorCode: 'CODE_CLI_MISSING',
      error: 'VS Code CLI path is missing',
    });
  }

  if (!packet) {
    return finalize({
      ok: false,
      action: null,
      completion: 'skipped',
      command: null,
      pid: null,
      stdoutLines: [],
      stderrLines: [],
      errorCode: 'PACKET_PATH_MISSING',
      error: 'Active workstream packet path could not be resolved',
    });
  }

  if (!fs.existsSync(packet.absolutePath)) {
    return finalize({
      ok: false,
      action: null,
      completion: 'skipped',
      command: null,
      pid: null,
      stdoutLines: [],
      stderrLines: [],
      errorCode: 'PACKET_NOT_FOUND',
      error: 'Active workstream packet is missing',
    });
  }

  if (!resolvedAction) {
    return finalize({
      ok: false,
      action: null,
      completion: 'skipped',
      command: null,
      pid: null,
      stdoutLines: [],
      stderrLines: [],
      errorCode: 'VALIDATION',
      error: 'Invalid action or target for the Hermes VS Code bridge allowlist',
    });
  }

  const command = buildCommandString(codeCliPath, resolvedAction.args);

  if (dryRun) {
    return finalize({
      ok: true,
      action: resolvedAction.action,
      completion: 'skipped',
      command,
      pid: null,
      stdoutLines: [],
      stderrLines: [],
      errorCode: null,
      error: null,
    });
  }

  let completion: HermesVsCodeBridgeCompletion = ['wait', 'chat'].includes(resolvedAction.action) ? 'queued' : 'completed';
  let pid: number | null = null;
  let stdoutLines: string[] = [];
  let stderrLines: string[] = [];
  let commandError: string | null = null;

  try {
    if (resolvedAction.action === 'wait' || resolvedAction.action === 'chat') {
      pid = await queueCodeCli(codeCliPath, resolvedAction.args);
    } else {
      const output = await executeCodeCli(codeCliPath, resolvedAction.args);
      stdoutLines = output.stdoutLines;
      stderrLines = output.stderrLines;
    }
  } catch (error) {
    completion = 'skipped';
    commandError = getErrorMessage(error);
  }

  packetLog.attempted = true;
  packetLog.entry = buildPacketEntry({
    action: resolvedAction.action,
    targetSummary: resolvedAction.targetSummary,
    completion,
    reason: params.reason,
    command,
  });

  try {
    await logBridgeInvocationToPacket({
      packet,
      entry: packetLog.entry,
    });
    packetLog.logged = true;
  } catch (error) {
    packetLog.error = getErrorMessage(error);
  }

  if (commandError) {
    return finalize({
      ok: false,
      action: resolvedAction.action,
      completion,
      command,
      pid,
      stdoutLines,
      stderrLines,
      errorCode: 'COMMAND_FAILED',
      error: commandError,
    });
  }

  if (!packetLog.logged) {
    return finalize({
      ok: false,
      action: resolvedAction.action,
      completion,
      command,
      pid,
      stdoutLines,
      stderrLines,
      errorCode: 'PACKET_WRITE_FAILED',
      error: packetLog.error || 'Packet logging failed',
    });
  }

  return finalize({
    ok: true,
    action: resolvedAction.action,
    completion,
    command,
    pid,
    stdoutLines,
    stderrLines,
    errorCode: null,
    error: null,
  });
};