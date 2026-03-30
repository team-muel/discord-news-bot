/* eslint-disable no-console */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

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

const hasFlag = (name) => process.argv.includes(`--${name}`);

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

const runGcloud = (args, options = {}) => {
  const allowFail = Boolean(options.allowFail);
  const commandLine = `${quoteArg(gcloudBin)} ${args.map((arg) => quoteArg(arg)).join(' ')}`;
  try {
    const stdout = execSync(commandLine, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    return { ok: true, stdout: String(stdout || '').trim() };
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || '').trim();
    if (allowFail) {
      return { ok: false, stdout: '', stderr };
    }
    throw new Error(stderr || 'gcloud command failed');
  }
};

const parseJson = (raw, fallback) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const ensureBudgetAmount = (raw) => {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`Invalid --amount-usd value: ${raw}`);
  }
  return `${num}USD`;
};

const resolveBillingAccount = () => {
  const explicit = getArg('billing-account', read('GCP_BILLING_ACCOUNT_ID', ''));
  if (explicit) {
    return explicit;
  }

  const list = runGcloud(['billing', 'accounts', 'list', '--format=json']);
  const accounts = parseJson(list.stdout, []);
  const open = Array.isArray(accounts)
    ? accounts.find((item) => String(item?.open).toLowerCase() === 'true' || item?.open === true)
    : null;

  if (!open?.name) {
    throw new Error('No open billing account found; set --billing-account or GCP_BILLING_ACCOUNT_ID');
  }
  return String(open.name).replace(/^billingAccounts\//, '');
};

const resolveProjectId = () => {
  const explicit = getArg(
    'project-id',
    read('GCP_PROJECT_ID', read('GOOGLE_CLOUD_PROJECT', 'gen-lang-client-0405212361')),
  );
  if (explicit) {
    return explicit;
  }

  const result = runGcloud(['config', 'get-value', 'project'], { allowFail: true });
  if (!result.ok) {
    return '';
  }
  const value = String(result.stdout || '').trim();
  if (!value || value === '(unset)') {
    return '';
  }
  return value;
};

const main = () => {
  const apply = hasFlag('apply');
  const displayName = getArg('display-name', read('GCP_BUDGET_DISPLAY_NAME', 'muel-worker-monthly-budget'));
  const amountUsd = getArg('amount-usd', read('GCP_BUDGET_AMOUNT_USD', '10'));
  const budgetAmount = ensureBudgetAmount(amountUsd);
  const billingAccount = resolveBillingAccount();
  const projectId = resolveProjectId();

  const budgets = runGcloud([
    'beta',
    'billing',
    'budgets',
    'list',
    '--billing-account',
    billingAccount,
    '--format=json',
  ], { allowFail: true });

  const budgetItems = budgets.ok ? parseJson(budgets.stdout, []) : [];
  const existing = Array.isArray(budgetItems)
    ? budgetItems.find((item) => String(item?.displayName || '').trim() === displayName)
    : null;

  const createArgs = [
    'beta',
    'billing',
    'budgets',
    'create',
    '--billing-account',
    billingAccount,
    '--display-name',
    displayName,
    '--budget-amount',
    budgetAmount,
    '--calendar-period',
    'month',
    '--threshold-rule',
    'percent=0.50,basis=current-spend',
    '--threshold-rule',
    'percent=0.80,basis=current-spend',
    '--threshold-rule',
    'percent=1.00,basis=current-spend',
  ];

  if (projectId) {
    createArgs.push('--filter-projects', `projects/${projectId}`);
  }

  const report = {
    mode: 'gcp-budget-alert-setup',
    apply,
    billingAccount,
    projectId: projectId || null,
    displayName,
    budgetAmount,
    existingBudgetFound: Boolean(existing),
    commandPreview: `${gcloudBin} ${createArgs.join(' ')}`,
    created: false,
    note: '',
  };

  if (existing) {
    report.note = 'Budget with this display name already exists; no create action taken.';
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!apply) {
    report.note = 'Dry-run mode. Re-run with --apply to create the budget.';
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const created = runGcloud(createArgs, { allowFail: true });
  if (!created.ok) {
    report.note = `Create failed: ${created.stderr || 'unknown error'}`;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  report.created = true;
  report.note = 'Budget created successfully.';
  console.log(JSON.stringify(report, null, 2));
};

try {
  main();
} catch (error) {
  console.error('[gcp-budget] FAIL', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
