/**
 * Intent Signal Enricher (ADR-006)
 *
 * Collects multi-source signals BEFORE intent classification to provide
 * richer context than a single message string.
 *
 * Signal sources:
 * 1. promptCompiler intentTags + directives (already extracted)
 * 2. Recent conversation turns (via conversationTurnService)
 * 3. Obsidian graph neighbor tags (1-hop from keyword matches)
 * 4. User/guild intent history (from intent_exemplars)
 */

import type { PromptCompileResult } from '../../infra/promptCompiler';
import type { IntentTaxonomy } from '../../agent/agentRuntimeTypes';
import logger from '../../../logger';
import { getErrorMessage } from '../../../utils/errorMessage';

// ──── Types ─────────────────────────────────────────────────────────────────

export type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
};

export type IntentFrequency = {
  intent: string;
  count: number;
};

export type IntentSignalBundle = {
  /** Original message text */
  message: string;

  /** Compiled prompt result (intentTags, directives, executionGoal) */
  compiledPrompt: PromptCompileResult;

  /** Recent conversation turns for multi-turn context */
  recentTurns: ConversationTurn[];

  /** Turn position in current conversation (0 = first message) */
  turnPosition: number;

  /** Obsidian graph neighbor tags from keyword-matched nodes (1-hop) */
  graphNeighborTags: string[];

  /** Graph cluster hint derived from tag intersection */
  graphClusterHint: string | null;

  /** User's intent distribution over recent sessions */
  userIntentHistory: IntentFrequency[];

  /** Guild's dominant usage pattern */
  guildDominantIntent: string | null;

  /** Memory hints already fetched for this session */
  memoryHints: string[];
};

// ──── Obsidian Graph Signal ─────────────────────────────────────────────────

type GraphMetadataNode = {
  tags?: string[];
  backlinks?: string[];
};

const extractKeywords = (text: string): string[] => {
  const cleaned = text.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  return cleaned
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 15);
};

export const collectGraphNeighborTags = (
  keywords: string[],
  graphMetadata: Record<string, GraphMetadataNode> | null,
): { tags: string[]; clusterHint: string | null } => {
  if (!graphMetadata || keywords.length === 0) {
    return { tags: [], clusterHint: null };
  }

  const tagCounts = new Map<string, number>();
  const entries = Object.entries(graphMetadata);

  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();
    for (const [nodePath, node] of entries) {
      const nodeNameLower = nodePath.toLowerCase();
      if (!nodeNameLower.includes(lower)) continue;

      // Collect tags from this matched node
      if (Array.isArray(node.tags)) {
        for (const tag of node.tags) {
          const t = String(tag || '').trim().toLowerCase();
          if (t) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      }

      // Collect tags from 1-hop backlinked nodes
      if (Array.isArray(node.backlinks)) {
        for (const backlink of node.backlinks.slice(0, 5)) {
          const linkedNode = graphMetadata[backlink];
          if (linkedNode && Array.isArray(linkedNode.tags)) {
            for (const tag of linkedNode.tags) {
              const t = String(tag || '').trim().toLowerCase();
              if (t) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
            }
          }
        }
      }
    }
  }

  const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  const tags = sorted.slice(0, 10).map(([tag]) => tag);

  // Cluster hint: top tag that appears 2+ times
  const clusterHint = sorted.length > 0 && sorted[0][1] >= 2 ? sorted[0][0] : null;

  return { tags, clusterHint };
};

// ──── Intent History Signal ─────────────────────────────────────────────────

export type IntentHistoryLoader = (params: {
  guildId: string;
  userId: string;
  limit: number;
}) => Promise<{ userHistory: IntentFrequency[]; guildDominant: string | null }>;

const defaultIntentHistoryLoader: IntentHistoryLoader = async () => ({
  userHistory: [],
  guildDominant: null,
});

// ──── Enricher ──────────────────────────────────────────────────────────────

export type EnricherDeps = {
  /** Load recent conversation turns. */
  loadRecentTurns?: (params: {
    guildId: string;
    requestedBy: string;
    limit: number;
  }) => Promise<ConversationTurn[]>;

  /** Load cached Obsidian graph metadata. */
  loadGraphMetadata?: () => Promise<Record<string, GraphMetadataNode> | null>;

  /** Load intent history from exemplar store. */
  loadIntentHistory?: IntentHistoryLoader;
};

export const enrichIntentSignals = async (params: {
  guildId: string;
  requestedBy: string;
  goal: string;
  compiledPrompt: PromptCompileResult;
  memoryHints: string[];
  deps?: EnricherDeps;
}): Promise<IntentSignalBundle> => {
  const { guildId, requestedBy, goal, compiledPrompt, memoryHints, deps } = params;
  const message = compiledPrompt.normalizedGoal || goal;

  // 1. Recent turns (best-effort, timeout-safe)
  let recentTurns: ConversationTurn[] = [];
  let turnPosition = 0;
  if (deps?.loadRecentTurns) {
    try {
      recentTurns = await deps.loadRecentTurns({ guildId, requestedBy, limit: 4 });
      turnPosition = recentTurns.filter((t) => t.role === 'user').length;
    } catch (err) {
      logger.debug('[INTENT-ENRICHER] loadRecentTurns failed: %s', getErrorMessage(err));
    }
  }

  // 2. Obsidian graph neighbor tags (best-effort)
  let graphNeighborTags: string[] = [];
  let graphClusterHint: string | null = null;
  if (deps?.loadGraphMetadata) {
    try {
      const graphMeta = await deps.loadGraphMetadata();
      const keywords = extractKeywords(message);
      const graphSignal = collectGraphNeighborTags(keywords, graphMeta);
      graphNeighborTags = graphSignal.tags;
      graphClusterHint = graphSignal.clusterHint;
    } catch (err) {
      logger.debug('[INTENT-ENRICHER] loadGraphMetadata failed: %s', getErrorMessage(err));
    }
  }

  // 3. Intent history (best-effort)
  let userIntentHistory: IntentFrequency[] = [];
  let guildDominantIntent: string | null = null;
  const historyLoader = deps?.loadIntentHistory || defaultIntentHistoryLoader;
  try {
    const history = await historyLoader({ guildId, userId: requestedBy, limit: 20 });
    userIntentHistory = history.userHistory;
    guildDominantIntent = history.guildDominant;
  } catch (err) {
    logger.debug('[INTENT-ENRICHER] loadIntentHistory failed: %s', getErrorMessage(err));
  }

  return {
    message,
    compiledPrompt,
    recentTurns,
    turnPosition,
    graphNeighborTags,
    graphClusterHint,
    userIntentHistory,
    guildDominantIntent,
    memoryHints,
  };
};
