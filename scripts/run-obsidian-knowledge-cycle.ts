/* eslint-disable no-console */
import 'dotenv/config';
import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const STEP_TIMEOUT_SEC = Math.max(30, Number(process.env.OBSIDIAN_OPS_STEP_TIMEOUT_SEC || 900));

type Step = {
  name: string;
  script: string;
  args?: string[];
};

const parseArgs = (): { guildId: string; skipSync: boolean } => {
  const args = process.argv.slice(2);
  let guildId = String(process.env.OBSIDIAN_VERIFY_GUILD_ID || '').trim();
  let skipSync = false;

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();
    if (current === '--guild' || current === '--guild-id') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        guildId = value;
      }
      i += 1;
      continue;
    }

    if (current === '--skip-sync') {
      skipSync = true;
    }
  }

  return { guildId, skipSync };
};

const runNpmStep = async (step: Step): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const args = ['run', step.script];
    if (step.args && step.args.length > 0) {
      args.push('--', ...step.args);
    }

    const child = spawn(npmCommand, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${step.name} timeout (${STEP_TIMEOUT_SEC}s)`));
    }, STEP_TIMEOUT_SEC * 1000);

    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${step.name} failed (exit=${String(code)})`));
    });
  });
};

const main = async (): Promise<void> => {
  const { guildId, skipSync } = parseArgs();
  if (!guildId) {
    console.error('[obsidian-cycle] guild id is required. Use --guild or OBSIDIAN_VERIFY_GUILD_ID');
    process.exit(2);
  }

  const steps: Step[] = [
    {
      name: 'verify-write',
      script: 'obsidian:verify-write',
      args: ['--guild', guildId],
    },
    {
      name: 'graph-audit',
      script: 'obsidian:audit-graph',
    },
  ];

  if (!skipSync) {
    steps.push({
      name: 'sync-obsidian-lore',
      script: 'sync:obsidian-lore',
    });
  }

  console.log(`[obsidian-cycle] start steps=${steps.map((s) => s.name).join(',')}`);
  for (const step of steps) {
    console.log(`[obsidian-cycle] running=${step.name}`);
    await runNpmStep(step);
  }

  console.log('[obsidian-cycle] completed');
};

main().catch((error) => {
  console.error('[obsidian-cycle] error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
