/* eslint-disable no-console */
import fs from 'node:fs/promises';
import path from 'node:path';

const toSingleLine = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const readArg = (name) => {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return '';
  return String(process.argv[idx + 1] || '').trim();
};

const guildId = readArg('--guild') || readArg('--guild-id');
const goal = readArg('--goal');
const vaultPath = readArg('--vault') || readArg('--vault-path');

if (!guildId || !vaultPath) {
  console.error('usage: node scripts/obsidian-headless.mjs --guild <guildId> --goal <goal> --vault <vaultPath>');
  process.exit(2);
}

const candidateFiles = [
  path.join(vaultPath, 'guilds', guildId, 'Guild_Lore.md'),
  path.join(vaultPath, 'guilds', guildId, 'Server_History.md'),
  path.join(vaultPath, 'guilds', guildId, 'Decision_Log.md'),
];

const out = [];
if (goal) {
  out.push(`[goal] ${toSingleLine(goal).slice(0, 180)}`);
}

for (const filePath of candidateFiles) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .slice(0, 6)
      .map((line) => toSingleLine(line));

    if (lines.length > 0) {
      out.push(`[${path.basename(filePath)}] ${lines.join(' | ')}`);
    }
  } catch {
    // Ignore missing files.
  }
}

for (const line of out) {
  console.log(line);
}
