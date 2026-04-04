import { describe, it, expect } from 'vitest';
import {
  checkFileScope,
  checkFilesScope,
  checkCommandSafety,
  checkNewFileCreation,
  getNewFileCount,
  getScopeGuardSnapshot,
} from './scopeGuard';

describe('scopeGuard', () => {
  describe('checkFileScope', () => {
    it('src/ 내부 파일은 허용한다', () => {
      const result = checkFileScope('src/services/test.ts');
      expect(result.allowed).toBe(true);
    });

    it('scripts/ 내부 파일은 허용한다', () => {
      const result = checkFileScope('scripts/build.mjs');
      expect(result.allowed).toBe(true);
    });

    it('.github/skills/ 내부 파일은 허용한다', () => {
      const result = checkFileScope('.github/skills/plan/SKILL.md');
      expect(result.allowed).toBe(true);
    });

    it('보호된 파일은 차단한다', () => {
      const result = checkFileScope('package.json');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Protected file');
    });

    it('.env 파일은 차단한다', () => {
      const result = checkFileScope('.env');
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkFilesScope', () => {
    it('모든 파일이 허용 범위 내이면 통과한다', () => {
      const result = checkFilesScope(['src/a.ts', 'src/b.ts']);
      expect(result.allowed).toBe(true);
    });

    it('하나라도 범위 밖이면 첫 위반을 반환한다', () => {
      const result = checkFilesScope(['src/a.ts', 'package.json', 'src/c.ts']);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Protected file');
    });

    it('빈 배열은 통과한다', () => {
      const result = checkFilesScope([]);
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkCommandSafety', () => {
    it('일반 명령은 허용한다', () => {
      expect(checkCommandSafety('npx vitest run').allowed).toBe(true);
      expect(checkCommandSafety('npx tsc --noEmit').allowed).toBe(true);
      expect(checkCommandSafety('npm install').allowed).toBe(true);
    });

    it('rm -rf를 차단한다', () => {
      const result = checkCommandSafety('rm -rf /tmp');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Destructive command');
    });

    it('DROP TABLE을 차단한다', () => {
      const result = checkCommandSafety('DROP TABLE users;');
      expect(result.allowed).toBe(false);
    });

    it('git push --force를 차단한다', () => {
      const result = checkCommandSafety('git push origin main --force');
      expect(result.allowed).toBe(false);
    });

    it('git reset --hard를 차단한다', () => {
      const result = checkCommandSafety('git reset --hard HEAD~3');
      expect(result.allowed).toBe(false);
    });
  });

  describe('getScopeGuardSnapshot', () => {
    it('스냅샷 구조가 올바르다', () => {
      const snap = getScopeGuardSnapshot();
      expect(typeof snap.enabled).toBe('boolean');
      expect(Array.isArray(snap.allowedDirs)).toBe(true);
      expect(Array.isArray(snap.protectedFiles)).toBe(true);
      expect(typeof snap.blockedAttempts).toBe('number');
      expect(Array.isArray(snap.recentBlocked)).toBe(true);
      expect(typeof snap.newFileCap).toBe('number');
    });
  });

  describe('checkNewFileCreation', () => {
    const testSprintId = 'new-file-cap-test-' + Date.now();

    it('기존 파일 수정은 항상 허용한다', () => {
      const result = checkNewFileCreation(testSprintId, 'src/existing.ts', true);
      expect(result.allowed).toBe(true);
    });

    it('새 파일 생성은 캡 내에서 허용한다', () => {
      const sid = 'cap-test-allow-' + Date.now();
      const r1 = checkNewFileCreation(sid, 'src/new1.ts', false);
      expect(r1.allowed).toBe(true);
      expect(getNewFileCount(sid)).toBe(1);
    });

    it('같은 파일 재시도는 중복 카운트하지 않는다', () => {
      const sid = 'cap-test-dedup-' + Date.now();
      checkNewFileCreation(sid, 'src/dedup.ts', false);
      checkNewFileCreation(sid, 'src/dedup.ts', false);
      expect(getNewFileCount(sid)).toBe(1);
    });

    it('캡 초과 시 새 파일 생성을 차단한다', () => {
      const sid = 'cap-test-block-' + Date.now();
      // SPRINT_NEW_FILE_CAP defaults to 3
      checkNewFileCreation(sid, 'src/a.ts', false);
      checkNewFileCreation(sid, 'src/b.ts', false);
      checkNewFileCreation(sid, 'src/c.ts', false);
      const blocked = checkNewFileCreation(sid, 'src/d.ts', false);
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toContain('New-file cap');
      expect(getNewFileCount(sid)).toBe(3);
    });
  });
});
