/**
 * Metric Review Formatter — thin layer that reads existing infrastructure
 * (SystemGradient, ConvergenceReport, SLO, SprintMetrics, hybrid_weekly)
 * and formats them into a unified Metric Review snapshot.
 *
 * Zero new data collection — everything comes from existing services.
 */

// ──── KR Classification ───────────────────────────────────────────────────────

export type KeyResultArea = 'agent-quality' | 'system-reliability' | 'operational-efficiency';

const SOURCE_TO_KR: Record<string, KeyResultArea> = {
  'lacuna-detector': 'agent-quality',
  'quality-gate': 'agent-quality',
  'jarvis-bench': 'agent-quality',
  'weekly-patterns': 'system-reliability',
  'cross-loop-feedback': 'operational-efficiency',
  'jarvis-optimize': 'operational-efficiency',
};

type KrSummary = { label: string; health: 'on-track' | 'at-risk' | 'off-track' | 'no-data'; signals: number; topIssue: string | null };

// ──── Snapshot Assembly ───────────────────────────────────────────────────────

export type MetricReviewSnapshot = {
  krs: Record<KeyResultArea, KrSummary>;
  convergence: { verdict: string; benchTrend: string; qualityTrend: string; dataPoints: number } | null;
  slo: { decision: string; pass: number; warn: number; fail: number } | null;
  sprint: { successRate: number | null; scaffoldingRatio: number; totalPipelines: number } | null;
  gradient: { totalScore: number; topPriority: string | null; signalCount: number } | null;
  generatedAt: string;
};

export const generateMetricReviewSnapshot = async (): Promise<MetricReviewSnapshot> => {
  const now = new Date().toISOString();
  const krs: Record<KeyResultArea, KrSummary> = {
    'agent-quality': { label: 'KR1: 에이전트 응답 품질', health: 'no-data', signals: 0, topIssue: null },
    'system-reliability': { label: 'KR2: 시스템 안정성', health: 'no-data', signals: 0, topIssue: null },
    'operational-efficiency': { label: 'KR3: 운영 효율', health: 'no-data', signals: 0, topIssue: null },
  };

  // 1. Gradient → KR classification
  let gradient: MetricReviewSnapshot['gradient'] = null;
  try {
    const { computeSystemGradient } = await import('./sprint/selfImprovementLoop');
    const g = await computeSystemGradient();
    gradient = { totalScore: g.totalScore, topPriority: g.topPriority?.description ?? null, signalCount: g.signals.length };
    for (const sig of g.signals) {
      const kr = SOURCE_TO_KR[sig.source] ?? 'system-reliability';
      krs[kr].signals++;
      if (!krs[kr].topIssue && sig.score > 3) krs[kr].topIssue = sig.description;
    }
  } catch { /* gradient unavailable — continue */ }

  // 2. Convergence → overall health
  let convergence: MetricReviewSnapshot['convergence'] = null;
  try {
    const { computeConvergenceReport } = await import('./sprint/selfImprovementLoop');
    const c = await computeConvergenceReport();
    convergence = { verdict: c.overallVerdict, benchTrend: c.benchScoreTrend, qualityTrend: c.qualityScoreTrend, dataPoints: c.dataPoints };
    if (c.overallVerdict === 'degrading') krs['agent-quality'].health = 'off-track';
    else if (c.overallVerdict === 'improving') krs['agent-quality'].health = 'on-track';
    else if (c.overallVerdict === 'stable') krs['agent-quality'].health = 'on-track';
  } catch { /* convergence unavailable */ }

  // 3. SLO → system-reliability health
  let slo: MetricReviewSnapshot['slo'] = null;
  try {
    const { evaluateGuildSloReport } = await import('./agent/agentSloService');
    const r = await evaluateGuildSloReport({ guildId: 'default' });
    slo = { decision: r.summary.decision, pass: r.summary.pass, warn: r.summary.warn, fail: r.summary.fail };
    if (r.summary.fail > 0) krs['system-reliability'].health = 'off-track';
    else if (r.summary.warn > 0) krs['system-reliability'].health = 'at-risk';
    else if (r.summary.pass > 0) krs['system-reliability'].health = 'on-track';
  } catch { /* SLO unavailable */ }

  // 4. Sprint metrics → operational-efficiency
  let sprint: MetricReviewSnapshot['sprint'] = null;
  try {
    const { getSprintMetrics } = await import('./sprint/sprintMetricsCollector');
    const sm = getSprintMetrics();
    const total = sm.totalPipelinesCreated;
    sprint = {
      successRate: total > 0 ? ((total - sm.totalLoopBacks) / total) * 100 : null,
      scaffoldingRatio: sm.scaffoldingRatio,
      totalPipelines: total,
    };
    if (sm.scaffoldingRatio >= 0.5) krs['operational-efficiency'].health = 'on-track';
    else if (total > 0) krs['operational-efficiency'].health = 'at-risk';
  } catch { /* metrics unavailable */ }

  return { krs, convergence, slo, sprint, gradient, generatedAt: now };
};

// ──── Discord Formatter ───────────────────────────────────────────────────────

const H_EMOJI: Record<string, string> = { 'on-track': '🟢', 'at-risk': '🟡', 'off-track': '🔴', 'no-data': '⚪' };
const T_EMOJI: Record<string, string> = { improving: '↑', stable: '→', degrading: '↓', 'insufficient-data': '?' };

export const formatMetricReviewForDiscord = (s: MetricReviewSnapshot): string => {
  const lines: string[] = [];
  lines.push('## 📊 Metric Review');
  lines.push(`> ${new Date(s.generatedAt).toLocaleDateString('ko-KR')} 기준\n`);

  for (const [, kr] of Object.entries(s.krs)) {
    lines.push(`${H_EMOJI[kr.health]} **${kr.label}** — ${kr.health}${kr.signals > 0 ? ` (시그널 ${kr.signals}개)` : ''}`);
    if (kr.topIssue) lines.push(`  ▸ ${kr.topIssue}`);
  }
  lines.push('');

  if (s.convergence) {
    lines.push(`**수렴** ${T_EMOJI[s.convergence.verdict]} ${s.convergence.verdict} (벤치 ${T_EMOJI[s.convergence.benchTrend]}, 품질 ${T_EMOJI[s.convergence.qualityTrend]}, ${s.convergence.dataPoints}pt)`);
  }
  if (s.slo) {
    lines.push(`**SLO** ${s.slo.decision === 'ok' ? '✅' : s.slo.decision === 'warn' ? '⚠️' : '🚨'} pass=${s.slo.pass} warn=${s.slo.warn} fail=${s.slo.fail}`);
  }
  if (s.sprint) {
    lines.push(`**스프린트** 총 ${s.sprint.totalPipelines}건, 성공률 ${s.sprint.successRate?.toFixed(0) ?? 'N/A'}%, 자동화 ${(s.sprint.scaffoldingRatio * 100).toFixed(0)}%`);
  }
  if (s.gradient && s.gradient.signalCount > 0) {
    lines.push(`**개선 시그널** ${s.gradient.signalCount}개 (총점 ${s.gradient.totalScore.toFixed(1)})`);
    if (s.gradient.topPriority) lines.push(`  ▸ 🎯 ${s.gradient.topPriority}`);
  }

  return lines.join('\n');
};
