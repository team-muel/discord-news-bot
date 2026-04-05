/* eslint-disable no-console */
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

try {
  await import('dotenv/config');
} catch {
  // Remote worker deployments can rely on systemd EnvironmentFile without dotenv installed.
}

const PORT = Math.max(1, Number(process.env.OPENCODE_LOCAL_WORKER_PORT || 8787));
const HOST = String(process.env.OPENCODE_LOCAL_WORKER_HOST || '127.0.0.1').trim() || '127.0.0.1';
const ROOT = path.resolve(process.cwd(), process.env.OPENCODE_LOCAL_WORKER_ROOT || '.');
const TIMEOUT_MS = Math.max(1000, Number(process.env.OPENCODE_LOCAL_WORKER_TIMEOUT_MS || 120000));
const MAX_OUTPUT_CHARS = Math.max(500, Number(process.env.OPENCODE_LOCAL_WORKER_MAX_OUTPUT_CHARS || 12000));
const ALLOW_WRITE = /^(1|true|yes|on)$/i.test(String(process.env.OPENCODE_LOCAL_WORKER_ALLOW_WRITE || 'false').trim());
const WORKER_AUTH_TOKEN = String(process.env.OPENCODE_LOCAL_WORKER_AUTH_TOKEN || '').trim();
const REQUIRE_AUTH = /^(1|true|yes|on)$/i.test(String(process.env.OPENCODE_LOCAL_WORKER_REQUIRE_AUTH || '').trim())
  || WORKER_AUTH_TOKEN.length > 0;

// ── OpenCode SDK proxy mode ──
const SDK_BASE_URL = String(process.env.OPENCODE_SDK_BASE_URL || '').trim().replace(/\/+$/, '');
const SDK_AUTH_TOKEN = String(process.env.OPENCODE_SDK_AUTH_TOKEN || '').trim();
const SDK_TIMEOUT_MS = Math.max(5000, Number(process.env.OPENCODE_SDK_TIMEOUT_MS || 90000));
const SDK_ENABLED = SDK_BASE_URL.length > 0;

const DANGEROUS_COMMAND_PATTERN = /(?:\brm\s+-rf\b|\bdel\s+\/f\b|\bformat\b|\bmkfs\b|\bshutdown\b|\breboot\b|\bpoweroff\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-fd\b|\bRemove-Item\b\s+.*-Recurse|\bStop-Computer\b|\bRestart-Computer\b)/i;
const WRITE_LIKE_COMMAND_PATTERN = /(?:\bnpm\s+(?:install|i)\b|\bpnpm\s+add\b|\byarn\s+add\b|\bgit\s+(?:add|commit|push|merge|rebase|checkout)\b|\bNew-Item\b|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bCopy-Item\b|\bMove-Item\b|\bRemove-Item\b|\bni\b|\bsc\b|\bac\b|\bmv\b|\bcp\b|\bren\b|\bmkdir\b|\brmdir\b|>|>>)/i;
const READ_SECRET_LIKE_PATTERN = /(?:\bprintenv\b|\benv\b|\bset\b|\bGet-ChildItem\s+Env:\\b|\bGet-Item\s+Env:\\b|\btype\s+\.env\b|\bcat\s+\.env\b|\bGet-Content\s+\.env\b|\bSelect-String\b\s+.*(?:token|secret|password|api[_-]?key)\b)/i;

const SAFE_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'LANG',
  'SHELL',
  'TMP',
  'TEMP',
  'PWD',
  'TZ',
  'TERM',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PUBLIC',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'SYSTEMDRIVE',
  'USERNAME',
  'USERDOMAIN',
  'NODE_ENV',
]);

const buildChildEnv = () => {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null) {
      continue;
    }
    const keyUpper = key.toUpperCase();
    if (
      SAFE_ENV_KEYS.has(key)
      || SAFE_ENV_KEYS.has(keyUpper)
      || keyUpper.startsWith('NPM_')
      || keyUpper.startsWith('NODE_')
      || keyUpper.startsWith('POWERSHELL_')
    ) {
      out[key] = value;
    }
  }
  return out;
};

const getAuthTokenFromRequest = (req) => {
  const fromHeader = String(req.headers['x-opencode-worker-token'] || '').trim();
  if (fromHeader) {
    return fromHeader;
  }
  const authHeader = String(req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  return '';
};

const json = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const toErrorPayload = (message) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

const collectBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const resolveCwd = (rawCwd) => {
  const candidate = String(rawCwd || '').trim();
  if (!candidate) {
    return ROOT;
  }
  const resolved = path.resolve(ROOT, candidate);
  const relative = path.relative(ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('cwd must stay inside workspace root');
  }
  return resolved;
};

const runCommand = async ({ task, cwd, mode }) => {
  const trimmedTask = String(task || '').trim();
  if (!trimmedTask) {
    throw new Error('task is required');
  }
  if (DANGEROUS_COMMAND_PATTERN.test(trimmedTask)) {
    throw new Error('dangerous command blocked');
  }
  if (mode !== 'workspace_write' || !ALLOW_WRITE) {
    if (WRITE_LIKE_COMMAND_PATTERN.test(trimmedTask)) {
      throw new Error('write-like command blocked in read_only mode');
    }
    if (READ_SECRET_LIKE_PATTERN.test(trimmedTask)) {
      throw new Error('secret-read command blocked in read_only mode');
    }
  }

  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'powershell.exe' : '/bin/sh';
  const args = isWindows
    ? ['-NoLogo', '-NoProfile', '-Command', trimmedTask]
    : ['-lc', trimmedTask];

  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: buildChildEnv(),
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error(`command timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
      if (stdout.length > MAX_OUTPUT_CHARS) {
        stdout = stdout.slice(0, MAX_OUTPUT_CHARS);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > MAX_OUTPUT_CHARS) {
        stderr = stderr.slice(0, MAX_OUTPUT_CHARS);
      }
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: Number(code ?? 1),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt,
      });
    });
  });
};

// ── OpenCode SDK proxy ────────────────────────────────────────────────────────

/**
 * Proxy a task to the OpenCode headless server via session API.
 * Returns null if the SDK is unreachable or the task is not applicable.
 * Safety guards (DANGEROUS_COMMAND_PATTERN etc.) still apply before this is called.
 */
const runViaSdk = async (task, mode) => {
  if (!task) return null;

  // Safety checks still apply
  if (DANGEROUS_COMMAND_PATTERN.test(task)) {
    throw new Error('dangerous command blocked');
  }
  if (mode !== 'workspace_write' || !ALLOW_WRITE) {
    if (WRITE_LIKE_COMMAND_PATTERN.test(task)) {
      throw new Error('write-like command blocked in read_only mode');
    }
    if (READ_SECRET_LIKE_PATTERN.test(task)) {
      throw new Error('secret-read command blocked in read_only mode');
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  if (SDK_AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${SDK_AUTH_TOKEN}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SDK_TIMEOUT_MS);

  try {
    // Create session
    const sessRes = await fetch(`${SDK_BASE_URL}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    if (!sessRes.ok) return null;
    const sessData = await sessRes.json();
    const sessionId = sessData?.sessionId || sessData?.id;
    if (!sessionId) return null;

    try {
      // Chat with task
      const chatRes = await fetch(`${SDK_BASE_URL}/session/${encodeURIComponent(sessionId)}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: task }),
        signal: controller.signal,
      });
      if (!chatRes.ok) return null;
      const chatData = await chatRes.json();

      const text = chatData?.message || chatData?.content || JSON.stringify(chatData);
      return {
        content: [{ type: 'text', text: `exit_code=0\nduration_ms=0\n[SDK]\nstdout:\n${text}` }],
        isError: false,
      };
    } finally {
      // Always close session
      fetch(`${SDK_BASE_URL}/session/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers,
      }).catch(() => {});
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[opencode-local-worker] SDK proxy timed out');
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const handleToolCall = async (payload) => {
  const name = String(payload?.name || '').trim();
  const args = payload?.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)
    ? payload.arguments
    : {};

  if (name !== 'opencode.run') {
    return toErrorPayload(`unsupported tool: ${name || 'unknown'}`);
  }

  const mode = String(args.mode || 'read_only').trim().toLowerCase() === 'workspace_write'
    ? 'workspace_write'
    : 'read_only';

  // ── SDK proxy: try OpenCode headless server first (if configured) ──
  if (SDK_ENABLED) {
    try {
      const sdkResult = await runViaSdk(String(args.task || '').trim(), mode);
      if (sdkResult) return sdkResult;
      // null = SDK unavailable or non-applicable; fall through to shell
    } catch (sdkError) {
      console.warn('[opencode-local-worker] SDK proxy failed, falling back to shell:', sdkError.message || sdkError);
    }
  }

  try {
    const cwd = resolveCwd(args.cwd);
    const result = await runCommand({
      task: String(args.task || '').trim(),
      cwd,
      mode,
    });

    const parts = [
      `exit_code=${result.code}`,
      `duration_ms=${result.durationMs}`,
    ];
    if (result.stdout) {
      parts.push(`stdout:\n${result.stdout}`);
    }
    if (result.stderr) {
      parts.push(`stderr:\n${result.stderr}`);
    }

    return {
      content: [{ type: 'text', text: parts.join('\n\n') || 'command finished with no output' }],
      isError: result.code !== 0,
    };
  } catch (error) {
    return toErrorPayload(error instanceof Error ? error.message : String(error));
  }
};

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    json(res, 404, { error: 'not found' });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, {
      ok: true,
      service: 'opencode-local-worker',
      root: ROOT,
      allowWrite: ALLOW_WRITE,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/tools/call') {
    if (REQUIRE_AUTH) {
      const incomingToken = getAuthTokenFromRequest(req);
      if (!incomingToken || incomingToken !== WORKER_AUTH_TOKEN) {
        json(res, 401, toErrorPayload('unauthorized'));
        return;
      }
    }

    try {
      const raw = await collectBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const result = await handleToolCall(payload);
      json(res, 200, result);
    } catch (error) {
      json(res, 400, toErrorPayload(error instanceof Error ? error.message : String(error)));
    }
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  if (REQUIRE_AUTH && !WORKER_AUTH_TOKEN) {
    console.error('[opencode-local-worker] OPENCODE_LOCAL_WORKER_REQUIRE_AUTH=true but OPENCODE_LOCAL_WORKER_AUTH_TOKEN is empty');
    process.exit(1);
  }
  console.log(`[opencode-local-worker] listening on http://${HOST}:${PORT}`);
  console.log(`[opencode-local-worker] root=${ROOT} allowWrite=${ALLOW_WRITE} requireAuth=${REQUIRE_AUTH} sdkProxy=${SDK_ENABLED}`);
});