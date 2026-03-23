import { describe, it, expect } from 'vitest';
import { isDeterministicPhase } from './fastPathExecutors';

describe('fastPathExecutors', () => {
  describe('isDeterministicPhase', () => {
    it('qa는 deterministic이다', () => {
      expect(isDeterministicPhase('qa')).toBe(true);
    });

    it('ops-validate는 deterministic이다', () => {
      expect(isDeterministicPhase('ops-validate')).toBe(true);
    });

    it('ship은 deterministic이다', () => {
      expect(isDeterministicPhase('ship')).toBe(true);
    });

    it('plan은 deterministic이 아니다', () => {
      expect(isDeterministicPhase('plan')).toBe(false);
    });

    it('implement는 deterministic이 아니다', () => {
      expect(isDeterministicPhase('implement')).toBe(false);
    });

    it('review는 deterministic이 아니다', () => {
      expect(isDeterministicPhase('review')).toBe(false);
    });

    it('retro는 deterministic이 아니다', () => {
      expect(isDeterministicPhase('retro')).toBe(false);
    });
  });
});
