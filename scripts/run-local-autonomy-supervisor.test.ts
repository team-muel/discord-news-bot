import { describe, expect, it } from 'vitest';

import {
  buildCodeDriftStatus,
  buildTrackedCodeFingerprint,
  LOCAL_AUTONOMY_TRACKED_CODE_PATHS,
} from './run-local-autonomy-supervisor.ts';

describe('run-local-autonomy-supervisor helpers', () => {
  it('builds a stable fingerprint from tracked code metadata', () => {
    const trackedFiles = [
      { path: 'scripts/run-local-autonomy-supervisor.ts', exists: true, size: 100, mtimeMs: 111 },
      { path: 'src/services/runtime/localAutonomySupervisorService.ts', exists: true, size: 200, mtimeMs: 222 },
    ] as const;

    expect(buildTrackedCodeFingerprint(trackedFiles)).toBe(buildTrackedCodeFingerprint(trackedFiles));
    expect(buildTrackedCodeFingerprint(trackedFiles)).not.toBe(buildTrackedCodeFingerprint([
      trackedFiles[0],
      { path: 'src/services/runtime/localAutonomySupervisorService.ts', exists: true, size: 201, mtimeMs: 222 },
    ]));
  });

  it('marks old detached manifests without a code fingerprint as restart-needed', () => {
    const trackedCodeState = {
      fingerprint: 'current-fingerprint',
      trackedFiles: [
        { path: 'scripts/run-local-autonomy-supervisor.ts', exists: true, size: 100, mtimeMs: 111 },
      ],
    };

    expect(buildCodeDriftStatus({}, trackedCodeState, true)).toMatchObject({
      driftDetected: true,
      restartRecommended: true,
      reason: 'manifest-missing-code-fingerprint',
      manifestFingerprint: null,
      currentFingerprint: 'current-fingerprint',
    });
  });

  it('detects tracked code drift only when the daemon is running and the fingerprint changes', () => {
    const trackedCodeState = {
      fingerprint: 'current-fingerprint',
      trackedFiles: [
        { path: 'scripts/run-local-autonomy-supervisor.ts', exists: true, size: 100, mtimeMs: 111 },
      ],
    };

    expect(buildCodeDriftStatus({ codeFingerprint: 'current-fingerprint' }, trackedCodeState, true)).toMatchObject({
      driftDetected: false,
      restartRecommended: false,
      reason: null,
    });

    expect(buildCodeDriftStatus({ codeFingerprint: 'old-fingerprint' }, trackedCodeState, true)).toMatchObject({
      driftDetected: true,
      restartRecommended: true,
      reason: 'tracked-code-changed',
    });

    expect(buildCodeDriftStatus({ codeFingerprint: 'old-fingerprint' }, trackedCodeState, false)).toMatchObject({
      driftDetected: false,
      restartRecommended: false,
      reason: null,
    });
  });

  it('tracks the continuity sync script for detached daemon restarts', () => {
    expect(LOCAL_AUTONOMY_TRACKED_CODE_PATHS.some((entry) => entry.replace(/\\/g, '/').endsWith('scripts/sync-openjarvis-continuity-packets.ts'))).toBe(true);
  });
});