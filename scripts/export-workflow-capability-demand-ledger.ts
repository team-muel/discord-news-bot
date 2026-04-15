import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScriptClient, isMissingRelationError } from './lib/supabaseClient.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export const DEFAULT_WORKFLOW_CAPABILITY_DEMAND_LEDGER_PATH = path.resolve(
  repoRoot,
  'docs/planning/development/WORKFLOW_CAPABILITY_DEMAND_LEDGER.md',
);

const DEFAULT_LIMIT = 40;
const DEFAULT_DAYS = 14;
const WORKFLOW_EVENTS_TABLE = 'workflow_events';
const WORKFLOW_SESSIONS_TABLE = 'workflow_sessions';

type WorkflowEventRow = {
  session_id?: unknown;
  created_at?: unknown;
  decision_reason?: unknown;
  payload?: unknown;
};

type WorkflowSessionRow = {
  session_id?: unknown;
  status?: unknown;
  metadata?: unknown;
};

export type WorkflowCapabilityDemandLedgerRow = {
  createdAt: string | null;
  sessionId: string | null;
  sessionStatus: string | null;
  objective: string | null;
  runtimeLane: string | null;
  summary: string;
  missingCapability: string | null;
  missingSource: string | null;
  failedOrInsufficientRoute: string | null;
  cheapestEnablementPath: string | null;
  proposedOwner: string | null;
  evidenceRefs: string[];
  recallCondition: string | null;
  sourceEvent: string | null;
  tags: string[];
};

export type WorkflowCapabilityDemandPatternSummary = {
  summary: string;
  count: number;
  latestAt: string | null;
  latestSessionId: string | null;
  proposedOwner: string | null;
  cheapestEnablementPath: string | null;
};

type CliOptions = {
  outputPath: string;
  limit: number;
  days: number;
  dryRun: boolean;
};

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();
const toNullableString = (value: unknown): string | null => compact(value) || null;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const toStringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.map((entry) => compact(entry)).filter(Boolean)
  : [];

const normalizePositiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value: unknown): boolean => {
  const normalized = compact(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const readArgValue = (args: string[], index: number, flag: string): string | null => {
  const current = args[index] || '';
  if (current.startsWith(`${flag}=`)) {
    return current.slice(flag.length + 1);
  }
  return args[index + 1] || null;
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  let outputPath = DEFAULT_WORKFLOW_CAPABILITY_DEMAND_LEDGER_PATH;
  let limit = DEFAULT_LIMIT;
  let days = DEFAULT_DAYS;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const current = compact(args[index]);
    if (current === '--output' || current.startsWith('--output=')) {
      const value = readArgValue(args, index, '--output');
      if (value) {
        outputPath = path.resolve(repoRoot, value);
      }
      if (current === '--output') {
        index += 1;
      }
      continue;
    }
    if (current === '--limit' || current.startsWith('--limit=')) {
      limit = normalizePositiveInt(readArgValue(args, index, '--limit'), DEFAULT_LIMIT);
      if (current === '--limit') {
        index += 1;
      }
      continue;
    }
    if (current === '--days' || current.startsWith('--days=')) {
      days = normalizePositiveInt(readArgValue(args, index, '--days'), DEFAULT_DAYS);
      if (current === '--days') {
        index += 1;
      }
      continue;
    }
    if (current === '--dryRun' || current === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (current.startsWith('--dryRun=') || current.startsWith('--dry-run=')) {
      dryRun = parseBoolean(current.split('=').slice(1).join('='));
    }
  }

  return { outputPath, limit, days, dryRun };
};

const hasLegacyDemandShape = (value: Record<string, unknown>): boolean => [
  value.summary,
  value.objective,
  value.missing_capability,
  value.missing_source,
  value.failed_or_insufficient_route,
  value.cheapest_enablement_path,
  value.proposed_owner,
  value.recall_condition,
].some((entry) => compact(entry));

export const normalizeCapabilityDemandEvents = (
  events: WorkflowEventRow[],
  sessions: WorkflowSessionRow[] = [],
): WorkflowCapabilityDemandLedgerRow[] => {
  const sessionById = new Map<string, WorkflowSessionRow>();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const sessionId = compact(session?.session_id);
    if (sessionId) {
      sessionById.set(sessionId, session);
    }
  }

  const rows = (Array.isArray(events) ? events : []).flatMap((event) => {
    const sessionId = compact(event?.session_id);
    const session = sessionById.get(sessionId);
    const sessionMeta = isRecord(session?.metadata) ? session.metadata : {};
    const payload = isRecord(event?.payload) ? event.payload : {};
    const eventRuntimeLane = toNullableString(payload.runtime_lane) || toNullableString(sessionMeta.runtime_lane);
    const eventSourceEvent = toNullableString(payload.source_event);
    const eventTags = toStringArray(payload.tags);
    const rawDemands = Array.isArray(payload.demands)
      ? payload.demands
      : (hasLegacyDemandShape(payload) || toStringArray(payload.evidence_refs).length > 0 ? [payload] : []);

    return rawDemands.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      const summary = toNullableString(entry.summary) || toNullableString(event?.decision_reason);
      if (!summary) {
        return [];
      }

      return [{
        createdAt: toNullableString(event?.created_at),
        sessionId: sessionId || null,
        sessionStatus: toNullableString(session?.status),
        objective: toNullableString(entry.objective) || toNullableString(sessionMeta.objective),
        runtimeLane: toNullableString(entry.runtime_lane) || eventRuntimeLane,
        summary,
        missingCapability: toNullableString(entry.missing_capability),
        missingSource: toNullableString(entry.missing_source),
        failedOrInsufficientRoute: toNullableString(entry.failed_or_insufficient_route),
        cheapestEnablementPath: toNullableString(entry.cheapest_enablement_path),
        proposedOwner: toNullableString(entry.proposed_owner),
        evidenceRefs: toStringArray(entry.evidence_refs),
        recallCondition: toNullableString(entry.recall_condition),
        sourceEvent: toNullableString(entry.source_event) || eventSourceEvent,
        tags: toStringArray(entry.tags).length > 0 ? toStringArray(entry.tags) : eventTags,
      }];
    });
  });

  return rows.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
};

export const summarizeCapabilityDemandPatterns = (
  rows: WorkflowCapabilityDemandLedgerRow[],
): WorkflowCapabilityDemandPatternSummary[] => {
  const patternMap = new Map<string, WorkflowCapabilityDemandPatternSummary>();

  for (const row of Array.isArray(rows) ? rows : []) {
    const key = [
      compact(row.summary).toLowerCase(),
      compact(row.failedOrInsufficientRoute).toLowerCase(),
      compact(row.missingCapability).toLowerCase(),
    ].join('|');

    const existing = patternMap.get(key);
    if (!existing) {
      patternMap.set(key, {
        summary: row.summary,
        count: 1,
        latestAt: row.createdAt,
        latestSessionId: row.sessionId,
        proposedOwner: row.proposedOwner,
        cheapestEnablementPath: row.cheapestEnablementPath,
      });
      continue;
    }

    existing.count += 1;
    if (String(row.createdAt || '') > String(existing.latestAt || '')) {
      existing.latestAt = row.createdAt;
      existing.latestSessionId = row.sessionId;
      existing.proposedOwner = row.proposedOwner;
      existing.cheapestEnablementPath = row.cheapestEnablementPath;
    }
  }

  return Array.from(patternMap.values())
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return String(right.latestAt || '').localeCompare(String(left.latestAt || ''));
    })
    .slice(0, 12);
};

export const renderWorkflowCapabilityDemandLedger = (params: {
  rows: WorkflowCapabilityDemandLedgerRow[];
  generatedAt?: string;
  days?: number;
}): string => {
  const rows = Array.isArray(params.rows) ? params.rows : [];
  const generatedAt = params.generatedAt || new Date().toISOString();
  const days = normalizePositiveInt(params.days, DEFAULT_DAYS);
  const sessions = new Set(rows.map((row) => compact(row.sessionId)).filter(Boolean));
  const repeatedPatterns = summarizeCapabilityDemandPatterns(rows);

  const lines = [
    '# Workflow Capability Demand Ledger',
    '',
    `Generated: ${generatedAt}`,
    '',
    'This file is auto-generated from persisted workflow capability demand events.',
    'Source of truth remains Supabase workflow_events rows with event_type=capability_demand.',
    '',
    '## Snapshot',
    `- window_days: ${days}`,
    `- ledger_rows: ${rows.length}`,
    `- sessions_with_demands: ${sessions.size}`,
    `- repeated_patterns: ${repeatedPatterns.length}`,
  ];

  lines.push('', '## Repeated Demand Patterns');
  if (repeatedPatterns.length === 0) {
    lines.push('- none captured in the current window');
  } else {
    for (const pattern of repeatedPatterns) {
      lines.push(`- ${pattern.summary}`);
      lines.push(`  count: ${pattern.count}`);
      lines.push(`  latest_at: ${pattern.latestAt || 'unknown'}`);
      lines.push(`  latest_session_id: ${pattern.latestSessionId || 'unknown'}`);
      lines.push(`  proposed_owner: ${pattern.proposedOwner || 'unknown'}`);
      lines.push(`  cheapest_enablement_path: ${pattern.cheapestEnablementPath || 'unknown'}`);
    }
  }

  lines.push('', '## Recent Capability Demands');
  if (rows.length === 0) {
    lines.push('- no capability demand rows were found in the current window');
  } else {
    rows.slice(0, 25).forEach((row, index) => {
      lines.push('', `### ${index + 1}. ${row.summary}`);
      lines.push(`- created_at: ${row.createdAt || 'unknown'}`);
      lines.push(`- objective: ${row.objective || 'unknown'}`);
      lines.push(`- session_id: ${row.sessionId || 'unknown'}`);
      lines.push(`- session_status: ${row.sessionStatus || 'unknown'}`);
      lines.push(`- runtime_lane: ${row.runtimeLane || 'unknown'}`);
      lines.push(`- proposed_owner: ${row.proposedOwner || 'unknown'}`);
      lines.push(`- missing_capability: ${row.missingCapability || 'unknown'}`);
      lines.push(`- missing_source: ${row.missingSource || 'unknown'}`);
      lines.push(`- failed_or_insufficient_route: ${row.failedOrInsufficientRoute || 'unknown'}`);
      lines.push(`- cheapest_enablement_path: ${row.cheapestEnablementPath || 'unknown'}`);
      lines.push(`- recall_condition: ${row.recallCondition || 'unknown'}`);
      lines.push(`- source_event: ${row.sourceEvent || 'unknown'}`);
      lines.push(`- tags: ${row.tags.length > 0 ? row.tags.join(', ') : 'none'}`);
      lines.push(`- evidence_refs: ${row.evidenceRefs.length > 0 ? row.evidenceRefs.join(' | ') : 'none'}`);
    });
  }

  return `${lines.join('\n')}\n`;
};

const fetchCapabilityDemandEvents = async (days: number, limit: number): Promise<WorkflowEventRow[]> => {
  const client = createScriptClient();
  const sinceIso = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
  const query = client
    .from(WORKFLOW_EVENTS_TABLE)
    .select('session_id, created_at, decision_reason, payload')
    .eq('event_type', 'capability_demand')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error, WORKFLOW_EVENTS_TABLE)) {
      throw new Error('workflow_events table is missing');
    }
    throw new Error(error.message);
  }
  return Array.isArray(data) ? data : [];
};

const fetchWorkflowSessions = async (sessionIds: string[]): Promise<WorkflowSessionRow[]> => {
  const normalizedIds = Array.from(new Set(sessionIds.map((id) => compact(id)).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return [];
  }

  const client = createScriptClient();
  const { data, error } = await client
    .from(WORKFLOW_SESSIONS_TABLE)
    .select('session_id, status, metadata')
    .in('session_id', normalizedIds);

  if (error) {
    if (isMissingRelationError(error, WORKFLOW_SESSIONS_TABLE)) {
      throw new Error('workflow_sessions table is missing');
    }
    throw new Error(error.message);
  }

  return Array.isArray(data) ? data : [];
};

const ensureDirectory = (filePath: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

export const generateWorkflowCapabilityDemandLedger = async (options: Partial<CliOptions> = {}): Promise<{
  outputPath: string;
  rowCount: number;
  sessionCount: number;
  markdown: string;
}> => {
  const limit = normalizePositiveInt(options.limit, DEFAULT_LIMIT);
  const days = normalizePositiveInt(options.days, DEFAULT_DAYS);
  const outputPath = path.resolve(options.outputPath || DEFAULT_WORKFLOW_CAPABILITY_DEMAND_LEDGER_PATH);
  const generatedAt = new Date().toISOString();

  const events = await fetchCapabilityDemandEvents(days, limit);
  const sessions = await fetchWorkflowSessions(events.map((event) => compact(event.session_id)));
  const rows = normalizeCapabilityDemandEvents(events, sessions);
  const markdown = renderWorkflowCapabilityDemandLedger({ rows, generatedAt, days });

  if (!options.dryRun) {
    ensureDirectory(outputPath);
    fs.writeFileSync(outputPath, markdown, 'utf8');
  }

  return {
    outputPath,
    rowCount: rows.length,
    sessionCount: new Set(rows.map((row) => compact(row.sessionId)).filter(Boolean)).size,
    markdown,
  };
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  const result = await generateWorkflowCapabilityDemandLedger(options);
  console.log(
    `[workflow-capability-demand-ledger] ${options.dryRun ? 'dry-run ' : ''}rows=${result.rowCount} sessions=${result.sessionCount} output=${path.relative(repoRoot, result.outputPath).replace(/\\/g, '/')}`,
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error('[workflow-capability-demand-ledger] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}