import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLoopState,
  checkActionLoop,
  actionSignature,
  formatLoopWarning,
  LOOP_SOFT_THRESHOLD,
  LOOP_HARD_THRESHOLD,
} from './loopDetection';

describe('loopDetection', () => {
  describe('actionSignature', () => {
    it('returns {} for undefined/empty args', () => {
      expect(actionSignature(undefined)).toBe('{}');
      expect(actionSignature({})).toBe('{}');
    });

    it('produces deterministic signature regardless of key order', () => {
      const a = actionSignature({ z: 1, a: 2 });
      const b = actionSignature({ a: 2, z: 1 });
      expect(a).toBe(b);
    });

    it('distinguishes different args', () => {
      const a = actionSignature({ phase: 'plan' });
      const b = actionSignature({ phase: 'review' });
      expect(a).not.toBe(b);
    });
  });

  describe('checkActionLoop', () => {
    let state: ReturnType<typeof createLoopState>;

    beforeEach(() => {
      state = createLoopState();
    });

    it('does not warn on first call', () => {
      const result = checkActionLoop(state, 'test.action', '{}');
      expect(result.softWarning).toBe(false);
      expect(result.hardBlock).toBe(false);
      expect(result.count).toBe(1);
    });

    it('does not warn for different actions', () => {
      checkActionLoop(state, 'action.a', '{}');
      const result = checkActionLoop(state, 'action.b', '{}');
      expect(result.softWarning).toBe(false);
      expect(result.count).toBe(1);
    });

    it('triggers soft warning at LOOP_SOFT_THRESHOLD', () => {
      for (let i = 0; i < LOOP_SOFT_THRESHOLD - 1; i++) {
        checkActionLoop(state, 'same.action', '{sig}');
      }
      const result = checkActionLoop(state, 'same.action', '{sig}');
      expect(result.softWarning).toBe(true);
      expect(result.hardBlock).toBe(false);
      expect(result.count).toBe(LOOP_SOFT_THRESHOLD);
    });

    it('triggers hard block at LOOP_HARD_THRESHOLD', () => {
      for (let i = 0; i < LOOP_HARD_THRESHOLD - 1; i++) {
        checkActionLoop(state, 'same.action', '{sig}');
      }
      const result = checkActionLoop(state, 'same.action', '{sig}');
      expect(result.hardBlock).toBe(true);
      expect(result.count).toBe(LOOP_HARD_THRESHOLD);
    });

    it('resets count when action changes', () => {
      for (let i = 0; i < 4; i++) {
        checkActionLoop(state, 'action.a', '{x}');
      }
      const result = checkActionLoop(state, 'action.b', '{x}');
      expect(result.count).toBe(1);
      expect(result.softWarning).toBe(false);
    });

    it('resets count when signature changes', () => {
      for (let i = 0; i < 4; i++) {
        checkActionLoop(state, 'action.a', '{x:1}');
      }
      const result = checkActionLoop(state, 'action.a', '{x:2}');
      expect(result.count).toBe(1);
    });
  });

  describe('formatLoopWarning', () => {
    it('returns a non-empty warning string', () => {
      const msg = formatLoopWarning('test.action', 3);
      expect(msg).toContain('test.action');
      expect(msg).toContain('3');
    });
  });
});
