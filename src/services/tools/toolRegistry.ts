import { parseBooleanEnv, parseBoundedNumberEnv, parseIntegerEnv, parseMinIntEnv, parseStringEnv } from '../../utils/env';
import type { CliToolRegistryStatus, RegisteredCliTool } from './types';

const CLI_TOOL_ENABLED = parseBooleanEnv(process.env.LOCAL_CLI_TOOL_ENABLED, false);
const CLI_TOOL_NAME = parseStringEnv(process.env.LOCAL_CLI_TOOL_NAME, 'local.cli') || 'local.cli';
const CLI_TOOL_DESCRIPTION = parseStringEnv(process.env.LOCAL_CLI_TOOL_DESCRIPTION, 'Configured local CLI tool') || 'Configured local CLI tool';
const CLI_TOOL_COMMAND = parseStringEnv(process.env.LOCAL_CLI_TOOL_COMMAND, '');
const CLI_TOOL_ARGS_JSON = parseStringEnv(process.env.LOCAL_CLI_TOOL_ARGS_JSON, '');
const CLI_TOOL_TIMEOUT_MS = parseMinIntEnv(process.env.LOCAL_CLI_TOOL_TIMEOUT_MS, 15_000, 500);
const CLI_TOOL_MAX_OUTPUT_CHARS = parseBoundedNumberEnv(process.env.LOCAL_CLI_TOOL_MAX_OUTPUT_CHARS, 2_000, 200, 8_000);

const DEFAULT_ARGS_TEMPLATE = ['{goal}'];

const parseArgsTemplate = (value: string): string[] => {
  if (!value) {
    return [...DEFAULT_ARGS_TEMPLATE];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_ARGS_TEMPLATE];
    }

    const normalized = parsed
      .map((item) => String(item || '').trim())
      .filter(Boolean);

    return normalized.length > 0 ? normalized : [...DEFAULT_ARGS_TEMPLATE];
  } catch {
    return [...DEFAULT_ARGS_TEMPLATE];
  }
};

const buildConfiguredTool = (): RegisteredCliTool | null => {
  if (!CLI_TOOL_ENABLED || !CLI_TOOL_COMMAND) {
    return null;
  }

  return {
    name: CLI_TOOL_NAME,
    description: CLI_TOOL_DESCRIPTION,
    adapterId: 'script-cli',
    command: CLI_TOOL_COMMAND,
    argsTemplate: parseArgsTemplate(CLI_TOOL_ARGS_JSON),
    timeoutMs: CLI_TOOL_TIMEOUT_MS,
    maxOutputChars: CLI_TOOL_MAX_OUTPUT_CHARS,
  };
};

export const listRegisteredCliTools = (): RegisteredCliTool[] => {
  const tool = buildConfiguredTool();
  return tool ? [tool] : [];
};

export const getRegisteredCliTool = (toolName?: string): RegisteredCliTool | null => {
  const tools = listRegisteredCliTools();
  if (tools.length === 0) {
    return null;
  }

  if (!toolName) {
    return tools[0];
  }

  return tools.find((tool) => tool.name === toolName) || null;
};

export const getCliToolRegistryStatus = (): CliToolRegistryStatus => {
  const configuredTool = buildConfiguredTool();
  const issues: string[] = [];

  if (!CLI_TOOL_ENABLED) {
    issues.push('LOCAL_CLI_TOOL_ENABLED=false');
  }
  if (CLI_TOOL_ENABLED && !CLI_TOOL_COMMAND) {
    issues.push('LOCAL_CLI_TOOL_COMMAND is required when LOCAL_CLI_TOOL_ENABLED=true');
  }

  return {
    enabled: CLI_TOOL_ENABLED,
    configured: Boolean(configuredTool),
    tools: [
      {
        name: CLI_TOOL_NAME,
        description: CLI_TOOL_DESCRIPTION,
        adapterId: 'script-cli',
        commandConfigured: CLI_TOOL_COMMAND.length > 0,
        available: Boolean(configuredTool),
        argsTemplate: configuredTool?.argsTemplate || parseArgsTemplate(CLI_TOOL_ARGS_JSON),
        timeoutMs: configuredTool?.timeoutMs || CLI_TOOL_TIMEOUT_MS,
        maxOutputChars: configuredTool?.maxOutputChars || CLI_TOOL_MAX_OUTPUT_CHARS,
      },
    ],
    issues,
  };
};