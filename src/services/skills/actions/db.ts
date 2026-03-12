import { getSupabaseClient, isSupabaseConfigured } from '../../supabaseClient';
import type { ActionDefinition } from './types';
import { ACTION_MAX_READ_LIMIT, isDbTableAllowed } from './policy';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const normalizeTable = (goal: string, args?: Record<string, unknown>): string => {
  const fromArgs = typeof args?.table === 'string' ? args.table.trim() : '';
  if (fromArgs) {
    return fromArgs;
  }

  const lower = goal.toLowerCase();
  if (/(lore|길드\s*로어|장기기억)/.test(lower)) {
    return 'guild_lore_docs';
  }
  if (/(memory|메모리|정책|선호)/.test(lower)) {
    return 'memory_items';
  }

  return '';
};

const normalizeLimit = (args?: Record<string, unknown>): number => {
  const raw = Number(args?.limit);
  if (!Number.isFinite(raw)) {
    return ACTION_MAX_READ_LIMIT;
  }
  return Math.max(1, Math.min(ACTION_MAX_READ_LIMIT, Math.trunc(raw)));
};

export const dbSupabaseReadAction: ActionDefinition = {
  name: 'db.supabase.read',
  description: '허용된 Supabase 테이블을 읽기 전용으로 조회합니다(limit 적용).',
  execute: async ({ goal, args }) => {
    if (!isSupabaseConfigured()) {
      return {
        ok: false,
        name: 'db.supabase.read',
        summary: 'Supabase가 구성되지 않았습니다.',
        artifacts: [],
        verification: ['SUPABASE_NOT_CONFIGURED'],
        error: 'SUPABASE_NOT_CONFIGURED',
      };
    }

    const table = normalizeTable(goal, args);
    if (!table) {
      return {
        ok: false,
        name: 'db.supabase.read',
        summary: '조회 대상 테이블을 결정하지 못했습니다.',
        artifacts: [],
        verification: ['table 추론 실패'],
        error: 'TABLE_NOT_FOUND',
      };
    }

    if (!isDbTableAllowed(table)) {
      return {
        ok: false,
        name: 'db.supabase.read',
        summary: `허용되지 않은 테이블입니다: ${table}`,
        artifacts: [table],
        verification: ['table allowlist 정책 차단'],
        error: 'TABLE_NOT_ALLOWED',
      };
    }

    const limit = normalizeLimit(args);
    const client = getSupabaseClient();

    const { data, error } = await client
      .from(table)
      .select('*')
      .limit(limit);

    if (error) {
      return {
        ok: false,
        name: 'db.supabase.read',
        summary: `DB 조회 실패: ${error.message}`,
        artifacts: [table],
        verification: ['supabase query error'],
        error: 'DB_READ_FAILED',
      };
    }

    const rows = Array.isArray(data) ? data : [];
    return {
      ok: true,
      name: 'db.supabase.read',
      summary: `${table} 조회 성공 (${rows.length} rows)` ,
      artifacts: [compact(JSON.stringify(rows).slice(0, 3000))],
      verification: ['read-only query', `limit=${limit}`],
    };
  },
};
