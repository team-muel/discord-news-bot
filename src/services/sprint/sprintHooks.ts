/**
 * Sprint Lifecycle Hooks — inspired by Cline's hooks system.
 *
 * Provides an extensible event system for sprint pipeline lifecycle events.
 * Hooks can observe, inject context, or cancel operations at defined points.
 *
 * Hook protocol (modeled after Cline's JSON stdin/stdout hooks):
 * - Each hook handler receives a typed payload and returns a HookResult.
 * - `cancel` = ANY handler returning cancel=true blocks the operation.
 * - `context` = ALL handler contexts are concatenated for injection.
 * - Handlers run concurrently via Promise.all (30s timeout per handler).
 * - Context output is bounded to 50KB per hook point.
 */

export type SprintHookPoint =
  | 'SprintStart'
  | 'SprintComplete'
  | 'PhaseStart'
  | 'PhaseComplete'
  | 'ActionPreExec'
  | 'ActionPostExec';

export interface HookPayload {
  hookPoint: SprintHookPoint;
  sprintId: string;
  phase?: string;
  actionName?: string;
  /** Extra data — varies by hook point */
  meta?: Record<string, unknown>;
}

export interface HookResult {
  /** If true, the triggering operation should be cancelled */
  cancel?: boolean;
  /** Reason for cancellation (displayed in sprint output) */
  cancelReason?: string;
  /** Extra context to inject into the next prompt / phase goal */
  context?: string;
}

export type HookHandler = (payload: HookPayload) => Promise<HookResult> | HookResult;

interface RegisteredHook {
  id: string;
  point: SprintHookPoint;
  handler: HookHandler;
}

// ──── Registry ────────────────────────────────────────────────────────────────

const registry: RegisteredHook[] = [];
const MAX_HOOKS = 50;
const HOOK_TIMEOUT_MS = 30_000;
const MAX_CONTEXT_BYTES = 50 * 1024; // 50KB

let nextId = 1;

/**
 * Register a hook handler for a specific lifecycle point.
 * Returns a disposable ID for unregistration.
 */
export function registerHook(point: SprintHookPoint, handler: HookHandler): string {
  if (registry.length >= MAX_HOOKS) {
    throw new Error(`Hook registry full (max ${MAX_HOOKS})`);
  }
  const id = `hook-${nextId++}`;
  registry.push({ id, point, handler });
  return id;
}

/** Unregister a hook by ID. */
export function unregisterHook(id: string): boolean {
  const idx = registry.findIndex((h) => h.id === id);
  if (idx < 0) return false;
  registry.splice(idx, 1);
  return true;
}

/** Clear all hooks (for testing). */
export function clearAllHooks(): void {
  registry.length = 0;
}

/** Get count of registered hooks for a given point. */
export function hookCount(point?: SprintHookPoint): number {
  if (!point) return registry.length;
  return registry.filter((h) => h.point === point).length;
}

// ──── Execution ───────────────────────────────────────────────────────────────

/**
 * Execute all hooks for a given lifecycle point.
 *
 * Semantics (matching Cline's hooks):
 * - All matching handlers run concurrently
 * - cancel = ANY → if any handler returns cancel=true, result.cancel is true
 * - context = ALL → all non-empty context strings are concatenated
 * - Individual handler failures are caught and logged (fail-open)
 */
export async function executeHooks(payload: HookPayload): Promise<HookResult> {
  const matching = registry.filter((h) => h.point === payload.hookPoint);
  if (matching.length === 0) return {};

  const settled = await Promise.allSettled(
    matching.map((hook) => runWithTimeout(hook.handler, payload, HOOK_TIMEOUT_MS)),
  );

  let cancel = false;
  let cancelReason = '';
  const contexts: string[] = [];

  for (const result of settled) {
    if (result.status === 'rejected') continue; // fail-open
    const val = result.value;
    if (val.cancel) {
      cancel = true;
      if (val.cancelReason) cancelReason = val.cancelReason;
    }
    if (val.context) {
      contexts.push(val.context);
    }
  }

  // Bound total context size
  let combinedContext = contexts.join('\n');
  if (combinedContext.length > MAX_CONTEXT_BYTES) {
    combinedContext = combinedContext.slice(0, MAX_CONTEXT_BYTES) + '\n[hook context truncated]';
  }

  return {
    cancel: cancel || undefined,
    cancelReason: cancelReason || undefined,
    context: combinedContext || undefined,
  };
}

// ──── Internal helpers ────────────────────────────────────────────────────────

function runWithTimeout(
  handler: HookHandler,
  payload: HookPayload,
  timeoutMs: number,
): Promise<HookResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Hook timeout')), timeoutMs);
    Promise.resolve(handler(payload))
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
