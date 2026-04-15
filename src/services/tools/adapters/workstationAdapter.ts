import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseBooleanEnv } from '../../../utils/env';
import { getErrorMessage } from '../../../utils/errorMessage';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';
import { makeAdapterResult } from '../externalAdapterTypes';

const execFileAsync = promisify(execFile);
const IS_WINDOWS = process.platform === 'win32';
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.WORKSTATION_ADAPTER_DISABLED, false);
const ENABLED = parseBooleanEnv(process.env.WORKSTATION_ADAPTER_ENABLED, true);
const POWERSHELL_COMMAND = String(process.env.WORKSTATION_POWERSHELL_COMMAND || 'powershell').trim() || 'powershell';
const TIMEOUT_MS = 15_000;
const MAX_TEXT_BYTES = 128 * 1024;
const MAX_LIST_ENTRIES = 200;
const MAX_APP_ARGS = 20;
const MAX_COMMAND_ARGS = 40;
const MAX_HOTKEY_TOKENS = 4;
const ADAPTER_ID = 'workstation' as ExternalAdapterId;

const sanitizeText = (value: unknown, maxLen = 2048): string => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLen);

const getWorkspaceRoot = (): string => path.resolve(process.cwd());

const toRelativeWorkspacePath = (absolutePath: string): string => {
  const relative = path.relative(getWorkspaceRoot(), absolutePath);
  return (relative || '.').split(path.sep).join('/');
};

const isWithinWorkspace = (candidatePath: string): boolean => {
  const relative = path.relative(getWorkspaceRoot(), candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const resolveWorkspacePath = (value: unknown): string | null => {
  const raw = sanitizeText(value, 500);
  if (!raw) {
    return null;
  }

  const normalizedInput = raw.replace(/[\\/]+/g, path.sep);
  const resolved = path.isAbsolute(normalizedInput)
    ? path.resolve(normalizedInput)
    : path.resolve(getWorkspaceRoot(), normalizedInput);

  return isWithinWorkspace(resolved) ? resolved : null;
};

const resolveLaunchTarget = (value: unknown): string | null => {
  const raw = sanitizeText(value, 320);
  if (!raw) {
    return null;
  }

  if (path.isAbsolute(raw)) {
    return path.normalize(raw);
  }

  if (raw.includes('/') || raw.includes('\\')) {
    return resolveWorkspacePath(raw);
  }

  return /^[a-zA-Z0-9_.:\- ]+$/.test(raw) ? raw : null;
};

const isAllowedBrowserUrl = (value: string): boolean => /^(https?:\/\/|file:\/\/)/i.test(value);

const getDefaultCapturePath = (): string => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(getWorkspaceRoot(), 'tmp', 'workstation-captures', `capture-${stamp}.png`);
};

const ensurePngPath = (value: string): string => path.extname(value).toLowerCase() === '.png'
  ? value
  : `${value}.png`;

const splitContentLines = (content: string, maxLines = 120): { lines: string[]; truncated: boolean } => {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  return {
    lines: lines.slice(0, maxLines),
    truncated: lines.length > maxLines,
  };
};

const normalizeArgList = (value: unknown, maxArgs: number): string[] => Array.isArray(value)
  ? value
    .map((entry) => sanitizeText(entry, 240))
    .filter(Boolean)
    .slice(0, maxArgs)
  : [];

const parseLastJsonLine = <T>(value: string): T | null => {
  const lines = String(value || '').replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as T;
    } catch {
      // Ignore non-JSON log lines and keep scanning backwards.
    }
  }
  return null;
};

const escapeSendKeysLiteral = (value: string): string => value
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .split('\n')
  .map((line) => line
    .replace(/\{/g, '{{}')
    .replace(/\}/g, '{}}')
    .replace(/\+/g, '{+}')
    .replace(/\^/g, '{^}')
    .replace(/%/g, '{%}')
    .replace(/~/g, '{~}')
    .replace(/\(/g, '{(}')
    .replace(/\)/g, '{)}')
    .replace(/\[/g, '{[}')
    .replace(/\]/g, '{]}'))
  .join('{ENTER}');

const normalizeHotkeyTokens = (value: unknown): string[] => {
  const rawTokens = Array.isArray(value)
    ? value.map((entry) => sanitizeText(entry, 50))
    : sanitizeText(value, 120).split('+').map((entry) => sanitizeText(entry, 50));

  return rawTokens
    .map((entry) => entry.toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_HOTKEY_TOKENS);
};

const HOTKEY_MODIFIERS = new Map<string, string>([
  ['ctrl', '^'],
  ['control', '^'],
  ['alt', '%'],
  ['shift', '+'],
]);

const HOTKEY_SPECIAL_KEYS = new Map<string, string>([
  ['backspace', '{BACKSPACE}'],
  ['delete', '{DELETE}'],
  ['down', '{DOWN}'],
  ['end', '{END}'],
  ['enter', '{ENTER}'],
  ['esc', '{ESC}'],
  ['escape', '{ESC}'],
  ['home', '{HOME}'],
  ['left', '{LEFT}'],
  ['pagedown', '{PGDN}'],
  ['pageup', '{PGUP}'],
  ['pgdn', '{PGDN}'],
  ['pgup', '{PGUP}'],
  ['right', '{RIGHT}'],
  ['space', ' '],
  ['tab', '{TAB}'],
  ['up', '{UP}'],
]);

const buildHotkeySendKeys = (value: unknown): { combo: string; sendKeys: string } | null => {
  const tokens = normalizeHotkeyTokens(value);
  if (tokens.length === 0) {
    return null;
  }

  const modifiers: string[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    const modifier = HOTKEY_MODIFIERS.get(token);
    if (modifier) {
      modifiers.push(modifier);
      continue;
    }
    keys.push(token);
  }

  const primaryKey = keys[0];
  if (!primaryKey) {
    return null;
  }

  let keySpec = HOTKEY_SPECIAL_KEYS.get(primaryKey);
  if (!keySpec && /^f(?:[1-9]|1[0-2])$/i.test(primaryKey)) {
    keySpec = `{${primaryKey.toUpperCase()}}`;
  }
  if (!keySpec && primaryKey.length === 1) {
    keySpec = escapeSendKeysLiteral(primaryKey);
  }
  if (!keySpec) {
    return null;
  }

  return {
    combo: tokens.join('+'),
    sendKeys: `${modifiers.join('')}${keySpec}`,
  };
};

const resolveCommandCwd = (value: unknown): string | null => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return getWorkspaceRoot();
  }
  return resolveWorkspacePath(value);
};

const formatCommandOutput = (
  stdout: string,
  stderr: string,
  metadataLines: string[],
): { lines: string[]; truncated: boolean } => {
  const combined = [stdout.trim(), stderr.trim(), ...metadataLines].filter(Boolean).join('\n');
  return splitContentLines(combined || metadataLines.join('\n'));
};

const runPowerShell = async (
  script: string,
  envOverrides: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> => {
  return execFileAsync(
    POWERSHELL_COMMAND,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: {
        ...(process.env as Record<string, string>),
        ...envOverrides,
      },
    },
  );
};

const probePowerShell = async (): Promise<string | null> => {
  if (!IS_WINDOWS) {
    return null;
  }

  try {
    const { stdout } = await runPowerShell('Write-Output $PSVersionTable.PSVersion.ToString()');
    return sanitizeText(stdout, 120) || 'unknown';
  } catch {
    return null;
  }
};

const makeResult = (
  ok: boolean,
  action: string,
  summary: string,
  output: string[],
  durationMs: number,
  error?: string,
): ExternalAdapterResult => makeAdapterResult(ADAPTER_ID, ok, action, summary, output, durationMs, error);

export const workstationAdapter: ExternalToolAdapter = {
  id: 'workstation',
  description: 'Local workstation executor. Runs bounded local commands, drives active desktop windows, captures screenshots, and performs workspace-scoped file operations.',
  capabilities: ['workstation.health', 'command.exec', 'browser.open', 'app.launch', 'app.activate', 'input.text', 'input.hotkey', 'screen.capture', 'file.list', 'file.read', 'file.write'],

  isAvailable: async () => {
    if (EXPLICITLY_DISABLED || !ENABLED) {
      return false;
    }

    if (!IS_WINDOWS) {
      return true;
    }

    return Boolean(await probePowerShell());
  },

  execute: async (action, args) => {
    const start = Date.now();

    try {
      switch (action) {
        case 'workstation.health': {
          const shellVersion = await probePowerShell();
          if (IS_WINDOWS && !shellVersion) {
            return makeResult(false, action, 'PowerShell is unavailable', [], Date.now() - start, 'POWERSHELL_UNAVAILABLE');
          }

          return makeResult(true, action, 'Local workstation executor ready', [
            `platform=${process.platform}`,
            `workspace=${getWorkspaceRoot()}`,
            shellVersion ? `shell=powershell ${shellVersion}` : 'shell=filesystem-only',
            'file-guard=workspace-only',
            'actions=command.exec,browser.open,app.launch,app.activate,input.text,input.hotkey,screen.capture,file.list,file.read,file.write',
          ], Date.now() - start);
        }

        case 'command.exec': {
          const target = resolveLaunchTarget(args.target ?? args.command ?? args.app);
          if (!target) {
            return makeResult(false, action, 'Command target required', [], Date.now() - start, 'MISSING_TARGET');
          }

          const cwd = resolveCommandCwd(args.cwd);
          if (!cwd) {
            return makeResult(false, action, 'Command cwd must stay inside the workspace', [], Date.now() - start, 'INVALID_PATH');
          }

          const argList = normalizeArgList(args.args, MAX_COMMAND_ARGS);

          let stdout = '';
          let stderr = '';
          let exitCode = 0;

          if (IS_WINDOWS) {
            const { stdout: rawStdout } = await runPowerShell([
              '$ErrorActionPreference = "Stop"',
              '$argList = @()',
              'if ($env:WORKSTATION_ARGS_JSON) {',
              '  $decoded = ConvertFrom-Json -InputObject $env:WORKSTATION_ARGS_JSON',
              '  if ($decoded -is [System.Array]) { $argList = @($decoded) }',
              '  elseif ($null -ne $decoded) { $argList = @([string]$decoded) }',
              '}',
              '$commandStdout = ""',
              '$commandStderr = ""',
              '$commandExitCode = 0',
              'Push-Location $env:WORKSTATION_CWD',
              'try {',
              '  $commandStdout = (& $env:WORKSTATION_COMMAND @argList 2>&1 | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine',
              '  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { $commandExitCode = [int]$LASTEXITCODE }',
              '} catch {',
              '  $commandStderr = $_ | Out-String',
              '  $commandExitCode = if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { [int]$LASTEXITCODE } else { 1 }',
              '} finally {',
              '  Pop-Location',
              '}',
              '@{ stdout = $commandStdout; stderr = $commandStderr; exitCode = $commandExitCode } | ConvertTo-Json -Compress',
            ].join('; '), {
              WORKSTATION_COMMAND: target,
              WORKSTATION_ARGS_JSON: JSON.stringify(argList),
              WORKSTATION_CWD: cwd,
            });

            const parsed = parseLastJsonLine<{ stdout?: string; stderr?: string; exitCode?: number }>(rawStdout);
            stdout = String(parsed?.stdout || '');
            stderr = String(parsed?.stderr || '');
            exitCode = Number.isFinite(parsed?.exitCode) ? Number(parsed?.exitCode) : 1;
          } else {
            try {
              const result = await execFileAsync(target, argList, {
                cwd,
                timeout: TIMEOUT_MS,
                windowsHide: true,
                maxBuffer: 1024 * 1024,
              });
              stdout = String(result.stdout || '');
              stderr = String(result.stderr || '');
            } catch (err) {
              const execError = err as Error & { stdout?: string; stderr?: string; code?: number | string };
              stdout = String(execError.stdout || '');
              stderr = String(execError.stderr || execError.message || '');
              exitCode = typeof execError.code === 'number'
                ? execError.code
                : Number(execError.code) || 1;
            }
          }

          const relativeCwd = toRelativeWorkspacePath(cwd);
          const { lines, truncated } = formatCommandOutput(stdout, stderr, [
            `cwd=${relativeCwd}`,
            `target=${target}`,
            `exitCode=${exitCode}`,
          ]);
          const ok = exitCode === 0;
          const summary = ok
            ? `${target} completed${truncated ? ' (truncated)' : ''}`
            : `${target} exited with ${exitCode}${truncated ? ' (truncated)' : ''}`;

          return makeResult(ok, action, summary, lines, Date.now() - start, ok ? undefined : `COMMAND_EXIT_${exitCode}`);
        }

        case 'browser.open': {
          if (!IS_WINDOWS) {
            return makeResult(false, action, 'browser.open is only available on Windows', [], Date.now() - start, 'PLATFORM_UNSUPPORTED');
          }

          const url = sanitizeText(args.url, 2048);
          if (!url) {
            return makeResult(false, action, 'URL required', [], Date.now() - start, 'MISSING_URL');
          }
          if (!isAllowedBrowserUrl(url)) {
            return makeResult(false, action, 'Only http(s) and file URLs are allowed', [], Date.now() - start, 'INVALID_URL');
          }

          await runPowerShell('$ErrorActionPreference = "Stop"; Start-Process -FilePath $env:WORKSTATION_URL | Out-Null', {
            WORKSTATION_URL: url,
          });

          return makeResult(true, action, 'Opened URL in the default browser', [
            `url=${url}`,
            'transport=start-process',
          ], Date.now() - start);
        }

        case 'app.launch': {
          if (!IS_WINDOWS) {
            return makeResult(false, action, 'app.launch is only available on Windows', [], Date.now() - start, 'PLATFORM_UNSUPPORTED');
          }

          const target = resolveLaunchTarget(args.target ?? args.app ?? args.command);
          if (!target) {
            return makeResult(false, action, 'App target required', [], Date.now() - start, 'MISSING_TARGET');
          }

          const argList = normalizeArgList(args.args, MAX_APP_ARGS);

          await runPowerShell([
            '$ErrorActionPreference = "Stop"',
            '$argList = @()',
            'if ($env:WORKSTATION_ARGS_JSON) {',
            '  $decoded = ConvertFrom-Json -InputObject $env:WORKSTATION_ARGS_JSON',
            '  if ($decoded -is [System.Array]) { $argList = @($decoded) }',
            '  elseif ($null -ne $decoded) { $argList = @([string]$decoded) }',
            '}',
            'if ($argList.Count -gt 0) {',
            '  Start-Process -FilePath $env:WORKSTATION_APP -ArgumentList $argList | Out-Null',
            '} else {',
            '  Start-Process -FilePath $env:WORKSTATION_APP | Out-Null',
            '}',
          ].join('; '), {
            WORKSTATION_APP: target,
            WORKSTATION_ARGS_JSON: JSON.stringify(argList),
          });

          return makeResult(true, action, `Launched ${target}`, [
            `target=${target}`,
            ...(argList.length > 0 ? [`args=${argList.join(' ')}`] : []),
          ], Date.now() - start);
        }

        case 'app.activate': {
          if (!IS_WINDOWS) {
            return makeResult(false, action, 'app.activate is only available on Windows', [], Date.now() - start, 'PLATFORM_UNSUPPORTED');
          }

          const target = sanitizeText(args.target ?? args.title ?? args.window ?? args.app, 240);
          if (!target) {
            return makeResult(false, action, 'Window target required', [], Date.now() - start, 'MISSING_TARGET');
          }

          await runPowerShell([
            '$ErrorActionPreference = "Stop"',
            'Add-Type -AssemblyName Microsoft.VisualBasic',
            '[Microsoft.VisualBasic.Interaction]::AppActivate($env:WORKSTATION_WINDOW_TARGET) | Out-Null',
          ].join('; '), {
            WORKSTATION_WINDOW_TARGET: target,
          });

          return makeResult(true, action, `Activated ${target}`, [
            `target=${target}`,
          ], Date.now() - start);
        }

        case 'input.text': {
          if (!IS_WINDOWS) {
            return makeResult(false, action, 'input.text is only available on Windows', [], Date.now() - start, 'PLATFORM_UNSUPPORTED');
          }

          const rawText = typeof args.text === 'string'
            ? args.text
            : typeof args.content === 'string'
              ? args.content
              : '';
          if (!rawText) {
            return makeResult(false, action, 'Text input required', [], Date.now() - start, 'MISSING_TEXT');
          }

          const activateTarget = sanitizeText(args.target ?? args.window ?? args.app, 240);
          await runPowerShell([
            '$ErrorActionPreference = "Stop"',
            'Add-Type -AssemblyName System.Windows.Forms',
            'if ($env:WORKSTATION_WINDOW_TARGET) {',
            '  Add-Type -AssemblyName Microsoft.VisualBasic',
            '  [Microsoft.VisualBasic.Interaction]::AppActivate($env:WORKSTATION_WINDOW_TARGET) | Out-Null',
            '}',
            '[System.Windows.Forms.SendKeys]::SendWait($env:WORKSTATION_SEND_KEYS)',
          ].join('; '), {
            WORKSTATION_WINDOW_TARGET: activateTarget,
            WORKSTATION_SEND_KEYS: escapeSendKeysLiteral(rawText),
          });

          return makeResult(true, action, activateTarget
            ? `Activated ${activateTarget} and sent text input`
            : 'Sent text input to the active window', [
            ...(activateTarget ? [`target=${activateTarget}`] : []),
            `chars=${rawText.length}`,
          ], Date.now() - start);
        }

        case 'input.hotkey': {
          if (!IS_WINDOWS) {
            return makeResult(false, action, 'input.hotkey is only available on Windows', [], Date.now() - start, 'PLATFORM_UNSUPPORTED');
          }

          const hotkey = buildHotkeySendKeys(args.combo ?? args.keys);
          if (!hotkey) {
            return makeResult(false, action, 'A valid hotkey combo is required', [], Date.now() - start, 'INVALID_HOTKEY');
          }

          const activateTarget = sanitizeText(args.target ?? args.window ?? args.app, 240);
          await runPowerShell([
            '$ErrorActionPreference = "Stop"',
            'Add-Type -AssemblyName System.Windows.Forms',
            'if ($env:WORKSTATION_WINDOW_TARGET) {',
            '  Add-Type -AssemblyName Microsoft.VisualBasic',
            '  [Microsoft.VisualBasic.Interaction]::AppActivate($env:WORKSTATION_WINDOW_TARGET) | Out-Null',
            '}',
            '[System.Windows.Forms.SendKeys]::SendWait($env:WORKSTATION_SEND_KEYS)',
          ].join('; '), {
            WORKSTATION_WINDOW_TARGET: activateTarget,
            WORKSTATION_SEND_KEYS: hotkey.sendKeys,
          });

          return makeResult(true, action, activateTarget
            ? `Activated ${activateTarget} and sent ${hotkey.combo}`
            : `Sent ${hotkey.combo} to the active window`, [
            ...(activateTarget ? [`target=${activateTarget}`] : []),
            `combo=${hotkey.combo}`,
          ], Date.now() - start);
        }

        case 'screen.capture': {
          if (!IS_WINDOWS) {
            return makeResult(false, action, 'screen.capture is only available on Windows', [], Date.now() - start, 'PLATFORM_UNSUPPORTED');
          }

          const explicitPath = args.path ? resolveWorkspacePath(args.path) : null;
          if (args.path && !explicitPath) {
            return makeResult(false, action, 'Capture path must stay inside the workspace', [], Date.now() - start, 'INVALID_PATH');
          }

          const capturePath = ensurePngPath(explicitPath || getDefaultCapturePath());
          await mkdir(path.dirname(capturePath), { recursive: true });
          await runPowerShell([
            '$ErrorActionPreference = "Stop"',
            'Add-Type -AssemblyName System.Windows.Forms',
            'Add-Type -AssemblyName System.Drawing',
            '$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen',
            '$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
            '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
            '$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)',
            '$bitmap.Save($env:WORKSTATION_CAPTURE_PATH, [System.Drawing.Imaging.ImageFormat]::Png)',
            '$graphics.Dispose()',
            '$bitmap.Dispose()',
          ].join('; '), {
            WORKSTATION_CAPTURE_PATH: capturePath,
          });

          return makeResult(true, action, 'Captured the current workstation screen', [
            `path=${toRelativeWorkspacePath(capturePath)}`,
            'format=png',
            'scope=virtual-screen',
          ], Date.now() - start);
        }

        case 'file.list': {
          const directoryPath = args.path ? resolveWorkspacePath(args.path) : getWorkspaceRoot();
          if (!directoryPath) {
            return makeResult(false, action, 'Directory path must stay inside the workspace', [], Date.now() - start, 'INVALID_PATH');
          }

          const entries = await readdir(directoryPath, { withFileTypes: true });
          const output = await Promise.all(entries
            .sort((left, right) => left.name.localeCompare(right.name))
            .slice(0, MAX_LIST_ENTRIES)
            .map(async (entry) => {
              const absoluteChildPath = path.join(directoryPath, entry.name);
              const relativeChildPath = toRelativeWorkspacePath(absoluteChildPath);
              if (entry.isDirectory()) {
                return `dir ${relativeChildPath}/`;
              }
              const metadata = await stat(absoluteChildPath).catch(() => null);
              return `file ${relativeChildPath}${metadata ? ` (${metadata.size} bytes)` : ''}`;
            }));

          return makeResult(true, action, `Listed ${output.length} entries`, output, Date.now() - start);
        }

        case 'file.read': {
          const targetPath = resolveWorkspacePath(args.path);
          if (!targetPath) {
            return makeResult(false, action, 'File path must stay inside the workspace', [], Date.now() - start, 'INVALID_PATH');
          }

          const buffer = await readFile(targetPath);
          if (buffer.includes(0)) {
            return makeResult(false, action, 'Binary files are not supported', [], Date.now() - start, 'BINARY_FILE_UNSUPPORTED');
          }
          if (buffer.byteLength > MAX_TEXT_BYTES) {
            return makeResult(false, action, `File exceeds ${MAX_TEXT_BYTES} bytes`, [], Date.now() - start, 'FILE_TOO_LARGE');
          }

          const { lines, truncated } = splitContentLines(buffer.toString('utf8'));
          return makeResult(true, action, truncated
            ? `Read ${toRelativeWorkspacePath(targetPath)} (truncated)`
            : `Read ${toRelativeWorkspacePath(targetPath)}`,
          lines, Date.now() - start);
        }

        case 'file.write': {
          const targetPath = resolveWorkspacePath(args.path);
          if (!targetPath) {
            return makeResult(false, action, 'File path must stay inside the workspace', [], Date.now() - start, 'INVALID_PATH');
          }
          if (typeof args.content !== 'string') {
            return makeResult(false, action, 'String content required', [], Date.now() - start, 'MISSING_CONTENT');
          }

          const content = String(args.content);
          const bytes = Buffer.byteLength(content, 'utf8');
          if (bytes > MAX_TEXT_BYTES) {
            return makeResult(false, action, `Content exceeds ${MAX_TEXT_BYTES} bytes`, [], Date.now() - start, 'CONTENT_TOO_LARGE');
          }

          await mkdir(path.dirname(targetPath), { recursive: true });
          await writeFile(targetPath, content, 'utf8');

          return makeResult(true, action, `Wrote ${toRelativeWorkspacePath(targetPath)}`, [
            `path=${toRelativeWorkspacePath(targetPath)}`,
            `bytes=${bytes}`,
          ], Date.now() - start);
        }

        default:
          return makeResult(false, action, `Unknown action: ${action}`, [], Date.now() - start, 'UNKNOWN_ACTION');
      }
    } catch (err) {
      return makeResult(false, action, `workstation ${action} failed`, [getErrorMessage(err)], Date.now() - start, 'EXECUTION_FAILED');
    }
  },
};