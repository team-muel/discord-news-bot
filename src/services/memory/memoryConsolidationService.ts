/**
 * Memory Consolidation Service (ADR-006, H-MEM inspired)
 *
 * Periodically promotes raw-tier memories to higher tiers:
 *   raw → summary: group 3+ raw memories by tag/keyword overlap, LLM-summarize
 *   summary → concept: group 3+ summaries into abstract concept
 *   concept → schema: manual-only (not auto-promoted for safety)
 *
 * Runs as a setInterval batch registered in runtimeBootstrap.
 * Can also be triggered via consolidation memory job type.
 */

import logger from '../../logger';
import { memoryConfig } from '../../config';
import { parseBooleanEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { generateText, isAnyLlmConfigured } from '../llmClient';
import { writeObsidianNoteWithAdapter } from '../obsidian/router';
import { doc } from '../obsidian/obsidianDocBuilder';

// ──── Configuration ───────────────────────────────────────────────────────────

const CONSOLIDATION_ENABLED = memoryConfig.consolidationEnabled;
const CONSOLIDATION_INTERVAL_MS = memoryConfig.consolidationIntervalMs;
const CONSOLIDATION_MIN_GROUP_SIZE = memoryConfig.consolidationMinGroupSize;
const CONSOLIDATION_MAX_BATCH = memoryConfig.consolidationMaxBatch;
const CONSOLIDATION_RAW_AGE_HOURS = memoryConfig.consolidationRawAgeHours;
const VAULT_WRITEBACK_ENABLED = parseBooleanEnv(process.env.MEMORY_CONSOLIDATION_VAULT_WRITEBACK, false);

// ──── Types ───────────────────────────────────────────────────────────────────

type MemoryRow = {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  confidence: number;
  tier: string;
};

export type ConsolidationResult = {
  groupsProcessed: number;
  memoriesCreated: number;
  memoriesArchived: number;
};

const EMPTY_RESULT: ConsolidationResult = { groupsProcessed: 0, memoriesCreated: 0, memoriesArchived: 0 };

let consolidationTimer: NodeJS.Timeout | null = null;

// ──── Grouping ────────────────────────────────────────────────────────────────

/**
 * Group memories by tag overlap. Two memories belong to the same group
 * if they share at least one tag.
 */
const groupByTagOverlap = (items: MemoryRow[]): MemoryRow[][] => {
  const groups: MemoryRow[][] = [];
  const used = new Set<string>();

  for (const item of items) {
    if (used.has(item.id)) continue;

    const group = [item];
    used.add(item.id);
    const groupTags = new Set(item.tags);

    for (const other of items) {
      if (used.has(other.id)) continue;
      const hasOverlap = other.tags.some((tag) => groupTags.has(tag));
      if (hasOverlap) {
        group.push(other);
        used.add(other.id);
        other.tags.forEach((tag) => groupTags.add(tag));
      }
    }

    if (group.length >= CONSOLIDATION_MIN_GROUP_SIZE) {
      groups.push(group);
    }
  }

  return groups.slice(0, CONSOLIDATION_MAX_BATCH);
};

// ──── LLM Summarization ──────────────────────────────────────────────────────

const summarizeGroup = async (items: MemoryRow[], targetTier: 'summary' | 'concept'): Promise<string | null> => {
  if (!isAnyLlmConfigured()) return null;

  const texts = items.map((item, i) => {
    const title = item.title || '(untitled)';
    const body = (item.summary || item.content || '').slice(0, 300);
    return `[${i + 1}] ${title}: ${body}`;
  }).join('\n');

  const tierLabel = targetTier === 'summary' ? 'summary' : 'abstract concept';
  const system = 'You are a memory consolidation agent. Create a single concise output that captures essential information from the provided memory items. Output ONLY the consolidated text, nothing else.';
  const user = `Below are ${items.length} related memory items. Create a single concise ${tierLabel} that captures the essential information from all of them.\n\n${texts}`;

  try {
    const result = await generateText({
      system,
      user,
      maxTokens: 400,
      temperature: 0.3,
    });
    return result?.trim() || null;
  } catch {
    return null;
  }
};

// ──── Core Consolidation ─────────────────────────────────────────────────────

/**
 * Run one consolidation cycle for a guild (or all guilds if guildId is omitted).
 */
export const runConsolidationCycle = async (guildId?: string): Promise<ConsolidationResult> => {
  if (!CONSOLIDATION_ENABLED) return EMPTY_RESULT;
  if (!isSupabaseConfigured()) return EMPTY_RESULT;

  try {
    const client = getSupabaseClient();
    const ageThreshold = new Date(Date.now() - CONSOLIDATION_RAW_AGE_HOURS * 60 * 60_000).toISOString();

    // Phase 1: raw → summary
    let query = client
      .from('memory_items')
      .select('id, guild_id, title, summary, content, tags, confidence, tier')
      .eq('status', 'active')
      .eq('tier', 'raw')
      .lt('created_at', ageThreshold)
      .order('guild_id')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (guildId) {
      query = query.eq('guild_id', guildId);
    }

    const { data: rawItems, error: rawError } = await query;
    if (rawError || !rawItems || rawItems.length === 0) return EMPTY_RESULT;

    // Group by guild, then by tag overlap
    const byGuild = new Map<string, MemoryRow[]>();
    for (const row of rawItems as Array<Record<string, unknown>>) {
      const gId = String(row.guild_id || '');
      if (!gId) continue;
      const list = byGuild.get(gId) || [];
      list.push({
        id: String(row.id || ''),
        title: String(row.title || ''),
        summary: String(row.summary || ''),
        content: String(row.content || ''),
        tags: Array.isArray(row.tags) ? (row.tags as string[]).map(String) : [],
        confidence: Number(row.confidence ?? 0.5),
        tier: String(row.tier || 'raw'),
      });
      byGuild.set(gId, list);
    }

    let totalGroupsProcessed = 0;
    let totalCreated = 0;
    let totalArchived = 0;

    for (const [currentGuildId, items] of byGuild) {
      const groups = groupByTagOverlap(items);

      for (const group of groups) {
        const summaryText = await summarizeGroup(group, 'summary');
        if (!summaryText) continue;

        // Merge tags from all group members
        const mergedTags = [...new Set(group.flatMap((item) => item.tags))].slice(0, 20);
        const avgConfidence = Math.min(
          0.95,
          group.reduce((sum, item) => sum + item.confidence, 0) / group.length + 0.05,
        );

        const newId = `mem_${crypto.randomUUID()}`;

        // Insert consolidated summary-tier memory
        const { error: insertError } = await client.from('memory_items').insert({
          id: newId,
          guild_id: currentGuildId,
          type: 'semantic',
          tier: 'summary',
          title: `[consolidated] ${summaryText.slice(0, 60)}`,
          content: summaryText,
          summary: summaryText.slice(0, 300),
          tags: mergedTags,
          confidence: Number(avgConfidence.toFixed(3)),
          status: 'active',
          source_count: group.length,
          created_by: 'consolidation-service',
          updated_by: 'consolidation-service',
        });

        if (insertError) {
          logger.warn('[CONSOLIDATION] insert failed guild=%s: %s', currentGuildId, insertError.message);
          continue;
        }

        // Create derived_from links from new summary to source memories
        for (const source of group) {
          try {
            await client.from('memory_item_links').insert({
              source_id: newId,
              target_id: source.id,
              guild_id: currentGuildId,
              relation_type: 'derived_from',
              strength: 0.9,
              created_by: 'consolidation-service',
            });
          } catch {
            /* unique violation is fine */
          }
        }

        // Archive source raw memories (not delete — preserve for audit)
        const sourceIds = group.map((item) => item.id);
        await client
          .from('memory_items')
          .update({ status: 'archived', updated_by: 'consolidation-service' })
          .in('id', sourceIds)
          .eq('tier', 'raw');

        totalGroupsProcessed++;
        totalCreated++;
        totalArchived += sourceIds.length;

        // Write consolidated concept to Obsidian vault for graph density
        if (VAULT_WRITEBACK_ENABLED) {
          void writeConsolidationToVault({
            guildId: currentGuildId,
            memoryId: newId,
            title: `[consolidated] ${summaryText.slice(0, 60)}`,
            content: summaryText,
            tags: mergedTags,
            sourceCount: group.length,
          });
        }

        logger.info(
          '[CONSOLIDATION] raw→summary guild=%s consolidated=%d→1 id=%s',
          currentGuildId, group.length, newId,
        );
      }
    }

    if (totalGroupsProcessed > 0) {
      logger.info('[CONSOLIDATION] cycle complete groups=%d created=%d archived=%d', totalGroupsProcessed, totalCreated, totalArchived);
    }

    return { groupsProcessed: totalGroupsProcessed, memoriesCreated: totalCreated, memoriesArchived: totalArchived };
  } catch (err) {
    logger.warn('[CONSOLIDATION] cycle failed: %s', err instanceof Error ? err.message : String(err));
    return EMPTY_RESULT;
  }
};

// ──── Vault Writeback ─────────────────────────────────────────────────────────

/**
 * Write consolidated memory to Obsidian vault for graph integration.
 * Fire-and-forget — failures are logged but never block consolidation.
 */
const writeConsolidationToVault = async (params: {
  guildId: string;
  memoryId: string;
  title: string;
  content: string;
  tags: string[];
  sourceCount: number;
}): Promise<void> => {
  const vaultPath = String(process.env.OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_SYNC_VAULT_PATH || '').trim();
  if (!vaultPath) return;

  const dateStr = new Date().toISOString().slice(0, 10);
  const safeName = params.memoryId.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
  const fileName = `consolidated/${dateStr}_${safeName}.md`;

  const tagList = params.tags.slice(0, 10).map((t) => `#${t}`).join(' ');
  const builder = doc()
    .title(params.title)
    .tag('consolidated', 'auto-generated', ...params.tags.slice(0, 5))
    .property('schema', 'consolidated-memory/v1')
    .property('memory_id', params.memoryId)
    .property('source_count', params.sourceCount)
    .property('created_at', new Date().toISOString())
    .section('Content')
    .line(`> Auto-consolidated from ${params.sourceCount} raw memories on ${new Date().toISOString()}`)
    .line('')
    .line(params.content)
    .section('Metadata')
    .line(`Tags: ${tagList}`)
    .line(`Memory ID: ${params.memoryId}`);

  const { markdown: content, tags, properties } = builder.build();

  try {
    await writeObsidianNoteWithAdapter({
      guildId: params.guildId,
      vaultPath,
      fileName,
      content,
      tags,
      properties,
    });
    logger.debug('[CONSOLIDATION] vault writeback: %s', fileName);
  } catch (err) {
    logger.debug('[CONSOLIDATION] vault writeback failed (non-critical): %s', err instanceof Error ? err.message : String(err));
  }
};

// ──── Lifecycle ───────────────────────────────────────────────────────────────

export const startConsolidationLoop = (): void => {
  if (!CONSOLIDATION_ENABLED) {
    logger.info('[CONSOLIDATION] disabled');
    return;
  }

  if (consolidationTimer) return;

  // Run first cycle after a short delay (don't block startup)
  const INITIAL_DELAY_MS = 5 * 60_000; // 5 min
  setTimeout(() => {
    void runConsolidationCycle().catch((err) => {
      logger.debug('[CONSOLIDATION] initial run skipped: %s', err instanceof Error ? err.message : String(err));
    });
  }, INITIAL_DELAY_MS);

  consolidationTimer = setInterval(() => {
    void runConsolidationCycle().catch((err) => {
      logger.debug('[CONSOLIDATION] periodic run skipped: %s', err instanceof Error ? err.message : String(err));
    });
  }, CONSOLIDATION_INTERVAL_MS);

  logger.info('[CONSOLIDATION] loop started interval=%dms minGroupSize=%d', CONSOLIDATION_INTERVAL_MS, CONSOLIDATION_MIN_GROUP_SIZE);
};

export const stopConsolidationLoop = (): void => {
  if (consolidationTimer) {
    clearInterval(consolidationTimer);
    consolidationTimer = null;
  }
};
