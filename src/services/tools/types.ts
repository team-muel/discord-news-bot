export type RegisteredCliTool = {
  name: string;
  description: string;
  adapterId: 'script-cli';
  command: string;
  argsTemplate: string[];
  timeoutMs: number;
  maxOutputChars: number;
};

export type CliToolRegistryStatus = {
  enabled: boolean;
  configured: boolean;
  tools: Array<{
    name: string;
    description: string;
    adapterId: 'script-cli';
    commandConfigured: boolean;
    available: boolean;
    argsTemplate: string[];
    timeoutMs: number;
    maxOutputChars: number;
  }>;
  issues: string[];
};

export type ExecuteCliToolInput = {
  toolName?: string;
  goal: string;
  args?: Record<string, unknown>;
  guildId?: string;
  requestedBy?: string;
};

export type ExecuteCliToolResult = {
  ok: boolean;
  toolName: string;
  summary: string;
  artifacts: string[];
  verification: string[];
  error?: string;
  durationMs: number;
  adapterId: 'script-cli';
  exitCode: number | null;
};

export type CliToolAdapter = {
  id: 'script-cli';
  isAvailable: (tool: RegisteredCliTool) => boolean;
  execute: (tool: RegisteredCliTool, input: ExecuteCliToolInput) => Promise<ExecuteCliToolResult>;
};