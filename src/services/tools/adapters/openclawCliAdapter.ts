import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBooleanEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';
import logger from '../../../logger';

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 30_000;
const ENABLED = parseBooleanEnv(process.env.OPENCLAW_ENABLED, false);

// Gateway HTTP surface (preferred — no CLI binary required)
const GATEWAY_URL = String(process.env.OPENCLAW_GATEWAY_URL || '').trim().replace(/\/+$/, '');
const GATEWAY_TOKEN = String(process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();

/**
 * Transport modes:
 * - 'gateway': HTTP calls to OpenClaw Gateway (remote or local)
 * - 'cli': execFile calls to `openclaw` CLI binary
 * - null: not yet determined
 */
let transport: 'gateway' | 'cli' | null = null;
let cliAvailable = false;

// Gateway health check with caching
let cachedGatewayHealth: { ok: boolean; at: number } | null = null;
const GATEWAY_HEALTH_CACHE_TTL_MS = 10_000;

const checkGatewayHealth = async (): Promise<boolean> => {
  if (!GATEWAY_URL) return false;
  if (cachedGatewayHealth && Date.now() - cachedGatewayHealth.at < GATEWAY_HEALTH_CACHE_TTL_MS) {
    return cachedGatewayHealth.ok;
  }
  try {
    const resp = await fetch(`${GATEWAY_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    const ok = !!resp?.ok;
    cachedGatewayHealth = { ok, at: Date.now() };
    return ok;
  } catch {
    cachedGatewayHealth = { ok: false, at: Date.now() };
    return false;
  }
};

const gatewayHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (GATEWAY_TOKEN) h['Authorization'] = `Bearer ${GATEWAY_TOKEN}`;
  return h;
};

const gatewayPost = async (path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> => {
  try {
    const resp = await fetch(`${GATEWAY_URL}${path}`, {
      method: 'POST',
      headers: gatewayHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, data };
  } catch (err) {
    logger.debug('[OPENCLAW] gatewayPost %s failed: %s', path, err instanceof Error ? err.message : String(err));
    return { ok: false, data: null };
  }
};

const stripShellMeta = (s: string): string => s.replace(/[|&;$`<>(){}\[\]!#"'\\\n\r]/g, '');

const runCli = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  return execFileAsync('openclaw', args, {
    timeout: CLI_TIMEOUT_MS,
    windowsHide: true,
  });
};

export const openclawAdapter: ExternalToolAdapter = {
  id: 'openclaw',
  capabilities: ['agent.chat', 'agent.skill.create', 'agent.session.relay', 'agent.health'],
  liteCapabilities: ['agent.chat', 'agent.health'],

  isAvailable: async () => {
    if (!ENABLED) return false;

    // Prefer Gateway HTTP transport
    const gatewayOk = await checkGatewayHealth();
    if (gatewayOk) {
      transport = 'gateway';
      return true;
    }

    // Fallback: CLI binary
    try {
      await runCli(['--version']);
      transport = 'cli';
      cliAvailable = true;
      return true;
    } catch {
      transport = null;
      cliAvailable = false;
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
        case 'agent.health': {
          const gatewayOk = await checkGatewayHealth();
          if (gatewayOk) return makeResult(true, 'Gateway healthy', [`url=${GATEWAY_URL}`, 'transport=gateway']);
          if (transport === 'cli') return makeResult(true, 'CLI available', ['transport=cli']);
          return makeResult(false, 'No transport available', [], 'NO_TRANSPORT');
        }

        case 'agent.chat': {
          const message = String(args.message || '').slice(0, 2000);
          if (!message) return makeResult(false, 'Message required', [], 'MISSING_MESSAGE');

          // Gateway HTTP: use agent --message equivalent via sessions API
          if (transport === 'gateway') {
            const model = typeof args.model === 'string' ? args.model : undefined;
            const thinking = typeof args.thinking === 'string' ? args.thinking : undefined;
            // GAP-010: Use sprint-scoped session ID when provided, fall back to 'main'
            const sessionId = typeof args.sessionId === 'string' && args.sessionId ? args.sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) : 'main';
            const body: Record<string, unknown> = { message };
            if (model) body.model = model;
            if (thinking) body.thinkingLevel = thinking;
            const { ok, data } = await gatewayPost(`/api/sessions/${sessionId}/message`, body);
            if (ok && data) {
              const resp = data as { response?: string; content?: string; text?: string };
              const content = resp.response || resp.content || resp.text || JSON.stringify(data);
              const lines = content.split('\n');
              // GAP-014: Log truncation so operators know output was clipped
              if (lines.length > 40) {
                logger.debug('[OPENCLAW] agent.chat output truncated: kept 40/%d lines', lines.length);
              }
              return makeResult(true, `Chat response via Gateway (session=${sessionId})`, lines.slice(0, 40));
            }
            // Gateway returned error — don't fall through to CLI if CLI not available
            if (!cliAvailable) {
              return makeResult(false, 'Gateway chat request failed', [], 'GATEWAY_REQUEST_FAILED');
            }
          }

          // CLI fallback
          const { stdout } = await runCli(['agent', '--message', stripShellMeta(message)]);
          return makeResult(true, 'Chat response via CLI', stdout.trim().split('\n'));
        }

        case 'agent.skill.create': {
          const skillName = String(args.name || '').slice(0, 100).replace(/[^a-zA-Z0-9_-]/g, '');
          if (!skillName) return makeResult(false, 'Skill name required', [], 'MISSING_NAME');

          if (transport === 'gateway') {
            const { ok, data } = await gatewayPost('/api/skills', { name: skillName });
            if (ok) return makeResult(true, `Skill ${skillName} created via Gateway`, [JSON.stringify(data)]);
            if (!cliAvailable) return makeResult(false, 'Gateway skill create failed', [], 'GATEWAY_REQUEST_FAILED');
          }

          // CLI fallback
          const { stdout } = await runCli(['skill', 'create', skillName]);
          return makeResult(true, `Skill ${skillName} created`, stdout.trim().split('\n'));
        }

        case 'agent.session.relay': {
          const message = String(args.message || '').slice(0, 4000);
          if (!message) return makeResult(false, 'Message required for relay', [], 'MISSING_MESSAGE');
          const channel = String(args.channel || 'discord').slice(0, 50).replace(/[^a-zA-Z0-9_-]/g, '');
          const relaySessionId = String(args.sessionId || '').slice(0, 100).replace(/[^a-zA-Z0-9_-]/g, '') || 'main';

          if (transport === 'gateway') {
            const body: Record<string, unknown> = { message, channel };
            if (relaySessionId !== 'main') body.sessionId = relaySessionId;
            const { ok } = await gatewayPost(`/api/sessions/${relaySessionId}/send`, body);
            if (ok) return makeResult(true, `Message relayed via ${channel} (Gateway)`, []);
            if (!cliAvailable) return makeResult(false, 'Gateway relay failed', [], 'GATEWAY_REQUEST_FAILED');
          }

          // CLI fallback
          const cliArgs = ['message', 'send', '--channel', channel];
          if (relaySessionId !== 'main') cliArgs.push('--session', relaySessionId);
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

// ── OpenClaw Tool Registration Bootstrap ──
// Register ext.* tools as OpenClaw session skills so OpenClaw can invoke them autonomously.

/** Skills already registered in this process lifetime. */
const registeredSkills = new Set<string>();

/**
 * Bootstrap OpenClaw with knowledge of available ext.* tools.
 * Sends a system-level message to an OpenClaw session listing available tools.
 * Idempotent per session: skips if already bootstrapped for this sessionId.
 * Best-effort — never throws.
 */
export const bootstrapOpenClawSession = async (sessionId: string): Promise<{ ok: boolean; toolCount: number }> => {
  if (!ENABLED || registeredSkills.has(sessionId)) {
    return { ok: registeredSkills.has(sessionId), toolCount: 0 };
  }

  const gatewayOk = await checkGatewayHealth();
  if (!gatewayOk) return { ok: false, toolCount: 0 };

  try {
    // Build tool catalog from external adapters
    const { listExternalAdapters } = await import('../externalAdapterRegistry');
    const adapters = listExternalAdapters();
    const tools: string[] = [];

    for (const adapter of adapters) {
      if (adapter.id === 'openclaw') continue; // Don't register self
      const caps = adapter.liteCapabilities ?? adapter.capabilities;
      for (const cap of caps) {
        tools.push(`- ext.${adapter.id}.${cap}: ${adapter.id} ${cap} capability`);
      }
    }

    if (tools.length === 0) return { ok: true, toolCount: 0 };

    // Send tool catalog as a system bootstrap message
    const bootstrapMessage = [
      'SYSTEM: You have access to the following external tools via the MCP bridge.',
      'To use a tool, include a tool call in your response with the tool name and arguments.',
      '',
      '## Available External Tools',
      ...tools,
      '',
      'When implementing code, you can use sandbox.exec to test in isolation.',
      'When researching, use jarvis.research for deep analysis or wiki.read for library docs.',
      'When reviewing, use jarvis.memory.search to find related patterns in the knowledge base.',
    ].join('\n');

    const { ok } = await gatewayPost(`/api/sessions/${sessionId}/message`, {
      message: bootstrapMessage,
      role: 'system',
    });

    if (ok) {
      registeredSkills.add(sessionId);
      logger.info('[OPENCLAW] session %s bootstrapped with %d ext.* tools', sessionId, tools.length);
    }

    return { ok, toolCount: tools.length };
  } catch (err) {
    logger.debug('[OPENCLAW] session bootstrap failed for %s: %s', sessionId, err instanceof Error ? err.message : String(err));
    return { ok: false, toolCount: 0 };
  }
};
