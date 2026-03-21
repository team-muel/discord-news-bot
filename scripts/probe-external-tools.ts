/**
 * probe-external-tools.ts — CLI runner for the external tool probe module.
 * Usage: npx tsx scripts/probe-external-tools.ts [--json]
 */
import 'dotenv/config';
import { probeAllExternalTools } from '../src/services/tools/externalToolProbe';

const jsonMode = process.argv.includes('--json');

async function main() {
  const result = await probeAllExternalTools();

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  console.log('');
  console.log('=== External Tool Probe ===');
  console.log(`Timestamp: ${result.timestamp}`);
  console.log('');

  for (const tool of result.tools) {
    const status = tool.available ? '\x1b[32m[OK]\x1b[0m  ' : '\x1b[31m[MISS]\x1b[0m';
    const ver = tool.version ? ` (${tool.version})` : '';
    const api = tool.apiReachable === true
      ? ' \x1b[32mAPI✓\x1b[0m'
      : tool.apiReachable === false
        ? ' \x1b[31mAPI✗\x1b[0m'
        : '';
    console.log(`${status} ${tool.name}${ver}${api}`);
    for (const d of tool.details) {
      console.log(`       ${d}`);
    }
  }

  console.log('');
  console.log(`Summary: ${result.summary.available}/${result.summary.total} available, ${result.summary.apiReachable} APIs reachable`);
  console.log('');
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
