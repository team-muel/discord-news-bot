import { DISCORD_MESSAGES } from './messages';

const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const DEBUG_LINE_PATTERN =
  /^(?:\[프롬프트 컴파일\]|요청 결과|액션:|검증:|반영 가이드:|재시도 횟수:|소요시간\(ms\):|상태:|FinOps 모드:|\[실패 진단\]|total=|missing_action=|policy_blocked=|governance_unavailable=|finops_blocked=|external_failures=|unknown_failures=|Discord surface:|Discord reply mode:|tenant_lane:|discord_source:|RAG (?:근거|힌트) \d+건 |검색 가능한 RAG 근거를 찾지 못했습니다\.|RAG 검색 실행 실패)/i;
const DEBUG_BULLET_PATTERN =
  /^-\s*(?:dropped_noise=|intent_tags=|directives=|queryLatencyMs=|returned=|avgScore=|memoryType=|cache_ttl_ms=|cache_hit=|evidence_bundle_id:)/i;
const DEBUG_ARTIFACT_PATTERN =
  /^(?:\[(?:evidence|hint):\d+\]|id=|type=|score=|conf=|title=|snippet=|cite=)/i;
const SECTION_HEADER_PATTERN =
  /^(?:#+\s*)?\*{0,2}(deliverable|verification|confidence|why this path)\*{0,2}\s*:?\s*(.*)$/i;
const INLINE_DEBUG_STRIP_PATTERNS: ReadonlyArray<RegExp> = [
  /\[프롬프트 컴파일\]/gi,
  /-\s*dropped_noise=\S+/gi,
  /-\s*intent_tags=[^\n]+?(?=(?:\s+-\s*directives=|\s+FinOps 모드:|$))/gi,
  /-\s*directives=[^\n]+?(?=(?:\s+FinOps 모드:|$))/gi,
  /\bintent_tags=[^\s]+/gi,
  /\bdirectives=[^\s]+/gi,
  /FinOps 모드:\s*[^\n(]*\([^\n)]*\)/gi,
  /RAG (?:근거|힌트) \d+건 검색 완료\s*\(query="[^"]*"\)/gi,
  /검색 가능한 RAG 근거를 찾지 못했습니다\./gi,
  /RAG 검색 실행 실패\.?/gi,
  /\[ROUTE:[^\]]+\]/gi,
  /\[intent-tags\][^|\n]*/gi,
  /\[response-directives\][^|\n]*/gi,
];

type SectionName = 'deliverable' | 'verification' | 'confidence' | 'why this path';

const parseSectionHeader = (line: string): { section: SectionName; trailing: string } | null => {
  const match = String(line || '').trim().match(SECTION_HEADER_PATTERN);
  if (!match) return null;

  const section = String(match[1] || '').toLowerCase() as SectionName;
  if (section !== 'deliverable' && section !== 'verification' && section !== 'confidence' && section !== 'why this path') {
    return null;
  }

  return {
    section,
    trailing: String(match[2] || '').trim(),
  };
};

const isDebugLine = (line: string): boolean =>
  DEBUG_LINE_PATTERN.test(String(line || '').trim());

const stripInlineDebugText = (raw: string): string => {
  let cleaned = String(raw || '');
  for (const pattern of INLINE_DEBUG_STRIP_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned.replace(/\s{2,}/g, ' ').trim();
};

export const sanitizeDiscordUserFacingText = (raw: string): string => {
  const lines = String(raw || '').split(/\r?\n/);
  const kept: string[] = [];
  const keptLinks: string[] = [];
  let section: 'none' | 'artifact' | 'skip' = 'none';
  let inDeliverable = false;

  const pushLink = (value: string) => {
    const links = String(value || '').match(URL_PATTERN) || [];
    for (const link of links) {
      if (!keptLinks.includes(link)) {
        keptLinks.push(link);
      }
    }
  };

  for (const original of lines) {
    const line = stripInlineDebugText(original);
    if (!line) continue;

    const header = parseSectionHeader(line);
    if (header) {
      if (header.section === 'deliverable') {
        inDeliverable = true;
        section = 'none';
        if (header.trailing) {
          pushLink(header.trailing);
          kept.push(header.trailing);
        }
        continue;
      }

      if (inDeliverable) {
        break;
      }

      section = 'skip';
      continue;
    }

    if (line.startsWith('산출물:')) {
      section = 'artifact';
      const body = stripInlineDebugText(line.replace(/^산출물:\s*/i, ''));
      pushLink(body);
      if (body && body !== '없음' && !DEBUG_ARTIFACT_PATTERN.test(body)) {
        kept.push(body);
      }
      continue;
    }

    if (line.startsWith('검증:') || line.startsWith('반영 가이드:')) {
      section = 'skip';
      continue;
    }

    if (isDebugLine(line) || DEBUG_ARTIFACT_PATTERN.test(line)) {
      section = 'none';
      continue;
    }

    if (line.startsWith('- ')) {
      const bulletBody = stripInlineDebugText(line.slice(2));
      pushLink(bulletBody);
      if (
        !bulletBody
        || section === 'skip'
        || DEBUG_BULLET_PATTERN.test(`- ${bulletBody}`)
        || DEBUG_ARTIFACT_PATTERN.test(bulletBody)
      ) {
        continue;
      }

      kept.push(section === 'artifact' ? bulletBody : `- ${bulletBody}`);
      continue;
    }

    if (section === 'skip') {
      continue;
    }

    pushLink(line);
    kept.push(line);
  }

  const compact = kept
    .map((line) => line.replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (compact) {
    return compact;
  }

  if (keptLinks.length > 0) {
    const top = keptLinks.slice(0, 2);
    return [DISCORD_MESSAGES.session.linkFoundHeader, ...top.map((url) => `- ${url}`)].join('\n');
  }

  return '';
};