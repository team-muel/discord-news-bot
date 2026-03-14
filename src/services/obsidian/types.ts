export type ObsidianCapability =
  | 'read_lore'
  | 'search_vault'
  | 'read_file'
  | 'graph_metadata'
  | 'write_note'
  | 'set_property'
  | 'set_tags'
  | 'run_plugin_command';

export type ObsidianNode = {
  filePath: string;
  title?: string;
  tags: string[];
  backlinks: string[];
  links: string[];
  category?: string;
};

export type ObsidianSearchResult = {
  filePath: string;
  title: string;
  score: number;
};

export type ObsidianLoreQuery = {
  guildId: string;
  goal: string;
  vaultPath: string;
};

export type ObsidianSearchQuery = {
  vaultPath: string;
  query: string;
  limit: number;
};

export type ObsidianReadFileQuery = {
  vaultPath: string;
  filePath: string;
};

export type ObsidianNoteWriteInput = {
  guildId: string;
  vaultPath: string;
  fileName: string;
  content: string;
  tags?: string[];
  properties?: Record<string, string | number | boolean | null>;
};

export type ObsidianVaultAdapter = {
  id: string;
  capabilities: ReadonlyArray<ObsidianCapability>;
  isAvailable: () => boolean;
  warmup?: (params: { vaultPath: string }) => Promise<void>;
  readLore?: (params: ObsidianLoreQuery) => Promise<string[]>;
  searchVault?: (params: ObsidianSearchQuery) => Promise<ObsidianSearchResult[]>;
  readFile?: (params: ObsidianReadFileQuery) => Promise<string | null>;
  getGraphMetadata?: (params: { vaultPath: string }) => Promise<Record<string, ObsidianNode>>;
  writeNote?: (params: ObsidianNoteWriteInput) => Promise<{ path: string }>;
};

export const supportsCapability = (
  adapter: ObsidianVaultAdapter,
  capability: ObsidianCapability,
): boolean => adapter.capabilities.includes(capability);
