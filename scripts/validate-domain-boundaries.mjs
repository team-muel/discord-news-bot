#!/usr/bin/env node
/**
 * validate-domain-boundaries.mjs
 *
 * Enforces the domain boundary contract: cross-domain imports in src/services/
 * must go through barrel exports (index.ts) rather than reaching into sub-modules.
 *
 * Example violation:
 *   import { foo } from '../memory/memoryPoisonGuard';  // BAD: reaches into sub-module
 *   import { foo } from '../memory';                     // OK: uses barrel
 *
 * Usage:
 *   node scripts/validate-domain-boundaries.mjs [--fix-suggestions]
 *
 * Exit code 0 = clean, 1 = violations found.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname, posix } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = join(__dirname, '..', 'src', 'services');

/** Domains that have barrel exports (index.ts). */
const DOMAINS_WITH_BARRELS = [
  'agent', 'automation', 'discord-support', 'eval', 'infra',
  'langgraph', 'llm', 'memory', 'news', 'observer', 'obsidian',
  'opencode', 'runtime', 'runtime-alerts', 'security', 'skills',
  'tools', 'trading', 'workerGeneration', 'workflow',
];

/** Files that are exempt from this rule (legacy, will migrate later). */
const EXEMPT_FILES = new Set([
  // Test files are exempt — they mock individual sub-modules
]);

/** Import patterns that are exempt (dynamic imports for code-splitting). */
const EXEMPT_PATTERNS = [
  /await import\(/,        // Dynamic imports for lazy loading
  /vi\.mock\(/,            // Vitest mocks target specific modules
  /vi\.doMock\(/,
];

function collectTsFiles(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectTsFiles(full, results);
    } else if (/\.ts$/.test(entry) && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

function getDomain(importPath) {
  // importPath like '../memory/memoryPoisonGuard' or '../obsidian/router'
  const match = importPath.match(/^\.\.\/([^/]+)\/(.+)/);
  if (!match) return null;
  return { domain: match[1], subModule: match[2] };
}

function getFileDomain(filePath) {
  const rel = relative(SERVICES_DIR, filePath).replace(/\\/g, '/');
  const parts = rel.split('/');
  return parts.length > 1 ? parts[0] : null;
}

const violations = [];
const files = collectTsFiles(SERVICES_DIR);
const showSuggestions = process.argv.includes('--fix-suggestions');

for (const file of files) {
  const rel = relative(SERVICES_DIR, file).replace(/\\/g, '/');
  if (EXEMPT_FILES.has(rel)) continue;

  const fileDomain = getFileDomain(file);
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip exempt patterns
    if (EXEMPT_PATTERNS.some((p) => p.test(line))) continue;

    // Match static imports: import { x } from '../domain/subModule'
    const importMatch = line.match(/from\s+['"](\.\.\/([\w-]+)\/([^'"]+))['"]/);
    if (!importMatch) continue;

    const [, fullPath, domain, subModule] = importMatch;

    // Skip if importing within own domain
    if (domain === fileDomain) continue;

    // Skip if domain doesn't have a barrel
    if (!DOMAINS_WITH_BARRELS.includes(domain)) continue;

    // Skip if already importing from barrel (no slash in subModule means it's the barrel)
    // Actually, a barrel import would be '../domain' not '../domain/subModule'
    // So any match here IS a violation.

    violations.push({
      file: rel,
      line: i + 1,
      domain,
      subModule,
      fullPath,
      suggestion: `'../${domain}'`,
    });
  }
}

if (violations.length === 0) {
  console.log('✓ No domain boundary violations found.');
} else {
  console.log(`✗ ${violations.length} domain boundary violation(s) found:\n`);

  const grouped = {};
  for (const v of violations) {
    (grouped[v.file] ??= []).push(v);
  }

  for (const [file, vs] of Object.entries(grouped)) {
    console.log(`  ${file}`);
    for (const v of vs) {
      console.log(`    L${v.line}: imports from '${v.fullPath}' (domain: ${v.domain})`);
      if (showSuggestions) {
        console.log(`           → use ${v.suggestion} instead`);
      }
    }
    console.log();
  }

  if (!showSuggestions) {
    console.log('Run with --fix-suggestions to see recommended barrel import paths.');
  }
}

// ── Rule: No direct process.env outside config files ──
// Tribal knowledge: "never read process.env directly outside config.ts"
const SRC_DIR = join(__dirname, '..', 'src');
const ENV_ALLOWLIST = new Set(['config.ts', 'configCore.ts', 'configDiscord.ts', 'configSprint.ts', 'configLlmProviders.ts']);
// mcpSkillRouter.ts has a documented exception for dynamic key lookup
const ENV_EXEMPT_FILES = new Set(['services/skills/mcpSkillRouter.ts']);
const ENV_PATTERN = /\bprocess\.env\b/;
const ENV_COMMENT_PATTERN = /^\s*(\/\/|\/\*|\*)/;

function collectAllTsFiles(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectAllTsFiles(full, results);
    } else if (/\.ts$/.test(entry) && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

const envViolations = [];
for (const file of collectAllTsFiles(SRC_DIR)) {
  const rel = relative(SRC_DIR, file).replace(/\\/g, '/');
  const basename = rel.split('/').pop();
  if (ENV_ALLOWLIST.has(basename)) continue;
  if (ENV_EXEMPT_FILES.has(rel)) continue;

  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ENV_PATTERN.test(line)) continue;
    if (ENV_COMMENT_PATTERN.test(line)) continue;
    envViolations.push({ file: rel, line: i + 1, text: line.trim() });
  }
}

if (envViolations.length === 0) {
  console.log('✓ No process.env violations found outside config files.');
} else {
  console.log(`\n✗ ${envViolations.length} process.env violation(s) outside config files:\n`);
  for (const v of envViolations) {
    console.log(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.log('\n  Fix: move env reads to src/config/*.ts and import the constant.');
}

const exitCode = violations.length > 0 ? 1 : 0;
// TODO: flip to hard-fail once remaining ~500 process.env violations are migrated to config.ts
// const exitCode = (violations.length > 0 || envViolations.length > 0) ? 1 : 0;
process.exit(exitCode);
