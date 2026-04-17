import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveAdapterImportSpec } from './adapterAutoLoader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('adapterAutoLoader', () => {
  it('builds file URL import specifiers for absolute module paths', () => {
    const modulePath = path.join(__dirname, 'externalAdapterTypes.ts');
    const importSpec = resolveAdapterImportSpec(modulePath);

    expect(importSpec).toBe(pathToFileURL(modulePath).href);
    expect(importSpec.startsWith('file:')).toBe(true);
    expect(importSpec).not.toBe(modulePath);
  });

  it('normalizes Windows drive paths to file URLs on Windows', () => {
    if (process.platform !== 'win32') {
      return;
    }

    const modulePath = path.win32.join('C:\\repo', 'src', 'services', 'tools', 'sampleAdapter.ts');
    expect(resolveAdapterImportSpec(modulePath)).toBe(pathToFileURL(modulePath).href);
  });
});