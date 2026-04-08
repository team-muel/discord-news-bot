/**
 * Local MCP Proxy Worker Registration
 *
 * Registers the self-hosted Express MCP proxy (/api/mcp) as a worker in the
 * mcpSkillRouter, making all 162+ tools (native + upstream) available to
 * sprint action execution paths.
 *
 * The local proxy uses a different endpoint shape than external workers:
 *   - GET /api/mcp/tools → tool list (vs. /tools/discover)
 *   - POST /api/mcp/rpc  → JSON-RPC 2.0 tool calls
 *
 * This module fetches tools from the local proxy and registers them directly
 * into the capability index without requiring /tools/discover compatibility.
 */

import logger from '../logger';
import { getErrorMessage } from '../utils/errorMessage';

const LOCAL_WORKER_ID = 'local-proxy';

/**
 * Register the local Express MCP proxy as a worker in mcpSkillRouter.
 * Called once during bootstrap after initMcpSkillRouter().
 */
export const registerLocalMcpProxy = async (port: number): Promise<void> => {
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Fetch the tool catalog from the local Express MCP route
    const res = await fetch(`${baseUrl}/api/mcp/tools`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      logger.debug('[MCP-LOCAL] /api/mcp/tools returned %d, skipping', res.status);
      return;
    }

    const data = (await res.json()) as Array<{ name?: string }>;
    if (!Array.isArray(data) || data.length === 0) {
      logger.debug('[MCP-LOCAL] empty tool catalog, skipping');
      return;
    }

    const capabilities = data
      .map((t) => String(t.name ?? ''))
      .filter(Boolean);

    // Register directly into the worker map via mcpSkillRouter
    const { registerWorkerDirect } = await import('./mcpSkillRouter');
    registerWorkerDirect(LOCAL_WORKER_ID, `${baseUrl}/api/mcp/rpc`, capabilities);

    logger.info('[MCP-LOCAL] registered local proxy: %d tools', capabilities.length);
  } catch (err) {
    // Non-fatal: local proxy may not be ready during startup
    logger.debug('[MCP-LOCAL] registration skipped: %s', getErrorMessage(err));
  }
};
