/**
 * Shared CLI argument parsing utilities for scripts.
 * Replaces 12+ copy-pasted parseArg / parseBool / parseSinks definitions.
 */

/**
 * Parse a CLI argument of the form `--name=value`.
 * Falls back to `fallback` if argument is not present.
 */
export const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
};

/**
 * Parse a boolean-like value. Accepts '1', 'true', 'yes', 'on' as truthy.
 */
export const parseBool = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

/**
 * Read the first explicitly configured boolean-like env var from a priority list.
 * Later aliases are only considered when earlier keys are unset.
 */
export const parseBoolEnvAny = (envKeys, fallback = false) => {
  for (const key of Array.isArray(envKeys) ? envKeys : []) {
    const raw = String(process.env[key] ?? '').trim();
    if (!raw) continue;
    return parseBool(raw, fallback);
  }
  return fallback;
};

/**
 * Parse sink list from a comma/semicolon-separated string.
 * @param {string} raw - Raw sink string (e.g. 'supabase,markdown')
 * @param {string[]} validSinks - Allowed sink names
 * @param {string[]} defaultSinks - Fallback if no valid sinks parsed
 */
export const parseSinks = (raw, validSinks = ['supabase', 'markdown', 'stdout'], defaultSinks = ['markdown']) => {
  const validSet = new Set(validSinks);
  const tokens = String(raw || '')
    .split(/[;,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const sinks = tokens.length > 0 ? tokens : defaultSinks;
  const deduped = [...new Set(sinks)].filter((sink) => validSet.has(sink));
  return deduped.length > 0 ? deduped : defaultSinks;
};
