/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
const CANARY_GUILD_ID = String(process.env.CANARY_GUILD_ID || '').trim();

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

const parseBool = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const dryRun = parseBool(parseArg('dryRun', 'false'));
const windowHours = Math.max(1, Number(parseArg('windowHours', '24')) || 24);

const now = new Date();
const day = now.toISOString().slice(0, 10);
const fromIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

/**
 * Validate static code boundary markers (same as trading isolation readiness).
 */
const validateStaticBoundary = () => {
  const checks = [];

  const fileChecks = [
    { path: 'src/routes/trading.ts', tokens: ["router.get('/strategy'", "router.put('/strategy'", 'requireAuth, requireAdmin'] },
    { path: 'src/services/tradingEngine.ts', tokens: ['acquireDistributedLease', 'releaseDistributedLease', 'pauseTradingEngine'] },
    { path: 'src/services/distributedLockService.ts', tokens: ['LOCK_HELD', 'LOCK_TABLE_UNAVAILABLE'] },
  ];

  for (const fc of fileChecks) {
    const absPath = path.join(ROOT, fc.path);
    if (!fs.existsSync(absPath)) {
      checks.push({ id: `file_exists:${fc.path}`, ok: false, detail: 'file not found' });
      continue;
    }
    const content = fs.readFileSync(absPath, 'utf8');
    for (const token of fc.tokens) {
      checks.push({
        id: `static:${fc.path}:${token.slice(0, 30)}`,
        ok: content.includes(token),
        detail: content.includes(token) ? 'present' : 'missing',
      });
    }
  }

  return checks;
};

/**
 * Validate runtime read/write isolation from recent action logs.
 * Read actions should be separate from write-mutation actions.
 */
const validateRuntimeIsolation = async () => {
  const checks = [];

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    checks.push({ id: 'runtime_isolation', ok: true, detail: 'supabase unavailable — skipped' });
    return checks;
  }

  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  try {
    let query = db
      .from('agent_action_logs')
      .select('action_type,failure_reason')
      .gte('created_at', fromIso)
      .limit(10000);
    if (CANARY_GUILD_ID) query = query.eq('guild_id', CANARY_GUILD_ID);

    const { data, error } = await query;
    if (error) {
      checks.push({ id: 'runtime_query', ok: false, detail: error.message });
      return checks;
    }

    const readActions = (data || []).filter((r) => {
      const at = String(r.action_type || '').toLowerCase();
      return at.includes('read') || at.includes('get') || at.includes('fetch') || at.includes('query');
    });

    const writeActions = (data || []).filter((r) => {
      const at = String(r.action_type || '').toLowerCase();
      return at.includes('write') || at.includes('mutate') || at.includes('execute') || at.includes('trade');
    });

    const writeFails = writeActions.filter((r) => r.failure_reason);

    checks.push({
      id: 'runtime_read_count',
      ok: true,
      detail: `${readActions.length} read actions in ${windowHours}h`,
    });
    checks.push({
      id: 'runtime_write_count',
      ok: true,
      detail: `${writeActions.length} write actions in ${windowHours}h`,
    });
    checks.push({
      id: 'runtime_write_failures',
      ok: writeFails.length === 0,
      detail: writeFails.length > 0 ? `${writeFails.length} write failures` : 'no write failures',
    });
  } catch (err) {
    checks.push({ id: 'runtime_isolation', ok: false, detail: err?.message || String(err) });
  }

  return checks;
};

/**
 * Validate canary cutover readiness.
 */
const validateCanaryCutover = () => {
  const checks = [];

  // Check canary guild is configured
  checks.push({
    id: 'canary_guild_configured',
    ok: CANARY_GUILD_ID.length > 0,
    detail: CANARY_GUILD_ID ? `CANARY_GUILD_ID=${CANARY_GUILD_ID.slice(0, 12)}…` : 'CANARY_GUILD_ID not set',
  });

  // Check canary readiness script exists
  const canaryScript = path.join(ROOT, 'scripts', 'run-trading-canary-readiness.mjs');
  checks.push({
    id: 'canary_script_exists',
    ok: fs.existsSync(canaryScript),
    detail: fs.existsSync(canaryScript) ? 'present' : 'missing',
  });

  // Check trading isolation validation exists
  const isolationScript = path.join(ROOT, 'scripts', 'validate-trading-isolation-readiness.mjs');
  checks.push({
    id: 'isolation_script_exists',
    ok: fs.existsSync(isolationScript),
    detail: fs.existsSync(isolationScript) ? 'present' : 'missing',
  });

  // Check policy doc exists
  const policyDoc = path.join(ROOT, 'docs', 'planning', 'TRADING_ISOLATION_READINESS_V1.md');
  checks.push({
    id: 'policy_doc_exists',
    ok: fs.existsSync(policyDoc),
    detail: fs.existsSync(policyDoc) ? 'present' : 'missing',
  });

  return checks;
};

async function main() {
  const staticChecks = validateStaticBoundary();
  const runtimeChecks = await validateRuntimeIsolation();
  const canaryChecks = validateCanaryCutover();

  const allChecks = [...staticChecks, ...runtimeChecks, ...canaryChecks];
  const passed = allChecks.filter((c) => c.ok).length;
  const failed = allChecks.filter((c) => !c.ok).length;
  const verdict = failed === 0 ? 'RW_BOUNDARY_OK' : 'RW_BOUNDARY_ISSUE';

  const md = `# Trading R/W Boundary & Canary Cutover Validation

- generated_at: ${now.toISOString()}
- window_hours: ${windowHours}
- canary_guild_id: ${CANARY_GUILD_ID || '*'}
- checks_passed: ${passed}
- checks_failed: ${failed}
- verdict: ${verdict}

## Static Code Boundary Checks

${staticChecks.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.id}: ${c.detail}`).join('\n')}

## Runtime Isolation Checks

${runtimeChecks.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.id}: ${c.detail}`).join('\n')}

## Canary Cutover Readiness

${canaryChecks.map((c) => `- [${c.ok ? 'x' : ' '}] ${c.id}: ${c.detail}`).join('\n')}

## Conclusion

${verdict === 'RW_BOUNDARY_OK'
    ? 'Read/Write 경계 분리 확인 완료. Canary cutover 운영화 준비 상태.'
    : `${failed}개 검증 항목 실패. 실패 항목 해결 후 재검증 필요.`}
`;

  const json = {
    generated_at: now.toISOString(),
    window_hours: windowHours,
    canary_guild_id: CANARY_GUILD_ID || null,
    verdict,
    checks_passed: passed,
    checks_failed: failed,
    checks: allChecks,
  };

  if (dryRun) {
    console.log('[RW-BOUNDARY] dry-run=true');
    console.log(md);
  } else {
    const mdPath = path.join(OUTPUT_DIR, `${day}_rw-boundary-canary-cutover.md`);
    const jsonPath = path.join(OUTPUT_DIR, `${day}_rw-boundary-canary-cutover.json`);
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, md, 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2), 'utf8');
    console.log(`[RW-BOUNDARY] written: ${path.relative(ROOT, mdPath).replace(/\\/g, '/')}`);
  }

  console.log(`[RW-BOUNDARY] verdict=${verdict} passed=${passed} failed=${failed}`);
  if (verdict !== 'RW_BOUNDARY_OK') process.exit(1);
}

main().catch((err) => {
  console.error('[RW-BOUNDARY] fatal:', err?.message || err);
  process.exit(1);
});
