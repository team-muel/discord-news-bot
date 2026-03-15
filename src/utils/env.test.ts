import { describe, expect, it } from 'vitest';
import { parseBoundedNumberEnv, parseIntegerEnv, parseNumberEnv } from './env';

describe('env parsing helpers', () => {
  it('parseNumberEnv는 숫자 파싱에 실패하면 fallback을 사용한다', () => {
    expect(parseNumberEnv('3.14', 0)).toBe(3.14);
    expect(parseNumberEnv('not-a-number', 2.5)).toBe(2.5);
  });

  it('parseIntegerEnv는 정수로 변환한다', () => {
    expect(parseIntegerEnv('42', 0)).toBe(42);
    expect(parseIntegerEnv(undefined, 7)).toBe(7);
  });

  it('parseBoundedNumberEnv는 min/max 범위를 보장한다', () => {
    expect(parseBoundedNumberEnv('0.8', 0.5, 0, 1)).toBe(0.8);
    expect(parseBoundedNumberEnv('9', 0.5, 0, 1)).toBe(1);
    expect(parseBoundedNumberEnv('-1', 0.5, 0, 1)).toBe(0);
  });
});
