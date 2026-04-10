import fs from 'node:fs';
import path from 'node:path';
import { OBSIDIAN_SYNC_VAULT_PATH, OBSIDIAN_VAULT_NAME } from '../config';

export const getObsidianVaultRoot = (): string => {
  return OBSIDIAN_SYNC_VAULT_PATH;
};

export type ObsidianVaultRuntimeInfo = {
  configured: boolean;
  root: string;
  configuredName: string;
  resolvedName: string;
  exists: boolean;
  topLevelDirectories: string[];
  topLevelFiles: string[];
  looksLikeDesktopVault: boolean;
  looksLikeRepoDocs: boolean;
};

export const getObsidianVaultRuntimeInfo = (): ObsidianVaultRuntimeInfo => {
  const root = getObsidianVaultRoot();
  const configured = Boolean(root);
  const exists = configured && fs.existsSync(root);
  const directories: string[] = [];
  const files: string[] = [];

  if (exists) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isDirectory()) {
          directories.push(entry.name);
          continue;
        }
        files.push(entry.name);
      }
    } catch {
      // Ignore filesystem probe errors in diagnostics.
    }
  }

  const topLevelDirectories = directories.slice(0, 12);
  const topLevelFiles = files.slice(0, 12);
  const resolvedName = root ? path.basename(root) || OBSIDIAN_VAULT_NAME : OBSIDIAN_VAULT_NAME;
  const looksLikeDesktopVault = directories.includes('chat') && directories.includes('guilds');
  const looksLikeRepoDocs = directories.includes('guilds')
    && (files.includes('ARCHITECTURE_INDEX.md') || resolvedName.toLowerCase() === 'docs');

  return {
    configured,
    root,
    configuredName: OBSIDIAN_VAULT_NAME,
    resolvedName,
    exists,
    topLevelDirectories,
    topLevelFiles,
    looksLikeDesktopVault,
    looksLikeRepoDocs,
  };
};
