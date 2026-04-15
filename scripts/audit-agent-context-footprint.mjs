/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

import { parseBool } from './lib/cliArgs.mjs';

const ROOT = process.cwd();

const walkFiles = (dirPath, filter) => {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, filter));
      continue;
    }
    if (!filter || filter(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
};

const existingFiles = (paths) => {
  return paths
    .map((filePath) => path.resolve(ROOT, filePath))
    .filter((filePath) => fs.existsSync(filePath));
};

const extractFrontmatterValue = (content, key) => {
  const match = String(content || '').match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return '';
  }
  const line = match[1].split(/\r?\n/).find((item) => item.trim().startsWith(`${key}:`));
  if (!line) {
    return '';
  }
  return line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '');
};

const toStat = (filePath, category) => {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const lines = String(content).split(/\r?\n/).length;
  const chars = content.length;
  const estimatedTokens = Math.ceil(chars / 4);
  const applyTo = extractFrontmatterValue(content, 'applyTo');
  const alwaysOn = relativePath === '.github/copilot-instructions.md' || applyTo === '**';
  const broadApply = Boolean(applyTo) && /\*\*|src\/\*\*/.test(applyTo);

  return {
    category,
    path: relativePath,
    lines,
    chars,
    estimated_tokens: estimatedTokens,
    apply_to: applyTo || null,
    always_on: alwaysOn,
    broad_apply: broadApply,
  };
};

const categoryFiles = [
  {
    category: 'workspace-instructions',
    files: existingFiles(['.github/copilot-instructions.md']),
  },
  {
    category: 'file-instructions',
    files: walkFiles(path.join(ROOT, '.github', 'instructions'), (filePath) => filePath.endsWith('.instructions.md')),
  },
  {
    category: 'skills',
    files: walkFiles(path.join(ROOT, '.github', 'skills'), (filePath) => path.basename(filePath) === 'SKILL.md'),
  },
  {
    category: 'skill-references',
    files: walkFiles(path.join(ROOT, '.github', 'skills'), (filePath) => filePath.includes(`${path.sep}references${path.sep}`)),
  },
  {
    category: 'prompts',
    files: walkFiles(path.join(ROOT, '.github', 'prompts'), (filePath) => filePath.endsWith('.prompt.md')),
  },
  {
    category: 'agents',
    files: walkFiles(path.join(ROOT, '.github', 'agents'), (filePath) => filePath.endsWith('.agent.md')),
  },
  {
    category: 'workflows',
    files: [
      ...walkFiles(path.join(ROOT, '.github', 'workflows')),
      ...existingFiles([
        'scripts/openjarvis-routing-policy.mjs',
        'scripts/run-openjarvis-unattended.mjs',
        'scripts/run-openjarvis-goal-cycle.mjs',
      ]),
    ],
  },
];

const stats = categoryFiles.flatMap((group) => group.files.map((filePath) => toStat(filePath, group.category)));
const totalsByCategory = Object.fromEntries(categoryFiles.map((group) => {
  const scoped = stats.filter((item) => item.category === group.category);
  return [group.category, {
    files: scoped.length,
    estimated_tokens: scoped.reduce((sum, item) => sum + item.estimated_tokens, 0),
    lines: scoped.reduce((sum, item) => sum + item.lines, 0),
  }];
}));

const alwaysOn = stats.filter((item) => item.always_on);
const broadApply = stats.filter((item) => item.broad_apply);
const topLargest = [...stats].sort((left, right) => right.estimated_tokens - left.estimated_tokens).slice(0, 12);

const recommendations = [];
if (alwaysOn.reduce((sum, item) => sum + item.estimated_tokens, 0) > 1800) {
  recommendations.push('Always-on instruction load is high; split broad guidance into narrower applyTo instructions or on-demand skills.');
}
if (broadApply.length > 6) {
  recommendations.push('Too many broad file instructions are eligible for many files; narrow applyTo patterns before adding more prose.');
}
if (topLargest.some((item) => item.category === 'skills' && item.estimated_tokens > 500)) {
  recommendations.push('Large SKILL.md files should move examples and long prose into references/ so the primary skill stays short.');
}
if (totalsByCategory.workflows && totalsByCategory.workflows.estimated_tokens > 2500) {
  recommendations.push('Workflow orchestration surface is large; keep goal launchers thin and avoid duplicating routing logic across scripts and docs.');
}
if (recommendations.length === 0) {
  recommendations.push('No critical token hot spot crossed the current heuristics; keep measuring before broadening always-on instructions.');
}

const report = {
  generated_at: new Date().toISOString(),
  root: ROOT,
  totals_by_category: totalsByCategory,
  always_on_instruction_tokens: alwaysOn.reduce((sum, item) => sum + item.estimated_tokens, 0),
  always_on_files: alwaysOn,
  broad_apply_files: broadApply,
  top_largest_files: topLargest,
  recommendations,
};

const jsonMode = parseBool(process.argv.find((arg) => arg.startsWith('--json='))?.split('=')[1] || 'false', false);
if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('# Agent Context Footprint Audit');
  console.log(`generated_at: ${report.generated_at}`);
  console.log('');
  console.log('## Totals By Category');
  for (const [category, total] of Object.entries(totalsByCategory)) {
    console.log(`- ${category}: files=${total.files}, estimated_tokens=${total.estimated_tokens}, lines=${total.lines}`);
  }
  console.log('');
  console.log(`## Always-On Instruction Tokens\n- total_estimated_tokens=${report.always_on_instruction_tokens}`);
  console.log('');
  console.log('## Largest Files');
  for (const item of topLargest) {
    console.log(`- ${item.path} (${item.category}) tokens≈${item.estimated_tokens} lines=${item.lines}`);
  }
  console.log('');
  console.log('## Recommendations');
  for (const item of recommendations) {
    console.log(`- ${item}`);
  }
}