/**
 * Atomic file write utilities — inspired by Cline's storage.md (write-then-rename).
 *
 * Ensures file writes survive process crashes:
 *  1. Write to `<path>.tmp`
 *  2. Rename (atomic on POSIX and NTFS)
 *
 * If the process dies between step 1 and 2, the original file is untouched.
 */

import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';

/**
 * Synchronous atomic write: write to temp then rename.
 * Falls back to direct write if rename fails (e.g. cross-device).
 */
export function atomicWriteFileSync(filePath: string, data: string, encoding: BufferEncoding = 'utf-8'): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, data, encoding);
  try {
    renameSync(tmpPath, filePath);
  } catch {
    // Cross-device rename not supported — fall back to direct write
    writeFileSync(filePath, data, encoding);
    try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
}

/**
 * Async atomic write: write to temp then rename.
 * Falls back to direct write if rename fails.
 */
export async function atomicWriteFile(filePath: string, data: string, encoding: BufferEncoding = 'utf-8'): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, data, encoding);
  try {
    await rename(tmpPath, filePath);
  } catch {
    await writeFile(filePath, data, encoding);
    await unlink(tmpPath).catch(() => {});
  }
}
