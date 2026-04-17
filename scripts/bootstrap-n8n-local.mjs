import 'dotenv/config';

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseArg, parseBool } from './lib/cliArgs.mjs';

const ROOT = process.cwd();
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'tmp', 'n8n-local');
const DEFAULT_BASE_URL = 'http://127.0.0.1:5678';
const DEFAULT_TIMEZONE = 'Asia/Seoul';
const DEFAULT_WORKFLOW_MANIFEST_FILE = 'starter-workflows.manifest.json';
const DEFAULT_OPERATION_DIR_NAME = 'operations';
const N8N_API_TIMEOUT_MS = 10_000;
const DEFAULT_N8N_CONTAINER_NAME = 'muel-local-n8n';
const DEFAULT_N8N_IMAGE = 'docker.n8n.io/n8nio/n8n:latest';
const DEFAULT_N8N_REPO_ENV_PATH = path.join(ROOT, '.env');
const DEFAULT_LOCAL_PUBLIC_API_KEY_LABEL = 'muel-local-public-api';
const DEFAULT_LOCAL_PUBLIC_API_KEY_SCOPES = [
  'workflow:list',
  'workflow:read',
  'workflow:create',
  'workflow:update',
  'workflow:delete',
  'workflow:activate',
  'workflow:deactivate',
  'workflow:execute',
  'execution:list',
  'execution:read',
];

const WEBHOOK_HINTS = {
  N8N_WEBHOOK_NEWS_RSS_FETCH: 'muel/news-rss-fetch',
  N8N_WEBHOOK_NEWS_SUMMARIZE: 'muel/news-summarize',
  N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES: 'muel/news-monitor-candidates',
  N8N_WEBHOOK_YOUTUBE_FEED_FETCH: 'muel/youtube-feed-fetch',
  N8N_WEBHOOK_YOUTUBE_COMMUNITY_SCRAPE: 'muel/youtube-community-scrape',
  N8N_WEBHOOK_ALERT_DISPATCH: 'muel/alert-dispatch',
  N8N_WEBHOOK_ARTICLE_CONTEXT_FETCH: 'muel/article-context-fetch',
};

const fileName = fileURLToPath(import.meta.url);

export const N8N_STARTER_INSTALL_ACTION_NAME = 'n8n.workflow.install';

const buildDeterministicWebhookId = (value) => {
  const hex = createHash('sha1').update(String(value || '')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const normalizeBaseUrl = ({ rawBaseUrl = '', rawPort = '' } = {}) => {
  const fallbackPort = Number.parseInt(String(rawPort || '').trim(), 10);
  const port = Number.isFinite(fallbackPort) && fallbackPort > 0 ? fallbackPort : 5678;
  const source = String(rawBaseUrl || '').trim() || `http://127.0.0.1:${port}`;
  const parsed = new URL(source);
  const normalizedPort = Number.parseInt(parsed.port || '', 10)
    || (parsed.protocol === 'https:' ? 443 : 80);
  return {
    baseUrl: source.replace(/\/+$/, ''),
    host: parsed.hostname,
    protocol: parsed.protocol,
    port: normalizedPort,
  };
};

const runCommandProbe = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0;
};

const runCommandStrict = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }

  return result.stdout || '';
};

const readCommandOutput = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    return null;
  }

  return String(result.stdout || '').trim();
};

const fetchWithTimeout = async (url, init = {}, timeoutMs = 5_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const upsertEnvVarText = (inputText, key, value) => {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return String(inputText || '');
  }

  const source = String(inputText || '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = source.endsWith('\n');
  const lines = source.length > 0 ? source.split(/\r?\n/) : [];
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (!line || /^\s*#/.test(line)) {
      return line;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      return line;
    }

    const candidateKey = line.slice(0, separatorIndex).trim();
    if (candidateKey !== normalizedKey) {
      return line;
    }

    replaced = true;
    return `${normalizedKey}=${value}`;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
      nextLines.splice(nextLines.length - 1, 0, `${normalizedKey}=${value}`);
    } else {
      nextLines.push(`${normalizedKey}=${value}`);
    }
  }

  const normalizedLines = hadTrailingNewline && nextLines[nextLines.length - 1] === ''
    ? nextLines.slice(0, -1)
    : nextLines;
  const joined = normalizedLines.join(eol);
  if (!joined) {
    return `${normalizedKey}=${value}${eol}`;
  }

  return hadTrailingNewline || !source
    ? `${joined}${eol}`
    : joined;
};

const syncRepoEnvVar = async ({ envPath = DEFAULT_N8N_REPO_ENV_PATH, key, value }) => {
  const current = await fs.readFile(envPath, 'utf8').catch(() => '');
  const updated = upsertEnvVarText(current, key, value);
  if (updated !== current) {
    await fs.writeFile(envPath, updated, 'utf8');
  }
  return envPath;
};

const buildN8nWorkflowApiHeaders = (apiKey = String(process.env.N8N_API_KEY || '').trim()) => {
  const headers = {
    Accept: 'application/json',
  };
  if (apiKey) {
    headers['X-N8N-API-KEY'] = apiKey;
  }
  return headers;
};

const probeN8nWorkflowApi = async ({
  baseUrl = DEFAULT_BASE_URL,
  apiKey = String(process.env.N8N_API_KEY || '').trim(),
  timeoutMs = 3_000,
} = {}) => {
  try {
    const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/api/v1/workflows?limit=1`, {
      method: 'GET',
      headers: buildN8nWorkflowApiHeaders(apiKey),
    }, timeoutMs);
    return {
      reachable: response.ok || response.status === 401 || response.status === 403,
      ok: response.ok,
      status: response.status,
      authRequired: response.status === 401,
      forbidden: response.status === 403,
    };
  } catch (error) {
    return {
      reachable: false,
      ok: false,
      status: null,
      authRequired: false,
      forbidden: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const buildN8nApiKeyEnsureContainerScript = ({
  label = DEFAULT_LOCAL_PUBLIC_API_KEY_LABEL,
  scopes = DEFAULT_LOCAL_PUBLIC_API_KEY_SCOPES,
} = {}) => `
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const label = ${JSON.stringify(label)};
const scopes = ${JSON.stringify(scopes)};
const explicitJwtSecret = String(process.env.N8N_USER_MANAGEMENT_JWT_SECRET || process.env.USER_MANAGEMENT_JWT_SECRET || '').trim();
const encryptionKey = String(process.env.N8N_ENCRYPTION_KEY || '').trim();
const candidatePaths = [
  String(process.env.DB_SQLITE_DATABASE || '').trim(),
  String(process.env.N8N_USER_FOLDER || '').trim() ? \
    \`${'${String(process.env.N8N_USER_FOLDER || \'\').trim()}/database.sqlite'}\` : '',
  String(process.env.N8N_USER_FOLDER || '').trim() ? \
    \`${'${String(process.env.N8N_USER_FOLDER || \'\').trim()}/.n8n/database.sqlite'}\` : '',
  '/home/node/.n8n/database.sqlite',
  '/home/node/.n8n/.n8n/database.sqlite',
];
const databasePath = candidatePaths.find((candidate) => candidate && fs.existsSync(candidate));
if (!databasePath) {
  throw new Error('Local n8n database not found');
}

let jwtSecret = explicitJwtSecret;
if (!jwtSecret) {
  if (!encryptionKey) {
    throw new Error('N8N_ENCRYPTION_KEY is not available inside the running n8n container');
  }
  let baseKey = '';
  for (let index = 0; index < encryptionKey.length; index += 2) {
    baseKey += encryptionKey[index];
  }
  jwtSecret = createHash('sha256').update(baseKey).digest('hex');
}

const db = new DatabaseSync(databasePath);
const owner = db.prepare('SELECT "id" FROM "user" ORDER BY "createdAt" ASC LIMIT 1').get();
if (!owner?.id) {
  throw new Error('No n8n owner user found');
}

const parseScopes = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((scope) => typeof scope === 'string' && scope.trim());
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed)
      ? parsed.filter((scope) => typeof scope === 'string' && scope.trim())
      : [];
  } catch {
    return [];
  }
};

const base64Url = (value) => Buffer.from(value).toString('base64url');
const signJwt = (payload) => {
  const encodedHeader = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', jwtSecret)
    .update(\`${'${encodedHeader}.${encodedPayload}'}\`)
    .digest('base64url');
  return \`${'${encodedHeader}.${encodedPayload}.${signature}'}\`;
};

const existing = db.prepare('SELECT "id", "apiKey", "scopes" FROM "user_api_keys" WHERE "label" = ? AND "audience" = ? ORDER BY "createdAt" ASC LIMIT 1').get(label, 'public-api');
const existingScopes = parseScopes(existing?.scopes);
const hasRequiredScopes = scopes.every((scope) => existingScopes.includes(scope));

if (existing?.apiKey && hasRequiredScopes) {
  console.log(JSON.stringify({
    status: 'reused-existing',
    apiKey: existing.apiKey,
    apiKeyId: existing.id,
    userId: owner.id,
    label,
    scopes: existingScopes,
    databasePath,
  }));
  process.exit(0);
}

const apiKey = signJwt({
  sub: owner.id,
  iss: 'n8n',
  aud: 'public-api',
  jti: randomUUID(),
});
const scopesJson = JSON.stringify(scopes);
const now = new Date().toISOString();

if (existing?.id) {
  db.prepare('UPDATE "user_api_keys" SET "apiKey" = ?, "scopes" = ?, "updatedAt" = ? WHERE "id" = ?').run(apiKey, scopesJson, now, existing.id);
  console.log(JSON.stringify({
    status: 'updated-existing',
    apiKey,
    apiKeyId: existing.id,
    userId: owner.id,
    label,
    scopes,
    databasePath,
  }));
  process.exit(0);
}

const apiKeyId = randomUUID();
db.prepare('INSERT INTO "user_api_keys" ("id", "userId", "label", "apiKey", "createdAt", "updatedAt", "scopes", "audience") VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(apiKeyId, owner.id, label, apiKey, now, now, scopesJson, 'public-api');
console.log(JSON.stringify({
  status: 'created',
  apiKey,
  apiKeyId,
  userId: owner.id,
  label,
  scopes,
  databasePath,
}));
`;

const runDockerNodeJson = ({ containerName = DEFAULT_N8N_CONTAINER_NAME, scriptSource }) => {
  const result = spawnSync('docker', ['exec', containerName, 'node', '--input-type=module', '-e', scriptSource], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'docker exec failed').trim());
  }

  const payload = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!payload) {
    throw new Error('n8n API key auto-provisioner returned no payload');
  }

  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`n8n API key auto-provisioner returned malformed JSON: ${payload}`);
  }
};

export const ensureLocalN8nPublicApiKey = async ({
  baseUrl = DEFAULT_BASE_URL,
  containerName = DEFAULT_N8N_CONTAINER_NAME,
  repoEnvPath = DEFAULT_N8N_REPO_ENV_PATH,
  label = DEFAULT_LOCAL_PUBLIC_API_KEY_LABEL,
  scopes = DEFAULT_LOCAL_PUBLIC_API_KEY_SCOPES,
} = {}) => {
  const currentApiKey = String(process.env.N8N_API_KEY || '').trim();
  const currentProbe = await probeN8nWorkflowApi({ baseUrl, apiKey: currentApiKey });

  const containerRunning = inspectDockerContainerRunning(containerName);
  if (containerRunning !== true) {
    if (currentApiKey && currentProbe.ok) {
      return {
        ensured: false,
        changed: false,
        source: 'existing-env',
        apiKey: currentApiKey,
        workflowApiStatus: currentProbe.status,
        label,
        scopes,
        repoEnvPath,
      };
    }

    return {
      ensured: false,
      changed: false,
      source: 'container-not-running',
      workflowApiStatus: currentProbe.status,
      label,
      scopes,
      repoEnvPath,
    };
  }

  const provisioned = runDockerNodeJson({
    containerName,
    scriptSource: buildN8nApiKeyEnsureContainerScript({ label, scopes }),
  });

  const apiKey = String(provisioned?.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('n8n API key auto-provisioner did not return an API key');
  }

  process.env.N8N_API_KEY = apiKey;
  await syncRepoEnvVar({ envPath: repoEnvPath, key: 'N8N_API_KEY', value: apiKey });

  const verified = await probeN8nWorkflowApi({ baseUrl, apiKey });
  if (!verified.ok) {
    throw new Error(`Auto-provisioned N8N_API_KEY did not unlock workflow API (HTTP ${verified.status ?? 'unreachable'})`);
  }

  return {
    ensured: true,
    changed: currentApiKey !== apiKey,
    source: String(provisioned?.status || 'created'),
    apiKey,
    workflowApiStatus: verified.status,
    label: String(provisioned?.label || label),
    scopes: Array.isArray(provisioned?.scopes) ? provisioned.scopes : scopes,
    repoEnvPath,
    databasePath: String(provisioned?.databasePath || ''),
  };
};

const buildCodeWebhookWorkflow = ({
  workflowName,
  task,
  templateKey,
  webhookPath,
  codeName,
  jsCodeLines,
  manualNote = '',
}) => ({
  name: workflowName,
  active: true,
  nodes: [
    {
      id: `Webhook_${templateKey}`,
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      webhookId: buildDeterministicWebhookId(`${task}:${webhookPath}`),
      position: [-300, 0],
      parameters: {
        httpMethod: 'POST',
        path: webhookPath,
        responseMode: 'lastNode',
        options: {},
      },
    },
    {
      id: `Code_${templateKey}`,
      name: codeName,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [20, 0],
      parameters: {
        jsCode: jsCodeLines.join('\n'),
      },
    },
  ],
  connections: {
    Webhook: {
      main: [[{ node: codeName, type: 'main', index: 0 }]],
    },
  },
  settings: {
    executionOrder: 'v1',
  },
  staticData: null,
  pinData: {},
  meta: {
    template: 'local-bootstrap-starter',
    delegationTask: task,
    templateKey,
    manualNote,
  },
  tags: [],
});

export const buildN8nNewsRssFetchWorkflow = ({
  webhookPath = WEBHOOK_HINTS.N8N_WEBHOOK_NEWS_RSS_FETCH,
} = {}) => buildCodeWebhookWorkflow({
  workflowName: 'muel local news rss fetch starter',
  task: 'news-rss-fetch',
  templateKey: 'news-rss-fetch',
  webhookPath,
  codeName: 'Fetch RSS Search',
  jsCodeLines: [
    "const payload = $json.body ?? $json;",
    "const rawQuery = String(payload.query ?? '').trim();",
    "const requestedLimit = Number(payload.limit ?? 5);",
    "const limit = Math.max(1, Math.min(10, Number.isFinite(requestedLimit) ? requestedLimit : 5));",
    "if (!rawQuery) {",
    "  return [{ json: { items: [] } }];",
    "}",
    "const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(rawQuery)}&hl=ko&gl=KR&ceid=KR:ko`;",
    "const xml = await this.helpers.httpRequest({",
    "  method: 'GET',",
    "  url: rssUrl,",
    "  headers: {",
    "    accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',",
    "    'user-agent': 'muel-local-n8n/1.0',",
    "  },",
    "});",
    "const decodeXml = (value) => String(value || '')",
    "  .replace(/&amp;/g, '&')",
    "  .replace(/&lt;/g, '<')",
    "  .replace(/&gt;/g, '>')",
    "  .replace(/&quot;/g, '\"')",
    "  .replace(/&#39;/g, \"'\")",
    "  .trim();",
    "const unwrap = (value) => decodeXml(String(value || '').replace(/^<!\\[CDATA\\[/, '').replace(/\\]\\]>$/, '').trim());",
    "const items = Array.from(xml.matchAll(/<item>([\\s\\S]*?)<\\/item>/gi))",
    "  .slice(0, limit)",
    "  .map((match) => {",
    "    const block = match[1] || '';",
    "    const title = unwrap(block.match(/<title>([\\s\\S]*?)<\\/title>/i)?.[1] || '');",
    "    const link = unwrap(block.match(/<link>([\\s\\S]*?)<\\/link>/i)?.[1] || '');",
    "    const pubDate = unwrap(block.match(/<pubDate>([\\s\\S]*?)<\\/pubDate>/i)?.[1] || '');",
    "    const source = unwrap(block.match(/<source[^>]*>([\\s\\S]*?)<\\/source>/i)?.[1] || '');",
    "    return {",
    "      title,",
    "      link,",
    "      source: source || undefined,",
    "      pubDate: pubDate || undefined,",
    "    };",
    "  })",
    "  .filter((item) => item.title && item.link);",
    "return [{ json: { items } }];",
  ],
});

export const buildN8nNewsSummarizeWorkflow = ({
  webhookPath = WEBHOOK_HINTS.N8N_WEBHOOK_NEWS_SUMMARIZE,
} = {}) => buildCodeWebhookWorkflow({
  workflowName: 'muel local news summarize starter',
  task: 'news-summarize',
  templateKey: 'news-summarize',
  webhookPath,
  codeName: 'Summarize Heuristically',
  manualNote: 'Replace the heuristic code node with an LLM node or provider call when ready.',
  jsCodeLines: [
    "const payload = $json.body ?? $json;",
    "const title = String(payload.title ?? '').trim();",
    "const description = String(payload.description ?? '').replace(/\\s+/g, ' ').trim();",
    "const link = String(payload.link ?? '').trim();",
    "let sourceHost = '';",
    "try {",
    "  sourceHost = link ? new URL(link).hostname.replace(/^www\\./, '') : '';",
    "} catch {}",
    "const sentences = description",
    "  .split(/(?<=[.!?다])\\s+/u)",
    "  .map((value) => value.trim())",
    "  .filter(Boolean);",
    "const lines = [];",
    "if (title) lines.push(`핵심: ${title}`);",
    "if (sentences[0]) lines.push(`맥락: ${sentences[0]}`);",
    "else if (description) lines.push(`맥락: ${description.slice(0, 140)}`);",
    "if (sourceHost) lines.push(`출처: ${sourceHost}`);",
    "else if (sentences[1]) lines.push(`포인트: ${sentences[1]}`);",
    "const summary = lines.slice(0, 3).join('\\n').trim() || '핵심: 요약할 정보가 부족합니다.';",
    "return [{ json: { summary } }];",
  ],
});

export const buildN8nNewsMonitorCandidatesSmokeWorkflow = ({
  webhookPath = WEBHOOK_HINTS.N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES,
} = {}) => buildCodeWebhookWorkflow({
  workflowName: 'muel local news monitor candidates starter',
  task: 'news-monitor-candidates',
  templateKey: 'news-monitor-candidates',
  webhookPath,
  codeName: 'Build Finance Candidates',
  manualNote: 'Starter uses Google Finance page parsing. Refine filtering rules in the Code node if needed.',
  jsCodeLines: [
    "const payload = $json.body ?? $json;",
    "const requestedLimit = Number(payload.limit ?? 6);",
    "const limit = Math.max(1, Math.min(12, Number.isFinite(requestedLimit) ? requestedLimit : 6));",
    "const pageUrl = 'https://www.google.com/finance/markets?hl=ko';",
    "const html = await this.helpers.httpRequest({",
    "  method: 'GET',",
    "  url: pageUrl,",
    "  headers: {",
    "    accept: 'text/html,application/xhtml+xml',",
    "    'accept-language': 'ko,en;q=0.8',",
    "    'user-agent': 'muel-local-n8n/1.0',",
    "  },",
    "});",
    "const decodeXml = (value) => String(value || '')",
    "  .replace(/&amp;/g, '&')",
    "  .replace(/&lt;/g, '<')",
    "  .replace(/&gt;/g, '>')",
    "  .replace(/&quot;/g, '\"')",
    "  .replace(/&#39;/g, \"'\")",
    "  .replace(/&nbsp;/g, ' ')",
    "  .trim();",
    "const stripTags = (value) => decodeXml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim());",
    "const normalizeLink = (value) => {",
    "  try {",
    "  const pageHtml = await this.helpers.httpRequest({",
    "    method: 'GET',",
    "    url: sourceUrl,",
    "    headers: {",
    "    parsed.searchParams.delete('utm_source');",
    "    parsed.searchParams.delete('utm_medium');",
    "    parsed.searchParams.delete('utm_campaign');",
    "    return parsed.toString();",
    "  }",
    "};",
    "const parseSourceName = (value) => {",
    "  try {",
    "const xml = await this.helpers.httpRequest({",
    "  method: 'GET',",
    "  url: feedUrl,",
    "  headers: {",
    "    return null;",
    "  }",
    "};",
    "const normalizeTitle = (value) => String(value || '')",
    "  .toLowerCase()",
    "  .replace(/[^\\p{L}\\p{N}\\s]/gu, ' ')",
    "  .replace(/\\s+/g, ' ')",
    "  .trim();",
    "const buildLexicalSignature = (value) => normalizeTitle(value)",
    "  .split(' ')",
    "  .map((token) => token.trim())",
    "  .filter((token) => token.length >= 2)",
    "  .slice(0, 20)",
    "  .sort()",
    "  .join('|');",
    "const items = [];",
    "const seen = new Set();",
    "const anchorRegex = /<a[^>]+href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)<\\/a>/gi;",
    "let matched;",
    "while ((matched = anchorRegex.exec(html)) !== null && items.length < limit) {",
    "  let href = decodeXml(matched[1] || '');",
    "  if (href.startsWith('./')) href = `https://www.google.com/finance/${href.slice(2)}`;",
    "  else if (href.startsWith('/')) href = `https://www.google.com${href}`;",
    "  href = normalizeLink(href);",
    "  if (!/^https?:\\/\\//i.test(href) || href.includes('/finance')) continue;",
    "  const title = stripTags(matched[2] || '');",
    "  if (!title || title.length < 12) continue;",
    "  const key = href.slice(0, 1000);",
    "  if (seen.has(key)) continue;",
    "  seen.add(key);",
    "  const sourceName = parseSourceName(href);",
    "  items.push({",
    "    title,",
    "    link: href,",
    "    key,",
    "    sourceName: sourceName || undefined,",
    "    publisherName: sourceName || undefined,",
    "    lexicalSignature: buildLexicalSignature(title),",
    "  });",
    "}",
    "return [{ json: { items } }];",
  ],
});

export const buildN8nYoutubeFeedFetchWorkflow = ({
  webhookPath = WEBHOOK_HINTS.N8N_WEBHOOK_YOUTUBE_FEED_FETCH,
} = {}) => buildCodeWebhookWorkflow({
  workflowName: 'muel local youtube feed fetch starter',
  task: 'youtube-feed-fetch',
  templateKey: 'youtube-feed-fetch',
  webhookPath,
  codeName: 'Fetch YouTube Feed',
  jsCodeLines: [
    "const payload = $json.body ?? $json;",
    "const sourceUrl = String(payload.channelUrl ?? '').trim();",
    "if (!sourceUrl) return [{ json: { entries: [] } }];",
    "const parseChannelId = (value) => {",
    "  const base = String(value || '').split('#', 1)[0];",
    "  const direct = base.match(/\\/channel\\/(UC[0-9A-Za-z_-]{20,})/);",
    "  if (direct?.[1]) return direct[1];",
    "  const any = base.match(/(UC[0-9A-Za-z_-]{20,})/);",
    "  if (any?.[1]) return any[1];",
    "  try {",
    "    const parsed = new URL(base);",
    "    const queryValue = parsed.searchParams.get('channel_id');",
    "    return queryValue && /(UC[0-9A-Za-z_-]{20,})/.test(queryValue) ? queryValue : '';",
    "  } catch {",
    "    return '';",
    "  }",
    "};",
    "let channelId = parseChannelId(sourceUrl);",
    "if (!channelId) {",
    "  const pageResponse = await fetch(sourceUrl, {",
    "    headers: {",
    "      accept: 'text/html,application/xhtml+xml',",
    "      'user-agent': 'muel-local-n8n/1.0',",
    "    },",
    "  });",
    "  if (!pageResponse.ok) throw new Error(`Channel page fetch failed: ${pageResponse.status}`);",
    "  const pageHtml = await pageResponse.text();",
    "  channelId = pageHtml.match(/\"channelId\"\\s*:\\s*\"(UC[0-9A-Za-z_-]{20,})\"/)?.[1] || '';",
    "}",
    "if (!channelId) throw new Error('Could not resolve YouTube channel id');",
    "const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;",
    "const feedResponse = await fetch(feedUrl, {",
    "  headers: {",
    "    accept: 'application/atom+xml,text/xml;q=0.9,*/*;q=0.8',",
    "    'accept-language': 'ko,en;q=0.8',",
    "    'user-agent': 'muel-local-n8n/1.0',",
    "  },",
    "});",
    "if (!feedResponse.ok) throw new Error(`Feed fetch failed: ${feedResponse.status}`);",
    "const xml = await feedResponse.text();",
    "const decodeXml = (value) => String(value || '')",
    "  .replace(/&amp;/g, '&')",
    "  .replace(/&lt;/g, '<')",
    "  .replace(/&gt;/g, '>')",
    "  .replace(/&quot;/g, '\"')",
    "  .replace(/&#39;/g, \"'\")",
    "  .trim();",
    "const textBetween = (source, start, end) => {",
    "  const startIndex = source.indexOf(start);",
    "  if (startIndex < 0) return '';",
    "  const valueStart = startIndex + start.length;",
    "  const endIndex = source.indexOf(end, valueStart);",
    "  if (endIndex < 0) return '';",
    "  return source.slice(valueStart, endIndex).trim();",
    "};",
    "const entries = Array.from(xml.matchAll(/<entry>([\\s\\S]*?)<\\/entry>/gi))",
    "  .slice(0, 5)",
    "  .map((match) => {",
    "    const block = match[1] || '';",
    "    const link = decodeXml(block.match(/<link[^>]*href=\"([^\"]+)\"/i)?.[1] || '');",
    "    const authorBlock = textBetween(block, '<author>', '</author>');",
    "    return {",
    "      id: decodeXml(textBetween(block, '<yt:videoId>', '</yt:videoId>') || textBetween(block, '<id>', '</id>')),",
    "      title: decodeXml(textBetween(block, '<title>', '</title>')) || '(untitled)',",
    "      link,",
    "      published: decodeXml(textBetween(block, '<published>', '</published>') || textBetween(block, '<updated>', '</updated>')),",
    "      author: decodeXml(textBetween(authorBlock, '<name>', '</name>')) || 'Unknown',",
    "    };",
    "  })",
    "  .filter((entry) => entry.id && entry.link);",
    "return [{ json: { entries } }];",
  ],
});

export const buildN8nYoutubeCommunityScrapeWorkflow = ({
  webhookPath = WEBHOOK_HINTS.N8N_WEBHOOK_YOUTUBE_COMMUNITY_SCRAPE,
} = {}) => buildCodeWebhookWorkflow({
  workflowName: 'muel local youtube community scrape starter',
  task: 'youtube-community-scrape',
  templateKey: 'youtube-community-scrape',
  webhookPath,
  codeName: 'Scrape Community Post',
  manualNote: 'Starter uses a best-effort HTML parser. Replace with a more durable scraper if the page shape drifts.',
  jsCodeLines: [
    "const payload = $json.body ?? $json;",
    "const communityUrl = String(payload.communityUrl ?? '').trim();",
    "if (!communityUrl) throw new Error('communityUrl is required');",
    "const html = await this.helpers.httpRequest({",
    "  method: 'GET',",
    "  url: communityUrl,",
    "  headers: {",
    "    accept: 'text/html,application/xhtml+xml',",
    "    'accept-language': 'ko,en;q=0.8',",
    "    'user-agent': 'muel-local-n8n/1.0',",
    "  },",
    "});",
    "const decodeJsonText = (value) => String(value || '')",
    "  .replace(/\\\\u0026/g, '&')",
    "  .replace(/\\\\n/g, '\\n')",
    "  .replace(/\\\\\"/g, '\"')",
    "  .trim();",
    "const postId = html.match(/\"postId\":\"([^\"]+)\"/)?.[1] || '';",
    "const author = decodeJsonText(html.match(/\"authorText\":\{\"runs\":\[\{\"text\":\"([^\"]+)/)?.[1] || '') || 'Unknown';",
    "const published = decodeJsonText(html.match(/\"publishedTimeText\":\{\"runs\":\[\{\"text\":\"([^\"]+)/)?.[1] || '');",
    "let content = '';",
    "const contentStart = html.indexOf('\"contentText\"');",
    "if (contentStart >= 0) {",
    "  const contentSection = html.slice(contentStart, contentStart + 6000);",
    "  content = Array.from(contentSection.matchAll(/\"text\":\"([^\"]+)\"/g))",
    "    .map((match) => decodeJsonText(match[1] || ''))",
    "    .join('')",
    "    .trim();",
    "}",
    "if (!postId && !content) throw new Error('Could not parse a community post');",
    "const link = postId ? `https://www.youtube.com/post/${postId}` : communityUrl;",
    "const title = (content || 'YouTube community post').slice(0, 80);",
    "return [{ json: { id: postId || `community-${Date.now()}`, title, content, link, published, author } }];",
  ],
});

export const buildN8nAlertDispatchWorkflow = ({
  webhookPath = WEBHOOK_HINTS.N8N_WEBHOOK_ALERT_DISPATCH,
} = {}) => buildCodeWebhookWorkflow({
  workflowName: 'muel local alert dispatch starter',
  task: 'alert-dispatch',
  templateKey: 'alert-dispatch',
  webhookPath,
  codeName: 'Dispatch Alert',
  manualNote: 'Starter intentionally requires payload.webhookUrl so inline fallback stays intact until a real sink is wired.',
  jsCodeLines: [
    "const payload = $json.body ?? $json;",
    "const title = String(payload.title ?? 'Runtime alert').trim();",
    "const message = String(payload.message ?? '').trim();",
    "const webhookUrl = String(payload.webhookUrl ?? '').trim();",
    "if (!webhookUrl) throw new Error('Set payload.webhookUrl or edit this workflow to point at a real alert sink');",
    "const tags = payload.tags && typeof payload.tags === 'object' && !Array.isArray(payload.tags) ? payload.tags : {};",
    "const response = await this.helpers.httpRequest({",
    "  method: 'POST',",
    "  url: webhookUrl,",
    "  headers: { 'content-type': 'application/json' },",
    "  body: { text: `[Muel Runtime Alert] ${title}\\n${message}`, tags },",
    "  json: true,",
    "  returnFullResponse: true,",
    "});",
    "return [{ json: { dispatched: true, status: Number(response.statusCode ?? 200) } }];",
  ],
});

export const buildN8nArticleContextFetchWorkflow = ({
  webhookPath = WEBHOOK_HINTS.N8N_WEBHOOK_ARTICLE_CONTEXT_FETCH,
} = {}) => buildCodeWebhookWorkflow({
  workflowName: 'muel local article context fetch starter',
  task: 'article-context-fetch',
  templateKey: 'article-context-fetch',
  webhookPath,
  codeName: 'Fetch Article Metadata',
  jsCodeLines: [
    "const payload = $json.body ?? $json;",
    "const url = String(payload.url ?? '').trim();",
    "if (!url) return [{ json: { title: '', description: '' } }];",
    "const html = await this.helpers.httpRequest({",
    "  method: 'GET',",
    "  url,",
    "  headers: {",
    "    accept: 'text/html,application/xhtml+xml',",
    "    'accept-language': 'ko,en;q=0.8',",
    "    'user-agent': 'muel-local-n8n/1.0',",
    "  },",
    "});",
    "const decodeXml = (value) => String(value || '')",
    "  .replace(/&amp;/g, '&')",
    "  .replace(/&lt;/g, '<')",
    "  .replace(/&gt;/g, '>')",
    "  .replace(/&quot;/g, '\"')",
    "  .replace(/&#39;/g, \"'\")",
    "  .trim();",
    "const stripTags = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();",
    "const pickMeta = (key) => {",
    "  const re = new RegExp(`<meta[^>]+(?:name|property)=['\"]${key}['\"][^>]+content=['\"]([^'\"]+)['\"][^>]*>`, 'i');",
    "  return decodeXml(re.exec(html)?.[1] || '');",
    "};",
    "const titleMatch = html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i);",
    "const title = pickMeta('og:title') || decodeXml(stripTags(titleMatch?.[1] || ''));",
    "const description = pickMeta('description') || pickMeta('og:description');",
    "return [{ json: { title: title.slice(0, 300), description: description.slice(0, 1200) } }];",
  ],
});

const STARTER_WORKFLOW_SPECS = [
  {
    task: 'news-rss-fetch',
    fileName: 'news-rss-fetch-starter.workflow.json',
    webhookEnv: 'N8N_WEBHOOK_NEWS_RSS_FETCH',
    webhookPath: WEBHOOK_HINTS.N8N_WEBHOOK_NEWS_RSS_FETCH,
    description: 'Search Google News RSS by query and return { items }.',
    manualFollowUp: '',
    buildWorkflow: buildN8nNewsRssFetchWorkflow,
  },
  {
    task: 'news-summarize',
    fileName: 'news-summarize-starter.workflow.json',
    webhookEnv: 'N8N_WEBHOOK_NEWS_SUMMARIZE',
    webhookPath: WEBHOOK_HINTS.N8N_WEBHOOK_NEWS_SUMMARIZE,
    description: 'Return a heuristic summary for { title, link, description }.',
    manualFollowUp: 'Upgrade this starter to a real LLM node when you want higher-quality summaries.',
    buildWorkflow: buildN8nNewsSummarizeWorkflow,
  },
  {
    task: 'news-monitor-candidates',
    fileName: 'news-monitor-candidates-smoke.workflow.json',
    webhookEnv: 'N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES',
    webhookPath: WEBHOOK_HINTS.N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES,
    description: 'Fetch Google Finance headlines and return candidate items for news monitoring.',
    manualFollowUp: 'Refine the filtering logic if Google Finance markup changes.',
    buildWorkflow: buildN8nNewsMonitorCandidatesSmokeWorkflow,
  },
  {
    task: 'youtube-feed-fetch',
    fileName: 'youtube-feed-fetch-starter.workflow.json',
    webhookEnv: 'N8N_WEBHOOK_YOUTUBE_FEED_FETCH',
    webhookPath: WEBHOOK_HINTS.N8N_WEBHOOK_YOUTUBE_FEED_FETCH,
    description: 'Resolve a YouTube channel URL and return the latest Atom feed entries.',
    manualFollowUp: '',
    buildWorkflow: buildN8nYoutubeFeedFetchWorkflow,
  },
  {
    task: 'youtube-community-scrape',
    fileName: 'youtube-community-scrape-starter.workflow.json',
    webhookEnv: 'N8N_WEBHOOK_YOUTUBE_COMMUNITY_SCRAPE',
    webhookPath: WEBHOOK_HINTS.N8N_WEBHOOK_YOUTUBE_COMMUNITY_SCRAPE,
    description: 'Best-effort scrape of the latest YouTube community post.',
    manualFollowUp: 'Replace the HTML parser if YouTube page structure drifts.',
    buildWorkflow: buildN8nYoutubeCommunityScrapeWorkflow,
  },
  {
    task: 'alert-dispatch',
    fileName: 'alert-dispatch-starter.workflow.json',
    webhookEnv: 'N8N_WEBHOOK_ALERT_DISPATCH',
    webhookPath: WEBHOOK_HINTS.N8N_WEBHOOK_ALERT_DISPATCH,
    description: 'Forward runtime alerts to a caller-supplied webhook URL.',
    manualFollowUp: 'Wire a real sink before turning on N8N_DELEGATION_ENABLED for alerts.',
    buildWorkflow: buildN8nAlertDispatchWorkflow,
  },
  {
    task: 'article-context-fetch',
    fileName: 'article-context-fetch-starter.workflow.json',
    webhookEnv: 'N8N_WEBHOOK_ARTICLE_CONTEXT_FETCH',
    webhookPath: WEBHOOK_HINTS.N8N_WEBHOOK_ARTICLE_CONTEXT_FETCH,
    description: 'Fetch article metadata and return { title, description }.',
    manualFollowUp: '',
    buildWorkflow: buildN8nArticleContextFetchWorkflow,
  },
];

export const N8N_STARTER_WORKFLOWS = STARTER_WORKFLOW_SPECS.map((spec) => ({
  task: spec.task,
  fileName: spec.fileName,
  webhookEnv: spec.webhookEnv,
  webhookPath: spec.webhookPath,
  description: spec.description,
  manualFollowUp: spec.manualFollowUp,
}));

export const buildN8nStarterWorkflowDefinitions = () => STARTER_WORKFLOW_SPECS.map((spec) => ({
  ...spec,
  workflow: spec.buildWorkflow({ webhookPath: spec.webhookPath }),
}));

export const buildN8nStarterWorkflowManifest = () => JSON.stringify({
  generatedBy: 'scripts/bootstrap-n8n-local.mjs',
  workflows: buildN8nStarterWorkflowDefinitions().map((definition) => ({
    task: definition.task,
    fileName: definition.fileName,
    workflowName: definition.workflow.name,
    webhookEnv: definition.webhookEnv,
    webhookPath: definition.webhookPath,
    description: definition.description,
    manualFollowUp: definition.manualFollowUp,
  })),
}, null, 2);

const buildRepoEnvHints = () => [
  'N8N_DISABLED=false',
  'N8N_ENABLED=true',
  `N8N_BASE_URL=${DEFAULT_BASE_URL}`,
  'N8N_TIMEOUT_MS=30000',
  'N8N_DELEGATION_ENABLED=false',
  'N8N_DELEGATION_FIRST=false',
  '# Optional repo-managed local public API key. npm run n8n:local:api-key:ensure can populate this automatically:',
  '# N8N_API_KEY=',
  '# Suggested webhook path wiring:',
  ...Object.entries(WEBHOOK_HINTS).map(([key, value]) => `${key}=${value}`),
].join('\n');

export const buildN8nLocalComposeYaml = () => `services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    container_name: muel-local-n8n
    restart: unless-stopped
    ports:
      - "127.0.0.1:\${N8N_PORT:-5678}:5678"
    env_file:
      - .env
    volumes:
      - ./data:/home/node/.n8n
`;

export const buildN8nLocalEnvFile = ({
  baseUrl = DEFAULT_BASE_URL,
  encryptionKey = randomBytes(24).toString('hex'),
  timezone = DEFAULT_TIMEZONE,
} = {}) => {
  const normalized = normalizeBaseUrl({ rawBaseUrl: baseUrl });
  const secureCookie = normalized.protocol === 'https:' ? 'true' : 'false';
  return [
    '# Generated by scripts/bootstrap-n8n-local.mjs',
    '# Local-only file. Keep it out of version control.',
    `N8N_HOST=${normalized.host}`,
    `N8N_PORT=${normalized.port}`,
    `N8N_PROTOCOL=${normalized.protocol.replace(':', '')}`,
    `N8N_EDITOR_BASE_URL=${normalized.baseUrl}`,
    `WEBHOOK_URL=${normalized.baseUrl}/`,
    `GENERIC_TIMEZONE=${timezone}`,
    `N8N_ENCRYPTION_KEY=${encryptionKey}`,
    'N8N_USER_FOLDER=/home/node/.n8n',
    `N8N_SECURE_COOKIE=${secureCookie}`,
    'N8N_DIAGNOSTICS_ENABLED=false',
    'N8N_PERSONALIZATION_ENABLED=false',
    'N8N_BASIC_AUTH_ACTIVE=true',
    'N8N_BASIC_AUTH_USER=admin',
    'N8N_BASIC_AUTH_PASSWORD=change-me-local-only',
  ].join('\n');
};

export const buildN8nLocalReadme = ({
  baseUrl = DEFAULT_BASE_URL,
  outputDir = 'tmp/n8n-local',
} = {}) => {
  const definitions = buildN8nStarterWorkflowDefinitions();
  const workflowList = definitions
    .map((definition) => `- workflows/${definition.fileName}: ${definition.description}`)
    .join('\n');
  const followUps = definitions
    .filter((definition) => definition.manualFollowUp)
    .map((definition) => `- ${definition.task}: ${definition.manualFollowUp}`)
    .join('\n');

  return `# Local n8n Bootstrap

This directory is generated by scripts/bootstrap-n8n-local.mjs.

Files:
- compose.yaml: local Docker Compose stack for n8n
- .env: local-only n8n container settings and credentials
- ${DEFAULT_WORKFLOW_MANIFEST_FILE}: task-to-workflow manifest for the starter bundle
${workflowList}
- data/: persisted n8n state

Recommended flow:
1. Review .env and change N8N_BASIC_AUTH_PASSWORD before first long-running use.
2. Start n8n with: npm run n8n:local:start
3. Open ${baseUrl} and sign in with the basic-auth credentials from .env.
4. Preview the deterministic install plan with: npm run n8n:local:seed:plan
5. Create an approval-gated install request with: npm run n8n:local:seed:request
6. Approve and apply the request with: npm run n8n:local:seed:approve-and-apply -- --requestId=<approval-request-id> --actorId=<operator-id>
7. If you need breakglass local-only maintenance, you can still seed directly with: npm run n8n:local:seed
8. If you want repo-driven workflow CRUD or update-from-repo over the public API, generate the local repo key with: npm run n8n:local:api-key:ensure
9. If N8N_API_KEY is absent but the local container is running, the seed command first tries local public API auto-provision and then falls back to container CLI import automatically.
10. Keep the operation log under ${outputDir}/operations and roll back with: npm run n8n:local:rollback -- --operationId=<operation-id>
11. Re-apply your repo env profile if needed: npm run env:profile:local or npm run env:profile:local-first-hybrid
12. Verify with: npm run n8n:local:doctor

Important notes:
- In this repo, "local self-hosted n8n" means the OSS Docker image is downloaded into Docker Desktop, the container runs on this machine, and state is persisted under ${outputDir}/data.
- Webhook delegation can work without N8N_API_KEY.
- N8N_API_KEY is not the installation itself. It only unlocks repo-driven public API CRUD and updateExisting behavior.
- For local n8n 2.15.x in this repo, npm run n8n:local:api-key:ensure can generate a working repo-managed public API key without a manual UI step.
- Deterministic starter installs now close through the approval action ${N8N_STARTER_INSTALL_ACTION_NAME}, so the request/apply path can stop at an installable workflow instead of a draft seed payload.
- npm run n8n:local:seed can auto-provision a local public API key first, and still falls back to docker CLI import when public API CRUD is unavailable.
- The generated starter workflows now import active by default so repo-side webhook execution works on localhost without a manual activation toggle.
- UpdateExisting and automatic rollback both rely on the public API lane; docker CLI fallback only supports create or skip-existing behavior.
- workflow.list / workflow.execute / workflow.status / workflow create+update over the public API still need N8N_API_KEY.
- Generated files live under ${outputDir}, which is git-ignored in this repo.
${followUps ? `${followUps}\n` : ''}
Suggested repo env wiring:

${buildRepoEnvHints()}
`;
};

const safeJson = async (resp) => {
  try {
    return await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    return { raw: text };
  }
};

const buildN8nApiHeaders = () => {
  const apiKey = String(process.env.N8N_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('N8N_API_KEY is required for --seed=true');
  }

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': apiKey,
  };
};

const fetchN8nPublicApi = async ({ baseUrl, pathName, method = 'GET', body }) => {
  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/api/v1${pathName}`, {
    method,
    headers: buildN8nApiHeaders(),
    body: body == null ? undefined : JSON.stringify(body),
  }, N8N_API_TIMEOUT_MS);

  const data = await safeJson(response);
  if (!response.ok) {
    const detail = typeof data === 'string'
      ? data
      : JSON.stringify(data);
    throw new Error(`n8n API ${method} ${pathName} failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
  }

  return data;
};

const extractWorkflowList = (data) => {
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data?.data)) {
    return data.data;
  }
  if (Array.isArray(data?.data?.data)) {
    return data.data.data;
  }
  return [];
};

export const toN8nWorkflowSeedPayload = (workflow) => {
  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
  };

  if (workflow.settings != null) payload.settings = workflow.settings;
  if (workflow.staticData !== undefined) payload.staticData = workflow.staticData;
  if (workflow.pinData != null) payload.pinData = workflow.pinData;

  return payload;
};

const syncN8nWorkflowActiveState = async ({
  baseUrl,
  workflowId,
  desiredActive,
} = {}) => {
  const normalizedId = String(workflowId || '').trim();
  if (!normalizedId || typeof desiredActive !== 'boolean') {
    return null;
  }

  return fetchN8nPublicApi({
    baseUrl,
    pathName: `/workflows/${encodeURIComponent(normalizedId)}/${desiredActive ? 'activate' : 'deactivate'}`,
    method: 'POST',
    body: {},
  });
};

const parseRequestedTasks = (rawTasks) => String(rawTasks || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const selectN8nStarterWorkflowDefinitions = ({ tasks = [] } = {}) => {
  const definitions = buildN8nStarterWorkflowDefinitions();
  const knownTasks = new Set(definitions.map((definition) => definition.task));
  const unknownTasks = tasks.filter((task) => !knownTasks.has(task));

  if (unknownTasks.length > 0) {
    throw new Error(`Unknown n8n starter task(s): ${unknownTasks.join(', ')}`);
  }

  return {
    definitions,
    selected: tasks.length > 0
      ? definitions.filter((definition) => tasks.includes(definition.task))
      : definitions,
  };
};

const sanitizeFileToken = (value, fallback = 'workflow') => {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
};

const resolveStarterWorkflowOperationId = (value) => {
  const normalized = sanitizeFileToken(value, '');
  if (normalized) {
    return normalized;
  }

  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `starter-${timestamp}-${randomBytes(4).toString('hex')}`;
};

const toRepoRelativePath = (filePath) => {
  const relative = path.relative(ROOT, filePath);
  return (relative || filePath).replace(/\\/g, '/');
};

const resolveAbsoluteFilePath = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  return path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(ROOT, normalized);
};

/**
 * @param {{ outputDir?: string, operationId?: string }} [params]
 */
export const buildN8nStarterOperationPaths = ({
  outputDir = DEFAULT_OUTPUT_DIR,
  operationId,
} = {}) => {
  const normalizedOperationId = resolveStarterWorkflowOperationId(operationId);
  const operationsDir = path.join(outputDir, DEFAULT_OPERATION_DIR_NAME);
  const operationDir = path.join(operationsDir, normalizedOperationId);
  const backupDir = path.join(operationDir, 'backups');
  const operationLogPath = path.join(operationsDir, `${normalizedOperationId}.json`);

  return {
    operationId: normalizedOperationId,
    operationsDir,
    operationDir,
    backupDir,
    operationLogPath,
  };
};

const ensureN8nPublicApiReady = async ({
  baseUrl = DEFAULT_BASE_URL,
} = {}) => {
  const initialProbe = await probeN8nWorkflowApi({ baseUrl });
  let finalProbe = initialProbe;
  let apiKeyEnsure = null;

  if (!initialProbe.ok && inspectDockerContainerRunning(DEFAULT_N8N_CONTAINER_NAME) === true) {
    try {
      apiKeyEnsure = await ensureLocalN8nPublicApiKey({ baseUrl });
      finalProbe = await probeN8nWorkflowApi({ baseUrl });
    } catch (error) {
      apiKeyEnsure = {
        ensured: false,
        changed: false,
        source: 'auto-provision-failed',
        reason: error instanceof Error ? error.message : String(error),
        workflowApiStatus: initialProbe.status,
      };
      finalProbe = await probeN8nWorkflowApi({ baseUrl });
    }
  }

  return {
    apiKey: String(process.env.N8N_API_KEY || '').trim(),
    initialProbe,
    finalProbe,
    apiKeyEnsure,
  };
};

const fetchN8nWorkflowById = async ({
  baseUrl = DEFAULT_BASE_URL,
  workflowId,
} = {}) => {
  const normalizedWorkflowId = String(workflowId || '').trim();
  if (!normalizedWorkflowId) {
    throw new Error('workflowId is required');
  }

  return fetchN8nPublicApi({
    baseUrl,
    pathName: `/workflows/${encodeURIComponent(normalizedWorkflowId)}`,
    method: 'GET',
  });
};

const deleteN8nWorkflowById = async ({
  baseUrl = DEFAULT_BASE_URL,
  workflowId,
} = {}) => {
  const normalizedWorkflowId = String(workflowId || '').trim();
  if (!normalizedWorkflowId) {
    throw new Error('workflowId is required');
  }

  return fetchN8nPublicApi({
    baseUrl,
    pathName: `/workflows/${encodeURIComponent(normalizedWorkflowId)}`,
    method: 'DELETE',
  });
};

const buildN8nStarterRollbackPolicy = ({
  results = [],
  plannedMethod = 'docker-cli',
  autoProvisionAvailable = false,
} = {}) => {
  const createdCount = results.filter((item) => item.status === 'created' || item.status === 'create').length;
  const updatedCount = results.filter((item) => item.status === 'updated' || item.status === 'update').length;
  const mutatedCount = createdCount + updatedCount;
  const automatic = mutatedCount > 0 && (plannedMethod === 'public-api' || plannedMethod === 'public-api-with-auto-provision' || autoProvisionAvailable);

  return {
    automatic,
    createdCount,
    updatedCount,
    summary: mutatedCount === 0
      ? 'No workflow changes are planned or recorded, so rollback is not required.'
      : automatic
        ? 'Automatic rollback is available from the repo-managed operation log.'
        : 'Rollback exists as an operator policy, but automatic replay needs a running local container plus public API access.',
    steps: [
      automatic
        ? 'Run npm run n8n:local:rollback -- --operationId=<operation-id> to replay the recorded rollback steps.'
        : 'Review the operation log and restore or remove workflows manually from the n8n UI if automatic rollback is unavailable.',
      updatedCount > 0
        ? 'Updated workflows restore the captured backup snapshot and original active state.'
        : null,
      createdCount > 0
        ? 'Created workflows are removed by workflow id during rollback.'
        : null,
    ].filter(Boolean),
  };
};

const writeN8nStarterOperationRecord = async ({
  outputDir = DEFAULT_OUTPUT_DIR,
  operationId,
  payload,
} = {}) => {
  const paths = buildN8nStarterOperationPaths({ outputDir, operationId });
  await fs.mkdir(path.dirname(paths.operationLogPath), { recursive: true });
  await fs.writeFile(paths.operationLogPath, `${JSON.stringify(payload, null, 2).trim()}\n`, 'utf8');
  return {
    ...paths,
    operationLogPathRelative: toRepoRelativePath(paths.operationLogPath),
  };
};

const readN8nStarterOperationRecord = async ({
  outputDir = DEFAULT_OUTPUT_DIR,
  operationId,
  operationLogPath,
} = {}) => {
  const resolvedLogPath = operationLogPath
    ? resolveAbsoluteFilePath(operationLogPath)
    : buildN8nStarterOperationPaths({ outputDir, operationId }).operationLogPath;

  if (!resolvedLogPath) {
    throw new Error('An operationId or operationLogPath is required for rollback');
  }

  const raw = await fs.readFile(resolvedLogPath, 'utf8');
  return {
    operationLogPath: resolvedLogPath,
    record: JSON.parse(raw),
  };
};

export const parseN8nCliWorkflowListOutput = (stdout) => String(stdout || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const separatorIndex = line.indexOf('|');
    if (separatorIndex <= 0) {
      return null;
    }

    const id = line.slice(0, separatorIndex).trim();
    const name = line.slice(separatorIndex + 1).trim();
    if (!id || !name) {
      return null;
    }

    return { id, name };
  })
  .filter(Boolean);

const listN8nCliWorkflows = ({ containerName = DEFAULT_N8N_CONTAINER_NAME } = {}) => parseN8nCliWorkflowListOutput(
  runCommandStrict('docker', ['exec', containerName, 'n8n', 'list:workflow']),
);

export const listN8nLocalWorkflowsViaDockerCli = ({ containerName = DEFAULT_N8N_CONTAINER_NAME } = {}) =>
  listN8nCliWorkflows({ containerName });

const inspectDockerContainerRunning = (containerName = DEFAULT_N8N_CONTAINER_NAME) => {
  const output = readCommandOutput('docker', ['inspect', '--format={{.State.Running}}', containerName]);
  if (!output) {
    return null;
  }
  if (output === 'true') {
    return true;
  }
  if (output === 'false') {
    return false;
  }
  return null;
};

const seedN8nStarterWorkflowsViaDockerCli = async ({
  outputDir = DEFAULT_OUTPUT_DIR,
  baseUrl = DEFAULT_BASE_URL,
  tasks = [],
  updateExisting = false,
  containerName = DEFAULT_N8N_CONTAINER_NAME,
  apiKeyEnsure = null,
} = {}) => {
  const { selected } = selectN8nStarterWorkflowDefinitions({ tasks });
  const existingWorkflows = listN8nCliWorkflows({ containerName });
  const existingByName = new Map(existingWorkflows.map((workflow) => [workflow.name, workflow]));
  const results = [];
  const pending = [];

  for (const definition of selected) {
    const existing = existingByName.get(definition.workflow.name);
    if (existing && !updateExisting) {
      results.push({
        task: definition.task,
        fileName: definition.fileName,
        workflowName: definition.workflow.name,
        workflowId: existing.id,
        status: 'skipped-existing',
      });
      continue;
    }

    if (existing && updateExisting) {
      throw new Error('N8N_API_KEY is required to update existing starter workflows; docker CLI fallback only supports initial import or skip-existing behavior.');
    }

    pending.push(definition);
  }

  if (pending.length > 0) {
    const stagingDir = await fs.mkdtemp(path.join(outputDir, '.docker-import-'));
    try {
      await Promise.all(pending.map((definition) => fs.writeFile(
        path.join(stagingDir, definition.fileName),
        `${JSON.stringify(definition.workflow, null, 2).trim()}\n`,
        'utf8',
      )));

      runCommandStrict('docker', ['exec', containerName, 'sh', '-lc', 'rm -rf /tmp/muel-workflows && mkdir -p /tmp/muel-workflows']);
      runCommandStrict('docker', ['cp', `${stagingDir}${path.sep}.`, `${containerName}:/tmp/muel-workflows`]);
      runCommandStrict('docker', ['exec', containerName, 'n8n', 'import:workflow', '--separate', '--input=/tmp/muel-workflows']);

      const refreshed = new Map(listN8nCliWorkflows({ containerName }).map((workflow) => [workflow.name, workflow]));
      for (const definition of pending) {
        const imported = refreshed.get(definition.workflow.name);
        results.push({
          task: definition.task,
          fileName: definition.fileName,
          workflowName: definition.workflow.name,
          workflowId: imported?.id || '',
          status: 'created',
        });
      }
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }

  return {
    baseUrl,
    requestedTasks: selected.map((definition) => definition.task),
    updateExisting,
    seedMethod: 'docker-cli',
    apiKeyEnsure,
    results,
  };
};

export const seedN8nStarterWorkflows = async ({
  outputDir = DEFAULT_OUTPUT_DIR,
  baseUrl = DEFAULT_BASE_URL,
  tasks = [],
  updateExisting = false,
  dryRun = false,
  operationId,
  approvalRequestId = null,
  requestedBy = null,
} = {}) => {
  const preview = await previewN8nStarterWorkflows({
    outputDir,
    baseUrl,
    tasks,
    updateExisting,
    operationId,
  });

  if (dryRun) {
    return preview;
  }

  if (!preview.canApply) {
    throw new Error(`Local n8n apply is blocked: ${preview.blockedReasons.join(' | ')}`);
  }

  const { selected } = selectN8nStarterWorkflowDefinitions({ tasks: preview.requestedTasks });
  const operationPaths = buildN8nStarterOperationPaths({
    outputDir,
    operationId: preview.operationId,
  });
  const backups = [];
  let results = [];
  let apiKeyEnsure = null;
  let seedMethod = preview.plannedMethod === 'docker-cli' ? 'docker-cli' : 'public-api';
  let executionError = null;

  try {
    const apiAccess = await ensureN8nPublicApiReady({ baseUrl });
    apiKeyEnsure = apiAccess.apiKeyEnsure;

    if (!apiAccess.apiKey || !apiAccess.finalProbe.ok) {
      const fallback = await seedN8nStarterWorkflowsViaDockerCli({
        outputDir,
        baseUrl,
        tasks: preview.requestedTasks,
        updateExisting,
        apiKeyEnsure,
      });
      seedMethod = fallback.seedMethod;
      apiKeyEnsure = fallback.apiKeyEnsure || apiKeyEnsure;
      results = fallback.results;
    } else {
      const listed = await fetchN8nPublicApi({ baseUrl, pathName: '/workflows?limit=250', method: 'GET' });
      const existingWorkflows = extractWorkflowList(listed);
      const existingByName = new Map(existingWorkflows.map((workflow) => [String(workflow.name || ''), workflow]));

      for (const definition of selected) {
        const existing = existingByName.get(definition.workflow.name);
        const desiredActive = definition.workflow.active === true;

        if (existing && !updateExisting) {
          results.push({
            task: definition.task,
            fileName: definition.fileName,
            workflowName: definition.workflow.name,
            workflowId: String(existing.id || ''),
            status: 'skipped-existing',
          });
          continue;
        }

        if (existing) {
          const existingId = String(existing.id || '');
          const backupWorkflow = await fetchN8nWorkflowById({
            baseUrl,
            workflowId: existingId,
          });
          const backupFileName = `${sanitizeFileToken(definition.task, 'task')}-${sanitizeFileToken(existingId, 'workflow')}.json`;
          const backupFilePath = path.join(operationPaths.backupDir, backupFileName);
          await fs.mkdir(operationPaths.backupDir, { recursive: true });
          await fs.writeFile(backupFilePath, `${JSON.stringify(backupWorkflow, null, 2).trim()}\n`, 'utf8');
          backups.push({
            task: definition.task,
            workflowId: existingId,
            workflowName: definition.workflow.name,
            backupPath: toRepoRelativePath(backupFilePath),
            activeBefore: typeof backupWorkflow?.active === 'boolean'
              ? backupWorkflow.active
              : Boolean(existing.active),
          });

          const updated = await fetchN8nPublicApi({
            baseUrl,
            pathName: `/workflows/${encodeURIComponent(existingId)}`,
            method: 'PUT',
            body: toN8nWorkflowSeedPayload(definition.workflow),
          });
          const updatedId = String(updated?.id || existing.id || '');
          const nextActive = typeof updated?.active === 'boolean' ? updated.active : Boolean(existing.active);

          if (nextActive !== desiredActive) {
            await syncN8nWorkflowActiveState({
              baseUrl,
              workflowId: updatedId,
              desiredActive,
            });
          }

          results.push({
            task: definition.task,
            fileName: definition.fileName,
            workflowName: definition.workflow.name,
            workflowId: updatedId,
            status: 'updated',
          });
          continue;
        }

        const created = await fetchN8nPublicApi({
          baseUrl,
          pathName: '/workflows',
          method: 'POST',
          body: toN8nWorkflowSeedPayload(definition.workflow),
        });
        const createdId = String(created?.id || '');

        if (desiredActive && createdId) {
          await syncN8nWorkflowActiveState({
            baseUrl,
            workflowId: createdId,
            desiredActive: true,
          });
        }

        results.push({
          task: definition.task,
          fileName: definition.fileName,
          workflowName: definition.workflow.name,
          workflowId: createdId,
          status: 'created',
        });

        existingByName.set(definition.workflow.name, created);
      }
    }
  } catch (error) {
    executionError = error instanceof Error ? error.message : String(error);
  }

  const rollbackPolicy = buildN8nStarterRollbackPolicy({
    results,
    plannedMethod: preview.plannedMethod,
    autoProvisionAvailable: preview.doctor?.status?.apiKeyAutoProvisionAvailable === true,
  });
  const operationRecord = {
    schema: 'n8n-starter-operation/v1',
    operationId: operationPaths.operationId,
    createdAt: new Date().toISOString(),
    approvalRequestId: approvalRequestId || null,
    requestedBy: requestedBy || null,
    baseUrl,
    outputDirRelative: path.relative(ROOT, outputDir) || '.',
    requestedTasks: preview.requestedTasks,
    updateExisting,
    seedMethod,
    doctor: {
      ok: preview.doctor.ok,
      summary: preview.doctor.summary,
      failures: preview.doctor.failures,
      warnings: preview.doctor.warnings,
    },
    apiKeyEnsure,
    results,
    backups,
    rollbackPolicy,
    error: executionError,
  };
  const writtenOperation = await writeN8nStarterOperationRecord({
    outputDir,
    operationId: operationPaths.operationId,
    payload: operationRecord,
  });

  if (executionError) {
    throw new Error(`${executionError} (operationLog=${writtenOperation.operationLogPathRelative})`);
  }

  return {
    baseUrl,
    requestedTasks: preview.requestedTasks,
    updateExisting,
    seedMethod,
    apiKeyEnsure,
    results,
    operationId: operationPaths.operationId,
    operationLogPath: writtenOperation.operationLogPath,
    operationLogPathRelative: writtenOperation.operationLogPathRelative,
    rollbackPolicy,
    approvalRequestId,
    requestedBy,
    backups,
  };
};

export const resolveN8nLocalStatus = async ({
  outputDir = DEFAULT_OUTPUT_DIR,
  baseUrl = DEFAULT_BASE_URL,
} = {}) => {
  const composePath = path.join(outputDir, 'compose.yaml');
  const envPath = path.join(outputDir, '.env');
  const readmePath = path.join(outputDir, 'README.md');
  const dataPath = path.join(outputDir, 'data');
  const workflowDirPath = path.join(outputDir, 'workflows');
  const manifestPath = path.join(outputDir, DEFAULT_WORKFLOW_MANIFEST_FILE);

  const dockerAvailable = runCommandProbe('docker', ['--version']);
  const dockerComposeAvailable = dockerAvailable && runCommandProbe('docker', ['compose', 'version']);
  const imagePresent = dockerAvailable && runCommandProbe('docker', ['image', 'inspect', DEFAULT_N8N_IMAGE]);
  const containerPresent = dockerAvailable && runCommandProbe('docker', ['inspect', DEFAULT_N8N_CONTAINER_NAME]);
  const containerRunning = containerPresent ? inspectDockerContainerRunning(DEFAULT_N8N_CONTAINER_NAME) : null;
  const importedWorkflowCount = containerRunning
    ? (() => {
      try {
        return listN8nCliWorkflows({ containerName: DEFAULT_N8N_CONTAINER_NAME }).length;
      } catch {
        return null;
      }
    })()
    : null;
  const workflowTemplateCount = await fs.readdir(workflowDirPath)
    .then((entries) => entries.filter((entry) => entry.endsWith('.workflow.json')).length)
    .catch(() => 0);

  let healthzStatus = null;
  let workflowApiStatus = null;
  let reachable = false;
  let workflowApiReady = false;
  let workflowApiAuthRequired = false;

  try {
    const healthz = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/healthz`, { method: 'GET' }, 3_000);
    healthzStatus = healthz.status;
    reachable = healthz.ok;
  } catch {
    healthzStatus = null;
  }

  const workflowProbe = await probeN8nWorkflowApi({ baseUrl });
  workflowApiStatus = workflowProbe.status;
  if (workflowProbe.ok) {
    reachable = true;
    workflowApiReady = true;
  } else if (workflowProbe.authRequired) {
    reachable = true;
    workflowApiAuthRequired = true;
  }

  return {
    outputDir,
    outputDirRelative: path.relative(ROOT, outputDir) || '.',
    composePath,
    envPath,
    readmePath,
    dataPath,
    workflowDirPath,
    manifestPath,
    composeExists: await fs.access(composePath).then(() => true).catch(() => false),
    envExists: await fs.access(envPath).then(() => true).catch(() => false),
    readmeExists: await fs.access(readmePath).then(() => true).catch(() => false),
    dataDirExists: await fs.access(dataPath).then(() => true).catch(() => false),
    workflowDirExists: await fs.access(workflowDirPath).then(() => true).catch(() => false),
    manifestExists: await fs.access(manifestPath).then(() => true).catch(() => false),
    workflowTemplateCount,
    dockerAvailable,
    dockerComposeAvailable,
    imageName: DEFAULT_N8N_IMAGE,
    imagePresent,
    containerName: DEFAULT_N8N_CONTAINER_NAME,
    containerPresent,
    containerRunning,
    importedWorkflowCount,
    installConfirmed: Boolean(imagePresent && containerRunning),
    installMode: imagePresent ? 'docker-desktop-self-hosted' : 'not-installed-locally',
    baseUrl,
    reachable,
    healthzStatus,
    workflowApiStatus,
    workflowApiReady,
    workflowApiAuthRequired,
    apiKeyConfigured: Boolean(String(process.env.N8N_API_KEY || '').trim()),
    apiKeyAutoProvisionAvailable: containerRunning === true,
  };
};

export const buildN8nLocalDoctorReport = (status) => {
  const failures = [];
  const warnings = [];
  const nextSteps = [];

  if (!status.composeExists || !status.envExists) {
    failures.push('Repo-managed local n8n bootstrap files are missing.');
    nextSteps.push('npm run n8n:local:bootstrap');
  }

  if (!status.dockerAvailable || !status.dockerComposeAvailable) {
    failures.push('Docker Desktop and docker compose must be available for the local n8n lane.');
  }

  if (status.containerRunning !== true) {
    failures.push('The local n8n container is not running.');
    nextSteps.push('npm run n8n:local:start');
  }

  if (!status.reachable) {
    failures.push(`Local n8n is not reachable at ${status.baseUrl}.`);
  }

  if (status.workflowTemplateCount === 0) {
    warnings.push('No starter workflow templates are present under tmp/n8n-local/workflows.');
  }

  if (status.importedWorkflowCount === 0 && status.containerRunning === true) {
    warnings.push('No workflows are currently imported into the local n8n instance.');
  }

  if (status.workflowApiAuthRequired && !status.apiKeyConfigured) {
    warnings.push('Repo-managed workflow CRUD is locked until N8N_API_KEY is configured or auto-provisioned.');
    if (status.apiKeyAutoProvisionAvailable) {
      nextSteps.push('npm run n8n:local:api-key:ensure');
    }
  }

  if (status.apiKeyConfigured && !status.workflowApiReady && status.workflowApiStatus != null) {
    warnings.push(`N8N_API_KEY is configured but workflow API still reports HTTP ${status.workflowApiStatus}.`);
  }

  return {
    ok: failures.length === 0,
    summary: failures.length === 0
      ? 'Local n8n bootstrap and runtime checks passed.'
      : `Local n8n doctor found ${failures.length} blocking issue(s).`,
    failures,
    warnings,
    nextSteps: [...new Set(nextSteps)],
    status,
  };
};

export const resolveN8nLocalDoctorReport = async (params = {}) => {
  const status = await resolveN8nLocalStatus(params);
  return buildN8nLocalDoctorReport(status);
};

export const previewN8nStarterWorkflows = async ({
  outputDir = DEFAULT_OUTPUT_DIR,
  baseUrl = DEFAULT_BASE_URL,
  tasks = [],
  updateExisting = false,
  operationId,
} = {}) => {
  const { selected } = selectN8nStarterWorkflowDefinitions({ tasks });
  const status = await resolveN8nLocalStatus({ outputDir, baseUrl });
  const doctor = buildN8nLocalDoctorReport(status);
  const existingByName = new Map();
  let existingDiscoverySource = 'none';

  if (status.workflowApiReady) {
    try {
      const listed = await fetchN8nPublicApi({ baseUrl, pathName: '/workflows?limit=250', method: 'GET' });
      for (const workflow of extractWorkflowList(listed)) {
        existingByName.set(String(workflow.name || ''), workflow);
      }
      existingDiscoverySource = 'public-api';
    } catch {
      existingDiscoverySource = 'none';
    }
  }

  if (existingByName.size === 0 && status.containerRunning === true) {
    try {
      for (const workflow of listN8nCliWorkflows({ containerName: DEFAULT_N8N_CONTAINER_NAME })) {
        existingByName.set(workflow.name, workflow);
      }
      existingDiscoverySource = 'docker-cli';
    } catch {
      if (existingDiscoverySource === 'none') {
        existingDiscoverySource = 'none';
      }
    }
  }

  const plannedMethod = status.workflowApiReady
    ? 'public-api'
    : status.apiKeyAutoProvisionAvailable
      ? 'public-api-with-auto-provision'
      : 'docker-cli';
  const blockedReasons = [...doctor.failures];

  if (updateExisting && plannedMethod === 'docker-cli') {
    blockedReasons.push('updateExisting requires public API CRUD; the docker CLI fallback only supports create or skip-existing behavior.');
  }

  const results = selected.map((definition) => {
    const existing = existingByName.get(definition.workflow.name);
    if (existing && !updateExisting) {
      return {
        task: definition.task,
        fileName: definition.fileName,
        workflowName: definition.workflow.name,
        workflowId: String(existing.id || ''),
        status: 'skipped-existing',
        transport: plannedMethod,
        webhookPath: definition.webhookPath,
        manualFollowUp: definition.manualFollowUp,
        reason: 'Workflow already exists and updateExisting is false.',
      };
    }

    if (existing && updateExisting) {
      return {
        task: definition.task,
        fileName: definition.fileName,
        workflowName: definition.workflow.name,
        workflowId: String(existing.id || ''),
        status: plannedMethod === 'docker-cli' ? 'blocked' : 'update',
        transport: plannedMethod === 'docker-cli' ? 'unavailable' : plannedMethod,
        webhookPath: definition.webhookPath,
        manualFollowUp: definition.manualFollowUp,
        reason: plannedMethod === 'docker-cli'
          ? 'Existing workflow updates are blocked until the public API lane is available.'
          : 'Workflow already exists and updateExisting is true.',
      };
    }

    return {
      task: definition.task,
      fileName: definition.fileName,
      workflowName: definition.workflow.name,
      workflowId: '',
      status: 'create',
      transport: plannedMethod,
      webhookPath: definition.webhookPath,
      manualFollowUp: definition.manualFollowUp,
      reason: plannedMethod === 'public-api-with-auto-provision'
        ? 'Workflow is missing and the repo will auto-provision the local public API key before applying it when possible.'
        : 'Workflow is missing and will be created from the starter bundle.',
    };
  });

  const paths = buildN8nStarterOperationPaths({
    outputDir,
    operationId,
  });

  return {
    baseUrl,
    outputDir,
    outputDirRelative: path.relative(ROOT, outputDir) || '.',
    requestedTasks: selected.map((definition) => definition.task),
    updateExisting,
    dryRun: true,
    canApply: blockedReasons.length === 0 && results.every((item) => item.status !== 'blocked'),
    blockedReasons: [...new Set(blockedReasons)],
    doctor,
    plannedMethod,
    existingDiscoverySource,
    operationId: paths.operationId,
    operationLogPath: paths.operationLogPath,
    operationLogPathRelative: toRepoRelativePath(paths.operationLogPath),
    results,
    rollbackPolicy: buildN8nStarterRollbackPolicy({
      results,
      plannedMethod,
      autoProvisionAvailable: status.apiKeyAutoProvisionAvailable === true,
    }),
  };
};

export const rollbackN8nStarterWorkflowOperation = async ({
  outputDir = DEFAULT_OUTPUT_DIR,
  baseUrl = DEFAULT_BASE_URL,
  operationId,
  operationLogPath,
} = {}) => {
  const { record, operationLogPath: resolvedOperationLogPath } = await readN8nStarterOperationRecord({
    outputDir,
    operationId,
    operationLogPath,
  });
  const effectiveBaseUrl = String(record?.baseUrl || baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const apiAccess = await ensureN8nPublicApiReady({ baseUrl: effectiveBaseUrl });

  if (!apiAccess.apiKey || !apiAccess.finalProbe.ok) {
    throw new Error('Automatic rollback requires local n8n public API access or auto-provision support.');
  }

  const rollbackResults = [];
  const backupEntries = Array.isArray(record?.backups) ? record.backups : [];
  const backupByTask = new Map(backupEntries.map((entry) => [String(entry?.task || ''), entry]));
  const recordedResults = Array.isArray(record?.results) ? [...record.results].reverse() : [];

  for (const item of recordedResults) {
    const task = String(item?.task || '').trim();
    const workflowId = String(item?.workflowId || '').trim();
    const status = String(item?.status || '').trim();

    if (status === 'updated') {
      const backup = backupByTask.get(task);
      if (!backup?.backupPath) {
        rollbackResults.push({ task, workflowId, status: 'missing-backup' });
        continue;
      }

      const backupWorkflow = JSON.parse(await fs.readFile(resolveAbsoluteFilePath(backup.backupPath), 'utf8'));
      await fetchN8nPublicApi({
        baseUrl: effectiveBaseUrl,
        pathName: `/workflows/${encodeURIComponent(workflowId)}`,
        method: 'PUT',
        body: toN8nWorkflowSeedPayload(backupWorkflow),
      });

      if (typeof backup.activeBefore === 'boolean') {
        await syncN8nWorkflowActiveState({
          baseUrl: effectiveBaseUrl,
          workflowId,
          desiredActive: backup.activeBefore,
        });
      }

      rollbackResults.push({ task, workflowId, status: 'restored' });
      continue;
    }

    if (status === 'created') {
      if (!workflowId) {
        rollbackResults.push({ task, workflowId, status: 'missing-workflow-id' });
        continue;
      }

      try {
        await deleteN8nWorkflowById({
          baseUrl: effectiveBaseUrl,
          workflowId,
        });
        rollbackResults.push({ task, workflowId, status: 'deleted' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('HTTP 404')) {
          rollbackResults.push({ task, workflowId, status: 'already-missing' });
          continue;
        }
        throw error;
      }
      continue;
    }

    rollbackResults.push({ task, workflowId, status: 'skipped' });
  }

  return {
    operationId: String(record?.operationId || operationId || '').trim(),
    baseUrl: effectiveBaseUrl,
    operationLogPath: resolvedOperationLogPath,
    operationLogPathRelative: toRepoRelativePath(resolvedOperationLogPath),
    apiKeyEnsure: apiAccess.apiKeyEnsure,
    results: rollbackResults,
    summary: rollbackResults.length === 0
      ? 'No recorded workflow mutations required rollback.'
      : 'Recorded starter workflow mutations were replayed in reverse order.',
  };
};

export const bootstrapN8nLocal = async ({
  outputDir = DEFAULT_OUTPUT_DIR,
  baseUrl = DEFAULT_BASE_URL,
  dryRun = false,
  force = false,
} = {}) => {
  const composePath = path.join(outputDir, 'compose.yaml');
  const envPath = path.join(outputDir, '.env');
  const readmePath = path.join(outputDir, 'README.md');
  const dataPath = path.join(outputDir, 'data');
  const workflowDirPath = path.join(outputDir, 'workflows');
  const manifestPath = path.join(outputDir, DEFAULT_WORKFLOW_MANIFEST_FILE);
  const workflowDefinitions = buildN8nStarterWorkflowDefinitions();

  const composeBody = `${buildN8nLocalComposeYaml().trim()}\n`;
  const readmeBody = `${buildN8nLocalReadme({
    baseUrl,
    outputDir: path.relative(ROOT, outputDir) || '.',
  }).trim()}\n`;
  const manifestBody = `${buildN8nStarterWorkflowManifest().trim()}\n`;

  const envExists = await fs.access(envPath).then(() => true).catch(() => false);
  const envBody = `${buildN8nLocalEnvFile({ baseUrl }).trim()}\n`;
  const workflowFiles = workflowDefinitions.map((definition) => ({
    ...definition,
    filePath: path.join(workflowDirPath, definition.fileName),
    body: `${JSON.stringify(definition.workflow, null, 2).trim()}\n`,
  }));

  if (!dryRun) {
    await fs.mkdir(dataPath, { recursive: true });
    await fs.mkdir(workflowDirPath, { recursive: true });
    await fs.writeFile(composePath, composeBody, 'utf8');
    await fs.writeFile(readmePath, readmeBody, 'utf8');
    await fs.writeFile(manifestPath, manifestBody, 'utf8');
    await Promise.all(workflowFiles.map((file) => fs.writeFile(file.filePath, file.body, 'utf8')));
    if (!envExists || force) {
      await fs.writeFile(envPath, envBody, 'utf8');
    }
  }

  return {
    outputDir,
    outputDirRelative: path.relative(ROOT, outputDir) || '.',
    composePath,
    envPath,
    readmePath,
    workflowDirPath,
    manifestPath,
    workflowFiles,
    dataPath,
    wroteEnv: !envExists || force,
    preservedEnv: envExists && !force,
    dryRun,
    baseUrl,
  };
};

const printBootstrapResult = (result) => {
  console.log(`[n8n-local] bootstrapDir=${result.outputDirRelative}`);
  console.log(`[n8n-local] compose=${path.relative(ROOT, result.composePath)}`);
  console.log(`[n8n-local] env=${path.relative(ROOT, result.envPath)}`);
  console.log(`[n8n-local] readme=${path.relative(ROOT, result.readmePath)}`);
  console.log(`[n8n-local] manifest=${path.relative(ROOT, result.manifestPath)}`);
  console.log(`[n8n-local] workflowTemplates=${result.workflowFiles.length}`);
  for (const file of result.workflowFiles) {
    console.log(`[n8n-local] workflowTemplate=${path.relative(ROOT, file.filePath)}`);
  }
  console.log(`[n8n-local] dataDir=${path.relative(ROOT, result.dataPath)}`);
  if (result.dryRun) {
    console.log('[n8n-local] dry-run only. No files were written.');
  } else if (result.wroteEnv) {
    console.log('[n8n-local] wrote new local .env file. Review the admin password before long-running use.');
  } else if (result.preservedEnv) {
    console.log('[n8n-local] preserved existing local .env file. Use --force=true to regenerate it.');
  }
  console.log(`[n8n-local] baseUrl=${result.baseUrl}`);
  console.log('[n8n-local] next: npm run n8n:local:start');
  console.log('[n8n-local] verify: npm run n8n:local:doctor');
};

const printStatus = (status) => {
  const doctor = buildN8nLocalDoctorReport(status);
  console.log(`[n8n-local] bootstrapDir=${status.outputDirRelative}`);
  console.log(`[n8n-local] composeExists=${status.composeExists}`);
  console.log(`[n8n-local] envExists=${status.envExists}`);
  console.log(`[n8n-local] readmeExists=${status.readmeExists}`);
  console.log(`[n8n-local] dataDirExists=${status.dataDirExists}`);
  console.log(`[n8n-local] workflowDirExists=${status.workflowDirExists}`);
  console.log(`[n8n-local] manifestExists=${status.manifestExists}`);
  console.log(`[n8n-local] workflowTemplateCount=${status.workflowTemplateCount}`);
  console.log(`[n8n-local] dockerAvailable=${status.dockerAvailable}`);
  console.log(`[n8n-local] dockerComposeAvailable=${status.dockerComposeAvailable}`);
  console.log(`[n8n-local] imageName=${status.imageName}`);
  console.log(`[n8n-local] imagePresent=${status.imagePresent}`);
  console.log(`[n8n-local] containerName=${status.containerName}`);
  console.log(`[n8n-local] containerPresent=${status.containerPresent}`);
  console.log(`[n8n-local] containerRunning=${status.containerRunning ?? 'unknown'}`);
  console.log(`[n8n-local] importedWorkflowCount=${status.importedWorkflowCount ?? 'unknown'}`);
  console.log(`[n8n-local] installMode=${status.installMode}`);
  console.log(`[n8n-local] installConfirmed=${status.installConfirmed}`);
  console.log(`[n8n-local] baseUrl=${status.baseUrl}`);
  console.log(`[n8n-local] reachable=${status.reachable}`);
  console.log(`[n8n-local] healthzStatus=${status.healthzStatus ?? 'unreachable'}`);
  console.log(`[n8n-local] workflowApiStatus=${status.workflowApiStatus ?? 'unreachable'}`);
  console.log(`[n8n-local] workflowApiReady=${status.workflowApiReady}`);
  console.log(`[n8n-local] workflowApiAuthRequired=${status.workflowApiAuthRequired}`);
  console.log(`[n8n-local] repoApiKeyConfigured=${status.apiKeyConfigured}`);
  console.log(`[n8n-local] repoApiKeyAutoProvisionAvailable=${status.apiKeyAutoProvisionAvailable}`);
  console.log(`[n8n-local] doctorOk=${doctor.ok}`);
  console.log(`[n8n-local] doctorSummary=${doctor.summary}`);
  for (const failure of doctor.failures) {
    console.log(`[n8n-local] doctorFailure=${failure}`);
  }
  for (const warning of doctor.warnings) {
    console.log(`[n8n-local] doctorWarning=${warning}`);
  }
  for (const nextStep of doctor.nextSteps) {
    console.log(`[n8n-local] doctorNext=${nextStep}`);
  }
  if (status.installConfirmed) {
    console.log('[n8n-local] note: local OSS install is already real on this machine; API keys only change which control surface the repo can use.');
  }
  if (status.workflowApiAuthRequired && !status.apiKeyConfigured) {
    console.log('[n8n-local] note: webhook delegation can still work, and the repo can auto-provision a local public API key or fall back to docker CLI import for starter workflows.');
  }
  if (!status.composeExists || !status.envExists) {
    console.log('[n8n-local] next: npm run n8n:local:bootstrap');
    return;
  }
  if (!status.reachable) {
    console.log('[n8n-local] next: npm run n8n:local:start');
    return;
  }
  if (!status.apiKeyConfigured) {
    if (status.apiKeyAutoProvisionAvailable) {
      console.log('[n8n-local] next: npm run n8n:local:api-key:ensure');
      console.log('[n8n-local] or: npm run n8n:local:seed (auto-provision first, docker CLI fallback second)');
      return;
    }
    console.log('[n8n-local] next: npm run n8n:local:seed (docker CLI import fallback is available while the local container is running)');
    return;
  }
  console.log('[n8n-local] next: npm run n8n:local:seed');
};

const printEnsureApiKeyResult = (result) => {
  console.log(`[n8n-local] apiKeyEnsureSource=${result.source}`);
  console.log(`[n8n-local] apiKeyEnsureChanged=${result.changed}`);
  if (result.workflowApiStatus != null) {
    console.log(`[n8n-local] apiKeyEnsureWorkflowApiStatus=${result.workflowApiStatus}`);
  }
  if (result.databasePath) {
    console.log(`[n8n-local] apiKeyEnsureDatabase=${result.databasePath}`);
  }
  if (result.source === 'container-not-running') {
    console.log('[n8n-local] apiKeyEnsureNote=local n8n container is not running yet; start it first with npm run n8n:local:start');
    return;
  }
  console.log(`[n8n-local] apiKeyEnsureLabel=${result.label}`);
  console.log(`[n8n-local] apiKeyEnsureScopes=${Array.isArray(result.scopes) ? result.scopes.join(',') : ''}`);
  console.log(`[n8n-local] apiKeyEnsureRepoEnv=${path.relative(ROOT, result.repoEnvPath || DEFAULT_N8N_REPO_ENV_PATH)}`);
};

const printSeedResult = (result) => {
  console.log(`[n8n-local] seedBaseUrl=${result.baseUrl}`);
  if (result.dryRun) {
    console.log('[n8n-local] seedDryRun=true');
    console.log(`[n8n-local] seedCanApply=${result.canApply}`);
    console.log(`[n8n-local] seedPlannedMethod=${result.plannedMethod}`);
    console.log(`[n8n-local] seedExistingDiscovery=${result.existingDiscoverySource}`);
    console.log(`[n8n-local] seedOperationId=${result.operationId}`);
    console.log(`[n8n-local] seedOperationLog=${result.operationLogPathRelative}`);
    console.log(`[n8n-local] seedDoctorSummary=${result.doctor?.summary || 'n/a'}`);
    for (const failure of result.doctor?.failures || []) {
      console.log(`[n8n-local] seedDoctorFailure=${failure}`);
    }
    for (const warning of result.doctor?.warnings || []) {
      console.log(`[n8n-local] seedDoctorWarning=${warning}`);
    }
    for (const blockedReason of result.blockedReasons || []) {
      console.log(`[n8n-local] seedBlockedReason=${blockedReason}`);
    }
    if (result.rollbackPolicy?.summary) {
      console.log(`[n8n-local] seedRollbackPolicy=${result.rollbackPolicy.summary}`);
    }
    for (const item of result.results) {
      console.log(`[n8n-local] plan ${item.status} task=${item.task} transport=${item.transport} workflowId=${item.workflowId || 'n/a'} file=${item.fileName}`);
    }
    return;
  }

  console.log(`[n8n-local] seedMethod=${result.seedMethod || 'unknown'}`);
  console.log(`[n8n-local] seedRequestedTasks=${result.requestedTasks.join(',') || 'all'}`);
  console.log(`[n8n-local] seedUpdateExisting=${result.updateExisting}`);
  if (result.operationId) {
    console.log(`[n8n-local] seedOperationId=${result.operationId}`);
  }
  if (result.operationLogPathRelative) {
    console.log(`[n8n-local] seedOperationLog=${result.operationLogPathRelative}`);
  }
  if (result.apiKeyEnsure?.source) {
    console.log(`[n8n-local] seedApiKeyEnsure=${result.apiKeyEnsure.source}`);
  }
  if (result.apiKeyEnsure?.reason) {
    console.log(`[n8n-local] seedApiKeyEnsureNote=${result.apiKeyEnsure.reason}`);
  }
  for (const item of result.results) {
    console.log(`[n8n-local] seed ${item.status} task=${item.task} workflowId=${item.workflowId || 'n/a'} file=${item.fileName}`);
  }
  if (result.rollbackPolicy?.summary) {
    console.log(`[n8n-local] seedRollbackPolicy=${result.rollbackPolicy.summary}`);
  }
};

const printRollbackResult = (result) => {
  console.log(`[n8n-local] rollbackOperationId=${result.operationId}`);
  console.log(`[n8n-local] rollbackBaseUrl=${result.baseUrl}`);
  console.log(`[n8n-local] rollbackOperationLog=${result.operationLogPathRelative}`);
  if (result.apiKeyEnsure?.source) {
    console.log(`[n8n-local] rollbackApiKeyEnsure=${result.apiKeyEnsure.source}`);
  }
  console.log(`[n8n-local] rollbackSummary=${result.summary}`);
  for (const item of result.results) {
    console.log(`[n8n-local] rollback ${item.status} task=${item.task} workflowId=${item.workflowId || 'n/a'}`);
  }
};

const main = async () => {
  const dryRun = parseBool(parseArg('dryRun', 'false'), false);
  const statusMode = parseBool(parseArg('status', 'false'), false);
  const force = parseBool(parseArg('force', 'false'), false);
  const seed = parseBool(parseArg('seed', 'false'), false);
  const ensureApiKey = parseBool(parseArg('ensureApiKey', 'false'), false);
  const updateExisting = parseBool(parseArg('updateExisting', 'false'), false);
  const requestedTasks = parseRequestedTasks(parseArg('tasks', ''));
  const operationId = String(parseArg('operationId', '')).trim();
  const rollbackOperationId = String(parseArg('rollbackOperationId', '')).trim();
  const operationLog = String(parseArg('operationLog', '')).trim();
  const outputDir = path.resolve(ROOT, parseArg('dir', path.relative(ROOT, DEFAULT_OUTPUT_DIR) || 'tmp/n8n-local'));
  const normalized = normalizeBaseUrl({
    rawBaseUrl: parseArg('baseUrl', String(process.env.N8N_BASE_URL || DEFAULT_BASE_URL)),
    rawPort: parseArg('port', ''),
  });

  if (statusMode) {
    printStatus(await resolveN8nLocalStatus({ outputDir, baseUrl: normalized.baseUrl }));
    return;
  }

  if (rollbackOperationId || operationLog) {
    printRollbackResult(await rollbackN8nStarterWorkflowOperation({
      outputDir,
      baseUrl: normalized.baseUrl,
      operationId: rollbackOperationId,
      operationLogPath: operationLog,
    }));
    return;
  }

  const bootstrapResult = await bootstrapN8nLocal({
    outputDir,
    baseUrl: normalized.baseUrl,
    dryRun,
    force,
  });
  printBootstrapResult(bootstrapResult);

  if (!seed) {
    if (ensureApiKey) {
      if (dryRun) {
        console.log('[n8n-local] api-key ensure skipped in dry-run mode.');
        return;
      }
      printEnsureApiKeyResult(await ensureLocalN8nPublicApiKey({ baseUrl: normalized.baseUrl }));
    }
    return;
  }

  printSeedResult(await seedN8nStarterWorkflows({
    outputDir,
    baseUrl: normalized.baseUrl,
    tasks: requestedTasks,
    updateExisting,
    dryRun,
    operationId,
  }));
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileName) {
  main().catch((error) => {
    console.error(`[n8n-local] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}