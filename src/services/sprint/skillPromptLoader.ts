import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../../logger';
import { TtlCache } from '../../utils/ttlCache';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SkillPromptDefinition = {
  skillName: string;
  description: string;
  leadAgent: string;
  process: string[];
  outputContract: string;
  nextSkills: Array<{ condition: string; next: string }>;
  runtimeAction: string;
  rawContent: string;
};

const SKILLS_DIR = path.resolve(__dirname, '../../../.github/skills');

const PHASE_ACTION_MAP: Record<string, string> = {
  plan: 'architect.plan',
  implement: 'implement.execute',
  review: 'review.review',
  qa: 'qa.test',
  'security-audit': 'cso.audit',
  'ops-validate': 'operate.ops',
  ship: 'release.ship',
  retro: 'retro.summarize',
};

const PHASE_LEAD_AGENT_MAP: Record<string, string> = {
  plan: 'Architect',
  implement: 'Implement',
  review: 'Review',
  qa: 'Implement',
  'security-audit': 'Review',
  'ops-validate': 'Operate',
  ship: 'Operate',
  retro: 'Architect',
};

const cache = new TtlCache<SkillPromptDefinition>(50);
const CACHE_TTL_MS = 5 * 60_000;

const parseFrontmatter = (raw: string): { description: string; body: string } => {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) return { description: '', body: raw };
  const fmBlock = fmMatch[1];
  const body = fmMatch[2];
  const descMatch = fmBlock.match(/description:\s*"([^"]*)"/);
  return { description: descMatch?.[1] || '', body };
};

const extractSection = (body: string, heading: string): string => {
  const regex = new RegExp(`^##\\s+${heading}\\s*$`, 'mi');
  const match = body.match(regex);
  if (!match || match.index === undefined) return '';
  const start = match.index + match[0].length;
  const nextHeading = body.indexOf('\n## ', start);
  return body.slice(start, nextHeading === -1 ? undefined : nextHeading).trim();
};

const extractProcessSteps = (body: string): string[] => {
  const section = extractSection(body, 'Process');
  if (!section) return [];
  return section
    .split('\n')
    .filter((line) => /^\d+\.\s/.test(line.trim()))
    .map((line) => line.replace(/^\d+\.\s+/, '').replace(/\*\*([^*]+)\*\*\s*—?\s*/, '$1: ').trim());
};

const extractOutputContract = (body: string): string => {
  const section = extractSection(body, 'Output Contract');
  const codeBlock = section.match(/```[\s\S]*?```/);
  return codeBlock ? codeBlock[0].replace(/```/g, '').trim() : section;
};

const extractNextSkills = (body: string): Array<{ condition: string; next: string }> => {
  const section = extractSection(body, 'Next Skills');
  if (!section) return [];
  return section
    .split('\n')
    .filter((line) => line.includes('|') && !line.includes('---') && !line.toLowerCase().includes('condition'))
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
      return parts.length >= 2 ? { condition: parts[0], next: parts[1] } : null;
    })
    .filter((item): item is { condition: string; next: string } => item !== null);
};

export const loadSkillPrompt = (skillName: string): SkillPromptDefinition | null => {
  const cached = cache.get(skillName);
  if (cached) {
    return cached;
  }

  const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  let raw: string;
  try {
    raw = fs.readFileSync(skillPath, 'utf-8');
  } catch {
    logger.warn('[SKILL-PROMPT] SKILL.md not found for skill=%s path=%s', skillName, skillPath);
    return null;
  }

  const { description, body } = parseFrontmatter(raw);
  const def: SkillPromptDefinition = {
    skillName,
    description,
    leadAgent: PHASE_LEAD_AGENT_MAP[skillName] || 'Implement',
    process: extractProcessSteps(body),
    outputContract: extractOutputContract(body),
    nextSkills: extractNextSkills(body),
    runtimeAction: PHASE_ACTION_MAP[skillName] || '',
    rawContent: raw,
  };

  cache.set(skillName, def, CACHE_TTL_MS);
  return def;
};

export const buildPhaseSystemPrompt = (skillName: string): string | null => {
  const def = loadSkillPrompt(skillName);
  if (!def) return null;
  const lines = [
    `You are executing sprint phase: /${skillName}`,
    `Role: ${def.leadAgent}`,
    '',
    def.description,
    '',
    '## Process',
    ...def.process.map((step, i) => `${i + 1}. ${step}`),
    '',
    '## Expected Output',
    def.outputContract,
  ];
  return lines.join('\n');
};

export const listAvailableSkills = (): string[] => {
  try {
    return fs.readdirSync(SKILLS_DIR).filter((name) => {
      const skillPath = path.join(SKILLS_DIR, name, 'SKILL.md');
      return fs.existsSync(skillPath);
    });
  } catch {
    return [];
  }
};

export const getPhaseActionName = (skillName: string): string => {
  return PHASE_ACTION_MAP[skillName] || '';
};

export const getPhaseLeadAgent = (skillName: string): string => {
  return PHASE_LEAD_AGENT_MAP[skillName] || 'Implement';
};

/**
 * Phases that can execute deterministically (no LLM) when fast-path is enabled.
 * The sprintOrchestrator checks this before dispatching to LLM-based actions.
 */
export const FAST_PATH_PHASE_INFO: Record<string, { tool: string; description: string }> = {
  qa: { tool: 'vitest run', description: 'Run test suite, pass/fail by exit code' },
  'ops-validate': { tool: 'tsc --noEmit', description: 'TypeCheck, pass/fail by exit code' },
  ship: { tool: 'autonomousGit', description: 'Branch + commit + PR via GitHub API' },
};
