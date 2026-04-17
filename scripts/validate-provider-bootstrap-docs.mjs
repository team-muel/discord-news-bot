import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const fail = (message) => {
  console.error(`[DOCS-POLICY][FAIL] ${message}`);
  process.exit(1);
};

const read = (relativePath) => {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    fail(`missing file: ${relativePath}`);
  }
  return fs.readFileSync(fullPath, 'utf8');
};

const requireText = (content, needle, filePath) => {
  if (!content.includes(needle)) {
    fail(`${filePath} missing required text: ${needle}`);
  }
};

const runbookPath = 'docs/RUNBOOK_MUEL_PLATFORM.md';
const archPath = 'docs/ARCHITECTURE_INDEX.md';
const envTemplatePath = 'docs/RENDER_AGENT_ENV_TEMPLATE.md';
const gatesPath = 'docs/HARNESS_RELEASE_GATES.md';

const runbook = read(runbookPath);
const architecture = read(archPath);
const envTemplate = read(envTemplatePath);
const gates = read(gatesPath);

// HF token alias + provider fallback policy anchors
requireText(runbook, 'HF token alias rule (code-aligned):', runbookPath);
requireText(runbook, '`HF_TOKEN` -> `HF_API_KEY` -> `HUGGINGFACE_API_KEY`', runbookPath);
requireText(runbook, 'Provider fallback rule (code-aligned):', runbookPath);
requireText(runbook, '`LLM_PROVIDER_MAX_ATTEMPTS`', runbookPath);

requireText(architecture, '## LLM Provider Resolution Rules (Code-Aligned)', archPath);
requireText(architecture, 'Hugging Face token alias order:', archPath);
requireText(architecture, '1. `HF_TOKEN`', archPath);
requireText(architecture, '2. `HF_API_KEY`', archPath);
requireText(architecture, '3. `HUGGINGFACE_API_KEY`', archPath);
requireText(architecture, 'Fallback chain composition:', archPath);

requireText(envTemplate, '- HF_TOKEN=<secret> (if huggingface; primary key)', envTemplatePath);
requireText(envTemplate, '- HF_API_KEY=<secret> (huggingface alias)', envTemplatePath);
requireText(envTemplate, '- HUGGINGFACE_API_KEY=<secret> (huggingface alias)', envTemplatePath);
requireText(envTemplate, 'Provider fallback controls:', envTemplatePath);
requireText(envTemplate, '- LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED=true (optional)', envTemplatePath);

// Bootstrap profile DAG anchors
requireText(runbook, '### 3.7 Bootstrap Profiles and Startup DAG', runbookPath);
requireText(runbook, 'Profile A: server-only (`START_BOT=false`)', runbookPath);
requireText(runbook, 'Profile B: unified server+bot (`START_BOT=true` and token present)', runbookPath);
requireText(runbook, 'Profile C: bot-only process (`bot.ts` entry)', runbookPath);

requireText(architecture, '## Bootstrap Profiles and Startup DAG', archPath);
requireText(architecture, 'Profile A: server-only (`START_BOT=false`)', archPath);
requireText(architecture, 'Profile B: unified server+bot (`START_BOT=true` and token present)', archPath);
requireText(architecture, 'Profile C: bot-only (`bot.ts` entry)', archPath);

// Gate document must include policy gate entry and automation command note.
requireText(gates, '## Gate 7: Provider and Bootstrap Policy Documentation Consistency', gatesPath);
requireText(gates, '`npm run gates:validate:docs-policy`', gatesPath);

console.log('[DOCS-POLICY][OK] HF alias/fallback and startup DAG documentation consistency validated');
