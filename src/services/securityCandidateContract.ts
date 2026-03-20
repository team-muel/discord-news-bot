export type CandidateKind =
  | 'untrusted-input-review'
  | 'output-boundary-review'
  | 'command-boundary-review'
  | 'path-boundary-review'
  | 'auth-boundary-review'
  | 'policy-boundary-review'
  | 'custom';

export type DiscoveryDisposition = 'analyze' | 'hold' | 'drop';

export type AnalysisDisposition = 'confirmed' | 'likely' | 'needs_review' | 'dismissed';

export type SecurityCandidateAnchor = {
  id: string;
  commitSha: string;
  filePath: string;
  startLine: number;
  endLine: number;
  codeSnippet: string;
  ruleId: string;
  fingerprint: string;
  candidateKind: CandidateKind;
  sourceKind?: string;
  sinkKind?: string;
  symbolName?: string;
};

export type MergedSecurityReviewUnit = {
  id: string;
  commitSha: string;
  filePath: string;
  startLine: number;
  endLine: number;
  codeSnippet: string;
  rawCandidateIds: string[];
  mergedCount: number;
  candidateKind: CandidateKind;
  ruleIds?: string[];
  symbolName?: string;
  sourceKind?: string;
  sinkKind?: string;
};

export type DiscoveryDecision = {
  unitId: string;
  disposition: DiscoveryDisposition;
  priorityScore: number;
  shortReason: string;
  reasonCodes: string[];
  recommendedAnalysisDepth?: 'light' | 'standard' | 'deep';
};

export type DiscoveryResult = {
  analyze: DiscoveryDecision[];
  hold: DiscoveryDecision[];
  drop: DiscoveryDecision[];
};

export type AnalysisVerdict = {
  unitId: string;
  disposition: AnalysisDisposition;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  relatedCandidateIds: string[];
  requiredFollowup?: string[];
  findingTitle?: string;
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

const ensureString = (value: unknown, fieldName: string): string => {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error(`${fieldName} is required`);
  }
  return text;
};

const ensureInteger = (value: unknown, fieldName: string): number => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return numeric;
};

const ensureStringArray = (value: unknown, fieldName: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  const items = value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (items.length !== value.length) {
    throw new Error(`${fieldName} must contain only non-empty strings`);
  }
  return items;
};

const normalizeCandidateKind = (value: unknown): CandidateKind => {
  const kind = String(value || '').trim();
  if (
    kind === 'untrusted-input-review'
    || kind === 'output-boundary-review'
    || kind === 'command-boundary-review'
    || kind === 'path-boundary-review'
    || kind === 'auth-boundary-review'
    || kind === 'policy-boundary-review'
    || kind === 'custom'
  ) {
    return kind;
  }
  throw new Error('candidateKind is invalid');
};

const normalizeDiscoveryDisposition = (value: unknown): DiscoveryDisposition => {
  const disposition = String(value || '').trim();
  if (disposition === 'analyze' || disposition === 'hold' || disposition === 'drop') {
    return disposition;
  }
  throw new Error('disposition is invalid');
};

const normalizeAnalysisDisposition = (value: unknown): AnalysisDisposition => {
  const disposition = String(value || '').trim();
  if (disposition === 'confirmed' || disposition === 'likely' || disposition === 'needs_review' || disposition === 'dismissed') {
    return disposition;
  }
  throw new Error('analysis disposition is invalid');
};

const normalizeConfidence = (value: unknown): 'high' | 'medium' | 'low' => {
  const confidence = String(value || '').trim();
  if (confidence === 'high' || confidence === 'medium' || confidence === 'low') {
    return confidence;
  }
  throw new Error('confidence is invalid');
};

export const normalizeSecurityCandidateAnchor = (value: unknown): SecurityCandidateAnchor => {
  if (!isRecord(value)) {
    throw new Error('candidate must be an object');
  }

  const startLine = ensureInteger(value.startLine, 'startLine');
  const endLine = ensureInteger(value.endLine, 'endLine');
  if (endLine < startLine) {
    throw new Error('endLine must be greater than or equal to startLine');
  }

  return {
    id: ensureString(value.id, 'id'),
    commitSha: ensureString(value.commitSha, 'commitSha'),
    filePath: ensureString(value.filePath, 'filePath'),
    startLine,
    endLine,
    codeSnippet: ensureString(value.codeSnippet, 'codeSnippet'),
    ruleId: ensureString(value.ruleId, 'ruleId'),
    fingerprint: ensureString(value.fingerprint, 'fingerprint'),
    candidateKind: normalizeCandidateKind(value.candidateKind),
    sourceKind: isNonEmptyString(value.sourceKind) ? value.sourceKind.trim() : undefined,
    sinkKind: isNonEmptyString(value.sinkKind) ? value.sinkKind.trim() : undefined,
    symbolName: isNonEmptyString(value.symbolName) ? value.symbolName.trim() : undefined,
  };
};

export const normalizeMergedSecurityReviewUnit = (value: unknown): MergedSecurityReviewUnit => {
  if (!isRecord(value)) {
    throw new Error('merged review unit must be an object');
  }

  const startLine = ensureInteger(value.startLine, 'startLine');
  const endLine = ensureInteger(value.endLine, 'endLine');
  const mergedCount = ensureInteger(value.mergedCount, 'mergedCount');
  if (endLine < startLine) {
    throw new Error('endLine must be greater than or equal to startLine');
  }

  const rawCandidateIds = ensureStringArray(value.rawCandidateIds, 'rawCandidateIds');
  if (mergedCount !== rawCandidateIds.length) {
    throw new Error('mergedCount must equal rawCandidateIds length');
  }

  return {
    id: ensureString(value.id, 'id'),
    commitSha: ensureString(value.commitSha, 'commitSha'),
    filePath: ensureString(value.filePath, 'filePath'),
    startLine,
    endLine,
    codeSnippet: ensureString(value.codeSnippet, 'codeSnippet'),
    rawCandidateIds,
    mergedCount,
    candidateKind: normalizeCandidateKind(value.candidateKind),
    ruleIds: Array.isArray(value.ruleIds) ? ensureStringArray(value.ruleIds, 'ruleIds') : undefined,
    symbolName: isNonEmptyString(value.symbolName) ? value.symbolName.trim() : undefined,
    sourceKind: isNonEmptyString(value.sourceKind) ? value.sourceKind.trim() : undefined,
    sinkKind: isNonEmptyString(value.sinkKind) ? value.sinkKind.trim() : undefined,
  };
};

export const normalizeDiscoveryDecision = (value: unknown): DiscoveryDecision => {
  if (!isRecord(value)) {
    throw new Error('discovery decision must be an object');
  }

  const priorityScore = Number(value.priorityScore);
  if (!Number.isFinite(priorityScore) || priorityScore < 0 || priorityScore > 100) {
    throw new Error('priorityScore must be a number between 0 and 100');
  }

  const recommendedAnalysisDepthRaw = String(value.recommendedAnalysisDepth || '').trim();
  const recommendedAnalysisDepth = recommendedAnalysisDepthRaw
    ? (recommendedAnalysisDepthRaw === 'light' || recommendedAnalysisDepthRaw === 'standard' || recommendedAnalysisDepthRaw === 'deep'
      ? recommendedAnalysisDepthRaw
      : (() => { throw new Error('recommendedAnalysisDepth is invalid'); })())
    : undefined;

  return {
    unitId: ensureString(value.unitId, 'unitId'),
    disposition: normalizeDiscoveryDisposition(value.disposition),
    priorityScore,
    shortReason: ensureString(value.shortReason, 'shortReason'),
    reasonCodes: ensureStringArray(value.reasonCodes, 'reasonCodes'),
    recommendedAnalysisDepth,
  };
};

export const normalizeDiscoveryResult = (value: unknown): DiscoveryResult => {
  if (!isRecord(value)) {
    throw new Error('discovery result must be an object');
  }

  const analyze = Array.isArray(value.analyze) ? value.analyze.map(normalizeDiscoveryDecision) : [];
  const hold = Array.isArray(value.hold) ? value.hold.map(normalizeDiscoveryDecision) : [];
  const drop = Array.isArray(value.drop) ? value.drop.map(normalizeDiscoveryDecision) : [];

  return { analyze, hold, drop };
};

export const normalizeAnalysisVerdict = (value: unknown): AnalysisVerdict => {
  if (!isRecord(value)) {
    throw new Error('analysis verdict must be an object');
  }

  return {
    unitId: ensureString(value.unitId, 'unitId'),
    disposition: normalizeAnalysisDisposition(value.disposition),
    confidence: normalizeConfidence(value.confidence),
    rationale: ensureString(value.rationale, 'rationale'),
    relatedCandidateIds: ensureStringArray(value.relatedCandidateIds, 'relatedCandidateIds'),
    requiredFollowup: Array.isArray(value.requiredFollowup)
      ? ensureStringArray(value.requiredFollowup, 'requiredFollowup')
      : undefined,
    findingTitle: isNonEmptyString(value.findingTitle) ? value.findingTitle.trim() : undefined,
  };
};

export const parseJsonl = <T>(raw: string, normalizeLine: (value: unknown) => T): T[] => {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    try {
      return normalizeLine(JSON.parse(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`invalid JSONL at line ${index + 1}: ${message}`);
    }
  });
};

export const stringifyJsonl = (items: unknown[]): string => {
  return items.map((item) => JSON.stringify(item)).join('\n');
};

export const formatLineRange = (startLine: number, endLine: number): string => {
  const start = ensureInteger(startLine, 'startLine');
  const end = ensureInteger(endLine, 'endLine');
  if (end < start) {
    throw new Error('endLine must be greater than or equal to startLine');
  }
  return start === end ? String(start) : `${start}-${end}`;
};

const dedupeStrings = (items: Array<string | undefined>): string[] => {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
};

const toMergedUnitId = (anchor: SecurityCandidateAnchor): string => {
  return [
    'merged',
    anchor.commitSha,
    anchor.filePath,
    formatLineRange(anchor.startLine, anchor.endLine),
    anchor.candidateKind,
    anchor.symbolName || 'anonymous',
  ].join(':');
};

export const mergeSecurityReviewUnits = (items: SecurityCandidateAnchor[]): MergedSecurityReviewUnit[] => {
  const groups = new Map<string, SecurityCandidateAnchor[]>();

  for (const item of items) {
    const key = [
      item.commitSha,
      item.filePath,
      item.startLine,
      item.endLine,
      item.candidateKind,
      item.symbolName || '',
      item.sourceKind || '',
      item.sinkKind || '',
    ].join('::');
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
      continue;
    }
    groups.set(key, [item]);
  }

  return [...groups.values()]
    .map((bucket) => {
      const [first] = bucket;
      const richestSnippet = bucket
        .map((item) => item.codeSnippet)
        .sort((left, right) => right.length - left.length)[0] || first.codeSnippet;

      return {
        id: toMergedUnitId(first),
        commitSha: first.commitSha,
        filePath: first.filePath,
        startLine: first.startLine,
        endLine: first.endLine,
        codeSnippet: richestSnippet,
        rawCandidateIds: dedupeStrings(bucket.map((item) => item.id)),
        mergedCount: bucket.length,
        candidateKind: first.candidateKind,
        ruleIds: dedupeStrings(bucket.map((item) => item.ruleId)),
        symbolName: first.symbolName,
        sourceKind: first.sourceKind,
        sinkKind: first.sinkKind,
      } satisfies MergedSecurityReviewUnit;
    })
    .sort((left, right) => {
      if (left.filePath !== right.filePath) {
        return left.filePath.localeCompare(right.filePath);
      }
      if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
      }
      return left.id.localeCompare(right.id);
    });
};