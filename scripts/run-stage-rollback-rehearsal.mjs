/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'docs', 'planning', 'gate-runs', 'rollback-rehearsals');

const parseArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
};

const parseBool = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const toRunStamp = (iso) => {
  const cleaned = String(iso || '').replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  const [date, time] = cleaned.split('T');
  return `${date || '00000000'}-${(time || '000000').slice(0, 6)}`;
};

const toMarkdown = (ctx) => {
  const reconnectAccepted = [202, 409].includes(Number(ctx.payload?.reconnectStatus || 0));
  const replayAccepted = [202, 409].includes(Number(ctx.payload?.reconnectReplayStatus || 0));

  return `# Stage Rollback Rehearsal\n\n- generated_at: ${ctx.generatedAt}\n- run_id: ${ctx.runId}\n- api_base: ${ctx.apiBase}\n- max_recovery_minutes: ${ctx.maxRecoveryMinutes}\n- elapsed_ms: ${ctx.elapsedMs}\n- elapsed_minutes: ${ctx.elapsedMinutes}\n- within_recovery_target: ${ctx.withinRecoveryTarget}\n- reconnect_status: ${ctx.payload?.reconnectStatus ?? 'unknown'}\n- reconnect_replay_status: ${ctx.payload?.reconnectReplayStatus ?? 'unknown'}\n- overall: ${ctx.overall}\n\n## Recovery Gate Checks\n\n- elapsed_within_target: ${ctx.withinRecoveryTarget}\n- reconnect_status_accepted(202|409): ${reconnectAccepted}\n- replay_status_accepted(202|409): ${replayAccepted}\n\n## Runtime Snapshot\n\n- before_grade: ${ctx.payload?.beforeGrade ?? 'unknown'}\n- after_grade: ${ctx.payload?.afterGrade ?? 'unknown'}\n- idempotency_key: ${ctx.payload?.idempotencyKey || 'unknown'}\n\n## Notes\n\n- This artifact is generated from \`scripts/rehearse-stage-rollback.mjs\` execution output.\n- Use this as evidence for roadmap item R-017 and runbook section 11.4/11.5 rollback readiness checks.\n`;
};

const parsePayloadFromStdout = (stdout) => {
  const marker = String(stdout || '').indexOf('{');
  if (marker < 0) {
    throw new Error('ROLLBACK_REHEARSAL_OUTPUT_INVALID_JSON');
  }
  return JSON.parse(String(stdout).slice(marker));
};

const executeRehearsal = (apiBase) => {
  const startedAtMs = Date.now();
  const stdout = execFileSync('node', ['scripts/rehearse-stage-rollback.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      API_BASE: apiBase,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const payload = parsePayloadFromStdout(stdout);
  return { elapsedMs, payload };
};

async function main() {
  const generatedAt = new Date().toISOString();
  const runId = `rollback-${toRunStamp(generatedAt)}`;
  const apiBase = String(parseArg('apiBase', process.env.API_BASE || 'http://localhost:3000')).trim();
  const maxRecoveryMinutes = Math.max(1, Number(parseArg('maxRecoveryMinutes', '10')) || 10);
  const dryRun = parseBool(parseArg('dryRun', 'false'));

  const execution = dryRun
    ? {
        elapsedMs: Math.max(1, Math.round(maxRecoveryMinutes * 60 * 1000 * 0.45)),
        payload: {
          timestamp: generatedAt,
          base: apiBase,
          adminUserId: 'dry-run',
          idempotencyKey: 'dry-run',
          statusBefore: 200,
          reconnectStatus: 202,
          reconnectReplayStatus: 409,
          replayHeader: 'true',
          statusAfter: 200,
          beforeGrade: 'ok',
          afterGrade: 'ok',
          reconnectPayload: { accepted: true },
          replayPayload: { replayed: true },
        },
      }
    : executeRehearsal(apiBase);

  const elapsedMinutes = Number((execution.elapsedMs / 60000).toFixed(3));
  const withinRecoveryTarget = execution.elapsedMs <= maxRecoveryMinutes * 60 * 1000;
  const reconnectAccepted = [202, 409].includes(Number(execution.payload?.reconnectStatus || 0));
  const replayAccepted = [202, 409].includes(Number(execution.payload?.reconnectReplayStatus || 0));
  const overall = withinRecoveryTarget && reconnectAccepted && replayAccepted ? 'pass' : 'fail';

  const result = {
    generated_at: generatedAt,
    run_id: runId,
    api_base: apiBase,
    max_recovery_minutes: maxRecoveryMinutes,
    elapsed_ms: execution.elapsedMs,
    elapsed_minutes: elapsedMinutes,
    within_recovery_target: withinRecoveryTarget,
    reconnect_status: execution.payload?.reconnectStatus ?? null,
    reconnect_replay_status: execution.payload?.reconnectReplayStatus ?? null,
    replay_header: execution.payload?.replayHeader ?? null,
    overall,
    dry_run: dryRun,
    payload: execution.payload,
  };

  const markdown = toMarkdown({
    generatedAt,
    runId,
    apiBase,
    maxRecoveryMinutes,
    elapsedMs: execution.elapsedMs,
    elapsedMinutes,
    withinRecoveryTarget,
    payload: execution.payload,
    overall,
  });

  const outputBase = path.join(OUTPUT_DIR, `${generatedAt.slice(0, 10)}_${runId}`);
  const outputJson = `${outputBase}.json`;
  const outputMd = `${outputBase}.md`;

  if (!dryRun) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(outputJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    fs.writeFileSync(outputMd, markdown, 'utf8');
  }

  console.log(`[ROLLBACK-REHEARSAL] ${dryRun ? 'previewed' : 'written'}: ${path.relative(ROOT, outputMd).replace(/\\/g, '/')}`);
  console.log(JSON.stringify(result, null, 2));

  if (overall !== 'pass') {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error('[ROLLBACK-REHEARSAL] FAIL', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
