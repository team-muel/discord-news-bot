/**
 * Obsidian Headless Integration Service
 *
 * Compatibility wrapper over the adapter-router layer.
 * Legacy callsites keep using this module while execution
 * is unified through src/services/obsidian/router.ts.
 */

import logger from '../../logger';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import {
  getObsidianGraphMetadataWithAdapter,
  isObsidianCapabilityAvailable,
  readObsidianFileWithAdapter,
  searchObsidianVaultWithAdapter,
  warmupObsidianAdapters,
} from './router';
import type { ObsidianNode, ObsidianSearchResult } from './types';

export type { ObsidianNode, ObsidianSearchResult };

let initialized = false;
let initPromise: Promise<boolean> | null = null;

export async function initObsidianHeadless(): Promise<boolean> {
  if (initialized) {
    return true;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const enabled = String(process.env.OBSIDIAN_HEADLESS_ENABLED || '').trim().toLowerCase() === 'true';
    if (!enabled) {
      logger.info('[OBSIDIAN-HEADLESS] Disabled via OBSIDIAN_HEADLESS_ENABLED env var');
      initialized = false;
      return false;
    }

    const available = isObsidianCapabilityAvailable('search_vault') || isObsidianCapabilityAvailable('read_file');
    if (!available) {
      logger.warn('[OBSIDIAN-HEADLESS] No adapter available for search/read capabilities');
      initialized = false;
      return false;
    }

    const vaultPath = getObsidianVaultRoot();
    if (vaultPath) {
      await warmupObsidianAdapters(vaultPath);
    }

    initialized = true;
    logger.info('[OBSIDIAN-HEADLESS] Initialized via adapter-router');
    return true;
  })();

  return initPromise;
}

export async function searchObsidianVault(query: string, limit = 10): Promise<ObsidianSearchResult[]> {
  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    logger.debug('[OBSIDIAN] No vault path configured, skipping search');
    return [];
  }

  return searchObsidianVaultWithAdapter({
    vaultPath,
    query: String(query || ''),
    limit: Math.max(1, Math.min(50, Math.trunc(limit))),
  });
}

export async function readObsidianFile(filePath: string): Promise<string | null> {
  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    logger.warn('[OBSIDIAN] Vault path not configured');
    return null;
  }

  return readObsidianFileWithAdapter({
    vaultPath,
    filePath: String(filePath || ''),
  });
}

export async function getObsidianGraphMetadata(): Promise<Record<string, ObsidianNode>> {
  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    return {};
  }

  return getObsidianGraphMetadataWithAdapter({ vaultPath });
}

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

export async function parseObsidianFrontmatter(content: string): Promise<Record<string, unknown>> {
  const fmMatch = String(content || '').match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};

  const fm = fmMatch[1];
  const metadata: Record<string, unknown> = {};

  for (const line of fm.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    if (!key || valueParts.length === 0) {
      continue;
    }

    const value = valueParts.join(':').trim();
    const safeKey = key.trim();
    if (!safeKey) {
      continue;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      metadata[safeKey] = value.slice(1, -1).split(',').map((v) => toSingleLine(v));
    } else if (value === 'true' || value === 'false') {
      metadata[safeKey] = value === 'true';
    } else {
      metadata[safeKey] = value;
    }
  }

  return metadata;
}
