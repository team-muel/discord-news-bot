import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

const ROUTES_PATH = path.join(ROOT, 'src', 'routes', 'trading.ts');
const ENGINE_PATH = path.join(ROOT, 'src', 'services', 'tradingEngine.ts');
const LOCK_PATH = path.join(ROOT, 'src', 'services', 'distributedLockService.ts');
const RUNBOOK_PATH = path.join(ROOT, 'docs', 'RUNBOOK_MUEL_PLATFORM.md');
const POLICY_DOC_PATH = path.join(ROOT, 'docs', 'planning', 'TRADING_ISOLATION_READINESS_V1.md');

const fail = (message) => {
  console.error(`[TRADING-ISOLATION][FAIL] ${message}`);
  process.exit(1);
};

const readText = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fail(`cannot read ${path.relative(ROOT, filePath)}: ${msg}`);
  }
};

const assertIncludes = (text, token, scope) => {
  if (!text.includes(token)) {
    fail(`${scope} missing token: ${token}`);
  }
};

const routes = readText(ROUTES_PATH);
const engine = readText(ENGINE_PATH);
const lockService = readText(LOCK_PATH);
const runbook = readText(RUNBOOK_PATH);
const policyDoc = readText(POLICY_DOC_PATH);

const readEndpoints = [
  "router.get('/strategy'",
  "router.get('/runtime'",
  "router.get('/position'",
];

const writeEndpoints = [
  "router.put('/strategy'",
  "router.post('/strategy/reset'",
  "router.post('/runtime/run-once'",
  "router.post('/runtime/pause'",
  "router.post('/runtime/resume'",
  "router.post('/position/close'",
];

for (const token of readEndpoints) {
  assertIncludes(routes, token, 'trading routes(read)');
}
for (const token of writeEndpoints) {
  assertIncludes(routes, token, 'trading routes(write)');
}

assertIncludes(routes, 'tradingControlRateLimiter', 'trading routes');
assertIncludes(routes, 'requireAuth, requireAdmin', 'trading routes auth');

assertIncludes(engine, 'ENGINE_LOCK_NAME', 'trading engine lock');
assertIncludes(engine, 'acquireDistributedLease', 'trading engine lock');
assertIncludes(engine, 'releaseDistributedLease', 'trading engine lock');
assertIncludes(engine, 'pauseTradingEngine', 'trading engine kill switch');
assertIncludes(engine, 'resumeTradingEngine', 'trading engine kill switch');

assertIncludes(lockService, 'LOCK_HELD', 'distributed lock service');
assertIncludes(lockService, 'LOCK_TABLE_UNAVAILABLE', 'distributed lock service');

assertIncludes(runbook, '### 11.4) Rollback Operations', 'runbook rollback');
assertIncludes(runbook, '1. Stage rollback', 'runbook rollback');
assertIncludes(runbook, '2. Queue rollback', 'runbook rollback');
assertIncludes(runbook, '3. Provider rollback', 'runbook rollback');

assertIncludes(policyDoc, '## W4-01 Read Model / Write Model Boundary', 'policy doc');
assertIncludes(policyDoc, '## W4-02 Distributed Lock / Kill Switch Procedure', 'policy doc');
assertIncludes(policyDoc, '## W4-03 Rollback Path Check (stage / queue / provider)', 'policy doc');

console.log('[TRADING-ISOLATION] validation passed');
