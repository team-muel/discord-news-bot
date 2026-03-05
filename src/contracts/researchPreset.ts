export const RESEARCH_PRESET_KEYS = ['embedded', 'studio'] as const;

export type ResearchPresetKey = (typeof RESEARCH_PRESET_KEYS)[number];

export type ResolvedResearchPreset = {
  key: ResearchPresetKey;
  page: { mainClassName: string };
  stepNav: { ariaLabel: string; showLabels: boolean; showSeparators: boolean };
  core: { feedsLabel: string; viewsLabel: string; libraryLabel: string };
  hero: {
    layout: 'embedded' | 'studio';
    overline: string;
    title: string;
    description: string;
    studio?: {
      ctas: Array<{ label: string; to: string; variant: 'solid' | 'outline'; size: 'lg' | 'md' }>;
      kpi: {
        kicker: string;
        listAriaLabel: string;
        footnoteLabel: string;
        footnoteLinkLabel: string;
        footnoteLinkTo: string;
      };
    };
  };
  charts: {
    radar: { title: string; subtitle: string };
    trend: { title: string; subtitle: string };
    premium: { title: string; subtitle: string; lockLabel: string };
  };
  data: {
    connectors: Array<{ id: string; title: string; status: string; description: string }>;
    workbench: { feeds: string[]; views: string[]; library: string[] };
    radar: { metrics: Array<{ label: string; value: number }> };
    trend: { labels: string[]; values: number[] };
    premium: { rows: Array<{ label: string; value: string }> };
  };
};

export type ResearchPresetHistoryEntry = {
  id: string;
  presetKey: ResearchPresetKey;
  actorUserId: string;
  actorUsername: string;
  source: string;
  payload: ResolvedResearchPreset;
  metadata?: Record<string, unknown>;
  createdAt: string;
};
