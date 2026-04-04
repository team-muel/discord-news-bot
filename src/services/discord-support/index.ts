export { recordDiscordChannelMessageSignal } from './discordChannelTelemetryService';
export { recordReactionRewardSignal } from './discordReactionRewardService';
export {
  autoSyncGuildTopologiesOnReady,
  autoSyncGuildTopologyOnJoin,
} from './discordTopologySyncService';
export {
  upsertDiscordLoginSession,
  purgeExpiredDiscordLoginSessions,
} from './discordLoginSessionStore';
export {
  trackUserActivity,
  getUserProfile,
  getGuildMembership,
  listUserGuildMemberships,
  getUserCrmSnapshot,
  getGuildLeaderboard,
  updateUserProfileMeta,
  shutdownCrm,
  type UserProfile,
  type GuildMembership,
  type UserCrmSnapshot,
  type ActivityCounter,
} from './userCrmService';
