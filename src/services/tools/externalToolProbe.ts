import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WSL_DISTRO, NEMOCLAW_SANDBOX_NAME, OLLAMA_BASE_URL, OPENJARVIS_ENABLED, OPENJARVIS_SERVE_URL, LITELLM_BASE_URL } from '../../config';
import { parseStringEnv } from '../../utils/env';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export type ExternalToolId =
  | 'ollama'
  | 'openshell'
  | 'nemoclaw'
  | 'openclaw'
  | 'openjarvis'
  | 'uv'
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
    const shellCmd = `export HOME=/root; export NVM_DIR=/root/.nvm; source /root/.nvm/nvm.sh 2>/dev/null; export PATH=/root/.local/bin:$PATH; ${command} ${args.join(' ')}`;
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

const probeHttp = async (url: string): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
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
  return {
    id: 'openshell',
    name: 'NVIDIA OpenShell',
    available: cmd.ok,
    version: cmd.ok ? cmd.output : null,
    apiReachable: null,
    details: [
      ...(cmd.ok ? [IS_WINDOWS ? `via WSL ${WSL_DISTRO}` : 'native Linux'] : ['install: curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh']),
    ],
  };
};

const probeNemoClaw = async (): Promise<ExternalToolStatus> => {
  const cmd = await probeWslCommand('nemoclaw', ['help']);
  const hasKey = parseStringEnv(process.env.NVIDIA_API_KEY, '') !== '';
  const sandboxName = NEMOCLAW_SANDBOX_NAME;
  const sandbox = cmd.ok ? await probeWslCommand('nemoclaw', ['list']) : { ok: false, output: '', fullOutput: '' };
  const hasSandbox = sandbox.ok && (sandbox.fullOutput ?? sandbox.output).includes(sandboxName);
  return {
    id: 'nemoclaw',
    name: 'NVIDIA NemoClaw',
    available: cmd.ok,
    version: cmd.ok ? 'installed' : null,
    apiReachable: null,
    details: [
      ...(!cmd.ok ? ['install: curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash'] : [IS_WINDOWS ? `via WSL ${WSL_DISTRO}` : 'native Linux']),
      ...(cmd.ok && !hasKey ? ['NVIDIA_API_KEY not set'] : []),
      ...(hasSandbox ? [`sandbox: ${sandboxName}`] : cmd.ok ? ['no sandbox registered'] : []),
    ],
  };
};

const probeOpenClaw = async (): Promise<ExternalToolStatus> => {
  const cmd = await probeCommand('openclaw', ['--version']);
  return {
    id: 'openclaw',
    name: 'OpenClaw',
    available: cmd.ok,
    version: cmd.ok ? cmd.output : null,
    apiReachable: null,
    details: cmd.ok ? [] : ['install: irm https://openclaw.ai/install.ps1 | iex (Windows)'],
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

export const probeAllExternalTools = async (): Promise<ExternalToolProbeResult> => {
  const tools = await Promise.all([
    probeOllama(),
    probeOpenShell(),
    probeNemoClaw(),
    probeOpenClaw(),
    probeOpenJarvis(),
    probeUv(),
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
    litellm: probeLitellm,
  };
  return probeMap[id]();
};
