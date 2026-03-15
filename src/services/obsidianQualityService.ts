import { promises as fs } from 'node:fs';
import path from 'node:path';

export type ObsidianGraphAuditSnapshot = {
  generatedAt: string;
  vaultPath: string;
  totals: {
    files: number;
    unresolvedLinks: number;
    ambiguousLinks: number;
    orphanFiles: number;
    deadendFiles: number;
    missingRequiredPropertyFiles: number;
  };
  topTags: Array<{ tag: string; count: number }>;
  thresholds: {
    unresolvedLinks: number;
    ambiguousLinks: number;
    orphanFiles: number;
    deadendFiles: number;
    missingRequiredPropertyFiles: number;
  };
  pass: boolean;
};

const SNAPSHOT_PATH = path.resolve(process.cwd(), '.runtime', 'obsidian-graph-audit.json');

export const getLatestObsidianGraphAuditSnapshot = async (): Promise<ObsidianGraphAuditSnapshot | null> => {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as ObsidianGraphAuditSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};
