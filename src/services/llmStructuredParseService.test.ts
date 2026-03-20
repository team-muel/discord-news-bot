import { describe, expect, it } from 'vitest';

import {
  parseLlmAnalysisVerdict,
  parseLlmDiscoveryResult,
  parseLlmNormalized,
  parseLlmStructuredArray,
  parseLlmStructuredRecord,
  parseLlmStructuredValue,
} from './llmStructuredParseService';

describe('llmStructuredParseService', () => {
  it('structured record는 JSON object를 파싱한다', () => {
    expect(parseLlmStructuredRecord('{"probability":0.8,"correctness":0.7}')).toEqual({
      probability: 0.8,
      correctness: 0.7,
    });
  });

  it('structured array는 본문에 섞인 JSON 배열을 추출한다', () => {
    expect(parseLlmStructuredArray('result:\n[{"id":"a"},{"id":"b"}]')).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });

  it('structured value는 key-value fallback도 반환한다', () => {
    expect(parseLlmStructuredValue('priority: 90\nstatus: ok')).toEqual({
      priority: 90,
      status: 'ok',
    });
  });

  it('normalized parse는 검증기 통과 시 정규화 값을 반환한다', () => {
    const parsed = parseLlmNormalized('{"unitId":"u1","score":2}', (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid');
      }
      const record = value as Record<string, unknown>;
      return {
        unitId: String(record.unitId || ''),
        score: Number(record.score || 0),
      };
    });

    expect(parsed).toEqual({ unitId: 'u1', score: 2 });
  });

  it('normalized parse는 검증 실패 시 null을 반환한다', () => {
    expect(parseLlmNormalized('{"unitId":"u1"}', () => {
      throw new Error('bad');
    })).toBeNull();
  });

  it('discovery result parse는 보안 후보 버킷 계약으로 정규화한다', () => {
    expect(parseLlmDiscoveryResult('{"analyze":[{"unitId":"u1","disposition":"analyze","priorityScore":91,"shortReason":"near sink","reasonCodes":["sink-nearby"]}],"hold":[],"drop":[]}'))
      .toEqual({
        analyze: [{
          unitId: 'u1',
          disposition: 'analyze',
          priorityScore: 91,
          shortReason: 'near sink',
          reasonCodes: ['sink-nearby'],
          recommendedAnalysisDepth: undefined,
        }],
        hold: [],
        drop: [],
      });
  });

  it('analysis verdict parse는 판정 계약으로 정규화한다', () => {
    expect(parseLlmAnalysisVerdict('{"unitId":"u1","disposition":"likely","confidence":"medium","rationale":"taint path is incomplete","relatedCandidateIds":["cand-1"]}'))
      .toEqual({
        unitId: 'u1',
        disposition: 'likely',
        confidence: 'medium',
        rationale: 'taint path is incomplete',
        relatedCandidateIds: ['cand-1'],
        requiredFollowup: undefined,
        findingTitle: undefined,
      });
  });
});