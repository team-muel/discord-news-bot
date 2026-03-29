/**
 * RuntimeProvider — singleton host abstraction inspired by Cline's HostProvider.
 *
 * Centralises platform-specific service access so the rest of the codebase can
 * consume messaging, storage, and observability via a single import regardless
 * of whether the runtime is Discord-bot, Express-API, or a headless worker.
 *
 * Usage:
 *   RuntimeProvider.initialize({ messaging, storage, logger })
 *   RuntimeProvider.messaging.send(channel, text)
 *   RuntimeProvider.storage.getClient()
 *   RuntimeProvider.logger.info('hello')
 */

import type { Client } from 'discord.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// ──── Service interfaces (swap implementations per runtime surface) ───────────

export interface RuntimeMessaging {
  /** Send a text message to a channel. */
  send(channelId: string, text: string): Promise<void>;
  /** Return true if the messaging layer is ready (e.g. Discord WebSocket open). */
  isReady(): boolean;
}

export interface RuntimeStorage {
  /** Supabase client (may throw if not configured). */
  getClient(): SupabaseClient;
  /** True when Supabase credentials are present. */
  isConfigured(): boolean;
}

export interface RuntimeLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface RuntimeConfig {
  messaging: RuntimeMessaging;
  storage: RuntimeStorage;
  logger: RuntimeLogger;
  /** Optional raw Discord client — routes that require it can access without direct import. */
  discordClient?: Client;
  /** Runtime surface label for diagnostics. */
  surface?: 'discord-bot' | 'express-api' | 'headless-worker' | string;
}

// ──── Singleton ───────────────────────────────────────────────────────────────

let instance: RuntimeConfig | null = null;

/**
 * One-time initialisation — call from the topmost entry point (bot.ts, server.ts, worker).
 * Throws if called twice (prevents accidental double-init).
 */
export function initializeRuntime(config: RuntimeConfig): void {
  if (instance) {
    throw new Error('RuntimeProvider already initialized — call resetRuntime() first in tests.');
  }
  instance = config;
}

function get(): RuntimeConfig {
  if (!instance) {
    throw new Error('RuntimeProvider not initialized. Call initializeRuntime() during startup.');
  }
  return instance;
}

/** Reset for tests only. */
export function resetRuntime(): void {
  instance = null;
}

export function isRuntimeInitialized(): boolean {
  return instance !== null;
}

// ──── Static accessors (Cline-style HostProvider.workspace / .window / .env) ──

export const RuntimeProvider = {
  /** Messaging subsystem (Discord, Slack, noop in workers). */
  get messaging(): RuntimeMessaging { return get().messaging; },
  /** Persistent storage subsystem (Supabase). */
  get storage(): RuntimeStorage { return get().storage; },
  /** Structured logger. */
  get logger(): RuntimeLogger { return get().logger; },
  /** Raw Discord.js client (optional — may be undefined in non-bot surfaces). */
  get discordClient(): Client | undefined { return get().discordClient; },
  /** Runtime surface label. */
  get surface(): string { return get().surface ?? 'unknown'; },
  /** Full config (escape hatch). */
  get config(): RuntimeConfig { return get(); },
  /** Whether the provider has been initialized. */
  get initialized(): boolean { return instance !== null; },
} as const;
