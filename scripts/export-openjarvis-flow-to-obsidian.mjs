/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SUMMARY_PATH = path.join(ROOT, 'tmp', 'autonomy', 'openjarvis-unattended-last-run.json');

const toTrimmed = (value) => String(value || '').trim();

const sanitizeNodeId = (value) => {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'node';
};

const sanitizeLabel = (value) => {
  return String(value || '')
    .replace(/"/g, "'")
    .replace(/\r?\n/g, ' ')
    .trim();
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    sessionPath: '',
    outDir: 'ops/reports/openjarvis',
    latest: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const current = toTrimmed(args[i]);
    if (current === '--session-path') {
      options.sessionPath = toTrimmed(args[i + 1]);
      options.latest = false;
      i += 1;
      continue;
    }
    if (current === '--out-dir') {
      options.outDir = toTrimmed(args[i + 1]) || options.outDir;
      i += 1;
      continue;
    }
    if (current === '--latest') {
      options.latest = true;
      continue;
    }
  }

  return options;
};

const loadJson = async (targetPath) => {
  const raw = await fs.readFile(targetPath, 'utf8');
  return JSON.parse(raw);
};

const resolveSessionPath = async (options) => {
  if (!options.latest && options.sessionPath) {
    return path.isAbsolute(options.sessionPath)
      ? options.sessionPath
      : path.resolve(ROOT, options.sessionPath);
  }

  const summary = await loadJson(SUMMARY_PATH);
  const relative = toTrimmed(summary?.workflow?.session_path);
  if (!relative) {
    throw new Error('session_path missing in openjarvis-unattended-last-run.json');
  }
  return path.resolve(ROOT, relative);
};

const buildMermaid = (session) => {
  const steps = Array.isArray(session?.steps) ? session.steps : [];
  const lines = ['flowchart TD', '  start([Start])'];

  if (steps.length === 0) {
    lines.push('  endState([No Steps])');
    lines.push('  start --> endState');
    return lines.join('\n');
  }

  const firstNode = `step_${sanitizeNodeId(steps[0]?.step_name || '1')}_1`;
  lines.push(`  start --> ${firstNode}`);

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] || {};
    const node = `step_${sanitizeNodeId(step.step_name || String(i + 1))}_${i + 1}`;
    const status = sanitizeLabel(step.status || 'unknown');
    const role = sanitizeLabel(step.agent_role || 'openjarvis');
    const title = sanitizeLabel(step.step_name || `step-${i + 1}`);
    const duration = Number(step.duration_ms || 0);
    lines.push(`  ${node}["${i + 1}. ${title}\\nrole=${role}\\nstatus=${status}\\n${duration}ms"]`);

    if (i > 0) {
      const prev = `step_${sanitizeNodeId(steps[i - 1]?.step_name || String(i))}_${i}`;
      lines.push(`  ${prev} --> ${node}`);
    }

    if (status === 'failed' || status === 'fail') {
      lines.push(`  style ${node} fill:#fde2e2,stroke:#c1121f,stroke-width:2px`);
    } else if (status === 'passed' || status === 'pass') {
      lines.push(`  style ${node} fill:#e9f7ef,stroke:#2d6a4f,stroke-width:2px`);
    }
  }

  const finalNode = sanitizeNodeId(String(session?.status || 'completed'));
  lines.push(`  done([Workflow: ${sanitizeLabel(session?.status || 'completed')}])`);
  const last = `step_${sanitizeNodeId(steps[steps.length - 1]?.step_name || String(steps.length))}_${steps.length}`;
  lines.push(`  ${last} --> done`);
  lines.push(`  classDef ${finalNode} fill:#f1f5f9,stroke:#334155`);

  return lines.join('\n');
};

const buildMarkdown = (params) => {
  const { session, sessionRelativePath } = params;
  const steps = Array.isArray(session?.steps) ? session.steps : [];
  const events = Array.isArray(session?.events) ? session.events : [];
  const startedAt = toTrimmed(session?.started_at);
  const completedAt = toTrimmed(session?.completed_at);
  const totalDuration = steps.reduce((sum, step) => sum + Number(step?.duration_ms || 0), 0);

  const lines = [
    '---',
    'tags: [openjarvis, autonomy, workflow, operations]',
    `session_id: ${toTrimmed(session?.session_id)}`,
    `workflow_name: ${toTrimmed(session?.workflow_name)}`,
    `status: ${toTrimmed(session?.status)}`,
    `started_at: ${startedAt}`,
    `completed_at: ${completedAt}`,
    '---',
    '',
    `# OpenJarvis Unattended Flow - ${toTrimmed(session?.session_id)}`,
    '',
    `- Workflow: ${toTrimmed(session?.workflow_name)}`,
    `- Scope: ${toTrimmed(session?.scope)}`,
    `- Stage: ${toTrimmed(session?.stage)}`,
    `- Route Mode: ${toTrimmed(session?.metadata?.route_mode)}`,
    `- Dry Run: ${String(Boolean(session?.metadata?.dry_run))}`,
    `- Strict: ${String(Boolean(session?.metadata?.strict))}`,
    `- Total Step Duration(ms): ${totalDuration}`,
    `- Session JSON: ${sessionRelativePath.replace(/\\/g, '/')}`,
    '',
    '## Flow Diagram',
    '',
    '```mermaid',
    buildMermaid(session),
    '```',
    '',
    '## Step Timeline',
    '',
    '| # | Step | Role | Status | Duration(ms) | Script |',
    '|---|---|---|---|---:|---|',
  ];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] || {};
    const script = toTrimmed(step?.details?.script || '');
    lines.push(`| ${i + 1} | ${sanitizeLabel(step?.step_name || '')} | ${sanitizeLabel(step?.agent_role || '')} | ${sanitizeLabel(step?.status || '')} | ${Number(step?.duration_ms || 0)} | ${sanitizeLabel(script)} |`);
  }

  lines.push('');
  lines.push('## Event Trace (Last 12)');
  lines.push('');
  lines.push('| Time | Event | From -> To | Handoff | Reason |');
  lines.push('|---|---|---|---|---|');

  const lastEvents = events.slice(-12);
  for (const event of lastEvents) {
    const when = sanitizeLabel(event?.created_at || '');
    const eventType = sanitizeLabel(event?.event_type || '');
    const state = `${sanitizeLabel(event?.from_state || '-') } -> ${sanitizeLabel(event?.to_state || '-')}`;
    const handoff = `${sanitizeLabel(event?.handoff_from || '-') } -> ${sanitizeLabel(event?.handoff_to || '-')}`;
    const reason = sanitizeLabel(event?.decision_reason || '');
    lines.push(`| ${when} | ${eventType} | ${state} | ${handoff} | ${reason} |`);
  }

  lines.push('');
  lines.push('## Operator Note');
  lines.push('');
  lines.push('- 이 노트는 scripts/export-openjarvis-flow-to-obsidian.mjs로 생성되었습니다.');
  lines.push('- 다음 실행 시 최신 세션 기준으로 다시 생성할 수 있습니다.');

  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const options = parseArgs();
  const vaultRoot = toTrimmed(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH);
  if (!vaultRoot) {
    throw new Error('Missing OBSIDIAN_SYNC_VAULT_PATH or OBSIDIAN_VAULT_PATH');
  }

  const sessionAbsolutePath = await resolveSessionPath(options);
  const session = await loadJson(sessionAbsolutePath);
  const sessionRelativePath = path.relative(ROOT, sessionAbsolutePath);
  const outDirAbs = path.resolve(vaultRoot, options.outDir);
  await fs.mkdir(outDirAbs, { recursive: true });

  const safeSessionId = sanitizeNodeId(session?.session_id || `openjarvis-${Date.now()}`);
  const noteName = `${safeSessionId}.md`;
  const notePathAbs = path.join(outDirAbs, noteName);
  const content = buildMarkdown({ session, sessionRelativePath });

  await fs.writeFile(notePathAbs, content, 'utf8');

  const latestPathAbs = path.join(outDirAbs, 'LATEST.md');
  const latestContent = [
    '# OpenJarvis Latest Flow',
    '',
    `- updated_at: ${new Date().toISOString()}`,
    `- latest_note: [[${noteName.replace(/\.md$/i, '')}]]`,
    '',
    '아래 링크에서 최신 워크플로우 흐름을 확인하세요.',
  ].join('\n');
  await fs.writeFile(latestPathAbs, `${latestContent}\n`, 'utf8');

  console.log('[obsidian-flow] export complete');
  console.log(`[obsidian-flow] vault=${vaultRoot}`);
  console.log(`[obsidian-flow] note=${notePathAbs}`);
  console.log(`[obsidian-flow] latest=${latestPathAbs}`);
};

main().catch((error) => {
  console.error(`[obsidian-flow] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
