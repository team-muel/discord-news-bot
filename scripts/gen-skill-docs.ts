#!/usr/bin/env tsx
/**
 * Generate SKILL.md from SKILL.md.tmpl templates.
 * Usage: npx tsx scripts/gen-skill-docs.ts [--dry-run]
 *
 * --dry-run: Only check for stale files, don't write. Exits 1 if stale.
 *            Useful in CI: npx tsx scripts/gen-skill-docs.ts --dry-run && git diff --exit-code
 */
import { runCli } from '../src/services/sprint/skillDocGenerator';

runCli();
