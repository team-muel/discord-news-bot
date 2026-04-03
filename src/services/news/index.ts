// Barrel export — News & YouTube domain services
// Usage: import { startNewsSentimentMonitor, startYouTubeSubscriptionsMonitor } from './news';

export { buildNewsFingerprint, isNewsFingerprinted, recordNewsFingerprint } from './newsCaptureDedupService';

export { createNewsChannelSubscription, listNewsChannelSubscriptions, deleteNewsChannelSubscription } from './newsChannelStore';
export type { NewsChannelSubscription } from './newsChannelStore';

export { fetchNewsMonitorCandidatesByWorker } from './newsMonitorWorkerClient';
export type { WorkerNewsItem } from './newsMonitorWorkerClient';

export {
  isNewsSentimentMonitorEnabled, startNewsSentimentMonitor,
  triggerNewsSentimentMonitor, getNewsSentimentMonitorSnapshot, stopNewsSentimentMonitor,
} from './newsSentimentMonitor';

export { updateSourceState, claimSourceLock, releaseSourceLock } from './sourceMonitorStore';

export { scrapeLatestCommunityPostByChannelId, scrapeLatestCommunityPostByUrl } from './youtubeCommunityScraper';

export { isYouTubeMonitorWorkerStrict, fetchYouTubeLatestByWorker } from './youtubeMonitorWorkerClient';
export type { YouTubeMonitorMode, YouTubeMonitorEntry, YouTubeMonitorLatestResult } from './youtubeMonitorWorkerClient';

export {
  parseYouTubeChannelIdOrThrow,
  createYouTubeSubscription, listYouTubeSubscriptions, deleteYouTubeSubscription,
} from './youtubeSubscriptionStore';
export type { YouTubeSubscriptionKind, YouTubeSubscription } from './youtubeSubscriptionStore';

export {
  startYouTubeSubscriptionsMonitor, triggerYouTubeSubscriptionsMonitor,
  getYouTubeSubscriptionsMonitorSnapshot, stopYouTubeSubscriptionsMonitor,
} from './youtubeSubscriptionsMonitor';
