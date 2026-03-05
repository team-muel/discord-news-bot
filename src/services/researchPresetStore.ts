import crypto from 'crypto';
import {
  RESEARCH_PRESET_KEYS,
  type ResearchPresetHistoryEntry,
  type ResearchPresetKey,
  type ResolvedResearchPreset,
} from '../contracts/researchPreset';

const nowIso = () => new Date().toISOString();

const BASE_CONNECTORS = [
  {
    id: 'macro-api',
    title: 'Macro API',
    status: 'CONNECTED',
    description: 'Macro data source is connected and synchronized.',
  },
  {
    id: 'quant-api',
    title: 'Quant Signals API',
    status: 'MONITORING',
    description: 'Signal anomaly detection is currently monitoring.',
  },
  {
    id: 'publish-api',
    title: 'Publish Metadata Feed',
    status: 'REFERENCE',
    description: 'Published metadata feed is available for review.',
  },
];

const DEFAULT_PRESETS: Record<ResearchPresetKey, ResolvedResearchPreset> = {
  embedded: {
    key: 'embedded',
    page: { mainClassName: 'section-wrap section-v-80 section-cluster dashboard-kpay-flow' },
    stepNav: { ariaLabel: 'Research flow steps', showLabels: false, showSeparators: true },
    core: { feedsLabel: 'DATA FEEDS', viewsLabel: 'VISUAL MODES', libraryLabel: 'PREMIUM VIEW' },
    hero: {
      layout: 'embedded',
      overline: 'RESEARCH IN-APP LINKED SURFACE',
      title: 'Research Workspace',
      description: 'Embedded view for data exploration and published content access.',
    },
    charts: {
      radar: { title: 'Macro Risk Radar', subtitle: 'Macro risk layers' },
      trend: { title: 'Quant Signal Timeline', subtitle: 'Signal drift timeline' },
      premium: {
        title: 'Published Content Deck',
        subtitle: 'Operator published content layer',
        lockLabel: 'VIEW ONLY',
      },
    },
    data: {
      connectors: BASE_CONNECTORS,
      workbench: {
        feeds: ['FRED / ECOS', 'Yahoo / Polygon', 'Discord in-app context'],
        views: ['Multi-asset compare', 'Risk radar', 'Event timeline'],
        library: ['Published feed', 'Tag metadata', 'Latest checklist'],
      },
      radar: {
        metrics: [
          { label: 'Liquidity', value: 72 },
          { label: 'Volatility', value: 44 },
          { label: 'Momentum', value: 67 },
          { label: 'Risk Spread', value: 53 },
          { label: 'Sentiment', value: 61 },
          { label: 'Stability', value: 70 },
        ],
      },
      trend: {
        labels: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'],
        values: [61, 64, 66, 59, 71, 74, 69, 77],
      },
      premium: {
        rows: [
          { label: 'Core CPI Forecast', value: '3.42% -> 2.88%' },
          { label: 'Policy Rate Path', value: 'Q3 Pivot Probability 74%' },
          { label: 'FX Regime Shift', value: 'KRW Strength Window 5W' },
          { label: 'Risk-On Trigger', value: 'Liquidity Delta +18.6' },
        ],
      },
    },
  },
  studio: {
    key: 'studio',
    page: { mainClassName: 'section-wrap section-v-80 section-cluster dashboard-kpay-flow dashboard-main-shell' },
    stepNav: { ariaLabel: 'Research pipeline steps', showLabels: true, showSeparators: false },
    core: { feedsLabel: 'DATA FEEDS', viewsLabel: 'VISUAL MODES', libraryLabel: 'PUBLISHED LIBRARY' },
    hero: {
      layout: 'studio',
      overline: 'STUDIO RESEARCH CONTROL',
      title: 'Studio Operations',
      description: 'Studio view for operator-focused monitoring and controls.',
      studio: {
        ctas: [
          { label: 'Open In-App Workspace', to: '/in-app', variant: 'solid', size: 'lg' },
          { label: 'View Support Center', to: '/support', variant: 'outline', size: 'md' },
        ],
        kpi: {
          kicker: 'LIVE CONNECTOR SNAPSHOT',
          listAriaLabel: 'Current connector states',
          footnoteLabel: 'SOURCE OF TRUTH',
          footnoteLinkLabel: 'Validate in Embedded App',
          footnoteLinkTo: '/in-app',
        },
      },
    },
    charts: {
      radar: { title: 'Studio Macro Risk Radar', subtitle: 'Operator research layer' },
      trend: { title: 'Studio Quant Signal Timeline', subtitle: 'Signal timeline for editors' },
      premium: {
        title: 'Published Content Review Deck',
        subtitle: 'Review and read layer',
        lockLabel: 'REFERENCE VIEW',
      },
    },
    data: {
      connectors: [
        { ...BASE_CONNECTORS[0] },
        { ...BASE_CONNECTORS[1], status: 'READY' },
        { ...BASE_CONNECTORS[2], status: 'EDITORIAL READY' },
      ],
      workbench: {
        feeds: ['Macro APIs', 'Signal APIs', 'Discord in-app context'],
        views: ['Risk radar', 'Signal timeline', 'Premium deck'],
        library: ['Editorial queue', 'Metadata tags', 'Publish readiness'],
      },
      radar: {
        metrics: [
          { label: 'Liquidity', value: 75 },
          { label: 'Volatility', value: 47 },
          { label: 'Momentum', value: 69 },
          { label: 'Risk Spread', value: 57 },
          { label: 'Sentiment', value: 64 },
          { label: 'Stability', value: 73 },
        ],
      },
      trend: {
        labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
        values: [62, 63, 67, 65, 72, 75, 73, 79],
      },
      premium: {
        rows: [
          { label: 'Editorial Queue', value: '4 Scheduled / 1 Draft' },
          { label: 'Macro Revision Note', value: 'CPI Delta +0.18pt' },
          { label: 'Signal Confidence', value: 'Tier-A 68% / Tier-B 24%' },
          { label: 'Publish Readiness', value: 'Final QA 92%' },
        ],
      },
    },
  },
};

const presetStore = new Map<ResearchPresetKey, ResolvedResearchPreset>();
const historyStore = new Map<ResearchPresetKey, ResearchPresetHistoryEntry[]>();

for (const key of RESEARCH_PRESET_KEYS) {
  presetStore.set(key, structuredClone(DEFAULT_PRESETS[key]));
  historyStore.set(key, []);
}

export function isResearchPresetKey(value: string): value is ResearchPresetKey {
  return RESEARCH_PRESET_KEYS.includes(value as ResearchPresetKey);
}

export function getPreset(key: ResearchPresetKey): ResolvedResearchPreset {
  return structuredClone(presetStore.get(key) || DEFAULT_PRESETS[key]);
}

export function upsertPreset(params: {
  key: ResearchPresetKey;
  payload: ResolvedResearchPreset;
  actorUserId: string;
  actorUsername: string;
  source: string;
  metadata?: Record<string, unknown>;
}): ResolvedResearchPreset {
  const payload = structuredClone(params.payload);
  payload.key = params.key;
  presetStore.set(params.key, payload);

  const historyEntry: ResearchPresetHistoryEntry = {
    id: crypto.randomUUID(),
    presetKey: params.key,
    actorUserId: params.actorUserId,
    actorUsername: params.actorUsername,
    source: params.source,
    payload: structuredClone(payload),
    metadata: params.metadata,
    createdAt: nowIso(),
  };

  const list = historyStore.get(params.key) || [];
  list.unshift(historyEntry);
  historyStore.set(params.key, list.slice(0, 200));

  return structuredClone(payload);
}

export function getPresetHistory(key: ResearchPresetKey, limit = 20): ResearchPresetHistoryEntry[] {
  const list = historyStore.get(key) || [];
  const safeLimit = Math.max(1, Math.min(100, limit));
  return structuredClone(list.slice(0, safeLimit));
}

export function restorePresetFromHistory(params: {
  key: ResearchPresetKey;
  historyId: string;
  actorUserId: string;
  actorUsername: string;
}): { preset: ResolvedResearchPreset; restored: ResearchPresetHistoryEntry } | null {
  const list = historyStore.get(params.key) || [];
  const row = list.find((entry) => entry.id === params.historyId);
  if (!row) return null;

  const nextPreset = structuredClone(row.payload);
  nextPreset.key = params.key;
  presetStore.set(params.key, nextPreset);

  const restored: ResearchPresetHistoryEntry = {
    id: crypto.randomUUID(),
    presetKey: params.key,
    actorUserId: params.actorUserId,
    actorUsername: params.actorUsername,
    source: 'restore',
    payload: structuredClone(nextPreset),
    metadata: { restoredFrom: row.id },
    createdAt: nowIso(),
  };

  list.unshift(restored);
  historyStore.set(params.key, list.slice(0, 200));

  return {
    preset: structuredClone(nextPreset),
    restored,
  };
}
