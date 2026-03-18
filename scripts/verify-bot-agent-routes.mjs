import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const COMPOSER_FILE = path.join(ROOT, 'src', 'routes', 'botAgentRoutes.ts');
const MODULE_DIR = path.join(ROOT, 'src', 'routes', 'bot-agent');

const ROUTE_REGEX = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
const IMPORT_REGEX = /import\s+\{\s*(registerBotAgent[A-Za-z]+Routes)\s*\}\s+from\s+'\.\/bot-agent\/([^']+)';/g;
const CALL_REGEX = /(registerBotAgent[A-Za-z]+Routes)\(deps\);/g;

const EXPECTED_PREFIX_RULES = {
  coreRoutes: ['/agent/sessions', '/agent/conversations', '/agent/deadletters', '/agent/skills', '/agent/policy', '/agent/onboarding', '/agent/learning/run'],
  runtimeRoutes: ['/agent/runtime/', '/agent/finops/', '/agent/llm/'],
  gotRoutes: ['/agent/got/'],
  qualityPrivacyRoutes: ['/agent/quality/', '/agent/privacy/', '/agent/obsidian/'],
  governanceRoutes: ['/agent/actions/', '/agent/opencode/', '/agent/self-growth/'],
  memoryRoutes: ['/agent/memory/'],
  learningRoutes: ['/agent/task-routing/', '/agent/learning/task-routing/'],
};

const toRel = (absPath) => path.relative(ROOT, absPath).replace(/\\/g, '/');

const parseComposer = async () => {
  const text = await fs.readFile(COMPOSER_FILE, 'utf8');
  const imports = [];
  const calls = [];

  let importMatch;
  while ((importMatch = IMPORT_REGEX.exec(text)) !== null) {
    imports.push({
      fnName: importMatch[1],
      moduleName: importMatch[2],
    });
  }

  let callMatch;
  while ((callMatch = CALL_REGEX.exec(text)) !== null) {
    calls.push(callMatch[1]);
  }

  return { imports, calls };
};

const collectRoutesFromModule = async (moduleName) => {
  const filePath = path.join(MODULE_DIR, `${moduleName}.ts`);
  const text = await fs.readFile(filePath, 'utf8');
  const routes = [];

  let match;
  while ((match = ROUTE_REGEX.exec(text)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
    });
  }

  return { filePath, routes };
};

const checkPrefixRule = (moduleName, routes) => {
  const expectedPrefixes = EXPECTED_PREFIX_RULES[moduleName] || [];
  if (expectedPrefixes.length === 0) return [];

  const violations = [];
  for (const route of routes) {
    if (!route.path.startsWith('/agent/')) {
      violations.push(`Non-agent path in ${moduleName}: ${route.method} ${route.path}`);
      continue;
    }
    const ok = expectedPrefixes.some((prefix) => route.path.startsWith(prefix));
    if (!ok) {
      violations.push(`Unexpected domain path in ${moduleName}: ${route.method} ${route.path}`);
    }
  }
  return violations;
};

const main = async () => {
  const errors = [];
  const warnings = [];

  const { imports, calls } = await parseComposer();
  if (imports.length === 0) {
    errors.push('No bot-agent module imports found in composer.');
  }

  const importFnSet = new Set(imports.map((x) => x.fnName));
  const callFnSet = new Set(calls);

  for (const fnName of importFnSet) {
    if (!callFnSet.has(fnName)) {
      errors.push(`Imported registrar not called: ${fnName}`);
    }
  }
  for (const fnName of callFnSet) {
    if (!importFnSet.has(fnName)) {
      errors.push(`Called registrar not imported: ${fnName}`);
    }
  }

  const routeOwnerMap = new Map();
  let totalRoutes = 0;

  for (const entry of imports) {
    const { filePath, routes } = await collectRoutesFromModule(entry.moduleName);
    totalRoutes += routes.length;

    if (routes.length === 0) {
      errors.push(`No routes found in ${toRel(filePath)}`);
      continue;
    }

    const prefixViolations = checkPrefixRule(entry.moduleName, routes);
    errors.push(...prefixViolations);

    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      const owners = routeOwnerMap.get(key) || [];
      owners.push(entry.moduleName);
      routeOwnerMap.set(key, owners);
    }
  }

  const duplicates = [];
  for (const [key, owners] of routeOwnerMap.entries()) {
    if (owners.length > 1) {
      duplicates.push(`${key} :: ${owners.join(', ')}`);
    }
  }
  if (duplicates.length > 0) {
    for (const d of duplicates) {
      errors.push(`Duplicate route across modules: ${d}`);
    }
  }

  if (totalRoutes < 40) {
    warnings.push(`Suspiciously low agent route count: ${totalRoutes}`);
  }

  if (warnings.length > 0) {
    process.stdout.write('Warnings:\n');
    for (const warning of warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }

  if (errors.length > 0) {
    process.stderr.write('Agent route modularization checks failed:\n');
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(`OK: verified ${imports.length} modules and ${totalRoutes} agent routes.\n`);
};

main().catch((error) => {
  process.stderr.write(`Failed to verify bot agent routes: ${String(error)}\n`);
  process.exit(1);
});
