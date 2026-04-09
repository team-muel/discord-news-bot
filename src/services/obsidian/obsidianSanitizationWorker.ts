import { parseBooleanEnv, parseMinIntEnv } from '../../utils/env';

const SANITIZER_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_SANITIZER_ENABLED, true);
const SANITIZER_MAX_TEXT_LEN = parseMinIntEnv(process.env.OBSIDIAN_SANITIZER_MAX_TEXT_LEN, 12_000, 80);
const SANITIZER_MIN_TEXT_LEN = parseMinIntEnv(process.env.OBSIDIAN_SANITIZER_MIN_TEXT_LEN, 20, 8);
const SANITIZER_MAX_LINKS = parseMinIntEnv(process.env.OBSIDIAN_SANITIZER_MAX_LINKS, 8, 1);

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+previous\s+instructions/i,
  /system\s+prompt/i,
  /developer\s+mode/i,
  /jailbreak/i,
  /이전\s*지시.*무시/i,
  /시스템\s*지시/i,
  /루트\s*폴더|etc\/passwd|\.\.[/\\]/i,
];

const SPAM_PATTERNS: RegExp[] = [
  /무료\s*(배송|증정|체험)|할인\s*(코드|쿠폰)|특가\s*판매|쿠폰\s*(지급|발급)/i,
  /원금\s*보장|고수익|수익\s*보장/i,
  /텔레그램|t\.me\//i,
  /dm\s*me|문의\s*주세요/i,
  /bit\.ly|tinyurl|shorturl/i,
];

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const sanitizeInlineText = (value: unknown, maxLen = SANITIZER_MAX_TEXT_LEN): string => {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/[|&;$`<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
};

const sanitizeMarkdownText = (value: unknown, maxLen = SANITIZER_MAX_TEXT_LEN): string => {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[&;$`<]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLen);
};

const countLinks = (value: string): number => (value.match(/https?:\/\/[^\s<>()]+/gi) || []).length;

const countPatternHits = (patterns: RegExp[], value: string): number => {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(value)) {
      count += 1;
    }
  }
  return count;
};

export type ObsidianSanitizeResult = {
  ok: boolean;
  blocked: boolean;
  reasons: string[];
  cleaned: {
    title: string | null;
    summary: string | null;
    content: string;
    sourceRef: string | null;
    excerpt: string | null;
  };
};

export const sanitizeForObsidianWrite = (params: {
  title?: unknown;
  summary?: unknown;
  content: unknown;
  sourceRef?: unknown;
  excerpt?: unknown;
  trustedSource?: boolean;
}): ObsidianSanitizeResult => {
  const cleaned = {
    title: params.title == null ? null : sanitizeInlineText(params.title, 160),
    summary: params.summary == null ? null : sanitizeInlineText(params.summary, 400),
    content: sanitizeMarkdownText(params.content, SANITIZER_MAX_TEXT_LEN),
    sourceRef: params.sourceRef == null ? null : sanitizeInlineText(params.sourceRef, 300),
    excerpt: params.excerpt == null ? null : sanitizeInlineText(params.excerpt, 600),
  };

  if (!SANITIZER_ENABLED) {
    return { ok: true, blocked: false, reasons: [], cleaned };
  }

  const corpus = compact([cleaned.title, cleaned.summary, cleaned.content, cleaned.sourceRef, cleaned.excerpt].filter(Boolean).join(' ')).toLowerCase();
  const reasons: string[] = [];

  if (cleaned.content.length < SANITIZER_MIN_TEXT_LEN) {
    reasons.push('content_too_short');
  }

  const injectionHits = countPatternHits(INJECTION_PATTERNS, corpus);
  if (injectionHits > 0) {
    reasons.push('prompt_or_path_injection_pattern');
  }

  if (!params.trustedSource) {
    const spamHits = countPatternHits(SPAM_PATTERNS, corpus);
    if (spamHits > 0) {
      reasons.push('spam_or_ad_pattern');
    }
  }

  const links = countLinks(corpus);
  if (links > SANITIZER_MAX_LINKS) {
    reasons.push('too_many_links');
  }

  const blocked = reasons.length > 0;
  return {
    ok: !blocked,
    blocked,
    reasons,
    cleaned,
  };
};
