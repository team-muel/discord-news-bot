import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExternalToolAdapter, ExternalAdapterResult } from '../externalAdapterTypes';
import logger from '../../../logger';
import {
  OPENCLAW_ENABLED as ENABLED,
  OPENCLAW_DISABLED as EXPLICITLY_DISABLED,
  OPENCLAW_GATEWAY_URL as GATEWAY_URL,
} from '../../../config';
import { checkOpenClawGatewayHealth, getGatewayHeaders } from '../../openclaw/gatewayHealth';
import { generateText, isAnyLlmConfigured } from '../../llmClient';
import { getErrorMessage } from '../../../utils/errorMessage';

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 30_000;

/**
 * Transport modes:
 * - 'gateway': HTTP calls to OpenClaw Gateway (remote or local)
 * - 'cli': execFile calls to `openclaw` CLI binary
 * - null: not yet determined
 */
let transport: 'gateway' | 'cli' | null = null;
let cliAvailable: boolean | null = null;

const gatewayPost = async (path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> => {
  try {
    const resp = await fetch(`${GATEWAY_URL}${path}`, {
      method: 'POST',
      headers: getGatewayHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, data };
  } catch (err) {
    logger.debug('[OPENCLAW] gatewayPost %s failed: %s', path, getErrorMessage(err));
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
    if (EXPLICITLY_DISABLED || !ENABLED) return false;

    // Prefer Gateway HTTP transport
    const gatewayOk = await checkOpenClawGatewayHealth();
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
    }

    // Lite mode: no gateway or CLI, but central LLM is configured → agent.chat still works
    if (isAnyLlmConfigured()) {
      return true;
    }

    return false;
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
          const gatewayOk = await checkOpenClawGatewayHealth();
          if (gatewayOk) return makeResult(true, 'Gateway healthy', [`url=${GATEWAY_URL}`, 'transport=gateway']);
          if (transport === 'cli') return makeResult(true, 'CLI available', ['transport=cli']);
          if (isAnyLlmConfigured()) return makeResult(true, 'LLM lite mode active', ['transport=llm-lite']);
          return makeResult(false, 'No transport available', [], 'NO_TRANSPORT');
        }

        case 'agent.chat': {
          const message = String(args.message || '').slice(0, 2000);
          if (!message) return makeResult(false, 'Message required', [], 'MISSING_MESSAGE');

          // Gateway HTTP: use OpenAI-compatible /v1/chat/completions
          if (transport === 'gateway') {
            const model = typeof args.model === 'string' ? args.model : undefined;
            const body: Record<string, unknown> = {
              messages: [{ role: 'user', content: message }],
            };
            if (model) body.model = model;
            const { ok, data } = await gatewayPost('/v1/chat/completions', body);
            if (ok && data) {
              const resp = data as { choices?: Array<{ message?: { content?: string } }> };
              const content = resp.choices?.[0]?.message?.content || JSON.stringify(data);
              const lines = content.split('\n');
              // GAP-014: Log truncation so operators know output was clipped
              if (lines.length > 40) {
                logger.debug('[OPENCLAW] agent.chat output truncated: kept 40/%d lines', lines.length);
              }
              return makeResult(true, 'Chat response via Gateway', lines.slice(0, 40));
            }
            // Gateway returned error — don't fall through to CLI if CLI not available
            if (!cliAvailable) {
              return makeResult(false, 'Gateway chat request failed', [], 'GATEWAY_REQUEST_FAILED');
            }
          }

          // CLI fallback: openclaw agent --agent main --local -m <message>
          if (cliAvailable !== false) {
            try {
              const { stdout } = await runCli(['agent', '--agent', 'main', '--local', '-m', stripShellMeta(message)]);
              return makeResult(true, 'Chat response via CLI', stdout.trim().split('\n'));
            } catch {
              // CLI failed — fall through to LLM lite mode
            }
          }

          // Lite mode: central LLM pipeline when gateway and CLI are both unavailable
          if (isAnyLlmConfigured()) {
            try {
              const content = await generateText({
                system: 'You are a helpful always-on AI assistant (OpenClaw lite mode).',
                user: message,
                actionName: 'agent.chat',
              });
              if (content) {
                logger.debug('[OPENCLAW] agent.chat served via LLM lite mode');
                return makeResult(true, 'Chat response via LLM (lite mode)', content.split('\n').slice(0, 40));
              }
            } catch (liteErr) {
              logger.debug('[OPENCLAW] LLM lite mode failed: %s', getErrorMessage(liteErr));
            }
          }

          return makeResult(false, 'No transport available for agent.chat', [], 'NO_TRANSPORT');
        }

        case 'agent.skill.create': {
          const skillName = String(args.name || '').slice(0, 100).replace(/[^a-zA-Z0-9_-]/g, '');
          if (!skillName) return makeResult(false, 'Skill name required', [], 'MISSING_NAME');

          // CLI only — the OpenClaw Gateway does not expose a REST API for skill creation
          if (cliAvailable === false) {
            return makeResult(false, 'Skill create requires OpenClaw CLI', [], 'CLI_REQUIRED');
          }
          const { stdout } = await runCli(['skill', 'create', skillName]);
          return makeResult(true, `Skill ${skillName} created`, stdout.trim().split('\n'));
        }

        case 'agent.session.relay': {
          const message = String(args.message || '').slice(0, 4000);
          if (!message) return makeResult(false, 'Message required for relay', [], 'MISSING_MESSAGE');
          const channel = String(args.channel || 'discord').slice(0, 50).replace(/[^a-zA-Z0-9_-]/g, '');

          // CLI only — the OpenClaw Gateway does not expose a REST API for message relay
          if (cliAvailable === false) {
            return makeResult(false, 'Message relay requires OpenClaw CLI', [], 'CLI_REQUIRED');
          }
          const cliArgs = ['message', 'send', '--channel', channel];
          cliArgs.push(stripShellMeta(message));
          const { stdout } = await runCli(cliArgs);
          return makeResult(true, `Message relayed via ${channel}`, stdout.trim().split('\n'));
        }

        default:
          return makeResult(false, `Unknown action: ${action}`, [], 'UNKNOWN_ACTION');
      }
    } catch (err) {
      const message = getErrorMessage(err);
      return makeResult(false, `openclaw ${action} failed`, [message], 'EXECUTION_FAILED');
    }
  },
};

// ── OpenClaw Tool Registration Bootstrap ──
// Register ext.* tools as OpenClaw session skills so OpenClaw can invoke them autonomously.

/** Bootstrapped session state: tool count at registration time + timestamp. */
const bootstrappedSessions = new Map<string, { toolCount: number; at: number }>();

/** Max age before a session re-checks the adapter catalog. */
const BOOTSTRAP_STALE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build a sorted tool catalog key from the current adapters.
 * Used to detect when adapter availability has changed since last bootstrap.
 */
const buildToolCatalog = async (): Promise<string[]> => {
  const { listExternalAdapters } = await import('../externalAdapterRegistry');
  const adapters = listExternalAdapters();
  const tools: string[] = [];
  for (const adapter of adapters) {
    if (adapter.id === 'openclaw') continue;
    const caps = adapter.liteCapabilities ?? adapter.capabilities;
    for (const cap of caps) {
      tools.push(`- ext.${adapter.id}.${cap}: ${adapter.id} ${cap} capability`);
    }
  }
  return tools;
};

/**
 * Bootstrap OpenClaw with knowledge of available ext.* tools.
 * Sends a system-level message to an OpenClaw session listing available tools.
 * Re-bootstraps when the adapter catalog changes or after BOOTSTRAP_STALE_MS.
 * Best-effort — never throws.
 */
export const bootstrapOpenClawSession = async (sessionId: string): Promise<{ ok: boolean; toolCount: number }> => {
  if (EXPLICITLY_DISABLED || !ENABLED) {
    return { ok: false, toolCount: 0 };
  }

  const gatewayOk = await checkOpenClawGatewayHealth();
  if (!gatewayOk) return { ok: false, toolCount: 0 };

  try {
    const tools = await buildToolCatalog();

    // Check if re-bootstrap is needed
    const prev = bootstrappedSessions.get(sessionId);
    if (prev) {
      const stale = (Date.now() - prev.at) > BOOTSTRAP_STALE_MS;
      const catalogChanged = prev.toolCount !== tools.length;
      if (!stale && !catalogChanged) {
        return { ok: true, toolCount: prev.toolCount };
      }
    }

    if (tools.length === 0) {
      bootstrappedSessions.set(sessionId, { toolCount: 0, at: Date.now() });
      return { ok: true, toolCount: 0 };
    }

    // Send tool catalog as a system bootstrap message via /v1/chat/completions
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

    const { ok } = await gatewayPost('/v1/chat/completions', {
      messages: [
        { role: 'system', content: bootstrapMessage },
      ],
    });

    if (ok) {
      bootstrappedSessions.set(sessionId, { toolCount: tools.length, at: Date.now() });
      logger.info('[OPENCLAW] session %s bootstrapped with %d ext.* tools', sessionId, tools.length);
    }

    return { ok, toolCount: tools.length };
  } catch (err) {
    logger.debug('[OPENCLAW] session bootstrap failed for %s: %s', sessionId, getErrorMessage(err));
    return { ok: false, toolCount: 0 };
  }
};
