import { Router, type RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';

import { registerBotAgentRoutes } from './botAgentRoutes';

const noop: RequestHandler = (_req, _res, next) => next();

type RouteEntry = {
  method: string;
  path: string;
};

const collectRoutes = (router: Router): RouteEntry[] => {
  const stack = (router as unknown as { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }> }).stack || [];
  const routes: RouteEntry[] = [];

  for (const layer of stack) {
    if (!layer.route || !layer.route.path || !layer.route.methods) continue;
    const methods = Object.keys(layer.route.methods).filter((m) => layer.route?.methods?.[m]);
    for (const method of methods) {
      routes.push({ method: method.toUpperCase(), path: String(layer.route.path) });
    }
  }

  return routes;
};

describe('bot agent route module smoke', () => {
  it('registers representative endpoints from all domains', () => {
    const router = Router();

    registerBotAgentRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const routes = collectRoutes(router);
    const routeKeys = new Set(routes.map((r) => `${r.method} ${r.path}`));

    expect(routeKeys.has('GET /agent/sessions')).toBe(true);
    expect(routeKeys.has('POST /agent/sessions/:sessionId/resume')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/efficiency')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/worker-approval-gates')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/social-quality-snapshot')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/operator-snapshot')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/workset')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/knowledge-control-plane')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/openjarvis/autopilot')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/openjarvis/hermes-runtime')).toBe(true);
    expect(routeKeys.has('POST /agent/runtime/openjarvis/session-start')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/openjarvis/session-open-bundle')).toBe(true);
    expect(routeKeys.has('POST /agent/runtime/openjarvis/hermes-runtime/chat-note')).toBe(true);
    expect(routeKeys.has('POST /agent/runtime/openjarvis/hermes-runtime/queue-objective')).toBe(true);
    expect(routeKeys.has('POST /agent/runtime/openjarvis/hermes-runtime/chat-launch')).toBe(true);
    expect(routeKeys.has('POST /agent/runtime/openjarvis/hermes-runtime/remediate')).toBe(true);
    expect(routeKeys.has('POST /agent/runtime/openjarvis/memory-sync')).toBe(true);
    expect(routeKeys.has('GET /agent/got/policy')).toBe(true);
    expect(routeKeys.has('GET /agent/privacy/policy')).toBe(true);
    expect(routeKeys.has('GET /agent/privacy/consent')).toBe(true);
    expect(routeKeys.has('GET /agent/privacy/retention-policy')).toBe(true);
    expect(routeKeys.has('GET /agent/obsidian/runtime')).toBe(true);
    expect(routeKeys.has('GET /agent/obsidian/quality')).toBe(true);
    expect(routeKeys.has('GET /agent/obsidian/knowledge-control')).toBe(true);
    expect(routeKeys.has('GET /agent/obsidian/knowledge-bundle')).toBe(true);
    expect(routeKeys.has('GET /agent/obsidian/internal-knowledge')).toBe(true);
    expect(routeKeys.has('GET /agent/obsidian/requirement-compile')).toBe(true);
    expect(routeKeys.has('GET /agent/obsidian/decision-trace')).toBe(true);
    expect(routeKeys.has('GET /agent/obsidian/incident-graph')).toBe(true);
    expect(routeKeys.has('POST /agent/obsidian/knowledge-promote')).toBe(true);
    expect(routeKeys.has('GET /agent/obsidian/semantic-lint-audit')).toBe(true);
    expect(routeKeys.has('POST /agent/obsidian/wiki-change-capture')).toBe(true);
    expect(routeKeys.has('GET /agent/super/services')).toBe(true);
    expect(routeKeys.has('GET /agent/super/services/:serviceId')).toBe(true);
    expect(routeKeys.has('POST /agent/super/services/:serviceId/recommend')).toBe(true);
    expect(routeKeys.has('POST /agent/super/services/:serviceId/sessions')).toBe(true);
    expect(routeKeys.has('GET /agent/actions/catalog')).toBe(true);
    expect(routeKeys.has('GET /agent/actions/policies')).toBe(true);
    expect(routeKeys.has('POST /agent/actions/execute')).toBe(true);
    expect(routeKeys.has('GET /agent/tools/status')).toBe(true);
    expect(routeKeys.has('GET /agent/memory/search')).toBe(true);
    expect(routeKeys.has('GET /agent/runtime/role-workers')).toBe(true);
    expect(routeKeys.has('GET /agent/task-routing/summary')).toBe(true);
  });

  it('does not register duplicate method/path pairs', () => {
    const router = Router();

    registerBotAgentRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const routes = collectRoutes(router);
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) {
        duplicates.push(key);
      }
      seen.add(key);
    }

    expect(duplicates).toEqual([]);
  });
});
