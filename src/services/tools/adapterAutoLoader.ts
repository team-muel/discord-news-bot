/**
 * M-15 / F-02: Auto-load external tool adapters from the adapters/ directory.
 *
 * Scans `src/services/tools/adapters/` for files matching *Adapter.ts or *CliAdapter.ts,
 * imports them, and registers any exported ExternalToolAdapter objects that are not
 * already in the built-in registry.
 *
 * - Built-in adapters (openshell, nemoclaw, openclaw, openjarvis) are statically imported
 *   by externalAdapterRegistry.ts and will NOT be re-registered here.
 * - Only new adapter files dropped into the adapters/ directory will be auto-discovered.
 * - The scriptCliToolAdapter.ts file is excluded (different type interface).
 */

import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerExternalAdapter, getExternalAdapter } from './externalAdapterRegistry';
import { KNOWN_ADAPTER_IDS, type ExternalToolAdapter } from './externalAdapterTypes';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ADAPTERS_DIR = join(__dirname, 'adapters');

/** Files to skip — not ExternalToolAdapter exports. */
const SKIP_FILES = new Set([
  'scriptCliToolAdapter.ts',
  'scriptCliToolAdapter.js',
]);

/** Pattern: files ending in Adapter.ts/.js or CliAdapter.ts/.js (not test files). */
const ADAPTER_FILE_PATTERN = /(?:Adapter|CliAdapter)\.(ts|js)$/;
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(ts|js)$/;

/**
 * Scan adapters directory and register any new ExternalToolAdapter exports.
 * Returns the count of newly registered adapters. Graceful: never throws.
 */
export const autoLoadAdapters = async (): Promise<{ loaded: number; skipped: string[]; errors: string[] }> => {
  const result = { loaded: 0, skipped: [] as string[], errors: [] as string[] };

  let files: string[];
  try {
    files = await readdir(ADAPTERS_DIR);
  } catch (err) {
    logger.debug('[ADAPTER-LOADER] adapters directory not readable: %s', getErrorMessage(err));
    return result;
  }

  const candidates = files.filter((f) =>
    ADAPTER_FILE_PATTERN.test(f) && !TEST_FILE_PATTERN.test(f) && !SKIP_FILES.has(f),
  );

  for (const file of candidates) {
    try {
      const modulePath = join(ADAPTERS_DIR, file);
      const mod = await import(modulePath) as Record<string, unknown>;

      // Find exported ExternalToolAdapter-shaped objects
      for (const [exportName, value] of Object.entries(mod)) {
        if (!isExternalToolAdapter(value)) continue;

        const adapter = value as ExternalToolAdapter;
        // Skip built-ins
        if (KNOWN_ADAPTER_IDS.has(adapter.id)) {
          result.skipped.push(`${file}:${exportName} (built-in ${adapter.id})`);
          continue;
        }
        // Skip already registered
        if (getExternalAdapter(adapter.id)) {
          result.skipped.push(`${file}:${exportName} (already registered ${adapter.id})`);
          continue;
        }

        const ok = registerExternalAdapter(adapter);
        if (ok) {
          result.loaded++;
          logger.info('[ADAPTER-LOADER] auto-loaded adapter id=%s from %s', adapter.id, file);
        } else {
          result.errors.push(`${file}:${exportName} (registration rejected for ${adapter.id})`);
        }
      }
    } catch (err) {
      const msg = getErrorMessage(err);
      result.errors.push(`${file}: ${msg}`);
      logger.debug('[ADAPTER-LOADER] failed to load %s: %s', file, msg);
    }
  }

  if (result.loaded > 0) {
    logger.info('[ADAPTER-LOADER] auto-load complete: %d new adapters', result.loaded);
  }
  return result;
};

/** Duck-type check for ExternalToolAdapter shape. */
function isExternalToolAdapter(value: unknown): value is ExternalToolAdapter {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    Array.isArray(obj.capabilities) &&
    typeof obj.isAvailable === 'function' &&
    typeof obj.execute === 'function'
  );
}
