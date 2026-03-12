import { parseIntegerEnv } from '../../../utils/env';

const toSet = (raw: string): Set<string> => {
  return new Set(
    String(raw || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
};

const normalizeHost = (value: string): string => value.trim().toLowerCase();

const RUNNER_MODE_RAW = String(process.env.ACTION_RUNNER_MODE || 'execute').trim().toLowerCase();
const RUNNER_MODE = RUNNER_MODE_RAW === 'dry-run' ? 'dry-run' : 'execute';
const ALLOWED_ACTIONS_RAW = String(process.env.ACTION_ALLOWED_ACTIONS || '*').trim();
const ALLOWED_ACTIONS = toSet(ALLOWED_ACTIONS_RAW);
const WEB_ALLOWED_HOSTS = new Set(
  String(process.env.ACTION_WEB_FETCH_ALLOWED_HOSTS || '')
    .split(',')
    .map((item) => normalizeHost(item))
    .filter(Boolean),
);
const DB_ALLOWED_TABLES = toSet(String(process.env.ACTION_DB_READ_ALLOWED_TABLES || 'guild_lore_docs,memory_items'));

export const ACTION_MAX_READ_LIMIT = Math.max(1, Math.min(50, parseIntegerEnv(process.env.ACTION_DB_READ_MAX_ROWS, 5)));

export const getActionRunnerMode = (): 'execute' | 'dry-run' => RUNNER_MODE;

export const isActionAllowed = (actionName: string): boolean => {
  if (!actionName) {
    return false;
  }

  if (ALLOWED_ACTIONS_RAW === '*' || ALLOWED_ACTIONS.has('*')) {
    return true;
  }

  return ALLOWED_ACTIONS.has(actionName);
};

export const isWebHostAllowed = (host: string): boolean => {
  if (WEB_ALLOWED_HOSTS.size === 0) {
    return false;
  }
  return WEB_ALLOWED_HOSTS.has(normalizeHost(host));
};

export const isDbTableAllowed = (table: string): boolean => {
  if (!table) {
    return false;
  }
  return DB_ALLOWED_TABLES.has(table.trim());
};
