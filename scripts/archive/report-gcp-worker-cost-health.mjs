/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const read = (key, fallback = '') => {
  const value = String(process.env[key] || '').trim();
  return value || fallback;
};

const getArg = (name, fallback = '') => {
  const key = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(key));
  if (!found) {
    return fallback;
  }
  return found.slice(key.length).trim();
};

const resolveGcloudBin = () => {
  const explicit = read('GCP_GCLOUD_BIN', '');
  if (explicit) {
    return explicit;
  }

  const windowsDefault = 'C:/Users/fancy/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd';
  if (process.platform === 'win32' && fs.existsSync(windowsDefault)) {
    return windowsDefault;
  }

  return 'gcloud';
};

const gcloudBin = resolveGcloudBin();

const quoteArg = (value) => {
  const escaped = String(value).replace(/"/g, '\\"');
  return `"${escaped}"`;
};

const run = (command, args, options = {}) => {
  const allowFail = Boolean(options.allowFail);
  const commandLine = `${quoteArg(command)} ${args.map((arg) => quoteArg(arg)).join(' ')}`;
  try {
    const stdout = execSync(commandLine, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    return { ok: true, stdout: String(stdout || '').trim(), stderr: '' };
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || '').trim();
    if (allowFail) {
      return { ok: false, stdout: '', stderr };
    }
    throw new Error(stderr || `${command} failed`);
  }
};

const parseJson = (raw, fallback) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const compactError = (raw) => {
  const text = String(raw || '').trim();
  if (!text) {
    return 'unknown error';
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, 2).join(' | ');
};

const timedFetch = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const toMachineType = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const parts = raw.split('/');
  return parts[parts.length - 1] || raw;
};

const getProjectId = () => {
  const explicit = getArg(
    'project-id',
    read('GCP_PROJECT_ID', read('GOOGLE_CLOUD_PROJECT', 'gen-lang-client-0405212361')),
  );
  if (explicit) {
    return explicit;
  }
  const result = run(gcloudBin, ['config', 'get-value', 'project'], { allowFail: true });
  if (!result.ok) {
    return '';
  }
  const value = String(result.stdout || '').trim();
  if (!value || value === '(unset)') {
    return '';
  }
  return value;
};

const formatMarkdown = (report) => {
  const lines = [];
  lines.push('# GCP Worker Cost/Health Report');
  lines.push('');
  lines.push(`- checkedAt: ${report.checkedAt}`);
  lines.push(`- period: ${report.period}`);
  lines.push(`- ok: ${report.ok}`);
  lines.push(`- projectId: ${report.projectId || 'unknown'}`);
  lines.push('');
  lines.push('## Worker');
  lines.push(`- instance: ${report.worker.instanceName}`);
  lines.push(`- zone: ${report.worker.zone}`);
  lines.push(`- status: ${report.worker.status || 'unknown'}`);
  lines.push(`- machineType: ${report.worker.machineType || 'unknown'}`);
  lines.push(`- bootDiskGb: ${report.worker.bootDiskGb ?? 'unknown'}`);
  lines.push('');
  lines.push('## Endpoint');
  lines.push(`- url: ${report.endpoint.url || 'unset'}`);
  lines.push(`- healthOk: ${report.endpoint.ok}`);
  lines.push(`- statusCode: ${report.endpoint.status}`);
  lines.push('');
  lines.push('## Static IP');
  lines.push(`- addressName: ${report.staticIp.name || 'unknown'}`);
  lines.push(`- address: ${report.staticIp.address || 'unknown'}`);
  lines.push(`- status: ${report.staticIp.status || 'unknown'}`);
  lines.push('');
  lines.push('## Budget');
  lines.push(`- billingAccount: ${report.budget.billingAccount || 'unknown'}`);
  lines.push(`- foundDisplayName: ${report.budget.foundDisplayName || 'not-found'}`);
  lines.push(`- expectedDisplayName: ${report.budget.expectedDisplayName}`);
  lines.push('');
  if (report.failures.length > 0) {
    lines.push('## Failures');
    for (const item of report.failures) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  if (report.warnings.length > 0) {
    lines.push('## Warnings');
    for (const item of report.warnings) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  lines.push('## Notes');
  lines.push('- If static IP is kept for endpoint stability, expect small recurring IP cost.');
  lines.push('- Worker runs on e2-small (2GB). Keep disk around 30GB baseline where possible.');
  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const period = getArg('period', 'weekly').toLowerCase() === 'monthly' ? 'monthly' : 'weekly';
  const timeoutMs = Math.max(1000, Number(getArg('timeout-ms', read('GCP_WORKER_HEALTH_TIMEOUT_MS', '5000'))) || 5000);

  const projectId = getProjectId();
  const instanceName = getArg('instance', read('GCP_WORKER_INSTANCE_NAME', 'instance-20260319-223412'));
  const zone = getArg('zone', read('GCP_WORKER_ZONE', 'us-central1-c'));
  const staticIpName = getArg('static-ip-name', read('GCP_WORKER_STATIC_IP_NAME', 'opencode-worker-ip'));
  const workerUrl = getArg('worker-url', read('MCP_OPENCODE_WORKER_URL', ''));
  const budgetDisplayName = getArg('budget-display-name', read('GCP_BUDGET_DISPLAY_NAME', 'muel-worker-monthly-budget'));

  const failures = [];
  const warnings = [];

  const report = {
    checkedAt: new Date().toISOString(),
    period,
    ok: false,
    projectId,
    worker: {
      instanceName,
      zone,
      status: '',
      machineType: '',
      bootDiskGb: null,
    },
    endpoint: {
      url: workerUrl,
      ok: false,
      status: 0,
      error: '',
    },
    staticIp: {
      name: staticIpName,
      address: '',
      status: '',
    },
    budget: {
      billingAccount: '',
      expectedDisplayName: budgetDisplayName,
      foundDisplayName: '',
    },
    failures,
    warnings,
  };

  if (!projectId) {
    warnings.push('GCP project is not set in gcloud config and GCP_PROJECT_ID is empty.');
  }

  if (workerUrl) {
    const healthTargets = [workerUrl, `${workerUrl.replace(/\/+$/, '')}/health`];
    for (const target of healthTargets) {
      const response = await timedFetch(target, timeoutMs);
      if (response.ok) {
        report.endpoint.ok = true;
        report.endpoint.status = response.status;
        break;
      }
      report.endpoint.status = response.status;
      report.endpoint.error = response.error || response.body || '';
    }
    if (!report.endpoint.ok) {
      failures.push('Remote worker endpoint health probe failed (base URL and /health).');
    }
  } else {
    failures.push('MCP_OPENCODE_WORKER_URL is empty; remote worker endpoint is not configured.');
  }

  if (projectId) {
    const instanceArgs = [
      'compute',
      'instances',
      'describe',
      instanceName,
      '--project',
      projectId,
      '--zone',
      zone,
      '--format=json',
    ];
    const instanceRaw = run(gcloudBin, instanceArgs, { allowFail: true });
    if (!instanceRaw.ok) {
      failures.push(`Failed to read worker instance metadata: ${instanceRaw.stderr}`);
    } else {
      const payload = parseJson(instanceRaw.stdout, {});
      report.worker.status = String(payload?.status || '');
      report.worker.machineType = toMachineType(payload?.machineType);
      const disks = Array.isArray(payload?.disks) ? payload.disks : [];
      const boot = disks.find((item) => item?.boot) || disks[0] || null;
      report.worker.bootDiskGb = Number(boot?.diskSizeGb || 0) || null;

      if (report.worker.status !== 'RUNNING') {
        failures.push(`Worker instance is not RUNNING (current: ${report.worker.status || 'unknown'}).`);
      }
      if (report.worker.machineType && report.worker.machineType !== 'e2-small') {
        warnings.push(`Machine type is ${report.worker.machineType}; expected e2-small (2GB) as of 2026-04-05.`);
      }
      if (report.worker.bootDiskGb && report.worker.bootDiskGb > 30) {
        warnings.push(`Boot disk is ${report.worker.bootDiskGb}GB; free-tier baseline for standard persistent disk is about 30GB.`);
      }
    }

    const addressArgs = [
      'compute',
      'addresses',
      'list',
      '--project',
      projectId,
      '--filter',
      `name=('${staticIpName}')`,
      '--format=json',
    ];
    const addressRaw = run(gcloudBin, addressArgs, { allowFail: true });
    if (addressRaw.ok) {
      const rows = parseJson(addressRaw.stdout, []);
      const first = Array.isArray(rows) ? rows[0] : null;
      report.staticIp.address = String(first?.address || '');
      report.staticIp.status = String(first?.status || '');
      if (report.staticIp.status === 'IN_USE') {
        warnings.push('Static external IP is IN_USE; this improves stability but may incur small recurring cost.');
      }
    } else {
      warnings.push(`Unable to inspect static IP status: ${compactError(addressRaw.stderr)}`);
    }

    const billingAccounts = run(gcloudBin, ['billing', 'accounts', 'list', '--format=json'], { allowFail: true });
    if (billingAccounts.ok) {
      const rows = parseJson(billingAccounts.stdout, []);
      const open = Array.isArray(rows)
        ? rows.find((item) => String(item?.open).toLowerCase() === 'true' || item?.open === true)
        : null;
      const accountId = String(open?.name || '').replace(/^billingAccounts\//, '');
      report.budget.billingAccount = accountId;

      if (accountId) {
        const budgets = run(gcloudBin, [
          'beta',
          'billing',
          'budgets',
          'list',
          '--billing-account',
          accountId,
          '--format=json',
        ], { allowFail: true });

        if (budgets.ok) {
          const items = parseJson(budgets.stdout, []);
          const found = Array.isArray(items)
            ? items.find((item) => String(item?.displayName || '').trim() === budgetDisplayName)
            : null;
          if (found) {
            report.budget.foundDisplayName = String(found.displayName || '');
          } else {
            warnings.push(`Budget '${budgetDisplayName}' was not found. Run budget setup script to add monthly alerts.`);
          }
        } else {
          warnings.push(`Unable to list budgets via gcloud beta: ${compactError(budgets.stderr)}`);
        }
      } else {
        warnings.push('No open billing account detected; budget status check skipped.');
      }
    } else {
      warnings.push(`Unable to list billing accounts: ${compactError(billingAccounts.stderr)}`);
    }
  }

  report.ok = failures.length === 0;

  const outPath = period === 'monthly'
    ? path.resolve('docs/planning/gate-runs/MONTHLY_GCP_WORKER_COST_HEALTH.md')
    : path.resolve('docs/planning/gate-runs/WEEKLY_GCP_WORKER_COST_HEALTH.md');

  const markdown = formatMarkdown(report);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown, 'utf8');

  console.log(JSON.stringify({
    ...report,
    output: path.relative(process.cwd(), outPath).replace(/\\/g, '/'),
  }, null, 2));

  process.exitCode = report.ok ? 0 : 1;
};

main().catch((error) => {
  console.error('[gcp-worker-cost-health] FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
