import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DEFAULT_POLICY_PATH = path.join(ROOT, 'docs', 'planning', 'runtime-profiles', 'openjarvis-routing-policy.json');

const VALID_CLASSIFICATIONS = new Set(['discover', 'implement', 'verify', 'release', 'recover']);
const VALID_AGENT_ROLES = new Set(['openjarvis', 'opencode', 'nemoclaw', 'opendev']);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asTrimmed = (value, fallback = '') => String(value || fallback).trim();

const defaultPolicy = {
  version: 1,
  classificationPriority: ['recover', 'release', 'verify', 'implement', 'discover'],
  agentByClassification: {
    discover: 'nemoclaw',
    implement: 'opencode',
    verify: 'opendev',
    release: 'opendev',
    recover: 'opendev',
  },
  workflowSteps: [
    {
      id: 'weekly-report-all',
      script: 'gates:weekly-report:all',
      scriptDry: 'gates:weekly-report:all:dry',
      classification: 'implement',
      agentRole: 'opencode',
      handoffFrom: 'openjarvis',
      handoffTo: 'opencode',
      reason: 'collect weekly artifacts',
    },
    {
      id: 'validate-gates-strict',
      script: 'gates:validate:strict',
      scriptDry: 'gates:validate:strict',
      classification: 'verify',
      agentRole: 'opendev',
      handoffFrom: 'opencode',
      handoffTo: 'opendev',
      reason: 'strict release gate validation',
    },
    {
      id: 'rollback-readiness-validate-strict',
      script: 'rehearsal:stage-rollback:validate:strict',
      scriptDry: 'rehearsal:stage-rollback:validate:strict',
      classification: 'discover',
      agentRole: 'nemoclaw',
      handoffFrom: 'opendev',
      handoffTo: 'nemoclaw',
      reason: 'rollback rehearsal readiness check',
    },
  ],
};

const normalizePolicy = (value) => {
  if (!isObject(value)) {
    return defaultPolicy;
  }

  const classificationPriorityRaw = Array.isArray(value.classificationPriority)
    ? value.classificationPriority.map((item) => asTrimmed(item).toLowerCase()).filter((item) => VALID_CLASSIFICATIONS.has(item))
    : [];
  const classificationPriority = classificationPriorityRaw.length > 0
    ? [...new Set(classificationPriorityRaw)]
    : [...defaultPolicy.classificationPriority];

  const agentByClassification = { ...defaultPolicy.agentByClassification };
  if (isObject(value.agentByClassification)) {
    for (const key of Object.keys(agentByClassification)) {
      const raw = asTrimmed(value.agentByClassification[key]).toLowerCase();
      if (VALID_AGENT_ROLES.has(raw)) {
        agentByClassification[key] = raw;
      }
    }
  }

  const workflowStepsRaw = Array.isArray(value.workflowSteps) ? value.workflowSteps : [];
  const workflowSteps = workflowStepsRaw
    .map((step) => {
      if (!isObject(step)) return null;

      const id = asTrimmed(step.id);
      const script = asTrimmed(step.script);
      const scriptDry = asTrimmed(step.scriptDry, script);
      const classification = asTrimmed(step.classification).toLowerCase();
      const agentRole = asTrimmed(step.agentRole).toLowerCase();
      const handoffFrom = asTrimmed(step.handoffFrom).toLowerCase();
      const handoffTo = asTrimmed(step.handoffTo).toLowerCase();
      const reason = asTrimmed(step.reason, `${id || script} execution`);

      if (!id || !script) return null;
      if (!VALID_CLASSIFICATIONS.has(classification)) return null;
      if (!VALID_AGENT_ROLES.has(agentRole)) return null;
      if (!VALID_AGENT_ROLES.has(handoffFrom)) return null;
      if (!VALID_AGENT_ROLES.has(handoffTo)) return null;

      return {
        id,
        script,
        scriptDry: scriptDry || script,
        classification,
        agentRole,
        handoffFrom,
        handoffTo,
        reason,
      };
    })
    .filter(Boolean);

  return {
    version: Number(value.version || 1),
    classificationPriority,
    agentByClassification,
    workflowSteps: workflowSteps.length > 0 ? workflowSteps : [...defaultPolicy.workflowSteps],
  };
};

export const loadOpenjarvisRoutingPolicy = (policyPathRaw) => {
  const policyPath = asTrimmed(policyPathRaw)
    ? path.resolve(ROOT, asTrimmed(policyPathRaw))
    : DEFAULT_POLICY_PATH;

  try {
    const parsed = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    const policy = normalizePolicy(parsed);
    return {
      policy,
      policyPath,
      loaded: true,
    };
  } catch {
    return {
      policy: normalizePolicy(null),
      policyPath,
      loaded: false,
    };
  }
};
