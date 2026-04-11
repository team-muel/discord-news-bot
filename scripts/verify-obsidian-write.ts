/* eslint-disable no-console */
import 'dotenv/config';
import { getObsidianVaultRoot } from '../src/utils/obsidianEnv';
import { upsertObsidianGuildDocument, upsertObsidianSystemDocument } from '../src/services/obsidian/authoring';
import { readObsidianFileWithAdapter } from '../src/services/obsidian/router';

const todayKey = (): string => new Date().toISOString().slice(0, 10);

const buildDefaultSystemFile = (): string => `ops/improvement/corrections/${todayKey()}_obsidian-live-verify`;

const parseArgs = (): {
  guildId: string;
  fileName: string;
  systemFile: string;
  preferSystem: boolean;
  simulateCorrection: boolean;
} => {
  const args = process.argv.slice(2);
  let guildId = String(process.env.OBSIDIAN_VERIFY_GUILD_ID || '').trim();
  let fileName = 'events/verification/obsidian_live_verify';
  let systemFile = buildDefaultSystemFile();
  let preferSystem = false;
  let simulateCorrection = true;

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
      continue;
    }

    if (current === '--system-file') {
      const value = String(args[i + 1] || '').trim();
      if (value) {
        systemFile = value;
        preferSystem = true;
      }
      i += 1;
      continue;
    }

    if (current === '--no-correction') {
      simulateCorrection = false;
    }
  }

  return { guildId, fileName, systemFile, preferSystem, simulateCorrection };
};

const buildVerificationBody = (params: {
  marker: string;
  phase: 'create' | 'correction';
  incidentState: 'initial' | 'corrected';
  mode: 'guild' | 'system';
  guildId: string;
}): string => {
  return [
    '# Obsidian Live Verification',
    '',
    `- marker: ${params.marker}`,
    `- verified_at: ${new Date().toISOString()}`,
    '- source: scripts/verify-obsidian-write.ts',
    `- mode: ${params.mode}`,
    `- phase: ${params.phase}`,
    `- incident_state: ${params.incidentState}`,
    `- guild_id: ${params.guildId}`,
  ].join('\n');
};

const buildProperties = (params: {
  marker: string;
  status: 'active' | 'corrected';
  mode: 'guild' | 'system';
  guildId: string;
}) => ({
  title: 'Obsidian Live Verification',
  source_kind: 'verification-probe',
  status: params.status,
  verified_at: new Date().toISOString(),
  marker: params.marker,
  mode: params.mode,
  guild_id: params.guildId,
});

const main = async (): Promise<void> => {
  const { guildId, fileName, systemFile, preferSystem, simulateCorrection } = parseArgs();

  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    console.error('[obsidian-verify] Missing vault path. Set OBSIDIAN_SYNC_VAULT_PATH or OBSIDIAN_VAULT_PATH');
    process.exit(2);
  }

  const mode: 'guild' | 'system' = !guildId || preferSystem ? 'system' : 'guild';
  const effectiveGuildId = mode === 'guild' ? guildId : 'system';
  const effectiveFileName = mode === 'guild' ? fileName : systemFile;
  const marker = `obsidian-verify-${Date.now()}`;
  const initialBody = buildVerificationBody({
    marker,
    phase: 'create',
    incidentState: 'initial',
    mode,
    guildId: effectiveGuildId,
  });
  const correctedBody = buildVerificationBody({
    marker,
    phase: 'correction',
    incidentState: 'corrected',
    mode,
    guildId: effectiveGuildId,
  });

  const writeOnce = async (body: string, status: 'active' | 'corrected') => {
    if (mode === 'guild') {
      return upsertObsidianGuildDocument({
        guildId,
        vaultPath,
        fileName: effectiveFileName,
        content: body,
        tags: ['verification', 'obsidian-live', 'guild-verify'],
        properties: buildProperties({ marker, status, mode, guildId: effectiveGuildId }),
      });
    }

    return upsertObsidianSystemDocument({
      vaultPath,
      fileName: effectiveFileName,
      content: body,
      tags: ['verification', 'obsidian-live', 'system-verify'],
      properties: buildProperties({ marker, status, mode, guildId: effectiveGuildId }),
    });
  };

  const firstWrite = await writeOnce(initialBody, 'active');
  if (!firstWrite.ok || !firstWrite.path) {
    console.error(`[obsidian-verify] initial write failed reason=${firstWrite.reason || 'WRITE_FAILED'}`);
    process.exit(1);
  }

  const finalWrite = simulateCorrection
    ? await writeOnce(correctedBody, 'corrected')
    : firstWrite;
  if (!finalWrite.ok || !finalWrite.path) {
    console.error(`[obsidian-verify] correction write failed reason=${finalWrite.reason || 'WRITE_FAILED'}`);
    process.exit(1);
  }

  const saved = await readObsidianFileWithAdapter({
    vaultPath,
    filePath: finalWrite.path,
  });
  if (typeof saved !== 'string') {
    console.error(`[obsidian-verify] readback failed path=${finalWrite.path}`);
    process.exit(1);
  }
  if (!saved.includes(marker)) {
    console.error(`[obsidian-verify] marker mismatch path=${finalWrite.path}`);
    process.exit(1);
  }

  if (simulateCorrection && !saved.includes('incident_state: corrected')) {
    console.error(`[obsidian-verify] correction mismatch path=${finalWrite.path}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    mode,
    guildId: effectiveGuildId,
    relativePath: finalWrite.path,
    marker,
    corrected: simulateCorrection,
    preview: saved.slice(0, 320),
  }, null, 2));
};

main().catch((error) => {
  console.error('[obsidian-verify] unexpected error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
