import 'dotenv/config';

import { parseArg, parseBool } from './lib/cliArgs.mjs';
import {
  getHermesVsCodeBridgeStatus,
  runHermesVsCodeBridge,
} from '../src/services/runtime/hermesVsCodeBridgeService.ts';

async function main() {
  const statusOnly = parseBool(parseArg('status', 'false'), false);
  const action = parseArg('action', '');
  const dryRun = parseBool(parseArg('dryRun', 'false'), false);
  const filePath = parseArg('filePath', '');
  const targetPath = parseArg('targetPath', '');
  const leftPath = parseArg('leftPath', '');
  const rightPath = parseArg('rightPath', '');
  const packetPath = parseArg('packetPath', '');
  const codeCliPath = parseArg('codeCliPath', '');
  const vaultPath = parseArg('vaultPath', '');
  const reason = parseArg('reason', '');
  const prompt = parseArg('prompt', '');
  const chatMode = parseArg('chatMode', '');
  const maximize = parseBool(parseArg('maximize', 'false'), false);
  const newWindow = parseBool(parseArg('newWindow', 'false'), false);
  const reuseWindow = parseBool(parseArg('reuseWindow', 'true'), true);
  const addFilePaths = parseArg('addFilePaths', '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const lineRaw = parseArg('line', '');
  const columnRaw = parseArg('column', '');
  const line = lineRaw ? Number(lineRaw) : null;
  const column = columnRaw ? Number(columnRaw) : null;

  if (statusOnly) {
    console.log(JSON.stringify(getHermesVsCodeBridgeStatus({
      codeCliPath: codeCliPath || null,
      packetPath: packetPath || null,
      vaultPath: vaultPath || null,
    }), null, 2));
    return;
  }

  if (!action) {
    console.error('Missing --action. Use --status=true for diagnostics or pass an allowlisted action.');
    process.exit(1);
  }

  const result = await runHermesVsCodeBridge({
    action,
    filePath: filePath || null,
    targetPath: targetPath || null,
    leftPath: leftPath || null,
    rightPath: rightPath || null,
    line: Number.isFinite(line) ? line : null,
    column: Number.isFinite(column) ? column : null,
    packetPath: packetPath || null,
    codeCliPath: codeCliPath || null,
    vaultPath: vaultPath || null,
    reason: reason || null,
    prompt: prompt || null,
    chatMode: chatMode || null,
    addFilePaths,
    maximize,
    newWindow,
    reuseWindow,
    dryRun,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});