/**
 * Ventyd Adapter for Supabase (via @supabase/supabase-js REST API).
 *
 * Implements the Ventyd Adapter interface using Supabase's PostgREST client.
 * No Prisma or direct PostgreSQL connection required.
 *
 * Table required: `ventyd_events` with columns:
 *   event_id (text PK), event_name (text), entity_name (text), entity_id (text),
 *   body (jsonb), event_created_at (timestamptz), version (int)
 */
import type { Adapter } from 'ventyd';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SupabaseAdapterOptions = {
  client: SupabaseClient;
  /** Table name for events. Default: 'ventyd_events' */
  eventsTable?: string;
};

type EventRow = {
  event_id: string;
  event_name: string;
  entity_name: string;
  entity_id: string;
  body: unknown;
  event_created_at: string;
  version: number | null;
};

export function createSupabaseAdapter(options: SupabaseAdapterOptions): Adapter {
  const { client, eventsTable = 'ventyd_events' } = options;

  return {
    async getEventsByEntityId({ entityName, entityId }) {
      const { data, error } = await client
        .from(eventsTable)
        .select('*')
        .eq('entity_name', entityName)
        .eq('entity_id', entityId)
        .order('event_created_at', { ascending: true });

      if (error) {
        throw new Error(`[ventyd-supabase] getEvents failed: ${error.message}`);
      }

      return (data as EventRow[]).map((row) => ({
        eventId: row.event_id,
        eventName: row.event_name,
        entityName: row.entity_name,
        entityId: row.entity_id,
        body: row.body,
        eventCreatedAt: row.event_created_at,
        version: row.version ?? undefined,
      }));
    },

    async commitEvents({ events }) {
      if (events.length === 0) return;

      const rows = events.map((event: any) => ({
        event_id: event.eventId,
        event_name: event.eventName,
        entity_name: event.entityName,
        entity_id: event.entityId,
        body: event.body,
        event_created_at: event.eventCreatedAt,
        version: event.version ?? null,
      }));

      const { error } = await client.from(eventsTable).insert(rows);

      if (error) {
        throw new Error(`[ventyd-supabase] commitEvents failed: ${error.message}`);
      }
    },
  };
}
