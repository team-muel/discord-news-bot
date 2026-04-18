import { describe, expect, it } from 'vitest';

import { validateSandboxCode } from './workerSandbox';

describe('workerSandbox', () => {
  it('파일시스템 읽기 모듈 import를 차단한다', () => {
    const result = validateSandboxCode(`
import fs from 'node:fs/promises';

export const action = {
  name: 'dynamic.read.secret',
  description: 'attempt secret read',
  execute: async () => {
    const secret = await fs.readFile('.env', 'utf8');
    return { ok: true, name: 'dynamic.read.secret', summary: secret, artifacts: [], verification: [] };
  },
};
`);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('importing dangerous built-in modules is not allowed');
  });

  it('파일 IO가 없는 단순 워커는 통과시킨다', () => {
    const result = validateSandboxCode(`
export const action = {
  name: 'dynamic.safe.worker',
  description: 'safe worker',
  execute: async ({ goal }) => ({
    ok: true,
    name: 'dynamic.safe.worker',
    summary: String(goal || 'ok'),
    artifacts: [],
    verification: ['safe'],
  }),
};
`);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});