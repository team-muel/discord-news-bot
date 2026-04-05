/**
 * One-shot migration script: replace string-based error branching in route files
 * with `next(error)` delegation to the global error handler.
 *
 * Transformations:
 * 1. Multi-line catch blocks with `if (message === ...)` → `catch (error) { next(error); }`
 * 2. `async (req, res) =>` → `async (req, res, next) =>` (only for handlers containing next())
 *
 * Run: node --experimental-strip-types scripts/migrate-route-errors.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

const ROUTE_FILES = [
  'src/routes/bot-agent/memoryRoutes.ts',
  'src/routes/bot-agent/runtimeRoutes.ts',
  'src/routes/bot-agent/governanceRoutes.ts',
  'src/routes/bot-agent/qualityPrivacyRoutes.ts',
  'src/routes/bot-agent/learningRoutes.ts',
  'src/routes/bot-agent/gotRoutes.ts',
  'src/routes/bot-agent/coreRoutes.ts',
];

/**
 * Find catch blocks that start with `const message = error instanceof Error ...`
 * and replace the entire block body with `next(error)`.
 * Works line-by-line using brace-depth tracking.
 */
function transformFile(src: string): { result: string; catchCount: number; sigCount: number } {
  const lines = src.split('\n');
  const output: string[] = [];
  let catchCount = 0;
  let inCatchBlock = false;
  let braceDepth = 0;
  let catchIndent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect catch block start: `} catch (error) {`
    if (!inCatchBlock && trimmed === '} catch (error) {') {
      // Peek at next line to check if it's the string-matching pattern
      const nextLine = (lines[i + 1] ?? '').trim();
      if (nextLine.startsWith('const message = error instanceof Error')) {
        // Start consuming the catch block
        inCatchBlock = true;
        braceDepth = 1; // the opening `{` of catch
        catchIndent = line.slice(0, line.indexOf('}'));
        catchCount++;

        // Emit the replacement
        output.push(`${catchIndent}} catch (error) {`);
        output.push(`${catchIndent}  next(error);`);

        // Skip lines until we find the matching closing brace
        i++; // skip the `const message = ...` line
        for (i = i + 1; i < lines.length; i++) {
          const innerLine = lines[i];
          for (const ch of innerLine) {
            if (ch === '{') braceDepth++;
            if (ch === '}') braceDepth--;
          }
          if (braceDepth === 0) {
            // This is the closing `}` of the catch block
            output.push(`${catchIndent}}`);
            inCatchBlock = false;
            break;
          }
        }
        continue;
      }
    }

    output.push(line);
  }

  // Step 2: Add `next` parameter to handler signatures that contain next(error)
  let result = output.join('\n');
  let sigCount = 0;

  // Only add `next` to handlers that actually call `next(error)`
  // Handle (req, res), (_req, res), and (req, _res) patterns
  result = result.replace(/async \(_?req, _?res\) =>/g, (match, offset) => {
    const after = result.slice(offset, offset + 5000);
    if (after.includes('next(error)')) {
      sigCount++;
      return match.replace(/\(_?req, _?res\)/, (paren) => {
        // Extract the actual param names and add next
        const inner = paren.slice(1, -1); // remove parens
        return `(${inner}, next)`;
      });
    }
    return match;
  });

  return { result, catchCount, sigCount };
}

let totalCatch = 0;
let totalSig = 0;

for (const relPath of ROUTE_FILES) {
  const absPath = resolve(ROOT, relPath);
  const raw = readFileSync(absPath, 'utf-8');
  const hasCRLF = raw.includes('\r\n');
  // Normalize to LF for processing
  const src = raw.replace(/\r\n/g, '\n');
  const { result, catchCount, sigCount } = transformFile(src);

  // Restore original line ending style
  const final = hasCRLF ? result.replace(/\n/g, '\r\n') : result;

  if (final !== raw) {
    writeFileSync(absPath, final, 'utf-8');
    console.log(`✅ ${relPath}: ${catchCount} catch blocks, ${sigCount} signatures`);
  } else {
    console.log(`⏭️  ${relPath}: no changes needed`);
  }

  totalCatch += catchCount;
  totalSig += sigCount;
}

console.log(`\nTotal: ${totalCatch} catch blocks replaced, ${totalSig} signatures updated`);
