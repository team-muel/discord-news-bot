import type { BenchmarkPayload } from '../backend/benchmark/types';

export type BenchmarkMemoryEvent = {
  id: string;
  name: string;
  payload?: BenchmarkPayload;
  path: string;
  ts: string;
};

export const createBenchmarkMemoryStore = () => {
  const store = new Map<string, BenchmarkMemoryEvent[]>();

  const appendBenchmarkMemoryEvents = (userId: string, events: BenchmarkMemoryEvent[]) => {
    const existing = store.get(userId) || [];
    store.set(userId, [...existing, ...events].slice(-1200));
  };

  const getUserBenchmarkEvents = (userId: string) => {
    return store.get(userId) || [];
  };

  return {
    store,
    appendBenchmarkMemoryEvents,
    getUserBenchmarkEvents,
  };
};
