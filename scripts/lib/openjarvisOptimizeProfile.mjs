import fs from 'fs';
import path from 'path';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const asOptionalNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const pickFirstDefined = (...values) => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
};

const normalizeRate = (value) => {
  const numeric = asOptionalNumber(value);
  if (numeric === null) {
    return null;
  }
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return clamp(normalized, 0, 1);
};

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');

const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const quoteTomlString = (value) => `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const renderTomlStringArray = (values) => `[${values.map((value) => quoteTomlString(value)).join(', ')}]`;

const buildSignalSnapshot = (params) => {
  const retrievalHitAtK = normalizeRate(pickFirstDefined(
    params.retrievalHitAtK,
    params.qualitySignals?.retrieval?.byVariant?.baseline?.recallAtKAvg,
  ));
  const citationRate = normalizeRate(params.citationRate);
  const retrievalDeltaGotVsBaseline = asOptionalNumber(pickFirstDefined(
    params.retrievalDeltaGotVsBaseline,
    params.qualitySignals?.retrieval?.deltaGotVsBaseline,
  ));
  const hallucinationDeltaGotVsBaselinePct = asOptionalNumber(pickFirstDefined(
    params.hallucinationDeltaGotVsBaselinePct,
    params.qualitySignals?.hallucination?.deltaGotVsBaselinePct,
  ));
  const p95LatencyMs = asOptionalNumber(params.p95LatencyMs);
  const benchScore = asOptionalNumber(params.benchScore);
  const retrievalPressure = retrievalHitAtK === null
    ? 0.35
    : clamp((0.45 - retrievalHitAtK) / 0.45, 0, 1);
  const citationPressure = citationRate === null
    ? 0
    : clamp((0.3 - citationRate) / 0.3, 0, 1);
  const retrievalRegression = retrievalDeltaGotVsBaseline === null || retrievalDeltaGotVsBaseline >= 0
    ? 0
    : clamp(Math.abs(retrievalDeltaGotVsBaseline) / 0.2, 0, 1);
  const hallucinationPressure = hallucinationDeltaGotVsBaselinePct === null || hallucinationDeltaGotVsBaselinePct <= 0
    ? 0
    : clamp(hallucinationDeltaGotVsBaselinePct / 8, 0, 1);
  const latencyPressure = p95LatencyMs === null
    ? 0.15
    : clamp(p95LatencyMs / 6000, 0, 1);

  return {
    retrievalHitAtK,
    citationRate,
    retrievalDeltaGotVsBaseline,
    hallucinationDeltaGotVsBaselinePct,
    p95LatencyMs,
    benchScore,
    retrievalPressure,
    citationPressure,
    retrievalRegression,
    hallucinationPressure,
    latencyPressure,
    providerProfileHint: String(params.providerProfileHint || '').trim() || null,
    qualityGateOverride: String(params.qualityGateOverride || '').trim() || null,
  };
};

const buildObjectiveWeights = (signals) => {
  const accuracyRaw = 1.0
    + (signals.retrievalPressure * 1.9)
    + (signals.citationPressure * 0.6)
    + (signals.retrievalRegression * 0.8)
    + (signals.hallucinationPressure * 0.35)
    + (signals.qualityGateOverride === 'fail' ? 0.25 : 0);
  const latencyRaw = 0.35 + (signals.latencyPressure * 0.75);
  const costBias = signals.providerProfileHint === 'cost-optimized'
    ? 0.55
    : signals.providerProfileHint === 'quality-optimized'
      ? 0.15
      : 0.25;
  const costRaw = 0.2 + costBias;
  const total = accuracyRaw + latencyRaw + costRaw;

  return {
    accuracy: round(accuracyRaw / total),
    mean_latency_seconds: round(latencyRaw / total),
    total_cost_usd: round(costRaw / total),
  };
};

const buildSearchDimensions = (signals) => {
  const temperatureHigh = signals.hallucinationPressure > 0.25
    ? 0.22
    : signals.retrievalPressure > 0.65
      ? 0.4
      : 0.3;
  const maxTokensLow = signals.retrievalPressure > 0.45 ? 1024 : 768;
  const maxTokensHigh = signals.retrievalPressure > 0.75
    ? 4096
    : signals.retrievalPressure > 0.4
      ? 3072
      : 2048;
  const topPLow = signals.hallucinationPressure > 0.25 ? 0.82 : 0.7;
  const maxTurnsLow = signals.retrievalPressure > 0.35 ? 4 : 2;
  const maxTurnsHigh = signals.latencyPressure > 0.6
    ? 8
    : signals.retrievalPressure > 0.65
      ? 12
      : 10;

  const dimensions = [
    {
      name: 'intelligence.temperature',
      type: 'continuous',
      low: 0.0,
      high: round(temperatureHigh, 2),
      description: 'Balance grounded local reasoning against small weekly quality gains.',
    },
    {
      name: 'intelligence.max_tokens',
      type: 'integer',
      low: maxTokensLow,
      high: maxTokensHigh,
      description: 'Expand answer budget only when retrieval pressure justifies it.',
    },
    {
      name: 'intelligence.top_p',
      type: 'continuous',
      low: round(topPLow, 2),
      high: 1.0,
      description: 'Search a stable evidence-grounded sampling envelope.',
    },
    {
      name: 'agent.max_turns',
      type: 'integer',
      low: maxTurnsLow,
      high: maxTurnsHigh,
      description: 'Allow enough tool and reasoning turns without stalling unattended runs.',
    },
  ];

  if (signals.retrievalPressure >= 0.25 || signals.retrievalRegression > 0.1 || signals.qualityGateOverride === 'fail') {
    dimensions.push({
      name: 'tools.tool_set',
      type: 'subset',
      values: ['think', 'file_read', 'web_search', 'http_request', 'code_interpreter'],
      description: 'Tool subset available to the agent when weekly quality pressure is retrieval-heavy.',
    });
  }

  if (signals.retrievalPressure >= 0.4 || signals.hallucinationPressure > 0.2) {
    dimensions.push({
      name: 'intelligence.system_prompt',
      type: 'text',
      description: 'System prompt that preserves graph-first retrieval, checks evidence sufficiency, and prefers grounded tool use.',
    });
  }

  return dimensions;
};

const buildConstraintRules = (signals) => {
  const rules = [
    'Use local Ollama for optimizer, judge, and trial execution.',
    'Preserve graph-first retrieval and do not optimize toward fallback-first chunk retrieval.',
    'Keep the resulting candidate suitable for unattended weekly validation runs.',
  ];

  if (signals.retrievalPressure >= 0.25) {
    rules.push('Prefer candidates that check evidence sufficiency and use think or file_read before final answers.');
  }
  if (signals.retrievalRegression > 0.1) {
    rules.push('Favor candidates that recover weekly retrieval quality over the current baseline, not only raw reasoning accuracy.');
  }
  if (signals.hallucinationPressure > 0.2) {
    rules.push('Reduce unsupported claims by preferring grounded prompts and more stable sampling settings.');
  }
  if (signals.latencyPressure > 0.6) {
    rules.push('Avoid overly large max_tokens or max_turns settings that would stall unattended weekly loops.');
  }

  return rules;
};

const renderSearchDimension = (dimension) => {
  const lines = [
    '[[optimize.search]]',
    `name = ${quoteTomlString(dimension.name)}`,
    `type = ${quoteTomlString(dimension.type)}`,
  ];

  if (Array.isArray(dimension.values) && dimension.values.length > 0) {
    lines.push(`values = ${renderTomlStringArray(dimension.values)}`);
  }
  if (dimension.low !== undefined) {
    lines.push(`low = ${dimension.low}`);
  }
  if (dimension.high !== undefined) {
    lines.push(`high = ${dimension.high}`);
  }
  if (dimension.description) {
    lines.push(`description = ${quoteTomlString(dimension.description)}`);
  }

  return lines.join('\n');
};

const buildAdaptiveToml = (params) => {
  const signals = buildSignalSnapshot(params);
  const objectiveWeights = buildObjectiveWeights(signals);
  const searchDimensions = buildSearchDimensions(signals);
  const constraints = buildConstraintRules(signals);
  const benchmark = String(params.benchmark || '').trim() || 'supergpqa';
  const optimizerModel = String(params.optimizerModel || '').trim() || 'qwen2.5:7b-instruct';
  const optimizerEngine = String(params.optimizerEngine || '').trim() || 'ollama';
  const judgeModel = String(params.judgeModel || '').trim() || optimizerModel;
  const judgeEngine = String(params.judgeEngine || '').trim() || optimizerEngine;
  const maxTrials = Math.max(1, Number(params.trials || 1) || 1);
  const maxSamples = Math.max(1, Number(params.maxSamples || 1) || 1);
  const outputDir = `results/optimize/local-first/adaptive/${String(params.source || 'weekly').replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}`;

  const searchBlocks = searchDimensions.map((dimension) => `${renderSearchDimension(dimension)}\n`).join('').trimEnd();
  const lines = [
    '# Auto-generated adaptive optimize profile for weekly OpenJarvis runs.',
    '[optimize]',
    `benchmark = ${quoteTomlString(benchmark)}`,
    `max_trials = ${maxTrials}`,
    `max_samples = ${maxSamples}`,
    `optimizer_model = ${quoteTomlString(optimizerModel)}`,
    `optimizer_engine = ${quoteTomlString(optimizerEngine)}`,
    `judge_model = ${quoteTomlString(judgeModel)}`,
    `judge_engine = ${quoteTomlString(judgeEngine)}`,
    `output_dir = ${quoteTomlString(outputDir)}`,
    'early_stop_patience = 1',
    '',
    '[[optimize.objectives]]',
    'metric = "accuracy"',
    'direction = "maximize"',
    `weight = ${objectiveWeights.accuracy}`,
    '',
    '[[optimize.objectives]]',
    'metric = "mean_latency_seconds"',
    'direction = "minimize"',
    `weight = ${objectiveWeights.mean_latency_seconds}`,
    '',
    '[[optimize.objectives]]',
    'metric = "total_cost_usd"',
    'direction = "minimize"',
    `weight = ${objectiveWeights.total_cost_usd}`,
  ];

  if (searchBlocks) {
    lines.push('', searchBlocks);
  }

  lines.push(
    '',
    '[optimize.fixed]',
    `"engine.backend" = ${quoteTomlString(optimizerEngine)}`,
    `"intelligence.model" = ${quoteTomlString(optimizerModel)}`,
    '"agent.type" = "orchestrator"',
    '',
    '[optimize.constraints]',
    `rules = ${renderTomlStringArray(constraints)}`,
    '',
  );

  return {
    toml: lines.join('\n'),
    profile: {
      mode: 'dynamic',
      benchmark,
      objectiveWeights,
      searchDimensions: searchDimensions.map((dimension) => dimension.name),
      signals,
      outputDir,
    },
  };
};

export const buildOpenjarvisOptimizeInvocation = (params) => {
  const benchmark = String(params.benchmark || '').trim() || 'supergpqa';
  const configPath = String(params.configPath || '').trim();
  const optimizeArgs = ['optimize', 'run'];
  let profile;

  if (params.dynamicProfileEnabled) {
    const { toml, profile: dynamicProfile } = buildAdaptiveToml(params);
    const outputDir = path.join(params.rootDir, 'tmp', 'openjarvis-optimize');
    const fileName = `${String(params.source || 'weekly').replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}-adaptive.toml`;
    const absoluteConfigPath = path.join(outputDir, fileName);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(absoluteConfigPath, toml, 'utf8');
    const relativeConfigPath = normalizePath(path.relative(params.rootDir, absoluteConfigPath));
    optimizeArgs.push('--config', relativeConfigPath);
    profile = {
      ...dynamicProfile,
      configPath: relativeConfigPath,
    };
  } else if (configPath) {
    optimizeArgs.push('--config', configPath);
    profile = {
      mode: 'static-config',
      benchmark,
      configPath,
      objectiveWeights: null,
      searchDimensions: [],
      signals: null,
      outputDir: null,
    };
  } else {
    optimizeArgs.push('--benchmark', benchmark);
    profile = {
      mode: 'benchmark-only',
      benchmark,
      configPath: null,
      objectiveWeights: null,
      searchDimensions: [],
      signals: null,
      outputDir: null,
    };
  }

  optimizeArgs.push('--trials', String(Math.max(1, Number(params.trials || 1) || 1)));
  optimizeArgs.push('--max-samples', String(Math.max(1, Number(params.maxSamples || 1) || 1)));
  if (params.optimizerModel) {
    optimizeArgs.push('--optimizer-model', String(params.optimizerModel));
  }
  if (params.optimizerEngine) {
    optimizeArgs.push('--optimizer-engine', String(params.optimizerEngine));
  }
  if (params.judgeModel) {
    optimizeArgs.push('--judge-model', String(params.judgeModel));
  }
  if (params.judgeEngine) {
    optimizeArgs.push('--judge-engine', String(params.judgeEngine));
  }

  return { optimizeArgs, profile };
};

export const formatOpenjarvisOptimizeProfile = (profile) => {
  if (!profile) {
    return 'profile=unknown';
  }

  const parts = [
    `mode=${profile.mode}`,
    `benchmark=${profile.benchmark || 'n/a'}`,
  ];

  if (profile.configPath) {
    parts.push(`config=${profile.configPath}`);
  }
  if (profile.objectiveWeights) {
    parts.push(`weights=accuracy:${profile.objectiveWeights.accuracy}/latency:${profile.objectiveWeights.mean_latency_seconds}/cost:${profile.objectiveWeights.total_cost_usd}`);
  }
  if (Array.isArray(profile.searchDimensions) && profile.searchDimensions.length > 0) {
    parts.push(`search=${profile.searchDimensions.join(',')}`);
  }
  if (profile.signals?.retrievalHitAtK !== null && profile.signals?.retrievalHitAtK !== undefined) {
    parts.push(`retrieval=${profile.signals.retrievalHitAtK}`);
  }
  if (profile.signals?.p95LatencyMs !== null && profile.signals?.p95LatencyMs !== undefined) {
    parts.push(`p95_ms=${profile.signals.p95LatencyMs}`);
  }

  return parts.join(' ');
};