import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapObsidianGuildKnowledgeTree } from './obsidianBootstrapService';

const tempRoots: string[] = [];

const rememberTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'obsidian-bootstrap-'));
  tempRoots.push(root);
  return root;
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bootstrapObsidianGuildKnowledgeTree', () => {
  it('writes canonical guild baseline documents', async () => {
    const vaultRoot = await rememberTempRoot();
    const guildId = '123456789012345678';

    const summary = await bootstrapObsidianGuildKnowledgeTree({
      guildId,
      vaultPath: vaultRoot,
    });

    const guildRoot = path.join(vaultRoot, 'guilds', guildId);
    expect(summary.manifestStatus).toBe('created');
    expect(summary.createdFiles).toBe(8);
    expect(summary.updatedFiles).toBe(0);
    expect(summary.skippedFiles).toBe(0);

    await expect(pathExists(path.join(guildRoot, 'Guild_Lore.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(guildRoot, 'Server_History.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(guildRoot, 'Decision_Log.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(guildRoot, 'customer', 'PROFILE.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(guildRoot, 'customer', 'REQUIREMENTS.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(guildRoot, 'customer', 'ISSUES.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(guildRoot, 'customer', 'ESCALATIONS.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(guildRoot, 'README.md'))).resolves.toBe(true);

    await expect(pathExists(path.join(guildRoot, 'memory', 'semantic', 'Guild_Lore.md'))).resolves.toBe(false);
    await expect(pathExists(path.join(guildRoot, 'policy', 'Decision_Log.md'))).resolves.toBe(false);
  });

  it('still seeds canonical docs when legacy bootstrap files exist', async () => {
    const vaultRoot = await rememberTempRoot();
    const guildId = '123456789012345678';
    const guildRoot = path.join(vaultRoot, 'guilds', guildId);

    await mkdir(path.join(guildRoot, 'memory', 'semantic'), { recursive: true });
    await mkdir(path.join(guildRoot, 'policy'), { recursive: true });
    await writeFile(path.join(guildRoot, 'memory', 'semantic', 'Guild_Lore.md'), '# legacy lore', 'utf8');
    await writeFile(path.join(guildRoot, 'policy', 'Decision_Log.md'), '# legacy decisions', 'utf8');

    const summary = await bootstrapObsidianGuildKnowledgeTree({
      guildId,
      vaultPath: vaultRoot,
    });

    expect(summary.createdFiles).toBe(8);
    await expect(pathExists(path.join(guildRoot, 'Guild_Lore.md'))).resolves.toBe(true);
    await expect(pathExists(path.join(guildRoot, 'Decision_Log.md'))).resolves.toBe(true);
  });
});