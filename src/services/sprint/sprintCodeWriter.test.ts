import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rollbackCodeChanges, type CodeChange } from './sprintCodeWriter';

vi.mock('../llmClient', () => ({
  isAnyLlmConfigured: vi.fn(() => false),
  generateText: vi.fn(async () => ''),
}));

// In test env SPRINT_DRY_RUN=false and LLM is not configured,
// so generateAndApplyCodeChanges returns LLM_NOT_CONFIGURED after passing the dry-run guard.

describe('sprintCodeWriter', () => {
  describe('generateAndApplyCodeChanges', () => {
    it('dry-run 모드에서는 코드 수정을 건너뛴다', async () => {
      vi.resetModules();
      vi.doMock('../../config', async (importOriginal) => {
        const orig = await importOriginal<typeof import('../../config')>();
        return { ...orig, SPRINT_DRY_RUN: true };
      });
      const { generateAndApplyCodeChanges: fn } = await import('./sprintCodeWriter');
      try {
        const result = await fn({
          objective: 'Fix a bug in sprint',
          changedFiles: [],
          sprintId: 'test-sprint-1',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('DRY_RUN');
        expect(result.changes).toHaveLength(0);
        expect(result.summary).toContain('Dry-run');
      } finally {
        vi.doUnmock('../../config');
        vi.resetModules();
      }
    });

    it('LLM이 설정되지 않으면 에러를 반환한다', async () => {
      const { generateAndApplyCodeChanges } = await import('./sprintCodeWriter');
      const result = await generateAndApplyCodeChanges({
        objective: 'Test with no LLM',
        changedFiles: [],
        sprintId: 'test-sprint-2',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('LLM_NOT_CONFIGURED');
      expect(result.changes).toEqual([]);
    });

    it('previousPhaseOutput을 선택적으로 받을 수 있다', async () => {
      const { generateAndApplyCodeChanges } = await import('./sprintCodeWriter');
      const result = await generateAndApplyCodeChanges({
        objective: 'Test optional param',
        changedFiles: [],
        previousPhaseOutput: 'Plan: fix the bug by...',
        sprintId: 'test-sprint-3',
      });

      // Fails due to no LLM, but no error from the parameter itself
      expect(result.ok).toBe(false);
      expect(result.error).toBe('LLM_NOT_CONFIGURED');
    });
  });

  describe('rollbackCodeChanges', () => {
    it('빈 배열에 대해 에러 없이 완료한다', async () => {
      await expect(rollbackCodeChanges([])).resolves.not.toThrow();
    });

    it('경로 순회가 포함된 변경은 무시한다', async () => {
      const maliciousChanges: CodeChange[] = [{
        filePath: '../../../etc/passwd',
        originalContent: 'original',
        newContent: 'hacked',
      }];

      // Should not throw; path traversal is silently skipped
      await expect(rollbackCodeChanges(maliciousChanges)).resolves.not.toThrow();
    });

    it('존재하지 않는 디렉토리의 파일 롤백은 경고만 출력한다', async () => {
      const changes: CodeChange[] = [{
        filePath: 'src/services/__nonexistent_dir__/__test_rollback__.ts',
        originalContent: 'original content',
        newContent: 'new content',
      }];

      // Should not throw; fs.writeFile to nonexistent dir fails gracefully
      await expect(rollbackCodeChanges(changes)).resolves.not.toThrow();
    });
  });

  describe('CodeChange type', () => {
    it('필수 필드 구조가 올바르다', () => {
      const change: CodeChange = {
        filePath: 'src/test.ts',
        originalContent: 'const a = 1;',
        newContent: 'const a = 2;',
      };

      expect(change.filePath).toBe('src/test.ts');
      expect(change.originalContent).toBe('const a = 1;');
      expect(change.newContent).toBe('const a = 2;');
    });
  });

  describe('OpenCode SDK path', () => {
    it('SDK 비활성화 시 LLM 경로로 fallthrough한다', async () => {
      // SDK is disabled by default, so generateAndApplyCodeChanges should
      // skip the SDK path and proceed to LLM (which also fails in test env)
      const { generateAndApplyCodeChanges } = await import('./sprintCodeWriter');
      const result = await generateAndApplyCodeChanges({
        objective: 'Test SDK fallthrough',
        changedFiles: [],
        sprintId: 'test-sprint-sdk-1',
      });

      // Should hit LLM_NOT_CONFIGURED (after skipping SDK)
      expect(result.ok).toBe(false);
      expect(result.error).toBe('LLM_NOT_CONFIGURED');
    });

    it('SDK 활성화 시 세션 실패하면 LLM으로 fallthrough한다', async () => {
      vi.resetModules();
      vi.doMock('../opencode/opencodeSdkClient', () => ({
        isOpenCodeSdkAvailable: vi.fn(() => true),
        generateCodeViaSession: vi.fn(async () => ({
          ok: false,
          patches: [],
          diagnostics: [],
          summary: 'Session creation failed',
          error: 'CONNECTION_REFUSED',
        })),
      }));
      const { generateAndApplyCodeChanges: fn } = await import('./sprintCodeWriter');
      try {
        const result = await fn({
          objective: 'Test SDK failure fallthrough',
          changedFiles: [],
          sprintId: 'test-sprint-sdk-2',
        });
        // Should fall through to LLM path
        expect(result.ok).toBe(false);
        expect(result.error).toBe('LLM_NOT_CONFIGURED');
      } finally {
        vi.doUnmock('../opencode/opencodeSdkClient');
        vi.resetModules();
      }
    });
  });
});
