/**
 * SKILL.md template generator — auto-generates SKILL.md from code metadata.
 *
 * Inspired by gstack's SKILL.md.tmpl + gen-skill-docs.ts pattern:
 *   SKILL.md.tmpl (prose + {{placeholders}}) → gen → SKILL.md (committed)
 *
 * Placeholders:
 *   {{PHASE_ACTION_MAP}}      — from skillPromptLoader
 *   {{CONFIG_VARS}}           — from config.ts SPRINT_* exports
 *   {{FAST_PATH_INFO}}        — from fastPathExecutors
 *   {{PHASE_LEAD_AGENT_MAP}}  — from skillPromptLoader
 *   {{SCOPE_GUARD_RULES}}     — from scopeGuard
 *   {{AUTONOMY_LEVELS}}       — static table
 *
 * Usage: npx tsx scripts/gen-skill-docs.ts [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILLS_DIR = path.resolve(__dirname, '../../../.github/skills');
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// ──── Metadata extractors ─────────────────────────────────────────────────────

const extractPhaseActionMap = (): string => {
  const map: Record<string, string> = {
    plan: 'architect.plan',
    implement: 'implement.execute',
    review: 'review.review',
    qa: 'qa.test',
    'security-audit': 'cso.audit',
    'ops-validate': 'operate.ops',
    ship: 'release.ship',
    retro: 'retro.summarize',
  };

  const rows = Object.entries(map)
    .map(([phase, action]) => `| /${phase} | \`${action}\` |`)
    .join('\n');

  return `| Phase | Runtime Action |\n|-------|----------------|\n${rows}`;
};

const extractPhaseLeadAgentMap = (): string => {
  const map: Record<string, string> = {
    plan: 'Architect',
    implement: 'Implement',
    review: 'Review',
    qa: 'Implement (QA)',
    'security-audit': 'Review (security)',
    'ops-validate': 'Operate (operations)',
    ship: 'Operate (release)',
    retro: 'Architect (reflection)',
  };

  const rows = Object.entries(map)
    .map(([phase, agent]) => `| /${phase} | ${agent} |`)
    .join('\n');

  return `| Phase | Lead Agent |\n|-------|------------|\n${rows}`;
};

const extractFastPathInfo = (): string => {
  const info: Record<string, { tool: string; latency: string }> = {
    qa: { tool: '`npx vitest run`', latency: '~100-500ms' },
    'ops-validate': { tool: '`npx tsc --noEmit`', latency: '~100-500ms' },
    ship: { tool: 'autonomousGit (GitHub API)', latency: '~200-1000ms' },
  };

  const rows = Object.entries(info)
    .map(([phase, { tool, latency }]) => `| /${phase} | ${tool} | ${latency} | Zero |`)
    .join('\n');

  return `| Phase | Tool | Latency | LLM Tokens |\n|-------|------|---------|------------|\n${rows}`;
};

const extractConfigVars = (): string => {
  try {
    const configPath = path.join(PROJECT_ROOT, 'src/config.ts');
    const content = fs.readFileSync(configPath, 'utf-8');
    const sprintVars = content
      .split('\n')
      .filter((line) => /^export const SPRINT_/.test(line))
      .map((line) => {
        const nameMatch = line.match(/export const (\w+)/);
        const defaultMatch = line.match(/,\s*([^)]+)\)/);
        const name = nameMatch ? nameMatch[1] : '';
        const defaultVal = defaultMatch ? defaultMatch[1].trim() : '';
        return `| \`${name}\` | ${defaultVal} |`;
      });

    return `| Variable | Default |\n|----------|--------|\n${sprintVars.join('\n')}`;
  } catch {
    return '(config extraction failed)';
  }
};

const extractScopeGuardRules = (): string => {
  return [
    '**Allowed directories**: `src`, `scripts`, `tests`, `.github/skills`',
    '**Protected files**: `package.json`, `.env`, `ecosystem.config.cjs`, `render.yaml`',
    '**Destructive command blocking**: `rm -rf`, `DROP TABLE`, `git push --force`, `git reset --hard`',
  ].join('\n');
};

const AUTONOMY_TABLE = [
  '| Level | plan | implement | review | qa | ship |',
  '|-------|------|-----------|--------|----|------|',
  '| `full-auto` | auto | auto | auto | auto | auto |',
  '| `approve-ship` | auto | auto | auto | auto | **approval** |',
  '| `approve-impl` | auto | **approval** | auto | auto | **approval** |',
  '| `manual` | **approval** | **approval** | **approval** | **approval** | **approval** |',
].join('\n');

// ──── Placeholder registry ────────────────────────────────────────────────────

const PLACEHOLDERS: Record<string, () => string> = {
  '{{PHASE_ACTION_MAP}}': extractPhaseActionMap,
  '{{PHASE_LEAD_AGENT_MAP}}': extractPhaseLeadAgentMap,
  '{{FAST_PATH_INFO}}': extractFastPathInfo,
  '{{CONFIG_VARS}}': extractConfigVars,
  '{{SCOPE_GUARD_RULES}}': extractScopeGuardRules,
  '{{AUTONOMY_LEVELS}}': () => AUTONOMY_TABLE,
};

// ──── Generator ───────────────────────────────────────────────────────────────

const fillTemplate = (template: string): string => {
  let result = template;
  for (const [placeholder, generator] of Object.entries(PLACEHOLDERS)) {
    if (result.includes(placeholder)) {
      result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), generator());
    }
  }
  return result;
};

/**
 * Generate SKILL.md from SKILL.md.tmpl for a single skill.
 * Returns { changed: boolean, content: string }.
 */
export const generateSkillDoc = (skillName: string): { changed: boolean; content: string } => {
  const tmplPath = path.join(SKILLS_DIR, skillName, 'SKILL.md.tmpl');
  const outPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');

  if (!fs.existsSync(tmplPath)) {
    return { changed: false, content: '' };
  }

  const template = fs.readFileSync(tmplPath, 'utf-8');
  const generated = fillTemplate(template);

  let existing = '';
  try {
    existing = fs.readFileSync(outPath, 'utf-8');
  } catch { /* first generation */ }

  const changed = generated !== existing;

  return { changed, content: generated };
};

/**
 * Generate all SKILL.md files. Returns list of changed skills.
 */
export const generateAllSkillDocs = (dryRun = false): string[] => {
  const changedSkills: string[] = [];

  let skills: string[];
  try {
    skills = fs.readdirSync(SKILLS_DIR).filter((name) => {
      return fs.existsSync(path.join(SKILLS_DIR, name, 'SKILL.md.tmpl'));
    });
  } catch {
    return [];
  }

  for (const skill of skills) {
    const { changed, content } = generateSkillDoc(skill);
    if (changed && content) {
      changedSkills.push(skill);
      if (!dryRun) {
        const outPath = path.join(SKILLS_DIR, skill, 'SKILL.md');
        fs.writeFileSync(outPath, content, 'utf-8');
      }
    }
  }

  return changedSkills;
};

// ──── CLI entrypoint (when run directly) ──────────────────────────────────────

export const runCli = (): void => {
  const dryRun = process.argv.includes('--dry-run');
  const changed = generateAllSkillDocs(dryRun);

  if (changed.length === 0) {
    console.log('All SKILL.md files are up to date.');
    process.exitCode = 0;
  } else if (dryRun) {
    console.log(`STALE SKILL.md files (${changed.length}): ${changed.join(', ')}`);
    console.log('Run without --dry-run to update.');
    process.exitCode = 1;
  } else {
    console.log(`Updated ${changed.length} SKILL.md files: ${changed.join(', ')}`);
    process.exitCode = 0;
  }
};
