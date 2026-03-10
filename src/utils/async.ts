export const runWithConcurrency = async <T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> => {
  if (items.length === 0) {
    return;
  }

  const laneCount = Math.min(Math.max(1, Math.trunc(concurrency)), items.length);
  let cursor = 0;

  const lanes = Array.from({ length: laneCount }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) {
        return;
      }

      await worker(items[idx]);
    }
  });

  await Promise.all(lanes);
};
