/* eslint-disable no-console */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

type LoopOptions = {
  guildIds: string[];
  allGuilds: boolean;
  vaultPath: string;
  intervalSec: number;
  maxRuns: number | null;
  skipSync: boolean;
  timeoutSec: number;
  retryCount: number;
  maxFailureRate: number;
};

const LOOP_LOCK_PATH = path.resolve(process.cwd(), '.runtime', 'obsidian-ops-loop.lock');

const parsePositiveInt = (value: string | undefined, fallback: number, min = 1): number => {
  const parsed = Number(value || '');
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.floor(parsed));
};

const parseRate = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value || '');
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const toGuildIdSet = (input: string[]): string[] => {
  return [...new Set(
    input
      .map((item) => String(item || '').trim())
      .filter((item) => /^\d{6,30}$/.test(item)),
  )];
};

const parseArgs = (): LoopOptions => {
  const args = process.argv.slice(2);

  const guildIds: string[] = [];
  const envGuildIds = String(process.env.OBSIDIAN_VERIFY_GUILD_ID || '').trim();
  if (envGuildIds) {
    guildIds.push(...envGuildIds.split(',').map((item) => item.trim()).filter(Boolean));
  }

  let allGuilds = ['1', 'true', 'yes', 'on'].includes(String(process.env.OBSIDIAN_OPS_ALL_GUILDS || '').trim().toLowerCase());
  let vaultPath = String(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();
  let intervalSec = parsePositiveInt(process.env.OBSIDIAN_OPS_LOOP_INTERVAL_SEC, 300, 30);
  let maxRuns: number | null = null;
  let skipSync = false;
  let timeoutSec = parsePositiveInt(process.env.OBSIDIAN_OPS_STEP_TIMEOUT_SEC, 900, 30);
  let retryCount = parsePositiveInt(process.env.OBSIDIAN_OPS_RETRY_COUNT, 1, 0);
  let maxFailureRate = parseRate(process.env.OBSIDIAN_OPS_MAX_FAILURE_RATE, 0.4);

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();

    if (current === '--guild' || current === '--guild-id') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        guildIds.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
      }
      i += 1;
      continue;
    }

    if (current === '--all-guilds') {
      allGuilds = true;
      continue;
    }

    if (current === '--vault' || current === '--vault-path') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        vaultPath = value;
      }
      i += 1;
      continue;
    }

    if (current === '--interval-sec') {
      const value = Number(args[i + 1] || '');
      if (Number.isFinite(value) && value >= 30) {
        intervalSec = Math.floor(value);
      }
      i += 1;
      continue;
    }

    if (current === '--max-runs') {
      const value = Number(args[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        maxRuns = Math.floor(value);
      }
      i += 1;
      continue;
    }

    if (current === '--skip-sync') {
      skipSync = true;
      continue;
    }

    if (current === '--timeout-sec') {
      const value = Number(args[i + 1] || '');
      if (Number.isFinite(value) && value >= 30) {
        timeoutSec = Math.floor(value);
      }
      i += 1;
      continue;
    }

    if (current === '--retry-count') {
      const value = Number(args[i + 1] || '');
      if (Number.isFinite(value) && value >= 0) {
        retryCount = Math.floor(value);
      }
      i += 1;
      continue;
    }

    if (current === '--max-failure-rate') {
      const value = Number(args[i + 1] || '');
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        maxFailureRate = value;
      }
      i += 1;
    }
  }

  return {
    guildIds: toGuildIdSet(guildIds),
    allGuilds,
    vaultPath,
    intervalSec,
    maxRuns,
    skipSync,
    timeoutSec,
    retryCount,
    maxFailureRate,
  };
};

const discoverGuildIdsFromVault = async (vaultPath: string): Promise<string[]> => {
  const resolvedVault = path.resolve(vaultPath);
  const guildsRoot = path.join(resolvedVault, 'guilds');

  let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
  try {
    entries = await fs.readdir(guildsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return toGuildIdSet(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
};

const runOpsCycleOnce = async (params: { guildId: string; skipSync: boolean; timeoutSec: number }): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const args = ['run', 'obsidian:ops-cycle', '--', '--guild', params.guildId];
    if (params.skipSync) {
      args.push('--skip-sync');
    }

    const child = spawn(npmCommand, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`ops-cycle timeout (${params.timeoutSec}s)`));
    }, params.timeoutSec * 1000);

    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ops-cycle failed (exit=${String(code)})`));
    });
  });
};

const acquireLock = async (): Promise<void> => {
  await fs.mkdir(path.dirname(LOOP_LOCK_PATH), { recursive: true });
  try {
    await fs.writeFile(LOOP_LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch {
    throw new Error(`LOCK_ALREADY_HELD:${LOOP_LOCK_PATH}`);
  }
};

const releaseLock = async (): Promise<void> => {
  try {
    await fs.unlink(LOOP_LOCK_PATH);
  } catch {
    // no-op
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs();

  if (!options.allGuilds && options.guildIds.length === 0) {
    console.error('[obsidian-loop] guild id is required. Use --guild or OBSIDIAN_VERIFY_GUILD_ID, or pass --all-guilds');
    process.exit(2);
  }

  if (options.allGuilds && !options.vaultPath) {
    console.error('[obsidian-loop] vault path is required for --all-guilds. Use --vault or OBSIDIAN_SYNC_VAULT_PATH/OBSIDIAN_VAULT_PATH');
    process.exit(2);
  }

  await acquireLock();

  let stopping = false;
  const handleStop = () => {
    stopping = true;
  };
  process.on('SIGINT', handleStop);
  process.on('SIGTERM', handleStop);

  console.log(
    `[obsidian-loop] start mode=${options.allGuilds ? 'all-guilds' : 'fixed-guilds'} guilds=${options.guildIds.join(',') || 'discover'} intervalSec=${options.intervalSec} maxRuns=${options.maxRuns ?? 'infinite'} skipSync=${String(options.skipSync)} timeoutSec=${options.timeoutSec} retryCount=${options.retryCount} maxFailureRate=${options.maxFailureRate}`,
  );

  let runCount = 0;
  let successCount = 0;
  let failedCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (stopping) {
      break;
    }

    runCount += 1;
    const startedAt = Date.now();
    console.log(`[obsidian-loop] run=${runCount} startedAt=${new Date(startedAt).toISOString()}`);

    const guildIds = options.allGuilds
      ? await discoverGuildIdsFromVault(options.vaultPath)
      : options.guildIds;

    if (guildIds.length === 0) {
      console.warn('[obsidian-loop] no guilds resolved for this run, waiting for next interval');
      if (options.maxRuns && runCount >= options.maxRuns) {
        break;
      }
      await sleep(options.intervalSec * 1000);
      continue;
    }

    console.log(`[obsidian-loop] run=${runCount} targets=${guildIds.join(',')}`);

    for (const guildId of guildIds) {
      let success = false;
      let attempt = 0;
      while (!success && attempt <= options.retryCount) {
        attempt += 1;
        try {
          await runOpsCycleOnce({
            guildId,
            skipSync: options.skipSync,
            timeoutSec: options.timeoutSec,
          });
          success = true;
        } catch (error) {
          console.error(
            `[obsidian-loop] run=${runCount} guild=${guildId} attempt=${attempt} failed:`,
            error instanceof Error ? error.message : String(error),
          );
          if (attempt > options.retryCount) {
            break;
          }
          await sleep(2000);
        }
      }

      if (success) {
        successCount += 1;
      } else {
        failedCount += 1;
      }

      const failureRate = (successCount + failedCount) > 0 ? failedCount / (successCount + failedCount) : 0;
      if (failureRate > options.maxFailureRate) {
        console.error(`[obsidian-loop] failure rate exceeded threshold (${failureRate.toFixed(3)} > ${options.maxFailureRate})`);
        stopping = true;
        break;
      }
    }

    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[obsidian-loop] run=${runCount} completed durationSec=${durationSec}`);

    if (options.maxRuns && runCount >= options.maxRuns) {
      break;
    }

    await sleep(options.intervalSec * 1000);
  }

  const totalAttempts = successCount + failedCount;
  const finalFailureRate = totalAttempts > 0 ? failedCount / totalAttempts : 0;
  console.log(`[obsidian-loop] completed runs=${runCount} success=${successCount} failed=${failedCount} failureRate=${finalFailureRate.toFixed(3)}`);

  await releaseLock();

  if (finalFailureRate > options.maxFailureRate) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('[obsidian-loop] unexpected error:', error instanceof Error ? error.message : String(error));
  void releaseLock();
  process.exit(1);
});
