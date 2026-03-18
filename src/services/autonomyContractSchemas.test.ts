import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const schemaPath = path.resolve(process.cwd(), 'docs', 'planning', 'AUTONOMY_CONTRACT_SCHEMAS.json');

const loadSchema = () => JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as Record<string, any>;

const hasKeys = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

describe('autonomy contract schemas', () => {
  it('contains all required contract definitions', () => {
    const schema = loadSchema();
    expect(schema).toHaveProperty('$defs');

    const defs = schema.$defs as Record<string, unknown>;
    expect(defs.eventEnvelope).toBeTruthy();
    expect(defs.commandEnvelope).toBeTruthy();
    expect(defs.policyDecisionRecord).toBeTruthy();
    expect(defs.evidenceBundle).toBeTruthy();
  });

  it('aligns required fields with roadmap contract set', () => {
    const schema = loadSchema();
    const defs = schema.$defs as Record<string, any>;

    expect(defs.eventEnvelope.required).toEqual([
      'event_id',
      'event_type',
      'event_version',
      'occurred_at',
      'guild_id',
      'actor_id',
      'payload',
      'trace_id',
    ]);

    expect(defs.commandEnvelope.required).toEqual([
      'command_id',
      'command_type',
      'requested_by',
      'requested_at',
      'idempotency_key',
      'policy_context',
      'payload',
    ]);

    expect(defs.policyDecisionRecord.required).toEqual([
      'decision',
      'reasons',
      'risk_score',
      'budget_state',
      'review_required',
      'approved_by',
    ]);

    expect(defs.evidenceBundle.required).toEqual([
      'ok',
      'summary',
      'artifacts',
      'verification',
      'error',
      'retry_hint',
      'runtime_cost',
    ]);
  });

  it('validates representative payload samples against required key sets', () => {
    const now = new Date().toISOString();

    const eventEnvelope = {
      event_id: 'evt-1',
      event_type: 'agent.session.started',
      event_version: 1,
      occurred_at: now,
      guild_id: 'guild-1',
      actor_id: 'user-1',
      payload: { sessionId: 's1' },
      trace_id: 'trace-1',
    } as Record<string, unknown>;

    const commandEnvelope = {
      command_id: 'cmd-1',
      command_type: 'agent.run',
      requested_by: 'user-1',
      requested_at: now,
      idempotency_key: 'idem-1',
      policy_context: { mode: 'approval_required' },
      payload: { goal: 'status check' },
    } as Record<string, unknown>;

    const policyDecisionRecord = {
      decision: 'review',
      reasons: ['high-risk action'],
      risk_score: 0.4,
      budget_state: 'warning',
      review_required: true,
      approved_by: null,
    } as Record<string, unknown>;

    const evidenceBundle = {
      ok: true,
      summary: 'run completed',
      artifacts: [],
      verification: [],
      error: null,
      retry_hint: null,
      runtime_cost: {
        latency_ms: 10,
        token_in: 1,
        token_out: 1,
      },
    } as Record<string, unknown>;

    expect(hasKeys(eventEnvelope, ['event_id', 'event_type', 'event_version', 'occurred_at', 'guild_id', 'actor_id', 'payload', 'trace_id'])).toBe(true);
    expect(hasKeys(commandEnvelope, ['command_id', 'command_type', 'requested_by', 'requested_at', 'idempotency_key', 'policy_context', 'payload'])).toBe(true);
    expect(hasKeys(policyDecisionRecord, ['decision', 'reasons', 'risk_score', 'budget_state', 'review_required', 'approved_by'])).toBe(true);
    expect(hasKeys(evidenceBundle, ['ok', 'summary', 'artifacts', 'verification', 'error', 'retry_hint', 'runtime_cost'])).toBe(true);
  });
});
