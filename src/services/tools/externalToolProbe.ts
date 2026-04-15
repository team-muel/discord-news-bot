import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  WSL_DISTRO,
  NEMOCLAW_SANDBOX_NAME,
  OLLAMA_BASE_URL,
  OPENCLAW_BASE_URL,
  OPENCLAW_GATEWAY_URL,
  OPENCLAW_GATEWAY_TOKEN,
  OPENJARVIS_ENABLED,
  OPENJARVIS_SERVE_URL,
  LITELLM_BASE_URL,
} from '../../config';
import { parseStringEnv } from '../../utils/env';
import { fetchWithTimeout } from '../../utils/network';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export type ExternalToolId =
  | 'ollama'
  | 'openshell'
  | 'nemoclaw'
  | 'openclaw'
  | 'openjarvis'
  | 'uv'
  | 'workstation'
  | 'litellm';

export type ExternalToolStatus = {
  id: ExternalToolId;
  name: string;
  available: boolean;
  version: string | null;
  apiReachable: boolean | null;
  details: string[];
};

export type ExternalToolProbeResult = {
  timestamp: string;
  tools: ExternalToolStatus[];
  summary: { total: number; available: number; apiReachable: number };
};

const PROBE_TIMEOUT_MS = 5_000;

const IS_WINDOWS = process.platform === 'win32';

const probeCommand = async (
  command: string,
  args: string[] = ['--version'],
): Promise<{ ok: boolean; output: string }> => {
  try {
    let stdout: string;
    let stderr: string;
    if (IS_WINDOWS) {
      // On Windows .cmd wrappers require shell; use exec with pre-joined command
      const safeCmd = [command, ...args].join(' ');
      const result = await execAsync(safeCmd, {
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } else {
      const result = await execFileAsync(command, args, {
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    }
    const output = (stdout || stderr || '').trim().split('\n')[0] || 'unknown';
    return { ok: true, output };
  } catch {
    return { ok: false, output: '' };
  }
};

const probeWslCommand = async (
  command: string,
  args: string[] = ['--version'],
): Promise<{ ok: boolean; output: string; fullOutput?: string }> => {
  if (!IS_WINDOWS) {
    return probeCommand(command, args);
  }
  try {
    const shellCmd = [
      'export NVM_DIR="$HOME/.nvm"',
      '[ -f "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1',
      'export PATH="$HOME/.local/bin:$PATH"',
      `${command} ${args.join(' ')}`,
    ].join('; ');
    const result = await execAsync(
      `wsl -d ${WSL_DISTRO} -e bash -c "${shellCmd.replace(/"/g, '\\"')}"`,
      { timeout: PROBE_TIMEOUT_MS * 2, windowsHide: true },
    );
    const fullOutput = (result.stdout || result.stderr || '').trim();
    const output = fullOutput.split('\n')[0] || 'unknown';
    return { ok: true, output, fullOutput };
  } catch {
    return { ok: false, output: '' };
  }
};

const probeCommandFull = async (
  command: string,
  args: string[] = [],
): Promise<{ ok: boolean; output: string; fullOutput?: string }> => {
  try {
    let stdout: string;
    let stderr: string;
    if (IS_WINDOWS) {
      const safeCmd = [command, ...args].join(' ');
      const result = await execAsync(safeCmd, {
        timeout: PROBE_TIMEOUT_MS * 2,
        windowsHide: true,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } else {
      const result = await execFileAsync(command, args, {
        timeout: PROBE_TIMEOUT_MS * 2,
        windowsHide: true,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    }
    const fullOutput = (stdout || stderr || '').trim();
    const output = fullOutput.split('\n')[0] || 'unknown';
    return { ok: true, output, fullOutput };
  } catch {
    return { ok: false, output: '' };
  }
};

const probeHttp = async (url: string): Promise<boolean> => {
  try {
    const resp = await fetchWithTimeout(url, {}, PROBE_TIMEOUT_MS);
    return resp.ok;
  } catch {
    return false;
  }
};

const stripAnsi = (value: string): string => String(value || '').replace(/\u001b\[[0-9;]*m/gu, '').trim();

const parseSandboxState = (rawOutput: string, sandboxName: string): { exists: boolean; phase: string | null } => {
  for (const line of String(rawOutput || '').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || /^name\s+/iu.test(trimmed)) {
      continue;
    }
    const parts = trimmed.split(/\s+/u);
    if (parts[0] !== sandboxName) {
      continue;
    }
    return {
      exists: true,
      phase: stripAnsi(parts[parts.length - 1] || ''),
    };
  }
  return { exists: false, phase: null };
};

const probeOpenShellSandboxState = async (sandboxName: string): Promise<{ exists: boolean; phase: string | null } | null> => {
  const sandboxProbe = IS_WINDOWS
    ? await probeWslCommand('openshell', ['sandbox', 'list'])
    : await probeCommandFull('openshell', ['sandbox', 'list']);
  if (!sandboxProbe.ok) {
    return null;
  }
  return parseSandboxState(sandboxProbe.fullOutput ?? sandboxProbe.output, sandboxName);
};

const probeOpenClawModelStatus = async (): Promise<{ defaultModel: string | null } | null> => {
  const status = await probeCommandFull('openclaw', ['models', 'status', '--json']);
  if (!status.ok || !status.fullOutput) {
    return null;
  }
  try {
    const parsed = JSON.parse(status.fullOutput) as { defaultModel?: string | null };
    return { defaultModel: parsed.defaultModel || null };
  } catch {
    return null;
  }
};

const probeOpenClawChatApi = async (baseUrl: string): Promise<{ ok: boolean; detail: string }> => {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (OPENCLAW_GATEWAY_TOKEN) {
      headers.Authorization = `Bearer ${OPENCLAW_GATEWAY_TOKEN}`;
    }

    const resp = await fetchWithTimeout(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers,
    }, PROBE_TIMEOUT_MS);
    const contentType = String(resp.headers?.get?.('content-type') || '').toLowerCase();

    if (!resp.ok) {
      return { ok: false, detail: `chat api http ${resp.status}` };
    }
    if (!contentType.includes('application/json')) {
      return { ok: false, detail: `chat api unavailable (${contentType || 'non-json'})` };
    }

    return { ok: true, detail: 'chat api ready' };
  } catch {
    return { ok: false, detail: 'chat api unreachable' };
  }
};

const probeOllama = async (): Promise<ExternalToolStatus> => {
  const cmd = await probeCommand('ollama', ['--version']);
  const baseUrl = OLLAMA_BASE_URL;
  const apiOk = cmd.ok ? await probeHttp(`${baseUrl}/api/tags`) : null;
  const details: string[] = [];

  if (cmd.ok && apiOk) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const resp = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) || [];
      details.push(`models: ${models.join(', ') || 'none'}`);
    } catch { /* ignore */ }
  }

  return {
    id: 'ollama',
    name: 'Ollama (Local LLM)',
    available: cmd.ok,
    version: cmd.ok ? cmd.output : null,
    apiReachable: apiOk,
    details,
  };
};

const probeOpenShell = async (): Promise<ExternalToolStatus> => {
  const cmd = await probeWslCommand('openshell', ['--version']);
  const sandboxState = cmd.ok ? await probeOpenShellSandboxState(NEMOCLAW_SANDBOX_NAME) : null;
  return {
    id: 'openshell',
    name: 'NVIDIA OpenShell',
    available: cmd.ok,
    version: cmd.ok ? cmd.output : null,
    apiReachable: null,
    details: [
      ...(cmd.ok ? [IS_WINDOWS ? `via WSL ${WSL_DISTRO}` : 'native Linux'] : ['install: curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh']),
      ...(sandboxState?.exists ? [`sandbox: ${NEMOCLAW_SANDBOX_NAME}${sandboxState.phase ? ` (${sandboxState.phase})` : ''}`] : cmd.ok ? ['no sandbox registered'] : []),
    ],
  };
};

const probeNemoClaw = async (): Promise<ExternalToolStatus> => {
  const cmd = await probeWslCommand('nemoclaw', ['help']);
  const hasKey = parseStringEnv(process.env.NVIDIA_API_KEY, '') !== '';
  const sandboxName = NEMOCLAW_SANDBOX_NAME;
  const sandboxState = cmd.ok ? await probeOpenShellSandboxState(sandboxName) : null;
  return {
    id: 'nemoclaw',
    name: 'NVIDIA NemoClaw',
    available: cmd.ok,
    version: cmd.ok ? 'installed' : null,
    apiReachable: null,
    details: [
      ...(!cmd.ok ? ['install: curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash'] : [IS_WINDOWS ? `via WSL ${WSL_DISTRO}` : 'native Linux']),
      ...(cmd.ok && !hasKey ? ['NVIDIA_API_KEY not set'] : []),
      ...(sandboxState?.exists ? [`sandbox: ${sandboxName}${sandboxState.phase ? ` (${sandboxState.phase})` : ''}`] : cmd.ok ? ['no sandbox registered'] : []),
    ],
  };
};

const probeOpenClaw = async (): Promise<ExternalToolStatus> => {
  const cmd = await probeCommand('openclaw', ['--version']);
  const gatewayUrl = OPENCLAW_GATEWAY_URL || OPENCLAW_BASE_URL;
  const gatewayHealthy = cmd.ok && gatewayUrl ? await probeHttp(`${gatewayUrl}/healthz`) : null;
  const chatApi = cmd.ok && gatewayUrl && gatewayHealthy ? await probeOpenClawChatApi(gatewayUrl) : null;
  const modelStatus = cmd.ok ? await probeOpenClawModelStatus() : null;
  const apiReachable = cmd.ok && gatewayUrl
    ? (gatewayHealthy && chatApi ? chatApi.ok : false)
    : null;
  return {
    id: 'openclaw',
    name: 'OpenClaw',
    available: cmd.ok,
    version: cmd.ok ? cmd.output : null,
    apiReachable,
    details: cmd.ok
      ? [
        ...(gatewayUrl ? [`gateway: ${gatewayUrl}`] : []),
        ...(gatewayUrl && gatewayHealthy === true ? ['gateway healthz: ok'] : []),
        ...(gatewayUrl && gatewayHealthy === false ? ['gateway healthz: unreachable'] : []),
        ...(chatApi ? [chatApi.detail] : []),
        ...(modelStatus?.defaultModel ? [`default model: ${modelStatus.defaultModel}`] : []),
      ]
      : ['install: irm https://openclaw.ai/install.ps1 | iex (Windows)'],
  };
};

const probeOpenJarvis = async (): Promise<ExternalToolStatus> => {
  const enabled = OPENJARVIS_ENABLED;
  const cmd = await probeCommand('jarvis', ['--version']);
  const jarvisUrl = OPENJARVIS_SERVE_URL;
  const apiOk = cmd.ok ? await probeHttp(`${jarvisUrl}/health`) : null;
  return {
    id: 'openjarvis',
    name: 'OpenJarvis (Stanford)',
    available: cmd.ok,
    version: cmd.ok ? cmd.output : null,
    apiReachable: apiOk,
    details: [
      ...(!cmd.ok ? ['install: git clone https://github.com/open-jarvis/OpenJarvis.git && cd OpenJarvis && uv sync'] : []),
      ...(enabled ? ['OPENJARVIS_ENABLED=true'] : ['OPENJARVIS_ENABLED not set']),
    ],
  };
};

const probeUv = async (): Promise<ExternalToolStatus> => {
  const cmd = await probeCommand('uv', ['--version']);
  return {
    id: 'uv',
    name: 'uv (Python package manager)',
    available: cmd.ok,
    version: cmd.ok ? cmd.output : null,
    apiReachable: null,
    details: cmd.ok ? [] : ['install: pip install uv'],
  };
};

const probeLitellm = async (): Promise<ExternalToolStatus> => {
  const hasNimKey = parseStringEnv(process.env.NVIDIA_NIM_API_KEY, '') !== '';
  const { existsSync } = await import('node:fs');
  const configExists = existsSync('litellm.config.yaml');
  const baseUrl = LITELLM_BASE_URL;
  const apiReachable = configExists ? await probeHttp(`${baseUrl}/health/liveliness`) : null;
  return {
    id: 'litellm',
    name: 'LiteLLM / Nemotron',
    available: configExists,
    version: configExists ? 'config present' : null,
    apiReachable,
    details: [
      ...(configExists ? ['litellm.config.yaml found'] : ['litellm.config.yaml missing']),
      ...(hasNimKey ? ['NVIDIA_NIM_API_KEY set'] : ['NVIDIA_NIM_API_KEY not set']),
      ...(apiReachable ? [`proxy reachable at ${baseUrl}`] : []),
    ],
  };
};

const probeWorkstation = async (): Promise<ExternalToolStatus> => {
  if (!IS_WINDOWS) {
    return {
      id: 'workstation',
      name: 'Local Workstation Executor',
      available: false,
      version: null,
      apiReachable: null,
      details: ['Windows desktop automation unavailable on this platform', 'guard: workspace-scoped files only'],
    };
  }

  try {
    const result = await execFileAsync('powershell', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output $PSVersionTable.PSVersion.ToString()'], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    const version = (result.stdout || result.stderr || '').trim().split('\n')[0] || 'unknown';
    return {
      id: 'workstation',
      name: 'Local Workstation Executor',
      available: true,
      version: `PowerShell ${version}`,
      apiReachable: null,
      details: [
        `workspace: ${process.cwd()}`,
        'guard: workspace-scoped files only',
        'actions: command.exec, browser.open, app.launch, app.activate, input.text, input.hotkey, screen.capture',
      ],
    };
  } catch {
    return {
      id: 'workstation',
      name: 'Local Workstation Executor',
      available: false,
      version: null,
      apiReachable: null,
      details: ['PowerShell unavailable for local desktop execution'],
    };
  }
};

export const probeAllExternalTools = async (): Promise<ExternalToolProbeResult> => {
  const tools = await Promise.all([
    probeOllama(),
    probeOpenShell(),
    probeNemoClaw(),
    probeOpenClaw(),
    probeOpenJarvis(),
    probeUv(),
    probeWorkstation(),
    probeLitellm(),
  ]);

  return {
    timestamp: new Date().toISOString(),
    tools,
    summary: {
      total: tools.length,
      available: tools.filter((t) => t.available).length,
      apiReachable: tools.filter((t) => t.apiReachable === true).length,
    },
  };
};

export const getExternalToolById = async (id: ExternalToolId): Promise<ExternalToolStatus> => {
  const probeMap: Record<ExternalToolId, () => Promise<ExternalToolStatus>> = {
    ollama: probeOllama,
    openshell: probeOpenShell,
    nemoclaw: probeNemoClaw,
    openclaw: probeOpenClaw,
    openjarvis: probeOpenJarvis,
    uv: probeUv,
    workstation: probeWorkstation,
    litellm: probeLitellm,
  };
  return probeMap[id]();
};
