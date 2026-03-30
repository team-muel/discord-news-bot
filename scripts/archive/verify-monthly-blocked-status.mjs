/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();

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
const windowDays = Math.max(1, Number(parseArg('days', '30')) || 30);
const guildId = String(parseArg('guildId', '')).trim() || null;

const now = new Date();
const fromIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
const day = now.toISOString().slice(0, 10);

const fetchBlockedCounts = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { available: false, policyBlocked: 0, finopsBlocked: 0, total: 0, source: 'supabase_unavailable' };
  }

  const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  let policyBlocked = 0;
  let finopsBlocked = 0;

  try {
    let query = client
      .from('agent_action_logs')
      .select('failure_reason')
      .gte('created_at', fromIso)
      .in('failure_reason', ['POLICY_BLOCKED', 'FINOPS_BLOCKED'])
      .limit(10000);
    if (guildId) query = query.eq('guild_id', guildId);
    const { data, error } = await query;
    if (error) {
      console.log(`[MONTHLY-BLOCKED] agent_action_logs query error: ${error.message}`);
      return { available: false, policyBlocked: 0, finopsBlocked: 0, total: 0, source: 'query_error' };
    }
    for (const row of data || []) {
      const reason = String(row.failure_reason || '').toUpperCase();
      if (reason === 'POLICY_BLOCKED') policyBlocked += 1;
      if (reason === 'FINOPS_BLOCKED') finopsBlocked += 1;
    }
  } catch (err) {
    console.log(`[MONTHLY-BLOCKED] fetch failed: ${err?.message || err}`);
    return { available: false, policyBlocked: 0, finopsBlocked: 0, total: 0, source: 'fetch_error' };
  }

  return { available: true, policyBlocked, finopsBlocked, total: policyBlocked + finopsBlocked, source: 'supabase' };
};

const fetchGateBlockedHistory = () => {
  const gateDir = path.join(ROOT, 'docs', 'planning', 'gate-runs');
  if (!fs.existsSync(gateDir)) return [];

  const files = fs.readdirSync(gateDir).filter((f) => f.endsWith('.json'));
  const breaches = [];
  for (const file of files) {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(gateDir, file), 'utf8'));
      const safetyMetrics = content?.gates?.safety?.metrics || {};
      const policyViolation = Number(safetyMetrics.policy_violation_count ?? 0);
      const privacyBlock = Number(safetyMetrics.privacy_block_count ?? 0);
      if (policyViolation > 0 || privacyBlock > 0) {
        breaches.push({ file, policyViolation, privacyBlock });
      }
    } catch { /* skip malformed */ }
  }
  return breaches;
};

const blocked = await fetchBlockedCounts();
const gateBreaches = fetchGateBlockedHistory();
const totalBlocked = blocked.total + gateBreaches.reduce((sum, b) => sum + b.policyViolation + b.privacyBlock, 0);
const verdict = totalBlocked === 0 ? 'OK' : 'BREACH';

const md = `# Monthly Blocked=0 Status Verification

- generated_at: ${now.toISOString()}
- window_days: ${windowDays}
- guild_id: ${guildId || '*'}
- verdict: ${verdict}

## Action Log Blocked Counts

- source: ${blocked.source}
- policy_blocked: ${blocked.policyBlocked}
- finops_blocked: ${blocked.finopsBlocked}
- total_action_blocked: ${blocked.total}

## Gate Run Safety Breaches

- gate_runs_with_violations: ${gateBreaches.length}
${gateBreaches.map((b) => `  - ${b.file}: policy=${b.policyViolation}, privacy=${b.privacyBlock}`).join('\n') || '  - none'}

## Combined Result

- total_blocked_events: ${totalBlocked}
- status: ${verdict}
${verdict === 'BREACH' ? '- remediation: 최근 blocked 이벤트를 분류하고 정책/FinOps 설정을 재검증한 뒤 다음 monthly 검증에서 0 달성 확인' : '- remediation: not required'}
`;

if (dryRun) {
  console.log('[MONTHLY-BLOCKED] dry-run=true');
  console.log(md);
} else {
  const month = day.slice(0, 7);
  const outputPath = path.join(OUTPUT_DIR, `${month}_monthly-blocked-status.md`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, md, 'utf8');
  console.log(`[MONTHLY-BLOCKED] written: ${path.relative(ROOT, outputPath).replace(/\\/g, '/')}`);
}

console.log(`[MONTHLY-BLOCKED] verdict=${verdict} total_blocked=${totalBlocked}`);

if (verdict !== 'OK') {
  process.exit(1);
}
