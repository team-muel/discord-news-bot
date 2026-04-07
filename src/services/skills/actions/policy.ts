import { parseBoundedNumberEnv, parseCsvList, parseIntegerEnv, parseStringEnv } from '../../../utils/env';

const normalizeHost = (value: string): string => value.trim().toLowerCase();

const normalizeHostRule = (value: string): string => {
  const host = normalizeHost(value)
    .replace(/^https?:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/\/+$/, '');
  const slashIndex = host.indexOf('/');
  if (slashIndex >= 0) {
    return host.slice(0, slashIndex);
  }
  return host;
};

const RUNNER_MODE_RAW = parseStringEnv(process.env.ACTION_RUNNER_MODE, 'execute').toLowerCase();
const RUNNER_MODE = RUNNER_MODE_RAW === 'dry-run' ? 'dry-run' : 'execute';
const ALLOWED_ACTIONS_RAW = parseStringEnv(process.env.ACTION_ALLOWED_ACTIONS, '*');
const ALLOWED_ACTIONS = new Set(parseCsvList(ALLOWED_ACTIONS_RAW));
const WEB_ALLOWED_HOSTS = new Set(
  parseCsvList(process.env.ACTION_WEB_FETCH_ALLOWED_HOSTS)
    .map((item) => normalizeHostRule(item))
    .filter(Boolean),
);
const DB_ALLOWED_TABLES = new Set(parseCsvList(process.env.ACTION_DB_READ_ALLOWED_TABLES || 'guild_lore_docs,memory_items'));

export const ACTION_MAX_READ_LIMIT = parseBoundedNumberEnv(process.env.ACTION_DB_READ_MAX_ROWS, 5, 1, 50);

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
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) {
    return false;
  }

  // Empty allowlist = deny all hosts (closed-by-default).
  // To allow specific hosts, set ACTION_WEB_FETCH_ALLOWED_HOSTS="example.com,other.com".
  // To allow all, set ACTION_WEB_FETCH_ALLOWED_HOSTS="*".
  if (WEB_ALLOWED_HOSTS.size === 0) {
    return false;
  }

  if (WEB_ALLOWED_HOSTS.has('*')) {
    return true;
  }

  for (const allowed of WEB_ALLOWED_HOSTS) {
    if (!allowed) {
      continue;
    }
    if (normalizedHost === allowed || normalizedHost.endsWith(`.${allowed}`)) {
      return true;
    }
  }

  return false;
};

export const isDbTableAllowed = (table: string): boolean => {
  if (!table) {
    return false;
  }
  return DB_ALLOWED_TABLES.has(table.trim());
};
