import { describe, expect, it } from 'vitest';

import {
  normalizeCapabilityDemandEvents,
  renderWorkflowCapabilityDemandLedger,
  summarizeCapabilityDemandPatterns,
} from './export-workflow-capability-demand-ledger';

describe('export-workflow-capability-demand-ledger', () => {
  it('normalizes persisted demand events with session fallback metadata', () => {
    const rows = normalizeCapabilityDemandEvents([
      {
        session_id: 'wf-1',
        created_at: '2026-04-13T05:00:00.000Z',
        decision_reason: '2 capability demands captured',
        payload: {
          runtime_lane: 'operator-personal',
          source_event: 'session_complete',
          demands: [
            {
              summary: 'Pipeline step review.route was blocked by policy and needs a narrower route or approval.',
              missing_capability: 'ACTION_NOT_ALLOWED',
              failed_or_insufficient_route: 'review.route',
              proposed_owner: 'operator',
              tags: ['goal-pipeline', 'failed'],
            },
            {
              summary: 'Pipeline step implement.execute has no executable implementation on the current action surface.',
              missing_capability: 'ACTION_NOT_IMPLEMENTED',
              missing_source: 'action-surface',
              failed_or_insufficient_route: 'implement.execute',
              cheapest_enablement_path: 'add or expose the missing action',
              proposed_owner: 'gpt',
              evidence_refs: ['docs/CHANGELOG-ARCH.md'],
            },
          ],
        },
      },
    ], [
      {
        session_id: 'wf-1',
        status: 'failed',
        metadata: {
          objective: 'repair the failed automation route',
          runtime_lane: 'operator-personal',
        },
      },
    ]);

    expect(rows).toEqual([
      {
        createdAt: '2026-04-13T05:00:00.000Z',
        sessionId: 'wf-1',
        sessionStatus: 'failed',
        objective: 'repair the failed automation route',
        runtimeLane: 'operator-personal',
        summary: 'Pipeline step review.route was blocked by policy and needs a narrower route or approval.',
        missingCapability: 'ACTION_NOT_ALLOWED',
        missingSource: null,
        failedOrInsufficientRoute: 'review.route',
        cheapestEnablementPath: null,
        proposedOwner: 'operator',
        evidenceRefs: [],
        recallCondition: null,
        sourceEvent: 'session_complete',
        tags: ['goal-pipeline', 'failed'],
      },
      {
        createdAt: '2026-04-13T05:00:00.000Z',
        sessionId: 'wf-1',
        sessionStatus: 'failed',
        objective: 'repair the failed automation route',
        runtimeLane: 'operator-personal',
        summary: 'Pipeline step implement.execute has no executable implementation on the current action surface.',
        missingCapability: 'ACTION_NOT_IMPLEMENTED',
        missingSource: 'action-surface',
        failedOrInsufficientRoute: 'implement.execute',
        cheapestEnablementPath: 'add or expose the missing action',
        proposedOwner: 'gpt',
        evidenceRefs: ['docs/CHANGELOG-ARCH.md'],
        recallCondition: null,
        sourceEvent: 'session_complete',
        tags: [],
      },
    ]);
  });

  it('summarizes repeated demand patterns and renders the markdown ledger', () => {
    const rows = [
      {
        createdAt: '2026-04-13T05:00:00.000Z',
        sessionId: 'wf-2',
        sessionStatus: 'failed',
        objective: 'repair route A',
        runtimeLane: 'operator-personal',
        summary: 'Pipeline step review.route was blocked by policy and needs a narrower route or approval.',
        missingCapability: 'ACTION_NOT_ALLOWED',
        missingSource: null,
        failedOrInsufficientRoute: 'review.route',
        cheapestEnablementPath: 'inspect the failed steps',
        proposedOwner: 'operator',
        evidenceRefs: ['docs/CHANGELOG-ARCH.md'],
        recallCondition: 'Pipeline failed; GPT recall required',
        sourceEvent: 'session_complete',
        tags: ['goal-pipeline', 'failed'],
      },
      {
        createdAt: '2026-04-12T05:00:00.000Z',
        sessionId: 'wf-1',
        sessionStatus: 'failed',
        objective: 'repair route B',
        runtimeLane: 'public-guild',
        summary: 'Pipeline step review.route was blocked by policy and needs a narrower route or approval.',
        missingCapability: 'ACTION_NOT_ALLOWED',
        missingSource: null,
        failedOrInsufficientRoute: 'review.route',
        cheapestEnablementPath: 'inspect the failed steps',
        proposedOwner: 'operator',
        evidenceRefs: [],
        recallCondition: 'Pipeline failed after replanning; GPT recall required',
        sourceEvent: 'session_complete',
        tags: ['goal-pipeline', 'failed', 'replanned'],
      },
    ];

    expect(summarizeCapabilityDemandPatterns(rows)).toEqual([
      {
        summary: 'Pipeline step review.route was blocked by policy and needs a narrower route or approval.',
        count: 2,
        latestAt: '2026-04-13T05:00:00.000Z',
        latestSessionId: 'wf-2',
        proposedOwner: 'operator',
        cheapestEnablementPath: 'inspect the failed steps',
      },
    ]);

    const markdown = renderWorkflowCapabilityDemandLedger({
      rows,
      generatedAt: '2026-04-13T06:00:00.000Z',
      days: 7,
    });

    expect(markdown).toContain('# Workflow Capability Demand Ledger');
    expect(markdown).toContain('- window_days: 7');
    expect(markdown).toContain('- ledger_rows: 2');
    expect(markdown).toContain('count: 2');
    expect(markdown).toContain('### 1. Pipeline step review.route was blocked by policy and needs a narrower route or approval.');
    expect(markdown).toContain('- evidence_refs: docs/CHANGELOG-ARCH.md');
  });
});