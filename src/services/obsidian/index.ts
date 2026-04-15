// Barrel export — Obsidian knowledge retrieval domain
// Usage: import { initObsidianRAG, queryObsidianRAG } from './obsidian';

export type {
  ObsidianCapability, ObsidianNode, ObsidianSearchResult,
  ObsidianLoreQuery, ObsidianSearchQuery, ObsidianReadFileQuery,
  ObsidianNoteWriteInput, ObsidianTask, ObsidianVaultAdapter,
} from './types';
export { supportsCapability } from './types';

export { upsertObsidianGuildDocument } from './authoring';
export {
  getObsidianKnowledgeCompilationStats,
  getObsidianKnowledgeControlSurface,
  listObsidianKnowledgeArtifactPaths,
  promoteKnowledgeToObsidian,
  resolveObsidianKnowledgeArtifactPath,
  runObsidianSemanticLintAudit,
  runKnowledgeCompilationForNote,
} from './knowledgeCompilerService';
export type {
  ObsidianKnowledgeCompilationResult,
  ObsidianKnowledgeCompilationStats,
  ObsidianKnowledgeLintIssue,
  ObsidianKnowledgeLintSummary,
  ObsidianKnowledgePromoteArtifactKind,
  ObsidianKnowledgePromoteResult,
  ObsidianSemanticLintAuditIssue,
  ObsidianSemanticLintPersistenceResult,
  ObsidianSemanticLintAuditResult,
} from './knowledgeCompilerService';

export { bootstrapObsidianGuildKnowledgeTree, autoBootstrapGuildKnowledgeOnJoin, DEFAULT_GUILD_MANIFEST } from './obsidianBootstrapService';
export type { GuildKnowledgeManifest, GuildBootstrapSummary } from './obsidianBootstrapService';

export { initObsidianCache, getCachedDocument, getCachedDocumentsBatch, cacheDocument, loadDocumentsWithCache, getCacheStats, clearExpiredCache } from './obsidianCacheService';

export { startObsidianLoreSyncLoop, stopObsidianLoreSyncLoop, getObsidianLoreSyncLoopStats } from './obsidianLoreSyncService';

export {
  getLatestObsidianGraphAuditSnapshot,
  getObsidianGraphAuditLoopStats,
  runObsidianGraphAuditOnce,
  startObsidianGraphAuditLoop,
  stopObsidianGraphAuditLoop,
} from './obsidianQualityService';
export type { ObsidianGraphAuditSnapshot, ObsidianGraphAuditLoopStats } from './obsidianQualityService';

export { initObsidianRAG, queryObsidianRAG, queryObsidianLoreHints, inferIntent, resetDynamicIntentState, flushKnowledgeGaps, getKnowledgeGapCount, appendToDailyNote, readDailyNote, writeRetroToVault } from './obsidianRagService';
export type { RAGQueryResult, LoreHint } from './obsidianRagService';

export { sanitizeForObsidianWrite } from './obsidianSanitizationWorker';
export type { ObsidianSanitizeResult } from './obsidianSanitizationWorker';

export {
  isObsidianCapabilityAvailable, getObsidianAdapterRuntimeStatus,
  readObsidianLoreWithAdapter, writeObsidianNoteWithAdapter,
  searchObsidianVaultWithAdapter, readObsidianFileWithAdapter,
  getObsidianGraphMetadataWithAdapter,
} from './router';
