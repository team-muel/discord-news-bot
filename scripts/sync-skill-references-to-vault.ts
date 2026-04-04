#!/usr/bin/env node
/**
 * sync-skill-references-to-vault.ts
 *
 * Copies skill reference files from .github/skills into the Obsidian vault
 * under skill-references/ so they become graph-searchable.
 *
 * Usage: npx tsx scripts/sync-skill-references-to-vault.ts [--dry-run]
 *
 * Idempotent: safe to run multiple times.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SKILLS_DIR = path.join(PROJECT_ROOT, '.github', 'skills');
const VAULT_PATH = String(
  process.env.OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_SYNC_VAULT_PATH || ''
).trim();
const DRY_RUN = process.argv.includes('--dry-run');

if (!VAULT_PATH) {
  console.log('[sync-refs] No OBSIDIAN_VAULT_PATH or OBSIDIAN_SYNC_VAULT_PATH set. Skipping.');
  process.exit(0);
}

const TARGET_DIR = path.join(VAULT_PATH, 'skill-references');

let copied = 0;
let skipped = 0;

const skillDirs = fs.readdirSync(SKILLS_DIR).filter((name) => {
  const refsDir = path.join(SKILLS_DIR, name, 'references');
  return fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory();
});

for (const skill of skillDirs) {
  const refsDir = path.join(SKILLS_DIR, skill, 'references');
  const targetSkillDir = path.join(TARGET_DIR, skill);

  const refFiles = fs.readdirSync(refsDir).filter((f) => f.endsWith('.md'));

  for (const refFile of refFiles) {
    const srcPath = path.join(refsDir, refFile);
    const destPath = path.join(targetSkillDir, refFile);

    // Check if content is identical (skip if unchanged)
    if (fs.existsSync(destPath)) {
      const srcContent = fs.readFileSync(srcPath, 'utf-8');
      const destContent = fs.readFileSync(destPath, 'utf-8');
      if (srcContent === destContent) {
        skipped++;
        continue;
      }
    }

    if (DRY_RUN) {
      console.log(`[dry-run] Would copy: ${srcPath} → ${destPath}`);
      copied++;
      continue;
    }

    fs.mkdirSync(targetSkillDir, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    copied++;
    console.log(`[sync-refs] Copied: ${skill}/${refFile}`);
  }
}

console.log(`[sync-refs] Done. copied=${copied} skipped=${skipped} dry_run=${DRY_RUN}`);
