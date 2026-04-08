/**
 * Agent collaboration re-export hub.
 *
 * Previously a 1,500+ line God File. Now split into domain-scoped modules:
 * - agentCollabHelpers.ts    — shared utilities
 * - agentCollabOrchestrator.ts — local.orchestrator.route / .all
 * - agentCollabRoles.ts       — opendev.plan, nemoclaw.review, openjarvis.ops
 * - agentCollabSprint.ts      — qa.test, cso.audit, release.ship, retro.summarize, sop.update
 * - agentCollabJarvis.ts      — jarvis.* extended capabilities
 *
 * This file re-exports everything for backward compatibility so that existing
 * import paths (`from './agentCollab'`) continue to work unchanged.
 */

// ──── Orchestrator ──────────────────────────────────────────────────────────
export {
  localOrchestratorAllAction,
  localOrchestratorRouteAction,
} from './agentCollabOrchestrator';

// ──── Lead Agent Roles ──────────────────────────────────────────────────────
export {
  opendevPlanAction,
  nemoclawReviewAction,
  openjarvisOpsAction,
} from './agentCollabRoles';

// ──── Sprint Phases ─────────────────────────────────────────────────────────
export {
  qaTestAction,
  csoAuditAction,
  releaseShipAction,
  retroSummarizeAction,
  sopUpdateAction,
} from './agentCollabSprint';

// ──── OpenJarvis Extended ───────────────────────────────────────────────────
export {
  jarvisResearchAction,
  jarvisDigestAction,
  jarvisMemoryIndexAction,
  jarvisMemorySearchAction,
  jarvisEvalAction,
  jarvisTelemetryAction,
  jarvisSchedulerListAction,
  jarvisSkillSearchAction,
} from './agentCollabJarvis';
