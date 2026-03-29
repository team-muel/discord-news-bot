import { describe, it, expect, afterEach } from 'vitest';
import { atomicWriteFileSync, atomicWriteFile } from './atomicWrite';
import { readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, '../../tmp/test-atomic');
const cleanup: string[] = [];

function ensureDir() {
  mkdirSync(TMP_DIR, { recursive: true });
}

afterEach(() => {
  for (const f of cleanup) {
    try { unlinkSync(f); } catch { /* ignore */ }
    try { unlinkSync(`${f}.tmp`); } catch { /* ignore */ }
  }
  cleanup.length = 0;
});

describe('atomicWriteFileSync', () => {
  it('writes file atomically (temp file cleaned up)', () => {
    ensureDir();
    const fp = path.join(TMP_DIR, 'sync-test.json');
    cleanup.push(fp);

    atomicWriteFileSync(fp, '{"ok":true}');

    expect(readFileSync(fp, 'utf-8')).toBe('{"ok":true}');
    expect(existsSync(`${fp}.tmp`)).toBe(false);
  });

  it('overwrites existing file', () => {
    ensureDir();
    const fp = path.join(TMP_DIR, 'sync-overwrite.json');
    cleanup.push(fp);

    atomicWriteFileSync(fp, 'first');
    atomicWriteFileSync(fp, 'second');

    expect(readFileSync(fp, 'utf-8')).toBe('second');
  });
});

describe('atomicWriteFile (async)', () => {
  it('writes file atomically', async () => {
    ensureDir();
    const fp = path.join(TMP_DIR, 'async-test.json');
    cleanup.push(fp);

    await atomicWriteFile(fp, '{"async":true}');

    expect(readFileSync(fp, 'utf-8')).toBe('{"async":true}');
    expect(existsSync(`${fp}.tmp`)).toBe(false);
  });

  it('overwrites existing file', async () => {
    ensureDir();
    const fp = path.join(TMP_DIR, 'async-overwrite.json');
    cleanup.push(fp);

    await atomicWriteFile(fp, 'one');
    await atomicWriteFile(fp, 'two');

    expect(readFileSync(fp, 'utf-8')).toBe('two');
  });
});
