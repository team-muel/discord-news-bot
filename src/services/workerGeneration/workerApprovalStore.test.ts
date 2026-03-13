import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// 파일 시스템 모드로 강제, Supabase 비활성화
vi.stubEnv('WORKER_APPROVAL_STORE_MODE', 'file');
vi.stubEnv('WORKER_APPROVAL_STORE_PATH', path.join(os.tmpdir(), `wapprv-test-${Date.now()}.json`));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => false,
  getSupabaseClient: () => { throw new Error('supabase not configured'); },
}));

// 싱글톤 모듈 상태 때문에 각 테스트는 독립적인 범위에서 확인
import {
  createApproval,
  getApproval,
  updateApprovalStatus,
  listApprovals,
  getWorkerApprovalStoreSnapshot,
} from './workerApprovalStore';

const makeParams = (overrides: Partial<Parameters<typeof createApproval>[0]> = {}) => ({
  guildId: 'guild-001',
  requestedBy: 'user-001',
  goal: '자동화 테스트 워커',
  actionName: 'dynamic.test.worker',
  generatedCode: 'export const action = { name: "dynamic.test.worker", execute: async () => ({ ok: true, name: "x", summary: "", artifacts: [], verification: [] }) };',
  sandboxDir: '',
  sandboxFilePath: '',
  validationPassed: true,
  validationErrors: [],
  validationWarnings: [],
  ...overrides,
});

describe('workerApprovalStore (file mode)', () => {
  it('createApproval은 id를 가진 항목을 반환한다', async () => {
    const entry = await createApproval(makeParams());
    expect(entry.id).toMatch(/^wapprv_/);
    expect(entry.status).toBe('pending');
    expect(entry.guildId).toBe('guild-001');
  });

  it('getApproval로 생성된 항목을 조회할 수 있다', async () => {
    const created = await createApproval(makeParams({ goal: '조회 테스트' }));
    const found = await getApproval(created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.goal).toBe('조회 테스트');
  });

  it('존재하지 않는 id 조회 시 null을 반환한다', async () => {
    const result = await getApproval('wapprv_nonexistent_id');
    expect(result).toBeNull();
  });

  it('updateApprovalStatus로 상태를 변경할 수 있다', async () => {
    const entry = await createApproval(makeParams({ goal: '상태변경 테스트' }));
    // updateApprovalStatus는 성공 시 true를 반환
    const ok = await updateApprovalStatus(entry.id, 'approved');
    expect(ok).toBe(true);

    const fetched = await getApproval(entry.id);
    expect(fetched?.status).toBe('approved');
  });

  it('updateApprovalStatus에 adminMessageId/adminChannelId를 같이 넘길 수 있다', async () => {
    const entry = await createApproval(makeParams());
    await updateApprovalStatus(entry.id, 'pending', { adminMessageId: 'msg-123', adminChannelId: 'ch-456' });
    const fetched = await getApproval(entry.id);
    expect(fetched?.adminMessageId).toBe('msg-123');
    expect(fetched?.adminChannelId).toBe('ch-456');
  });

  it('listApprovals는 전체 목록을 반환한다', async () => {
    await createApproval(makeParams({ goal: '목록 테스트 1' }));
    await createApproval(makeParams({ goal: '목록 테스트 2' }));
    const list = await listApprovals();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('listApprovals({ status }) 는 해당 상태만 반환한다', async () => {
    const entry = await createApproval(makeParams({ goal: '상태 필터 테스트' }));
    await updateApprovalStatus(entry.id, 'rejected');

    const rejectedList = await listApprovals({ status: 'rejected' });
    const allRejected = rejectedList.every((e) => e.status === 'rejected');
    expect(allRejected).toBe(true);
  });

  it('validation 실패 항목도 정상 생성된다', async () => {
    const entry = await createApproval(makeParams({
      validationPassed: false,
      validationErrors: ['eval is not allowed', 'missing export'],
    }));
    expect(entry.validationPassed).toBe(false);
    expect(entry.validationErrors).toHaveLength(2);
  });

  it('getWorkerApprovalStoreSnapshot은 loaded=true를 반환한다', async () => {
    const snap = await getWorkerApprovalStoreSnapshot();
    expect(snap.loaded).toBe(true);
    // configuredMode는 모듈 로드 시 env를 읽으므로 유효한 값인지만 검증
    expect(['auto', 'supabase', 'file']).toContain(snap.configuredMode);
    expect(['supabase', 'file', 'unknown']).toContain(snap.activeBackend);
    expect(snap.totalApprovals).toBeGreaterThanOrEqual(0);
  });
});
