/* eslint-disable no-console */
import process from 'node:process';
import { spawn } from 'node:child_process';

try {
  await import('dotenv/config');
} catch {
  // Local repo runs normally load .env via dotenv, but keep a soft fallback.
}

const trim = (value) => String(value ?? '').trim();

const looksLikeLiteLlmAlias = (value) => /^muel[-_a-z0-9]*$/i.test(trim(value));

const parseServeUrl = () => {
  const fallback = { host: '127.0.0.1', port: '8000' };
  const raw = trim(process.env.OPENJARVIS_SERVE_URL);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = new URL(raw);
    return {
      host: trim(parsed.hostname) || fallback.host,
      port: trim(parsed.port) || fallback.port,
    };
  } catch {
    return fallback;
  }
};

const resolveEngine = () => {
  const configured = trim(process.env.OPENJARVIS_ENGINE);
  if (configured) {
    return configured;
  }

  const openjarvisModel = trim(process.env.OPENJARVIS_MODEL);
  if (looksLikeLiteLlmAlias(openjarvisModel) || looksLikeLiteLlmAlias(process.env.LITELLM_MODEL)) {
    return 'litellm';
  }
  if (openjarvisModel || trim(process.env.OLLAMA_MODEL)) {
    return 'ollama';
  }
  return 'litellm';
};

const resolveModel = (engine) => {
  const configured = trim(process.env.OPENJARVIS_MODEL);
  if (configured) {
    return configured;
  }
  if (engine === 'ollama') {
    return trim(process.env.OLLAMA_MODEL);
  }
  if (engine === 'litellm') {
    return trim(process.env.LITELLM_MODEL);
  }
  return '';
};

const apiKey = trim(process.env.OPENJARVIS_API_KEY || process.env.OPENJARVIS_SERVE_API_KEY);
if (!apiKey) {
  console.error('[openjarvis] OPENJARVIS_SERVE_API_KEY or OPENJARVIS_API_KEY is required.');
  console.error('[openjarvis] Local OpenJarvis auth uses a static bearer token you choose; it is not centrally issued.');
  process.exit(1);
}

const { host, port } = parseServeUrl();
const engine = resolveEngine();
const model = resolveModel(engine);
const agent = trim(process.env.OPENJARVIS_AGENT);
const env = {
  ...process.env,
  OPENJARVIS_API_KEY: apiKey,
};

const serveArgs = ['serve', '--engine', engine, '--host', host, '--port', port];
if (model) {
  serveArgs.push('--model', model);
}
if (agent) {
  serveArgs.push('--agent', agent);
}

const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'jarvis';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'jarvis', ...serveArgs]
  : serveArgs;

console.log(`[openjarvis] starting serve on http://${host}:${port} using engine=${engine}${model ? ` model=${model}` : ''}${agent ? ` agent=${agent}` : ''}`);

const child = spawn(command, args, {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('error', (error) => {
  console.error(`[openjarvis] failed to start serve: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});