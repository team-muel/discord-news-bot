/* eslint-disable no-console */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

type MemoryItemRow = {
  id: string;
  guild_id: string;
  owner_user_id: string | null;
  created_by: string | null;
  updated_by: string | null;
};

type MemorySourceRow = {
  memory_item_id: string;
  source_author_id: string | null;
};

const BATCH_SIZE = 300;

const toMaybeUserId = (value: unknown): string | null => {
  const text = String(value || '').trim();
  if (!text) return null;
  return /^\d{6,30}$/.test(text) ? text : null;
};

const main = async () => {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();

  if (!supabaseUrl || !supabaseKey) {
    console.error('[privacy-backfill] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }

  const client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  let processed = 0;
  let updated = 0;

  while (true) {
    const { data, error } = await client
      .from('memory_items')
      .select('id,guild_id,owner_user_id,created_by,updated_by')
      .is('owner_user_id', null)
      .order('created_at', { ascending: true })
      .range(0, BATCH_SIZE - 1);

    if (error) {
      throw new Error(`[privacy-backfill] memory_items read failed: ${error.message}`);
    }

    const rows = (data || []) as MemoryItemRow[];
    if (rows.length === 0) {
      break;
    }

    const ids = rows.map((row) => row.id);
    const { data: sourceRows, error: sourceError } = await client
      .from('memory_sources')
      .select('memory_item_id,source_author_id')
      .in('memory_item_id', ids)
      .not('source_author_id', 'is', null)
      .limit(5000);

    if (sourceError) {
      throw new Error(`[privacy-backfill] memory_sources read failed: ${sourceError.message}`);
    }

    const byItem = new Map<string, string[]>();
    for (const row of (sourceRows || []) as MemorySourceRow[]) {
      const id = String(row.memory_item_id || '').trim();
      const authorId = toMaybeUserId(row.source_author_id);
      if (!id || !authorId) continue;
      const list = byItem.get(id) || [];
      list.push(authorId);
      byItem.set(id, list);
    }

    for (const row of rows) {
      processed += 1;
      const candidates = byItem.get(row.id) || [];

      // Pick most frequent source author if multiple exist.
      const frequency = new Map<string, number>();
      for (const candidate of candidates) {
        frequency.set(candidate, (frequency.get(candidate) || 0) + 1);
      }
      const topFromSources = [...frequency.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([userId]) => userId)[0];

      const fallback = toMaybeUserId(row.created_by) || toMaybeUserId(row.updated_by);
      const ownerUserId = topFromSources || fallback;
      if (!ownerUserId) {
        continue;
      }

      const { error: updateError } = await client
        .from('memory_items')
        .update({ owner_user_id: ownerUserId })
        .eq('id', row.id)
        .eq('guild_id', row.guild_id);

      if (updateError) {
        throw new Error(`[privacy-backfill] update failed id=${row.id}: ${updateError.message}`);
      }

      updated += 1;
    }

    console.log(`[privacy-backfill] processed=${processed} updated=${updated}`);
  }

  console.log(`[privacy-backfill] done processed=${processed} updated=${updated}`);
};

main().catch((error) => {
  console.error('[privacy-backfill] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
