export type ObsidianCapability =
  | 'read_lore'
  | 'search_vault'
  | 'read_file'
  | 'graph_metadata'
  | 'write_note'
  | 'set_property'
  | 'set_tags'
  | 'run_plugin_command'
  | 'daily_note'
  | 'task_management'
  | 'outline'
  | 'search_context'
  | 'property_read'
  | 'files_list'
  | 'append_content';

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

export type ObsidianTask = {
  filePath: string;
  line: number;
  text: string;
  completed: boolean;
  tags?: string[];
};

export type ObsidianOutlineHeading = {
  level: number;
  text: string;
  line: number;
};

export type ObsidianSearchContextResult = {
  filePath: string;
  line: number;
  text: string;
};

export type ObsidianFileInfo = {
  filePath: string;
  name: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: number;
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
  dailyAppend?: (params: { content: string }) => Promise<boolean>;
  dailyRead?: () => Promise<string | null>;
  listTasks?: () => Promise<ObsidianTask[]>;
  toggleTask?: (params: { filePath: string; line: number }) => Promise<boolean>;
  getOutline?: (params: { vaultPath: string; filePath: string }) => Promise<ObsidianOutlineHeading[]>;
  searchContext?: (params: { vaultPath: string; query: string; limit?: number }) => Promise<ObsidianSearchContextResult[]>;
  readProperty?: (params: { vaultPath: string; filePath: string; name: string }) => Promise<string | null>;
  setProperty?: (params: { vaultPath: string; filePath: string; name: string; value: string }) => Promise<boolean>;
  listFiles?: (params: { vaultPath: string; folder?: string; extension?: string }) => Promise<ObsidianFileInfo[]>;
  appendContent?: (params: { vaultPath: string; filePath: string; content: string }) => Promise<boolean>;
};

export const supportsCapability = (
  adapter: ObsidianVaultAdapter,
  capability: ObsidianCapability,
): boolean => adapter.capabilities.includes(capability);
