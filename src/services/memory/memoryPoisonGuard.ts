const toBounded = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
};

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const lower = (value: unknown): string => compact(value).toLowerCase();

const POISON_BLOCK_THRESHOLD = toBounded(process.env.MEMORY_POISON_BLOCK_THRESHOLD, 0.85, 0, 1);
const POISON_REVIEW_THRESHOLD = toBounded(process.env.MEMORY_POISON_REVIEW_THRESHOLD, 0.55, 0, 1);

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+previous\s+instructions/i,
  /system\s+prompt/i,
  /developer\s+mode/i,
  /jailbreak/i,
  /이전\s*지시.*무시/i,
  /시스템\s*프롬프트/i,
  /루트\s*폴더/i,
];

const AD_SPAM_PATTERNS: RegExp[] = [
  /무료|할인|특가|이벤트|쿠폰/i,
  /수익\s*보장|고수익|원금\s*보장|투자\s*추천/i,
  /dm\s*me|텔레그램|t\.me\//i,
  /bit\.ly|tinyurl|shorturl/i,
  /구독\s*유도|홍보/i,
];

const countMatches = (patterns: RegExp[], text: string): number => {
  let total = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      total += 1;
    }
  }
  return total;
};

const countLinks = (text: string): number => {
  const matches = text.match(/https?:\/\/[^\s<>()]+/gi) || [];
  return matches.length;
};

export type PoisonAssessment = {
  riskScore: number;
  reasons: string[];
  blocked: boolean;
  reviewRequired: boolean;
};

export const assessMemoryPoisonRisk = (params: {
  title?: string | null;
  summary?: string | null;
  content: string;
  sourceRef?: string | null;
}): PoisonAssessment => {
  const text = [params.title, params.summary, params.content, params.sourceRef].map((v) => lower(v)).filter(Boolean).join(' ');
  const reasons: string[] = [];

  let risk = 0;

  const injectionHits = countMatches(PROMPT_INJECTION_PATTERNS, text);
  if (injectionHits > 0) {
    risk += Math.min(0.7, injectionHits * 0.35);
    reasons.push('prompt_injection_pattern');
  }

  const spamHits = countMatches(AD_SPAM_PATTERNS, text);
  if (spamHits > 0) {
    risk += Math.min(0.5, spamHits * 0.16);
    reasons.push('ad_or_spam_pattern');
  }

  const links = countLinks(text);
  if (links >= 3) {
    risk += 0.2;
    reasons.push('excessive_links');
  }

  const contentLen = compact(params.content).length;
  if (contentLen > 0 && contentLen < 40 && links > 0) {
    risk += 0.2;
    reasons.push('short_link_heavy_content');
  }

  if (/광고|sponsored|ad\b/i.test(text) && links > 0) {
    risk += 0.15;
    reasons.push('ad_marker_with_link');
  }

  risk = Math.max(0, Math.min(1, risk));
  return {
    riskScore: risk,
    reasons,
    blocked: risk >= POISON_BLOCK_THRESHOLD,
    reviewRequired: risk >= POISON_REVIEW_THRESHOLD,
  };
};

export const buildPoisonTags = (assessment: PoisonAssessment): string[] => {
  if (assessment.blocked) {
    return ['poison_blocked'];
  }
  if (assessment.reviewRequired) {
    return ['needs_review', 'possible_poison'];
  }
  return [];
};
