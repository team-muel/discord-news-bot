import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SCHEMA_PATH = path.join(ROOT, 'docs', 'planning', 'AUTONOMY_CONTRACT_SCHEMAS.json');
const CORE_INTERFACE_DOC_PATH = path.join(ROOT, 'docs', 'planning', 'CORE_COMMAND_INTERFACE_V1.md');
const ADAPTER_MAPPING_DOC_PATH = path.join(ROOT, 'docs', 'planning', 'DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md');
const BOT_DISPATCH_PATH = path.join(ROOT, 'src', 'bot.ts');

const fail = (message) => {
  console.error(`[AUTONOMY-CONTRACTS] ${message}`);
  process.exit(1);
};

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`failed to parse JSON at ${filePath}: ${message}`);
  }
};

const readText = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`failed to read text at ${filePath}: ${message}`);
  }
};

const schema = readJson(SCHEMA_PATH);

const assert = (condition, message) => {
  if (!condition) {
    fail(message);
  }
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

assert(schema && typeof schema === 'object', 'schema must be an object');
assert(schema.$defs && typeof schema.$defs === 'object', 'schema must include $defs');

const requiredDefs = ['eventEnvelope', 'commandEnvelope', 'policyDecisionRecord', 'evidenceBundle'];
for (const key of requiredDefs) {
  assert(schema.$defs[key] && typeof schema.$defs[key] === 'object', `missing schema def: ${key}`);
}

const hasKeys = (value, keys) => keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const isString = (value) => typeof value === 'string' && value.trim().length > 0;
const isDateTimeString = (value) => isString(value) && Number.isFinite(Date.parse(value));

const validateEventEnvelope = (value) => {
  const required = ['event_id', 'event_type', 'event_version', 'occurred_at', 'guild_id', 'actor_id', 'payload', 'trace_id'];
  assert(value && typeof value === 'object', 'eventEnvelope must be an object');
  assert(hasKeys(value, required), 'eventEnvelope missing required keys');
  assert(isString(value.event_id), 'eventEnvelope.event_id must be non-empty string');
  assert(isString(value.event_type), 'eventEnvelope.event_type must be non-empty string');
  assert(Number.isInteger(value.event_version) && value.event_version >= 1, 'eventEnvelope.event_version must be integer >= 1');
  assert(isDateTimeString(value.occurred_at), 'eventEnvelope.occurred_at must be valid date-time string');
  assert(isString(value.guild_id), 'eventEnvelope.guild_id must be non-empty string');
  assert(isString(value.actor_id), 'eventEnvelope.actor_id must be non-empty string');
  assert(value.payload && typeof value.payload === 'object', 'eventEnvelope.payload must be object');
  assert(isString(value.trace_id), 'eventEnvelope.trace_id must be non-empty string');
};

const validateCommandEnvelope = (value) => {
  const required = ['command_id', 'command_type', 'requested_by', 'requested_at', 'idempotency_key', 'policy_context', 'payload'];
  assert(value && typeof value === 'object', 'commandEnvelope must be an object');
  assert(hasKeys(value, required), 'commandEnvelope missing required keys');
  assert(isString(value.command_id), 'commandEnvelope.command_id must be non-empty string');
  assert(isString(value.command_type), 'commandEnvelope.command_type must be non-empty string');
  assert(isString(value.requested_by), 'commandEnvelope.requested_by must be non-empty string');
  assert(isDateTimeString(value.requested_at), 'commandEnvelope.requested_at must be valid date-time string');
  assert(isString(value.idempotency_key), 'commandEnvelope.idempotency_key must be non-empty string');
  assert(value.policy_context && typeof value.policy_context === 'object', 'commandEnvelope.policy_context must be object');
  assert(value.payload && typeof value.payload === 'object', 'commandEnvelope.payload must be object');
};

const validatePolicyDecisionRecord = (value) => {
  const required = ['decision', 'reasons', 'risk_score', 'budget_state', 'review_required', 'approved_by'];
  assert(value && typeof value === 'object', 'policyDecisionRecord must be an object');
  assert(hasKeys(value, required), 'policyDecisionRecord missing required keys');
  assert(['allow', 'deny', 'review'].includes(value.decision), 'policyDecisionRecord.decision invalid enum');
  assert(Array.isArray(value.reasons), 'policyDecisionRecord.reasons must be array');
  assert(value.reasons.every((item) => typeof item === 'string'), 'policyDecisionRecord.reasons items must be strings');
  assert(typeof value.risk_score === 'number' && value.risk_score >= 0 && value.risk_score <= 1, 'policyDecisionRecord.risk_score must be number in [0,1]');
  assert(['normal', 'warning', 'blocked'].includes(value.budget_state), 'policyDecisionRecord.budget_state invalid enum');
  assert(typeof value.review_required === 'boolean', 'policyDecisionRecord.review_required must be boolean');
  assert(value.approved_by === null || isString(value.approved_by), 'policyDecisionRecord.approved_by must be string or null');
};

const validateEvidenceBundle = (value) => {
  const required = ['ok', 'summary', 'artifacts', 'verification', 'error', 'retry_hint', 'runtime_cost'];
  assert(value && typeof value === 'object', 'evidenceBundle must be an object');
  assert(hasKeys(value, required), 'evidenceBundle missing required keys');
  assert(typeof value.ok === 'boolean', 'evidenceBundle.ok must be boolean');
  assert(typeof value.summary === 'string', 'evidenceBundle.summary must be string');
  assert(Array.isArray(value.artifacts), 'evidenceBundle.artifacts must be array');
  assert(Array.isArray(value.verification), 'evidenceBundle.verification must be array');
  assert(value.error === null || typeof value.error === 'string', 'evidenceBundle.error must be string|null');
  assert(value.retry_hint === null || typeof value.retry_hint === 'string', 'evidenceBundle.retry_hint must be string|null');
  assert(value.runtime_cost && typeof value.runtime_cost === 'object', 'evidenceBundle.runtime_cost must be object');
  const runtimeCost = value.runtime_cost;
  assert(typeof runtimeCost.latency_ms === 'number' && runtimeCost.latency_ms >= 0, 'evidenceBundle.runtime_cost.latency_ms must be number >= 0');
  assert(typeof runtimeCost.token_in === 'number' && runtimeCost.token_in >= 0, 'evidenceBundle.runtime_cost.token_in must be number >= 0');
  assert(typeof runtimeCost.token_out === 'number' && runtimeCost.token_out >= 0, 'evidenceBundle.runtime_cost.token_out must be number >= 0');
};

const now = new Date().toISOString();

const sample = {
  eventEnvelope: {
    event_id: 'evt_001',
    event_type: 'agent.session.started',
    event_version: 1,
    occurred_at: now,
    guild_id: '1234567890',
    actor_id: 'operator_1',
    payload: { sessionId: 'sess_01' },
    trace_id: 'trace_001',
  },
  commandEnvelope: {
    command_id: 'cmd_001',
    command_type: 'agent.run',
    requested_by: 'operator_1',
    requested_at: now,
    idempotency_key: 'idem_001',
    policy_context: { mode: 'approval_required' },
    payload: { goal: 'health-check' },
  },
  policyDecisionRecord: {
    decision: 'review',
    reasons: ['high-risk action'],
    risk_score: 0.7,
    budget_state: 'warning',
    review_required: true,
    approved_by: null,
  },
  evidenceBundle: {
    ok: true,
    summary: 'validation sample',
    artifacts: [{ name: 'report', type: 'json', uri: 's3://bucket/report.json' }],
    verification: [{ check: 'lint', status: 'pass', details: 'tsc --noEmit passed' }],
    error: null,
    retry_hint: null,
    runtime_cost: {
      latency_ms: 123,
      token_in: 200,
      token_out: 80,
      usd: 0.01,
    },
  },
};

validateEventEnvelope(sample.eventEnvelope);
validateCommandEnvelope(sample.commandEnvelope);
validatePolicyDecisionRecord(sample.policyDecisionRecord);
validateEvidenceBundle(sample.evidenceBundle);

const coreInterfaceDoc = readText(CORE_INTERFACE_DOC_PATH);
const adapterMappingDoc = readText(ADAPTER_MAPPING_DOC_PATH);
const botDispatchSource = readText(BOT_DISPATCH_PATH);

assert(coreInterfaceDoc.includes('Core Command v1 Contract'), 'core interface doc missing required contract section');
assert(adapterMappingDoc.includes('Chat Input Command Mapping'), 'adapter mapping doc missing command mapping section');

const caseRegex = /case\s+'([^']+)'\s*:/g;
const dispatchCommands = [];
let match = caseRegex.exec(botDispatchSource);
while (match) {
  const command = String(match[1] || '').trim();
  if (command) {
    dispatchCommands.push(command);
  }
  match = caseRegex.exec(botDispatchSource);
}

const uniqueDispatchCommands = [...new Set(dispatchCommands)];
assert(uniqueDispatchCommands.length > 0, 'failed to collect command dispatch cases from src/bot.ts');

const missingFromMapping = uniqueDispatchCommands.filter((command) => {
  const pattern = new RegExp(`\\|\\s*${escapeRegExp(command)}\\s*\\|`, 'u');
  return !pattern.test(adapterMappingDoc);
});
const coverage = (uniqueDispatchCommands.length - missingFromMapping.length) / uniqueDispatchCommands.length;

assert(missingFromMapping.length === 0, `adapter-core mapping coverage incomplete: missing [${missingFromMapping.join(', ')}]`);
assert(coverage >= 1, `adapter-core mapping coverage must be 100%, got ${(coverage * 100).toFixed(2)}%`);

console.log(`[AUTONOMY-CONTRACTS] validation passed (dispatchCoverage=${(coverage * 100).toFixed(2)}%)`);
