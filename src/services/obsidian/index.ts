// Barrel export — Obsidian knowledge retrieval domain
// Usage: import { initObsidianRAG, queryObsidianRAG } from './obsidian';

export type {
  ObsidianCapability, ObsidianNode, ObsidianSearchResult,
  ObsidianLoreQuery, ObsidianSearchQuery, ObsidianReadFileQuery,
  ObsidianNoteWriteInput, ObsidianTask, ObsidianVaultAdapter,
} from './types';
export { supportsCapability } from './types';

export { upsertObsidianGuildDocument } from './authoring';

export { bootstrapObsidianGuildKnowledgeTree, autoBootstrapGuildKnowledgeOnJoin, DEFAULT_GUILD_MANIFEST } from './obsidianBootstrapService';
export type { GuildKnowledgeManifest, GuildBootstrapSummary } from './obsidianBootstrapService';

export { initObsidianCache, getCachedDocument, getCachedDocumentsBatch, cacheDocument, loadDocumentsWithCache, getCacheStats, clearExpiredCache } from './obsidianCacheService';

export { startObsidianLoreSyncLoop, stopObsidianLoreSyncLoop, getObsidianLoreSyncLoopStats } from './obsidianLoreSyncService';

export { getLatestObsidianGraphAuditSnapshot } from './obsidianQualityService';
export type { ObsidianGraphAuditSnapshot } from './obsidianQualityService';

export { initObsidianRAG, queryObsidianRAG, inferIntent, flushKnowledgeGaps, getKnowledgeGapCount, appendToDailyNote, readDailyNote, writeRetroToVault } from './obsidianRagService';
export type { RAGQueryResult } from './obsidianRagService';

export { sanitizeForObsidianWrite } from './obsidianSanitizationWorker';
export type { ObsidianSanitizeResult } from './obsidianSanitizationWorker';

export {
  isObsidianCapabilityAvailable, getObsidianAdapterRuntimeStatus,
  readObsidianLoreWithAdapter, writeObsidianNoteWithAdapter,
  searchObsidianVaultWithAdapter, readObsidianFileWithAdapter,
  getObsidianGraphMetadataWithAdapter,
} from './router';
