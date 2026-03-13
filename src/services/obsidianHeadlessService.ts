/**
 * Obsidian Headless CLI Integration Service
 * 
 * Provides CLI-based vault search and file reading without requiring
 * the Obsidian desktop app. Falls back to direct file I/O if CLI unavailable.
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import logger from '../logger';

export interface ObsidianNode {
  filePath: string;
  title?: string;
  tags: string[];
  backlinks: string[];
  links: string[];
  category?: string;
}

export interface ObsidianSearchResult {
  filePath: string;
  title: string;
  score: number;
}

let headlessAvailable = false;
let initPromise: Promise<boolean> | null = null;

/**
 * Initialize Obsidian Headless authentication
 */
export async function initObsidianHeadless(): Promise<boolean> {
  if (initPromise) return initPromise;
  
  if (!process.env.OBSIDIAN_HEADLESS_ENABLED || process.env.OBSIDIAN_HEADLESS_ENABLED !== 'true') {
    logger.info('[OBSIDIAN-HEADLESS] Disabled via OBSIDIAN_HEADLESS_ENABLED env var');
    return false;
  }

  initPromise = (async () => {
    try {
      const email = process.env.OBSIDIAN_EMAIL;
      const password = process.env.OBSIDIAN_PASSWORD;

      if (!email || !password) {
        logger.warn('[OBSIDIAN-HEADLESS] Email/password not configured, using fallback');
        headlessAvailable = false;
        return false;
      }

      // Test authentication (non-interactive in server context)
      try {
        execSync('ob --version', { stdio: 'pipe', timeout: 5000 });
        logger.info('[OBSIDIAN-HEADLESS] CLI available');
        headlessAvailable = true;
        return true;
      } catch (error) {
        logger.warn('[OBSIDIAN-HEADLESS] CLI not available, fallback to file-based (%o)', 
          error instanceof Error ? error.message : String(error)
        );
        headlessAvailable = false;
        return false;
      }
    } catch (error) {
      logger.error('[OBSIDIAN-HEADLESS] Initialization failed: %o', error);
      headlessAvailable = false;
      return false;
    }
  })();

  return initPromise;
}

/**
 * Search Obsidian vault using CLI or fallback keyword matching
 */
export async function searchObsidianVault(
  query: string,
  limit: number = 10
): Promise<ObsidianSearchResult[]> {
  try {
    if (headlessAvailable) {
      return searchViaHeadless(query, limit);
    }
    // Fallback: direct filesystem scan of vault directory
    const vaultPath = process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '';
    if (vaultPath) {
      return searchViaFilesystem(query, vaultPath, limit);
    }
    logger.debug('[OBSIDIAN] Headless unavailable and vault path not set, skipping search');
    return [];
  } catch (error) {
    logger.warn('[OBSIDIAN] Search failed: %o', error);
    return [];
  }
}

/**
 * Read single file from vault
 */
export async function readObsidianFile(filePath: string): Promise<string | null> {
  try {
    if (headlessAvailable) {
      return readViaHeadless(filePath);
    }

    // Fallback: direct file read
    const vaultPath = process.env.OBSIDIAN_SYNC_VAULT_PATH || '';
    if (!vaultPath) {
      logger.warn('[OBSIDIAN] Vault path not configured');
      return null;
    }

    const fullPath = join(vaultPath, filePath);
    const content = readFileSync(fullPath, 'utf-8');
    logger.debug('[OBSIDIAN] Read file (fallback) %s (%d bytes)', filePath, content.length);
    return content;
  } catch (error) {
    logger.error('[OBSIDIAN] Read failed for %s: %o', filePath, error);
    return null;
  }
}

/**
 * Get Obsidian graph metadata (backlinks, links, tags)
 */
export async function getObsidianGraphMetadata(): Promise<Record<string, ObsidianNode>> {
  try {
    if (!headlessAvailable) {
      logger.warn('[OBSIDIAN] Graph metadata unavailable (headless disabled)');
      return {};
    }

    // Query via CLI for detailed graph
    const result = execSync(
      `ob search --query "tag:" --json`,
      { encoding: 'utf-8', timeout: 30000 }
    );

    return parseGraphMetadata(result);
  } catch (error) {
    logger.warn('[OBSIDIAN] Graph metadata fetch failed: %o', error);
    return {};
  }
}

/**
 * Extract tag-based metadata from frontmatter
 */
export async function parseObsidianFrontmatter(content: string): Promise<Record<string, any>> {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};

  const fm = fmMatch[1];
  const metadata: Record<string, any> = {};

  // Parse YAML-like frontmatter
  fm.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      const value = valueParts.join(':').trim();
      
      if (value.startsWith('[') && value.endsWith(']')) {
        metadata[key.trim()] = value.slice(1, -1).split(',').map(v => v.trim());
      } else if (value === 'true' || value === 'false') {
        metadata[key.trim()] = value === 'true';
      } else {
        metadata[key.trim()] = value;
      }
    }
  });

  return metadata;
}

// ─── Private Helpers ────────────────────────────────────────────────────────

async function searchViaHeadless(query: string, limit: number): Promise<ObsidianSearchResult[]> {
  try {
    const vaultName = process.env.OBSIDIAN_VAULT_NAME || 'docs';
    
    // Use ob search with tag-based filtering
    const result = execSync(
      `ob search --query "${query}" --vault-name="${vaultName}" --limit ${limit}`,
      { encoding: 'utf-8', timeout: 15000 }
    );

    return parseSearchResults(result);
  } catch (error) {
    logger.warn('[OBSIDIAN-HEADLESS] Search via CLI failed: %o', error);
    return [];
  }
}

async function readViaHeadless(filePath: string): Promise<string | null> {
  try {
    const vaultName = process.env.OBSIDIAN_VAULT_NAME || 'docs';
    
    // Use ob read for file retrieval
    const result = execSync(
      `ob read "${filePath}" --vault-name="${vaultName}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    logger.debug('[OBSIDIAN-HEADLESS] Read file %s (%d bytes)', filePath, result.length);
    return result;
  } catch (error) {
    logger.warn('[OBSIDIAN-HEADLESS] Read via CLI failed for %s: %o', filePath, error);
    return null;
  }
}

function parseSearchResults(output: string): ObsidianSearchResult[] {
  const results: ObsidianSearchResult[] = [];
  const lines = output.trim().split('\n');

  lines.forEach(line => {
    if (!line.trim()) return;

    // Expected format: "path/to/file.md | title | score"
    const parts = line.split('|').map(p => p.trim());
    if (parts.length >= 2) {
      results.push({
        filePath: parts[0],
        title: parts[2] || parts[0].split('/').pop() || 'Untitled',
        score: parseFloat(parts[1]) || 0.5,
      });
    }
  });

  return results;
}

function parseGraphMetadata(output: string): Record<string, ObsidianNode> {
  try {
    const data = JSON.parse(output);
    const metadata: Record<string, ObsidianNode> = {};

    if (Array.isArray(data)) {
      data.forEach(item => {
        metadata[item.path] = {
          filePath: item.path,
          title: item.title || item.path.split('/').pop(),
          tags: item.tags || [],
          backlinks: item.backlinks || [],
          links: item.links || [],
          category: item.category,
        };
      });
    }

    return metadata;
  } catch (error) {
    logger.warn('[OBSIDIAN] Parse graph metadata failed: %o', error);
    return {};
  }
}

// ─── Filesystem Fallback ─────────────────────────────────────────────────────

function collectMarkdownFiles(dir: string, results: string[] = []): string[] {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          collectMarkdownFiles(fullPath, results);
        } else if (extname(entry).toLowerCase() === '.md') {
          results.push(fullPath);
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

function searchViaFilesystem(query: string, vaultPath: string, limit: number): ObsidianSearchResult[] {
  const files = collectMarkdownFiles(vaultPath);
  const queryLower = query.toLowerCase();

  // Strip "tag:" prefix for tag-based queries coming from INTENT_ROUTES
  const isTagQuery = queryLower.startsWith('tag:');
  const searchTerm = isTagQuery ? queryLower.slice(4).trim() : queryLower;
  const keywords = searchTerm.split(/\s+/).filter(Boolean);

  const scored: Array<{ filePath: string; title: string; score: number }> = [];

  for (const fullPath of files) {
    try {
      const content = readFileSync(fullPath, 'utf-8');
      const contentLower = content.toLowerCase();
      const relPath = relative(vaultPath, fullPath).replace(/\\/g, '/');

      // Extract title from frontmatter or first heading
      const titleMatch = content.match(/^title:\s*(.+)$/m) || content.match(/^#\s+(.+)$/m);
      const title = titleMatch
        ? titleMatch[1].trim()
        : (relPath.split('/').pop()?.replace('.md', '') ?? relPath);

      let score = 0;

      // Score: tag match in frontmatter
      if (isTagQuery) {
        const fmTagMatch = content.match(/^tags:\s*\[?([^\]\n]+)\]?/m);
        if (fmTagMatch && fmTagMatch[1].toLowerCase().includes(searchTerm)) {
          score += 1.0;
        }
        // Also match "tags:\n  - item" style
        const tagLines = [...content.matchAll(/^\s*-\s+(.+)$/gm)];
        for (const m of tagLines) {
          if (m[1].toLowerCase().includes(searchTerm)) score += 0.5;
        }
      }

      // Score: keyword presence in content and path
      for (const kw of keywords) {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const occurrences = (contentLower.match(new RegExp(escaped, 'g')) ?? []).length;
        score += Math.min(occurrences * 0.1, 0.8);
        if (title.toLowerCase().includes(kw)) score += 0.5;
        if (relPath.toLowerCase().includes(kw)) score += 0.3;
      }

      if (score > 0) {
        scored.push({ filePath: relPath, title, score });
      }
    } catch { /* skip unreadable file */ }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
