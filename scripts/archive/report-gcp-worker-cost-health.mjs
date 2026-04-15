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

const loadOperatingBaseline = () => {
  const manifestPath = path.resolve('config/runtime/operating-baseline.json');
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      manifestPath,
      data: parsed,
    };
  } catch {
    return null;
  }
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

const lastPathSegment = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const parts = raw.split('/').filter(Boolean);
  return parts[parts.length - 1] || raw;
};

const getUrlHost = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const isSslipHost = (value) => String(value || '').trim().toLowerCase().endsWith('.sslip.io');

const parseBooleanLike = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return null;
};

const readMetadataValue = (items, key) => {
  if (!Array.isArray(items)) {
    return '';
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (String(item?.key || '').trim() === key) {
      return String(item?.value || '').trim();
    }
  }
  return '';
};

const joinHealthUrl = (baseUrl, healthPath) => {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const suffix = `/${String(healthPath || '/health').trim().replace(/^\/+/, '')}`;
  if (!base) {
    return '';
  }
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
};

const probeService = async (id, config, timeoutMs) => {
  const url = String(config?.url || '').trim();
  const directUrl = String(config?.directUrl || '').trim();
  const healthPath = String(config?.healthPath || '/health').trim() || '/health';
  const targets = [...new Set([
    joinHealthUrl(url, healthPath),
    joinHealthUrl(directUrl, healthPath),
    url,
    directUrl,
  ].filter(Boolean))];

  const result = {
    id,
    url,
    directUrl,
    healthPath,
    checkedUrl: '',
    ok: false,
    status: 0,
    error: '',
  };

  for (const target of targets) {
    const response = await timedFetch(target, timeoutMs);
    result.checkedUrl = target;
    result.status = response.status;
    if (response.ok) {
      result.ok = true;
      result.error = '';
      break;
    }
    result.error = response.error || response.body || '';
  }

  return result;
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
  const expectedMachineType = report.baseline.machineType || 'e2-medium';
  const expectedMemoryGb = report.baseline.memoryGb || 4;
  const formatFlag = (value) => {
    if (value === true) {
      return 'true';
    }
    if (value === false) {
      return 'false';
    }
    return 'unknown';
  };
  const formatUrlValue = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed === 'unset' || trimmed === 'unknown') {
      return trimmed || 'unset';
    }
    return /^https?:\/\//i.test(trimmed) ? `<${trimmed}>` : trimmed;
  };
  const formatInlineValue = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed === 'unknown') {
      return trimmed || 'unknown';
    }
    return `\`${trimmed}\``;
  };
  const lines = [];
  lines.push('# GCP Worker Cost/Health Report');
  lines.push('');
  lines.push(`- checkedAt: ${report.checkedAt}`);
  lines.push(`- period: ${report.period}`);
  lines.push(`- ok: ${report.ok}`);
  lines.push(`- projectId: ${report.projectId || 'unknown'}`);
  lines.push('');
  lines.push('## Worker');
  lines.push('');
  lines.push(`- instance: ${report.worker.instanceName}`);
  lines.push(`- zone: ${report.worker.zone}`);
  lines.push(`- status: ${report.worker.status || 'unknown'}`);
  lines.push(`- machineType: ${report.worker.machineType || 'unknown'}`);
  lines.push(`- bootDiskGb: ${report.worker.bootDiskGb ?? 'unknown'}`);
  lines.push('');
  lines.push('## Endpoint');
  lines.push('');
  lines.push(`- url: ${formatUrlValue(report.endpoint.url || 'unset')}`);
  lines.push(`- healthOk: ${report.endpoint.ok}`);
  lines.push(`- statusCode: ${report.endpoint.status}`);
  lines.push('');
  if (Array.isArray(report.serviceChecks) && report.serviceChecks.length > 0) {
    lines.push('## Always-On Services');
    lines.push('');
    for (const item of report.serviceChecks) {
      lines.push(`- ${item.id}: ok=${item.ok} status=${item.status} checkedUrl=${formatUrlValue(item.checkedUrl || item.url || 'unset')}`);
    }
    lines.push('');
  }
  lines.push('## Static IP');
  lines.push('');
  lines.push(`- addressName: ${report.staticIp.name || 'unknown'}`);
  lines.push(`- address: ${report.staticIp.address || 'unknown'}`);
  lines.push(`- status: ${report.staticIp.status || 'unknown'}`);
  lines.push('');
  lines.push('## Budget');
  lines.push('');
  lines.push(`- billingAccount: ${report.budget.billingAccount || 'unknown'}`);
  lines.push(`- foundDisplayName: ${report.budget.foundDisplayName || 'not-found'}`);
  lines.push(`- expectedDisplayName: ${report.budget.expectedDisplayName}`);
  lines.push('');
  lines.push('## GCP-Native Hardening');
  lines.push('');
  lines.push(`- ingressMode: ${report.hardening.ingressMode || 'unknown'}`);
  lines.push(`- customDomainConfigured: ${formatFlag(report.hardening.customDomainConfigured)}`);
  lines.push(`- automaticRestart: ${formatFlag(report.hardening.automaticRestart)}`);
  lines.push(`- osLoginEnabled: ${formatFlag(report.hardening.osLoginEnabled)}`);
  lines.push(`- shieldedVm: secureBoot=${formatFlag(report.hardening.shieldedVm.secureBoot)} vTpm=${formatFlag(report.hardening.shieldedVm.vTpm)} integrityMonitoring=${formatFlag(report.hardening.shieldedVm.integrityMonitoring)}`);
  lines.push(`- bootDiskSnapshotPolicies: ${report.hardening.bootDiskSnapshotPolicies.length > 0 ? report.hardening.bootDiskSnapshotPolicies.join(', ') : 'none'}`);
  lines.push(`- serviceAccount: ${formatInlineValue(report.hardening.serviceAccountEmail || 'unknown')} dedicated=${formatFlag(report.hardening.dedicatedServiceAccount)} cloudPlatformScope=${formatFlag(report.hardening.cloudPlatformScope)}`);
  lines.push('');
  if (report.failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const item of report.failures) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  if (report.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const item of report.warnings) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  lines.push('## Notes');
  lines.push('');
  lines.push(`- Baseline manifest: ${report.baseline.manifestPath || 'config/runtime/operating-baseline.json'}`);
  lines.push('- If static IP is kept for endpoint stability, expect small recurring IP cost.');
  lines.push(`- Worker baseline is ${expectedMachineType} (${expectedMemoryGb}GB). Keep disk around ${report.baseline.bootDiskGb || 30}GB where possible.`);
  lines.push('- Treat custom domain, snapshot schedule, OS Login, Shielded VM, and least-privilege service accounts as the current GCP hardening backlog on this worker lane.');
  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const operatingBaseline = loadOperatingBaseline();
  const baselineData = operatingBaseline?.data || {};
  const baselineGcp = baselineData.gcpWorker || {};
  const baselineServices = baselineData.services || {};
  const period = getArg('period', 'weekly').toLowerCase() === 'monthly' ? 'monthly' : 'weekly';
  const timeoutMs = Math.max(1000, Number(getArg('timeout-ms', read('GCP_WORKER_HEALTH_TIMEOUT_MS', '5000'))) || 5000);

  const projectId = getArg('project-id', baselineGcp.projectId || read('GCP_PROJECT_ID', read('GOOGLE_CLOUD_PROJECT', getProjectId())));
  const instanceName = getArg('instance', baselineGcp.instanceName || read('GCP_WORKER_INSTANCE_NAME', 'instance-20260319-223412'));
  const zone = getArg('zone', baselineGcp.zone || read('GCP_WORKER_ZONE', 'us-central1-c'));
  const staticIpName = getArg('static-ip-name', baselineGcp.staticIpName || read('GCP_WORKER_STATIC_IP_NAME', 'opencode-worker-ip'));
  const workerUrl = getArg(
    'worker-url',
    baselineServices.implementWorker?.url
      || baselineServices.implementWorker?.publicBaseUrl
      || baselineGcp.publicBaseUrl
      || read('MCP_IMPLEMENT_WORKER_URL', read('MCP_OPENCODE_WORKER_URL', '')),
  );
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
    hardening: {
      ingressMode: '',
      customDomainConfigured: null,
      automaticRestart: null,
      osLoginEnabled: null,
      shieldedVm: {
        secureBoot: null,
        vTpm: null,
        integrityMonitoring: null,
      },
      bootDiskSnapshotPolicies: [],
      serviceAccountEmail: '',
      dedicatedServiceAccount: null,
      cloudPlatformScope: null,
    },
    serviceChecks: [],
    baseline: {
      manifestPath: operatingBaseline?.manifestPath || '',
      machineType: String(baselineGcp.machineType || ''),
      memoryGb: Number(baselineGcp.memoryGb || 0) || null,
      bootDiskGb: Number(baselineGcp.bootDiskGb || 0) || null,
    },
    failures,
    warnings,
  };

  if (!projectId) {
    warnings.push('GCP project is not set in gcloud config and GCP_PROJECT_ID is empty.');
  }

  const alwaysOnServiceIds = Array.isArray(baselineData?.lanes?.alwaysOnRequired) && baselineData.lanes.alwaysOnRequired.length > 0
    ? baselineData.lanes.alwaysOnRequired
    : ['implementWorker'];

  for (const serviceId of alwaysOnServiceIds) {
    const serviceConfig = baselineServices[serviceId];
    if (!serviceConfig || typeof serviceConfig !== 'object') {
      warnings.push(`Operating baseline is missing service config for '${serviceId}'.`);
      continue;
    }
    const serviceCheck = await probeService(serviceId, serviceConfig, timeoutMs);
    report.serviceChecks.push(serviceCheck);
    if (!serviceCheck.ok) {
      failures.push(`Always-on service '${serviceId}' health probe failed.`);
    }
  }

  const implementCheck = report.serviceChecks.find((item) => item.id === 'implementWorker');
  if (implementCheck) {
    report.endpoint.url = implementCheck.url || workerUrl;
    report.endpoint.ok = implementCheck.ok;
    report.endpoint.status = implementCheck.status;
    report.endpoint.error = implementCheck.error;
  } else if (!workerUrl) {
    failures.push('MCP_IMPLEMENT_WORKER_URL is empty; remote worker endpoint is not configured (legacy alias MCP_OPENCODE_WORKER_URL is also accepted).');
  }

  const ingressHost = getUrlHost(report.endpoint.url || workerUrl || baselineGcp.publicBaseUrl);
  if (ingressHost) {
    report.hardening.ingressMode = isSslipHost(ingressHost) ? 'temporary-sslip' : 'custom-domain';
    report.hardening.customDomainConfigured = !isSslipHost(ingressHost);
    if (report.hardening.customDomainConfigured === false) {
      warnings.push('Worker ingress still uses sslip.io; move to a custom domain before broader rollout.');
    }
  }

  if (projectId) {
    let projectMetadataItems = [];
    const projectInfoRaw = run(gcloudBin, ['compute', 'project-info', 'describe', '--project', projectId, '--format=json'], { allowFail: true });
    if (projectInfoRaw.ok) {
      const payload = parseJson(projectInfoRaw.stdout, {});
      projectMetadataItems = Array.isArray(payload?.commonInstanceMetadata?.items)
        ? payload.commonInstanceMetadata.items
        : [];
    }

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
      const bootDiskName = lastPathSegment(boot?.source);
      report.worker.bootDiskGb = Number(boot?.diskSizeGb || 0) || null;

      report.hardening.automaticRestart = typeof payload?.scheduling?.automaticRestart === 'boolean'
        ? payload.scheduling.automaticRestart
        : null;
      if (report.hardening.automaticRestart === false) {
        warnings.push('Compute Engine automaticRestart is disabled; unexpected maintenance can leave the worker offline.');
      }

      const instanceMetadataItems = Array.isArray(payload?.metadata?.items) ? payload.metadata.items : [];
      const osLoginValue = readMetadataValue([...projectMetadataItems, ...instanceMetadataItems], 'enable-oslogin');
      report.hardening.osLoginEnabled = parseBooleanLike(osLoginValue);
      if (report.hardening.osLoginEnabled !== true) {
        warnings.push('OS Login is not explicitly enabled for the worker; prefer IAM-backed SSH over per-box account drift.');
      }

      report.hardening.shieldedVm = {
        secureBoot: typeof payload?.shieldedInstanceConfig?.enableSecureBoot === 'boolean'
          ? payload.shieldedInstanceConfig.enableSecureBoot
          : null,
        vTpm: typeof payload?.shieldedInstanceConfig?.enableVtpm === 'boolean'
          ? payload.shieldedInstanceConfig.enableVtpm
          : null,
        integrityMonitoring: typeof payload?.shieldedInstanceConfig?.enableIntegrityMonitoring === 'boolean'
          ? payload.shieldedInstanceConfig.enableIntegrityMonitoring
          : null,
      };
      if (
        report.hardening.shieldedVm.secureBoot === false
        || report.hardening.shieldedVm.vTpm === false
        || report.hardening.shieldedVm.integrityMonitoring === false
      ) {
        warnings.push('Shielded VM protections are not fully enabled; review secure boot, vTPM, and integrity monitoring.');
      }

      const primaryServiceAccount = Array.isArray(payload?.serviceAccounts) ? payload.serviceAccounts[0] : null;
      report.hardening.serviceAccountEmail = String(primaryServiceAccount?.email || '');
      if (report.hardening.serviceAccountEmail) {
        report.hardening.dedicatedServiceAccount = !report.hardening.serviceAccountEmail.endsWith('-compute@developer.gserviceaccount.com');
        if (report.hardening.dedicatedServiceAccount === false) {
          warnings.push('Worker still uses the default Compute Engine service account; switch to a dedicated least-privilege service account.');
        }
      }
      const serviceAccountScopes = Array.isArray(primaryServiceAccount?.scopes)
        ? primaryServiceAccount.scopes.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      report.hardening.cloudPlatformScope = serviceAccountScopes.some((scope) => scope.endsWith('/auth/cloud-platform'));
      if (report.hardening.cloudPlatformScope) {
        warnings.push('Worker service account still has the broad cloud-platform scope; reduce scopes or rely on IAM-only least privilege.');
      }

      if (report.worker.status !== 'RUNNING') {
        failures.push(`Worker instance is not RUNNING (current: ${report.worker.status || 'unknown'}).`);
      }
      if (report.worker.machineType && report.baseline.machineType && report.worker.machineType !== report.baseline.machineType) {
        warnings.push(`Machine type is ${report.worker.machineType}; expected ${report.baseline.machineType} (${report.baseline.memoryGb || '?'}GB) from operating baseline.`);
      }
      if (report.worker.bootDiskGb && report.baseline.bootDiskGb && report.worker.bootDiskGb > report.baseline.bootDiskGb) {
        warnings.push(`Boot disk is ${report.worker.bootDiskGb}GB; operating baseline is ${report.baseline.bootDiskGb}GB.`);
      }

      if (bootDiskName) {
        const diskRaw = run(gcloudBin, [
          'compute',
          'disks',
          'describe',
          bootDiskName,
          '--project',
          projectId,
          '--zone',
          zone,
          '--format=json',
        ], { allowFail: true });
        if (diskRaw.ok) {
          const diskPayload = parseJson(diskRaw.stdout, {});
          report.hardening.bootDiskSnapshotPolicies = Array.isArray(diskPayload?.resourcePolicies)
            ? diskPayload.resourcePolicies.map((item) => lastPathSegment(item)).filter(Boolean)
            : [];
          if (report.hardening.bootDiskSnapshotPolicies.length === 0) {
            warnings.push('Boot disk has no snapshot schedule/resource policy; add scheduled snapshots before treating this worker as durable control-plane infrastructure.');
          }
        } else {
          warnings.push(`Unable to inspect boot disk policies: ${compactError(diskRaw.stderr)}`);
        }
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
