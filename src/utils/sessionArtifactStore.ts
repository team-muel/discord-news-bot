/**
 * In-memory store for code artifacts produced by agent sessions.
 * Supports per-session versioning (original → refactor → ...) and guild-level listing.
 */

const MAX_GUILD_INDEX = 300;
const MAX_ENTRIES = 500;
const MAX_RAW_RESULT_LENGTH = 2000;

export type ArtifactEntry = {
  sessionId: string;
  guildId: string;
  goalSummary: string;
  fullGoal: string;
  codeBlocks: string[];    // extracted fenced code block strings
  rawResult: string;        // full result text for context in follow-up sessions
  threadId?: string;        // Discord thread ID if thread was created
  parentSessionId?: string; // set when this was triggered by a button refactor/regen
  createdAt: string;
};

const store = new Map<string, ArtifactEntry>();
// guildId -> sessionIds ordered newest first
const guildIndex = new Map<string, string[]>();
// parentSessionId -> direct child sessionIds
const parentIndex = new Map<string, string[]>();

const pruneStore = () => {
  if (store.size <= MAX_ENTRIES) {
    return;
  }
  const oldest = [...store.keys()].slice(0, store.size - MAX_ENTRIES);
  for (const id of oldest) {
    store.delete(id);
  }
};

export const saveArtifact = (entry: ArtifactEntry): void => {
  const truncated = { ...entry };
  if (truncated.rawResult.length > MAX_RAW_RESULT_LENGTH) {
    truncated.rawResult = truncated.rawResult.slice(0, MAX_RAW_RESULT_LENGTH);
  }
  store.set(entry.sessionId, truncated);
  pruneStore();

  const ids = guildIndex.get(entry.guildId) || [];
  if (!ids.includes(entry.sessionId)) {
    ids.unshift(entry.sessionId);
  }
  guildIndex.set(entry.guildId, ids.slice(0, MAX_GUILD_INDEX));

  if (entry.parentSessionId) {
    const children = parentIndex.get(entry.parentSessionId) || [];
    if (!children.includes(entry.sessionId)) {
      children.push(entry.sessionId);
    }
    parentIndex.set(entry.parentSessionId, children);
  }
};

export const getArtifact = (sessionId: string): ArtifactEntry | null =>
  store.get(sessionId) ?? null;

export const setArtifactThreadId = (sessionId: string, threadId: string): void => {
  const entry = store.get(sessionId);
  if (entry) {
    entry.threadId = threadId;
  }
};

/** Returns the full chain from root to all descendants (breadth-first). */
export const getChain = (sessionId: string): ArtifactEntry[] => {
  // Walk up to root
  let root: ArtifactEntry | undefined = store.get(sessionId);
  if (!root) {
    return [];
  }
  while (root.parentSessionId) {
    const parent = store.get(root.parentSessionId);
    if (!parent) {
      break;
    }
    root = parent;
  }

  // BFS from root
  const result: ArtifactEntry[] = [];
  const queue: string[] = [root.sessionId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const entry = store.get(id);
    if (entry) {
      result.push(entry);
    }
    const children = parentIndex.get(id) || [];
    queue.push(...children);
  }
  return result;
};

export const listGuildArtifacts = (guildId: string, limit = 10): ArtifactEntry[] => {
  const ids = (guildIndex.get(guildId) || []).slice(0, Math.min(limit, 20));
  return ids.map((id) => store.get(id)).filter((e): e is ArtifactEntry => Boolean(e));
};
