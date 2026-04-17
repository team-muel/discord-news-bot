import { describe, expect, it } from 'vitest';

import { getOperatingBaselinePath, loadOperatingBaseline, summarizeOperatingBaseline } from './operatingBaseline';

describe('operatingBaseline', () => {
  it('repo-managed operating baseline를 로드한다', () => {
    const baseline = loadOperatingBaseline();

    expect(getOperatingBaselinePath().replace(/\\/g, '/')).toContain('config/runtime/operating-baseline.json');
    expect(baseline).toMatchObject({
      environment: 'production-current',
      capabilityAudit: {
        acknowledgedFindings: expect.arrayContaining([
          expect.objectContaining({
            id: 'openclaw-gateway-disconnected',
            status: 'optional-lane',
          }),
        ]),
      },
      gcpWorker: {
        machineType: 'e2-medium',
        memoryGb: 4,
      },
    });
  });

  it('prompt-friendly summary를 만든다', () => {
    const summary = summarizeOperatingBaseline(loadOperatingBaseline());

    expect(summary).toMatchObject({
      machineType: 'e2-medium',
      memoryGb: 4,
      publicBaseUrl: 'https://34.56.232.61.sslip.io',
    });
    expect(summary.alwaysOnRequired).toContain('unifiedMcp');
    expect(summary.alwaysOnRequired).not.toContain('litellmProxy');
    expect(summary.optInRemoteProviderLanes).toContain('litellmProxy');
    expect(summary.localAccelerationOnly).toContain('localOllama');
  });
});