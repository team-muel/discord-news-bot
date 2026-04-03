/* eslint-disable no-console */
import 'dotenv/config';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bootstrapObsidianGuildKnowledgeTree } from '../src/services/obsidian/obsidianBootstrapService';

type CliOptions = {
  guildIds: string[];
  vaultPath: string;
  force: boolean;
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);

  const guildIds = new Set<string>();
  let vaultPath = String(process.env.OBSIDIAN_SYNC_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH || '').trim();
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();

    if (current === '--guild' || current === '--guild-id') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        for (const token of value.split(',').map((item) => item.trim()).filter(Boolean)) {
          guildIds.add(token);
        }
      }
      i += 1;
      continue;
    }

    if (current === '--vault' || current === '--vault-path') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        vaultPath = value;
      }
      i += 1;
      continue;
    }

    if (current === '--force') {
      force = true;
    }
  }

  return {
    guildIds: [...guildIds],
    vaultPath,
    force,
  };
};

const validateGuildId = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!/^\d{6,30}$/.test(trimmed)) {
    return '';
  }
  return trimmed;
};

const main = async (): Promise<void> => {
  const options = parseArgs();

  if (!options.vaultPath) {
    console.error('[obsidian-bootstrap] vault path is required. Use --vault or set OBSIDIAN_SYNC_VAULT_PATH/OBSIDIAN_VAULT_PATH');
    process.exit(2);
  }

  const guildIds = options.guildIds
    .map((item) => validateGuildId(item))
    .filter(Boolean);

  if (guildIds.length === 0) {
    console.error('[obsidian-bootstrap] at least one valid guild id is required via --guild');
    process.exit(2);
  }

  const resolvedVault = path.resolve(options.vaultPath);
  await fs.mkdir(path.join(resolvedVault, 'guilds'), { recursive: true });

  for (const guildId of guildIds) {
    const summary = await bootstrapObsidianGuildKnowledgeTree({
      guildId,
      vaultPath: resolvedVault,
      force: options.force,
    });

    console.log(
      `[obsidian-bootstrap] guild=${summary.guildId} manifest=${summary.manifestStatus} files(created=${summary.createdFiles},updated=${summary.updatedFiles},skipped=${summary.skippedFiles})`,
    );
  }

  console.log(`[obsidian-bootstrap] completed guilds=${guildIds.length} force=${String(options.force)}`);
};

main().catch((error) => {
  console.error('[obsidian-bootstrap] fatal:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
