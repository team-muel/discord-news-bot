/* eslint-disable no-console */
import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getObsidianVaultRoot } from '../src/utils/obsidianEnv';
import { upsertObsidianGuildDocument } from '../src/services/obsidian/authoring';

const parseArgs = (): { guildId: string; fileName: string } => {
  const args = process.argv.slice(2);
  let guildId = String(process.env.OBSIDIAN_VERIFY_GUILD_ID || '').trim();
  let fileName = 'Guild_Lore';

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();
    if (current === '--guild' || current === '--guild-id') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        guildId = value;
      }
      i += 1;
      continue;
    }

    if (current === '--file' || current === '--file-name') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        fileName = value;
      }
      i += 1;
    }
  }

  return { guildId, fileName };
};

const main = async (): Promise<void> => {
  const { guildId, fileName } = parseArgs();
  if (!guildId) {
    console.error('[obsidian-verify] Missing guild id. Pass --guild <id> or set OBSIDIAN_VERIFY_GUILD_ID');
    process.exit(2);
  }

  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    console.error('[obsidian-verify] Missing vault path. Set OBSIDIAN_SYNC_VAULT_PATH or OBSIDIAN_VAULT_PATH');
    process.exit(2);
  }

  const marker = `obsidian-verify-${Date.now()}`;
  const body = [
    '# Obsidian Write Verification',
    '',
    `- marker: ${marker}`,
    `- verified_at: ${new Date().toISOString()}`,
    '- source: scripts/verify-obsidian-write.ts',
  ].join('\n');

  const result = await upsertObsidianGuildDocument({
    guildId,
    vaultPath,
    fileName,
    content: body,
    tags: ['verification', 'obsidian-sync'],
    properties: {
      schema: 'muel-note/v1',
      category: 'operations',
      verification: true,
      updated_at: new Date().toISOString(),
    },
  });

  if (!result.ok || !result.path) {
    console.error(`[obsidian-verify] write failed reason=${result.reason || 'WRITE_FAILED'}`);
    process.exit(1);
  }

  const absolutePath = path.resolve(vaultPath, result.path);
  const saved = await fs.readFile(absolutePath, 'utf8');
  if (!saved.includes(marker)) {
    console.error(`[obsidian-verify] marker mismatch path=${absolutePath}`);
    process.exit(1);
  }

  console.log('[obsidian-verify] OK');
  console.log(`[obsidian-verify] guildId=${guildId}`);
  console.log(`[obsidian-verify] relativePath=${result.path}`);
  console.log(`[obsidian-verify] absolutePath=${absolutePath}`);
  console.log(`[obsidian-verify] marker=${marker}`);
};

main().catch((error) => {
  console.error('[obsidian-verify] unexpected error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
