const GOAL_NOISE_REGEXES: RegExp[] = [
  /세션 스킬 실행:[^\n]*/g,
  /요청:\s*/g,
  /목표:\s*/g,
  /\[intent-tags\][^|\n]*/gi,
  /\[response-directives\][^|\n]*/gi,
  /\s*\|\s*/g,
];

export const compactText = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

export const stripGoalNoise = (goal: string): string => {
  let out = String(goal || '');
  for (const pattern of GOAL_NOISE_REGEXES) {
    out = out.replace(pattern, ' ');
  }
  return compactText(out);
};

export const extractFirstUrl = (goal: string, args?: Record<string, unknown>): string => {
  const argUrl = typeof args?.url === 'string' ? compactText(args.url) : '';
  if (argUrl) {
    return argUrl;
  }

  const matched = String(goal || '').match(/https?:\/\/[^\s]+/i);
  return matched ? matched[0] : '';
};

export const extractQuery = (params: {
  goal: string;
  args?: Record<string, unknown>;
  defaultQuery: string;
  removePatterns?: RegExp[];
}): string => {
  const removePatterns = params.removePatterns || [];

  const fromArgs = typeof params.args?.query === 'string' ? compactText(params.args.query) : '';
  const base = fromArgs || stripGoalNoise(params.goal);

  let cleaned = base;
  for (const pattern of removePatterns) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  return compactText(cleaned) || params.defaultQuery;
};
