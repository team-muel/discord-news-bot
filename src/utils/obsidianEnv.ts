export const getObsidianVaultRoot = (): string => {
  return String(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();
};
