type BenchmarkEventPayload = Record<string, string | number | boolean | null | undefined>;

export type BenchmarkEventRecord = {
  id: string;
  name: string;
  payload?: BenchmarkEventPayload;
  ts: string;
  path: string;
};

type ReconnectSummary = {
  attempts: number;
  total: number;
  success: number;
  failed: number;
  rejected: number;
  bySource: Array<{ source: string; count: number }>;
  byReason: Array<{ reason: string; count: number }>;
  lastResultAt: string | null;
};

const MAX_EVENTS = 5000;
const benchmarkEvents: BenchmarkEventRecord[] = [];

export function appendBenchmarkEvents(events: BenchmarkEventRecord[]): void {
  if (!events.length) return;
  for (const event of events) {
    benchmarkEvents.push(event);
  }
  if (benchmarkEvents.length > MAX_EVENTS) {
    benchmarkEvents.splice(0, benchmarkEvents.length - MAX_EVENTS);
  }
}

export function summarizeReconnectEvents(): ReconnectSummary {
  const reconnectEvents = benchmarkEvents.filter((event) =>
    String(event.name).includes('reconnect') || String(event.name).includes('bot_status'),
  );

  const bySourceMap = new Map<string, number>();
  const byReasonMap = new Map<string, number>();

  let success = 0;
  let failed = 0;
  let rejected = 0;

  for (const event of reconnectEvents) {
    const source = String(event.payload?.source || 'unknown');
    bySourceMap.set(source, (bySourceMap.get(source) || 0) + 1);

    const status = String(event.payload?.status || '').toUpperCase();
    const reason = String(event.payload?.reason || status || 'UNKNOWN').toUpperCase();

    if (status === 'OK' || status === 'SUCCESS') success += 1;
    else if (status === 'REJECTED') rejected += 1;
    else failed += 1;

    byReasonMap.set(reason, (byReasonMap.get(reason) || 0) + 1);
  }

  const sortedSources = [...bySourceMap.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  const sortedReasons = [...byReasonMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    attempts: reconnectEvents.length,
    total: reconnectEvents.length,
    success,
    failed,
    rejected,
    bySource: sortedSources,
    byReason: sortedReasons,
    lastResultAt: reconnectEvents.length ? reconnectEvents[reconnectEvents.length - 1].ts : null,
  };
}
