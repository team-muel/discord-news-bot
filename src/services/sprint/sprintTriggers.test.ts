import { describe, it, expect } from 'vitest';
import { recordRuntimeError } from './sprintTriggers';

describe('sprintTriggers', () => {
  describe('recordRuntimeError', () => {
    it('에러를 기록해도 예외가 발생하지 않는다', () => {
      expect(() => recordRuntimeError({ message: 'test error', code: 'TEST_ERR' })).not.toThrow();
    });

    it('code 없이도 에러를 기록할 수 있다', () => {
      expect(() => recordRuntimeError({ message: 'test error no code' })).not.toThrow();
    });

    it('빈 메시지도 처리한다', () => {
      expect(() => recordRuntimeError({ message: '' })).not.toThrow();
    });
  });
});
