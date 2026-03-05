import { RESEARCH_PRESET_KEYS } from '../src/contracts/researchPreset';
import { getPreset, upsertPreset } from '../src/services/researchPresetStore';

for (const key of RESEARCH_PRESET_KEYS) {
  const preset = getPreset(key);
  upsertPreset({
    key,
    payload: preset,
    actorUserId: 'system-seed',
    actorUsername: 'system',
    source: 'seed',
    metadata: { reason: 'seed_research_presets' },
  });
}

console.log(`Seeded presets: ${RESEARCH_PRESET_KEYS.join(', ')}`);
