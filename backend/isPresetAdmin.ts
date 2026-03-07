import { supabase, isSupabaseConfigured } from '../backend/supabase';

// 캐시를 저장할 Map 객체 (key: userId, value: { isAdmin, expiresAt })
const adminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 1000 * 60 * 5; // 5분 캐시

const presetAdminUserIdAllowlist = new Set(
  String(process.env.RESEARCH_PRESET_ADMIN_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

const adminAllowlistTable = String(process.env.ADMIN_ALLOWLIST_TABLE || '').trim();

const isEnvAllowlisted = (userId: string) => presetAdminUserIdAllowlist.has(userId);

const isTableAllowlisted = async (userId: string): Promise<boolean> => {
  if (!adminAllowlistTable || !isSupabaseConfigured) {
    return false;
  }

  try {
    const { data, error } = await supabase
      .from(adminAllowlistTable)
      .select('user_id, is_active, enabled')
      .eq('user_id', userId)
      .maybeSingle<{ user_id?: string; is_active?: boolean | null; enabled?: boolean | null }>();

    if (error && error.code !== 'PGRST116') {
      console.error('[Discord Bot] Failed to check admin allowlist table:', error.message);
      return false;
    }

    if (!data) {
      return false;
    }

    if (data.is_active === false || data.enabled === false) {
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Discord Bot] Exception in admin allowlist table check:', err);
    return false;
  }
};

export const isPresetAdmin = async (userId: string): Promise<boolean> => {
  if (isEnvAllowlisted(userId)) {
    return true;
  }

  const now = Date.now();
  const cached = adminCache.get(userId);
  // 캐시가 존재하고 아직 만료되지 않았다면 DB 조회 없이 반환
  if (cached && cached.expiresAt > now) {
    return cached.isAdmin;
  }

  try {
    if (!isSupabaseConfigured) {
      return false;
    }

    const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId).single();
    if (error && error.code !== 'PGRST116') {
      console.error('[Discord Bot] Failed to check admin role:', error.message);
    }

    const roleAdmin = data?.role === 'admin';
    const tableAllowlisted = roleAdmin ? false : await isTableAllowlisted(userId);
    const isAdmin = roleAdmin || tableAllowlisted;

    // DB 조회 결과를 캐시에 저장 (5분간 유지)
    adminCache.set(userId, { isAdmin, expiresAt: now + CACHE_TTL_MS });
    return isAdmin;
  } catch (err) {
    console.error('[Discord Bot] Exception in isPresetAdmin:', err);
    return false;
  }
};
