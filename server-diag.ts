/**
 * Diagnostic wrapper for Render deploys.
 * Wraps server.ts startup with full error capture.
 * Remove after debugging is complete.
 */
import 'dotenv/config';

// Capture all unhandled errors before they kill the process
process.on('uncaughtException', (err) => {
  console.error('[DIAG] uncaughtException:', err.message);
  console.error('[DIAG] stack:', err.stack);
  // Let Node handle it (exit with 1)
});

process.on('unhandledRejection', (reason) => {
  console.error('[DIAG] unhandledRejection:', reason instanceof Error ? reason.message : String(reason));
  if (reason instanceof Error) console.error('[DIAG] stack:', reason.stack);
});

console.log('[DIAG] Node version:', process.version);
console.log('[DIAG] Platform:', process.platform, process.arch);
console.log('[DIAG] Memory:', JSON.stringify(process.memoryUsage()));
console.log('[DIAG] CWD:', process.cwd());
console.log('[DIAG] ENV keys:', Object.keys(process.env).filter(k => !k.startsWith('npm_')).sort().join(', '));

try {
  console.log('[DIAG] Loading server.ts...');
  await import('./server.ts');
  console.log('[DIAG] server.ts loaded successfully');
} catch (err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error('[DIAG] IMPORT CRASH:', e.message);
  console.error('[DIAG] stack:', e.stack);
  process.exit(1);
}

// Keep alive and report memory periodically (30s)
setInterval(() => {
  const mem = process.memoryUsage();
  console.log('[DIAG] alive, heapUsed=%dMB rss=%dMB',
    Math.round(mem.heapUsed / 1048576),
    Math.round(mem.rss / 1048576),
  );
}, 30_000);
