// Barrel export — Memory domain services
// Usage: import { startMemoryJobRunner, evolveMemoryLinks } from './memory';

export { runConsolidationCycle, startConsolidationLoop, stopConsolidationLoop } from './memoryConsolidationService';
export type { ConsolidationResult } from './memoryConsolidationService';

export { isEmbeddingEnabled, generateEmbedding, generateQueryEmbedding, storeMemoryEmbedding, backfillMemoryEmbeddings } from './memoryEmbeddingService';

export { evolveMemoryLinks, countMemoryLinks, batchCountMemoryLinks } from './memoryEvolutionService';
export type { EvolutionCandidate, LinkRelation, EvolutionResult } from './memoryEvolutionService';

export {
  startMemoryJobRunner, stopMemoryJobRunner,
  getMemoryJobRunnerStats, getMemoryJobQueueStats,
  getMemoryQueueHealthSnapshot, listMemoryJobDeadletters,
  requeueDeadletterJob, cancelMemoryJob,
} from './memoryJobRunner';

export { assessMemoryPoisonRisk, buildPoisonTags } from './memoryPoisonGuard';
export type { PoisonAssessment } from './memoryPoisonGuard';

export { getMemoryQualityMetrics } from './memoryQualityMetricsService';

export {
  computeUserEmbedding, storeUserEmbedding, getUserEmbedding,
  refreshUserEmbeddings, startUserEmbeddingLoop, stopUserEmbeddingLoop,
  cosineSimilarity, isUserEmbeddingEnabled,
} from './userEmbeddingService';
export type { UserEmbedding, UserEmbeddingRefreshResult } from './userEmbeddingService';
