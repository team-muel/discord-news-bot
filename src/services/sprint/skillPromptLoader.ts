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
  hitlAct: string[];
  hitlAsk: string[];
  referenceFiles: string[];
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

const extractHitlItems = (body: string, subHeading: string): string[] => {
  const section = extractSection(body, 'HITL Decision');
  if (!section) return [];
  const subMatch = section.match(new RegExp(`###\\s+${subHeading}[^\\n]*\\n([\\s\\S]*?)(?=###|$)`, 'i'));
  if (!subMatch) return [];
  return subMatch[1]
    .split('\n')
    .filter((line) => line.trim().startsWith('-'))
    .map((line) => line.replace(/^-\s+/, '').trim())
    .filter(Boolean);
};

const discoverReferenceFiles = (skillName: string): string[] => {
  const refsDir = path.join(SKILLS_DIR, skillName, 'references');
  try {
    return fs.readdirSync(refsDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch (err) {
    logger.debug('[SKILL-PROMPT] discoverReferenceFiles failed for skill=%s: %s', skillName, err instanceof Error ? err.message : String(err));
    return [];
  }
};

const SAFE_SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export const loadSkillPrompt = (skillName: string): SkillPromptDefinition | null => {
  if (!SAFE_SKILL_NAME_RE.test(skillName)) {
    logger.warn('[SKILL-PROMPT] rejected invalid skillName=%s', skillName);
    return null;
  }

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
    hitlAct: extractHitlItems(body, 'Act'),
    hitlAsk: extractHitlItems(body, 'Ask'),
    referenceFiles: discoverReferenceFiles(skillName),
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

  if (def.hitlAct.length > 0 || def.hitlAsk.length > 0) {
    lines.push('', '## HITL Decision');
    if (def.hitlAct.length > 0) {
      lines.push('', 'Proceed without asking:');
      lines.push(...def.hitlAct.map((item) => `- ${item}`));
    }
    if (def.hitlAsk.length > 0) {
      lines.push('', 'MUST confirm before proceeding:');
      lines.push(...def.hitlAsk.map((item) => `- ${item}`));
    }
  }

  return lines.join('\n');
};

export const listAvailableSkills = (): string[] => {
  try {
    return fs.readdirSync(SKILLS_DIR).filter((name) => {
      const skillPath = path.join(SKILLS_DIR, name, 'SKILL.md');
      return fs.existsSync(skillPath);
    });
  } catch (err) {
    logger.debug('[SKILL-PROMPT] listAvailableSkills failed: %s', err instanceof Error ? err.message : String(err));
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
 * Load a specific reference file for a skill on demand.
 * Returns null if the file does not exist.
 */
export const loadSkillReference = (skillName: string, refFileName: string): string | null => {
  if (!SAFE_SKILL_NAME_RE.test(skillName)) return null;
  if (!/^[a-z0-9][a-z0-9._-]*\.md$/i.test(refFileName)) return null;
  const refPath = path.join(SKILLS_DIR, skillName, 'references', refFileName);
  try {
    return fs.readFileSync(refPath, 'utf-8');
  } catch (err) {
    logger.debug('[SKILL-PROMPT] readReferenceFile failed for %s/%s: %s', skillName, refFileName, err instanceof Error ? err.message : String(err));
    return null;
  }
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
