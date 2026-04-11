import type { ChannelSink } from '../automation/types';
import logger from '../../logger';
import { fetchWithTimeout } from '../../utils/network';
import { claimSourceLock, releaseSourceLock, updateSourceState } from './sourceMonitorStore';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { fromTable } from '../infra/baseRepository';
import { T_NEWS_SENTIMENT, T_SOURCES } from '../infra/tableRegistry';
import { fetchNewsMonitorCandidatesByWorker } from './newsMonitorWorkerClient';
import { delegateArticleContextFetch, delegateNewsSummarize, shouldDelegate } from '../automation/n8nDelegationService';
import { generateText, isAnyLlmConfigured } from '../llmClient';

type NewsItem = {
  title: string;
  link: string;
  sourceName: string | null;
  publisherName: string | null;
  publishedAtUnix: number | null;
  key: string;
  lexicalSignature: string;
};

type NewsChannelRow = {
  id: number;
  guild_id: string | null;
  name: string | null;
  url: string | null;
  channel_id: string | null;
  last_post_signature: string | null;
};

type NewsTickStats = {
  processed: number;
  failed: number;
  sent: number;
  skippedLocked: number;
  skippedDuplicate: number;
  skippedNoCandidate: number;
};

const SIGNATURE_HISTORY_MAX_ITEMS = parseMinIntEnv(process.env.NEWS_SIGNATURE_HISTORY_MAX_ITEMS, 12, 5);
const SIGNATURE_HISTORY_DELIMITER = '||';

let timer: NodeJS.Timeout | null = null;
let started = false;
let running = false;
let runCount = 0;
let successCount = 0;
let failCount = 0;
let lastRunAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastErrorAt: string | null = null;
let lastError: string | null = null;
let lastDurationMs: number | null = null;
let lastTickProcessedSources = 0;
let lastTickFailedSources = 0;
let lastTickStatus: 'success' | 'partial_failure' | 'failed' | null = null;
let newsHistoryTableUnavailableLogged = false;

const INTERVAL_MS = parseMinIntEnv(process.env.NEWS_MONITOR_INTERVAL_MS, 10 * 60_000, 60_000);
const LOCK_LEASE_MS = parseMinIntEnv(process.env.NEWS_MONITOR_LOCK_LEASE_MS, 120_000, 30_000);
const FETCH_TIMEOUT_MS = parseMinIntEnv(process.env.NEWS_MONITOR_FETCH_TIMEOUT_MS, 15_000, 5_000);
const NEWS_CANDIDATE_LIMIT = parseMinIntEnv(process.env.NEWS_MONITOR_CANDIDATE_LIMIT, 12, 3);
const NEWS_HISTORY_LOOKBACK_HOURS = parseMinIntEnv(process.env.NEWS_DEDUP_LOOKBACK_HOURS, 24, 1);
const NEWS_HISTORY_MAX_ITEMS = parseMinIntEnv(process.env.NEWS_DEDUP_HISTORY_MAX_ITEMS, 60, 10);
const NEWS_DEDUP_MODEL = parseStringEnv(process.env.OPENAI_NEWS_DEDUP_MODEL ?? process.env.NEWS_DEDUP_MODEL, '') || undefined;
const NEWS_SUMMARY_MODEL = parseStringEnv(process.env.OPENAI_NEWS_SUMMARY_MODEL ?? process.env.NEWS_SUMMARY_MODEL, '') || undefined;
const NEWS_AI_DEDUP_ENABLED = parseBooleanEnv(process.env.NEWS_AI_DEDUP_ENABLED, true);
const NEWS_KR_SUMMARY_ENABLED = parseBooleanEnv(process.env.NEWS_KR_SUMMARY_ENABLED, true);
const SUMMARY_FETCH_TIMEOUT_MS = parseMinIntEnv(process.env.NEWS_SUMMARY_FETCH_TIMEOUT_MS, 12_000, 5_000);
const INSTANCE_ID = parseStringEnv(process.env.RENDER_INSTANCE_ID ?? process.env.RENDER_SERVICE_ID ?? process.env.HOSTNAME, `local-${process.pid}`);

const isGoogleFinanceSourceRow = (row: NewsChannelRow): boolean => {
  const name = String(row.name || '').toLowerCase();
  const url = String(row.url || '').toLowerCase();

  if (name === 'google-finance-news' || name === 'google-finance' || name === 'news') {
    return true;
  }

  return url.includes('google.com/finance');
};

type NewsHistoryRow = {
  guild_id: string | null;
  title: string;
  link: string;
  event_signature: string;
  created_at: string | null;
};

type NewsHistoryDbRow = {
  guild_id: string | null;
  title: string | null;
  link: string | null;
  event_signature: string | null;
  created_at: string | null;
};

import { isSchemaUnavailableError } from '../../utils/supabaseErrors';
import { getErrorMessage } from '../../utils/errorMessage';
import { parseBooleanEnv, parseMinIntEnv, parseStringEnv } from '../../utils/env';

const isHistoryUnavailableError = (error: any): boolean => isSchemaUnavailableError(error, 'news_sentiment', 'event_signature', 'sentiment_score');

const decodeXml = (text: string): string => {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&bull;/g, '•')
    .replace(/&nbsp;/g, ' ')
    .trim();
};

const stripHtmlBlocks = (html: string): string => {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const pickMetaContent = (html: string, key: string): string => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const m = html.match(re);
  return decodeXml(m?.[1] || '').trim();
};

const pickTitleTag = (html: string): string => {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeXml(stripHtmlBlocks(m?.[1] || '')).trim();
};

const enforceTwoToThreeLines = (text: string): string => {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return '';
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 3);

  if (lines.length >= 2) {
    return lines.join('\n');
  }

  const sentenceChunks = normalized
    .split(/(?<=[.!?다])\s+/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (sentenceChunks.length >= 2) {
    return sentenceChunks.join('\n');
  }

  return lines[0] || sentenceChunks[0] || normalized;
};

const loadArticleContext = async (link: string): Promise<{ title: string; description: string }> => {
  // n8n delegation: try delegating article context fetch
  if (shouldDelegate('article-context-fetch')) {
    const n8n = await delegateArticleContextFetch(link);
    if (n8n.delegated && n8n.ok && n8n.data) {
      return { title: String(n8n.data.title || '').slice(0, 300), description: String(n8n.data.description || '').slice(0, 1200) };
    }
    // Fall through to inline on delegation failure
  }

  try {
    const response = await fetchWithTimeout(link, {
      headers: {
        'User-Agent': 'MuelBot/1.0',
        'Accept-Language': 'ko,en;q=0.8',
      },
      redirect: 'follow',
    }, SUMMARY_FETCH_TIMEOUT_MS);

    if (!response.ok) {
      return { title: '', description: '' };
    }

    const html = await response.text();
    const ogTitle = pickMetaContent(html, 'og:title');
    const metaDesc = pickMetaContent(html, 'description') || pickMetaContent(html, 'og:description');
    const title = ogTitle || pickTitleTag(html);
    const description = metaDesc || '';

    return { title: title.slice(0, 300), description: description.slice(0, 1200) };
  } catch {
    return { title: '', description: '' };
  }
};

const buildFallbackKoreanSummary = (item: NewsItem): string => {
  return [
    `핵심: ${item.title}`,
    `출처: ${item.sourceName || 'Google Finance'} 보도입니다.`,
  ].join('\n');
};

const buildTimeTag = (publishedAtUnix: number | null): string => {
  if (!publishedAtUnix || !Number.isFinite(publishedAtUnix)) {
    return '';
  }

  return `<t:${publishedAtUnix}:R>`;
};

const parseSignatureHistory = (raw: string | null): string[] => {
  const value = String(raw || '').trim();
  if (!value) {
    return [];
  }

  const parts = value.includes(SIGNATURE_HISTORY_DELIMITER)
    ? value.split(SIGNATURE_HISTORY_DELIMITER)
    : [value];

  return parts.map((part) => part.trim()).filter(Boolean);
};

const hasSeenSignature = (raw: string | null, signature: string): boolean => {
  if (!signature) {
    return false;
  }

  const history = parseSignatureHistory(raw);
  return history.includes(signature);
};

const appendSignatureHistory = (raw: string | null, signature: string): string => {
  const next = [signature, ...parseSignatureHistory(raw).filter((item) => item !== signature)]
    .slice(0, SIGNATURE_HISTORY_MAX_ITEMS);
  return next.join(SIGNATURE_HISTORY_DELIMITER);
};

const summarizeNewsInKorean = async (item: NewsItem): Promise<string> => {
  // n8n delegation: try summarization via n8n workflow
  if (shouldDelegate('news-summarize')) {
    const article = await loadArticleContext(item.link);
    const n8n = await delegateNewsSummarize(item.title, item.link, article.description);
    if (n8n.delegated && n8n.ok && n8n.data?.summary) {
      return enforceTwoToThreeLines(String(n8n.data.summary));
    }
    // Fall through to inline on delegation failure
  }

  if (!NEWS_KR_SUMMARY_ENABLED || !isAnyLlmConfigured()) {
    return '';
  }

  const article = await loadArticleContext(item.link);
  const prompt = [
    '다음 금융 뉴스를 한국어로 2~3줄 요약하세요.',
    '조건:',
    '- 출력은 순수 텍스트 2~3줄만',
    '- 과장/추측 금지, 주어진 정보만 사용',
    '- 핵심 사실과 시장 영향 포인트를 포함',
    `원문 제목: ${item.title}`,
    `원문 링크: ${item.link}`,
    `기사 제목(메타): ${article.title || '(없음)'}`,
    `기사 설명(메타): ${article.description || '(없음)'}`,
  ].join('\n');

  try {
    const content = await generateText({
      system: 'You are a precise Korean financial news summarizer.',
      user: prompt,
      model: NEWS_SUMMARY_MODEL,
      temperature: 0.2,
      maxTokens: 220,
      actionName: 'news.summarize',
    });

    return enforceTwoToThreeLines(content);
  } catch {
    return '';
  }
};

const normalizeTitleForSignature = (title: string): string => {
  return String(title || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const buildLexicalSignature = (title: string): string => {
  const tokens = normalizeTitleForSignature(title)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 20)
    .sort();
  return tokens.join('|');
};

export const normalizeNewsHistoryRow = (row: NewsHistoryDbRow): NewsHistoryRow => {
  const title = String(row.title || '');
  const eventSignature = String(row.event_signature || '').trim() || buildLexicalSignature(title);

  return {
    guild_id: row.guild_id ? String(row.guild_id) : null,
    title,
    link: String(row.link || ''),
    event_signature: eventSignature,
    created_at: row.created_at ? String(row.created_at) : null,
  };
};

const jaccardSimilarity = (a: string, b: string): number => {
  const setA = new Set(a.split('|').filter(Boolean));
  const setB = new Set(b.split('|').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

const isHeuristicDuplicate = (candidate: NewsItem, recent: NewsHistoryRow): boolean => {
  if (!recent.event_signature) {
    return false;
  }

  if (candidate.lexicalSignature && candidate.lexicalSignature === recent.event_signature) {
    return true;
  }

  const score = jaccardSimilarity(candidate.lexicalSignature, recent.event_signature);
  return score >= 0.82;
};

const parseAiDuplicateDecision = (raw: string): boolean | null => {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as { duplicate?: boolean };
    if (typeof parsed.duplicate === 'boolean') {
      return parsed.duplicate;
    }
  } catch {
    // Ignore and continue with plain-text fallback.
  }

  const lowered = text.toLowerCase();
  if (lowered.includes('true')) {
    return true;
  }
  if (lowered.includes('false')) {
    return false;
  }

  return null;
};

const isSemanticDuplicateWithAi = async (candidate: NewsItem, recents: NewsHistoryRow[]): Promise<boolean> => {
  if (!NEWS_AI_DEDUP_ENABLED || !isAnyLlmConfigured() || recents.length === 0) {
    return false;
  }

  const recentTitles = recents
    .slice(0, 8)
    .map((row, idx) => `${idx + 1}. ${row.title}`)
    .join('\n');

  const prompt = [
    '두 뉴스 제목이 같은 사건을 다루는지 판별하세요.',
    '반드시 JSON 한 줄로만 답하세요: {"duplicate":true|false}',
    `후보 제목: ${candidate.title}`,
    '최근 전송 제목 목록:',
    recentTitles,
  ].join('\n');

  try {
    const content = await generateText({
      system: 'You are a strict duplicate detector for financial news titles.',
      user: prompt,
      model: NEWS_DEDUP_MODEL,
      temperature: 0,
      maxTokens: 30,
      actionName: 'news.dedup',
    });

    const decision = parseAiDuplicateDecision(content);
    return decision === true;
  } catch {
    return false;
  }
};

const loadRecentNewsHistory = async (guildId: string | null): Promise<NewsHistoryRow[]> => {
  const qb = fromTable(T_NEWS_SENTIMENT);
  if (!qb) return [];

  const cutoffIso = new Date(Date.now() - NEWS_HISTORY_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  let query = qb
    .select('guild_id,title,link,event_signature,created_at')
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: false })
    .limit(NEWS_HISTORY_MAX_ITEMS);

  query = guildId ? query.eq('guild_id', guildId) : query.is('guild_id', null);
  const { data, error } = await query;

  if (error) {
    if (!newsHistoryTableUnavailableLogged && isHistoryUnavailableError(error)) {
      newsHistoryTableUnavailableLogged = true;
      logger.warn('[NEWS-MONITOR] news_sentiment table unavailable, semantic history dedup will be limited');
      return [];
    }

    logger.warn('[NEWS-MONITOR] failed to load semantic dedup history: %s', error.message);
    return [];
  }

  return ((data || []) as NewsHistoryDbRow[]).map(normalizeNewsHistoryRow);
};

const storeNewsHistory = async (item: NewsItem, guildId: string | null) => {
  const qb = fromTable(T_NEWS_SENTIMENT);
  if (!qb) return;

  const { error } = await qb.insert([
    {
      guild_id: guildId,
      title: item.title,
      link: item.link,
      event_signature: item.lexicalSignature,
      sentiment_score: null,
      created_at: new Date().toISOString(),
    },
  ]);

  if (error) {
    if (!newsHistoryTableUnavailableLogged && isHistoryUnavailableError(error)) {
      newsHistoryTableUnavailableLogged = true;
      logger.warn('[NEWS-MONITOR] news_sentiment table unavailable, semantic history persistence skipped');
      return;
    }

    logger.warn('[NEWS-MONITOR] failed to persist semantic dedup history: %s', error.message);
  }
};

const fetchLatestGoogleFinanceNews = async (): Promise<NewsItem[]> => {
  const rows = await fetchNewsMonitorCandidatesByWorker(NEWS_CANDIDATE_LIMIT);
  if (!rows) {
    return [];
  }

  return rows.map((row) => ({
    title: String(row.title || ''),
    link: String(row.link || ''),
    sourceName: row.sourceName ? String(row.sourceName) : null,
    publisherName: row.publisherName ? String(row.publisherName) : null,
    publishedAtUnix: Number.isFinite(Number(row.publishedAtUnix)) ? Number(row.publishedAtUnix) : null,
    key: String(row.key || ''),
    lexicalSignature: String(row.lexicalSignature || buildLexicalSignature(String(row.title || ''))),
  })).filter((item) => Boolean(item.title && item.link && item.key));
};

const pickBestCandidate = async (candidates: NewsItem[], recentHistory: NewsHistoryRow[]): Promise<NewsItem | null> => {
  for (const candidate of candidates) {
    const heuristicDuplicate = recentHistory.some((history) => isHeuristicDuplicate(candidate, history));
    if (heuristicDuplicate) {
      continue;
    }

    const aiDuplicate = await isSemanticDuplicateWithAi(candidate, recentHistory);
    if (aiDuplicate) {
      continue;
    }

    return candidate;
  }

  return null;
};

const claimRowLock = async (id: number): Promise<boolean> => {
  return claimSourceLock({
    id,
    instanceId: INSTANCE_ID,
    lockLeaseMs: LOCK_LEASE_MS,
    logPrefix: '[NEWS-MONITOR]',
  });
};

const releaseRowLock = async (id: number) => {
  await releaseSourceLock({ id, instanceId: INSTANCE_ID, logPrefix: '[NEWS-MONITOR]' });
};

const updateRowState = async (id: number, patch: Record<string, string | null>) => {
  await updateSourceState({ id, patch, logPrefix: '[NEWS-MONITOR]' });
};

const sendNews = async (sink: ChannelSink, channelId: string, item: NewsItem, summary: string | null) => {
  const summaryBlock = enforceTwoToThreeLines(summary || '') || buildFallbackKoreanSummary(item);
  const timeTag = buildTimeTag(item.publishedAtUnix);
  const sourceLabel = item.publisherName || item.sourceName || 'Google Finance';
  const description = [summaryBlock, item.link, timeTag].filter(Boolean).join('\n\n');

  const sent = await sink.sendToChannel(channelId, {
    embeds: [
      {
        title: item.title.slice(0, 250),
        description,
        color: 0x4285F4,
        footer: { text: `source: ${sourceLabel}` },
      },
    ],
  });

  if (!sent) {
    throw new Error('Target news channel is not sendable');
  }
};

const runTick = async (sink: ChannelSink, guildId?: string): Promise<NewsTickStats> => {
  const qb = fromTable(T_SOURCES);
  if (!qb) {
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoCandidate: 0 };
  }

  let query = qb
    .select('id, guild_id, name, url, channel_id, last_post_signature')
    .eq('is_active', true);

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query;

  if (error) {
    logger.warn('[NEWS-MONITOR] failed to load news channels: %s', error.message);
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoCandidate: 0 };
  }

  const rows = ((data || []) as NewsChannelRow[]).filter(isGoogleFinanceSourceRow);
  if (rows.length === 0) {
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoCandidate: 0 };
  }

  const candidates = await fetchLatestGoogleFinanceNews();
  if (candidates.length === 0) {
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoCandidate: rows.length };
  }

  const groupedRows = new Map<string, NewsChannelRow[]>();
  for (const row of rows) {
    const key = row.guild_id || '__NULL_GUILD__';
    const existing = groupedRows.get(key) || [];
    existing.push(row);
    groupedRows.set(key, existing);
  }

  const stats: NewsTickStats = {
    processed: 0,
    failed: 0,
    sent: 0,
    skippedLocked: 0,
    skippedDuplicate: 0,
    skippedNoCandidate: 0,
  };

  for (const [groupKey, group] of groupedRows.entries()) {
    const groupGuildId = groupKey === '__NULL_GUILD__' ? null : groupKey;
    const recentHistory = await loadRecentNewsHistory(groupGuildId);
    const latest = await pickBestCandidate(candidates, recentHistory);
    if (!latest) {
      logger.info('[NEWS-MONITOR] guild=%s all fetched candidates were deduplicated', groupGuildId || 'null');
      stats.skippedNoCandidate += group.length;
      continue;
    }

    const latestSummary = await summarizeNewsInKorean(latest);

    let sentAtLeastOnce = false;

    for (const row of group) {
      stats.processed += 1;

      if (!row.channel_id) {
        continue;
      }

      const locked = await claimRowLock(row.id);
      if (!locked) {
        stats.skippedLocked += 1;
        continue;
      }

      try {
        if (hasSeenSignature(row.last_post_signature, latest.key)) {
          stats.skippedDuplicate += 1;
          await updateRowState(row.id, { last_check_status: 'success', last_check_error: null });
          continue;
        }

        await sendNews(sink, row.channel_id, latest, latestSummary);
        stats.sent += 1;
        sentAtLeastOnce = true;
        await updateRowState(row.id, {
          last_check_status: 'success',
          last_check_error: null,
          last_post_signature: appendSignatureHistory(row.last_post_signature, latest.key),
        });
      } catch (err) {
        stats.failed += 1;
        const msg = getErrorMessage(err);
        await updateRowState(row.id, { last_check_status: 'error', last_check_error: msg });
        logger.warn('[NEWS-MONITOR] source=%s failed: %s', String(row.id), msg);
      } finally {
        await releaseRowLock(row.id);
      }
    }

    if (sentAtLeastOnce) {
      await storeNewsHistory(latest, groupGuildId);
    }
  }

  return stats;
};

const executeTick = async (sink: ChannelSink, guildId?: string) => {
  if (running) {
    return { ok: false, message: 'News monitor tick already running' as const };
  }

  running = true;
  runCount += 1;
  lastRunAt = new Date().toISOString();
  const startMs = Date.now();

  try {
    const tick = await runTick(sink, guildId);
    lastTickProcessedSources = tick.processed;
    lastTickFailedSources = tick.failed;
    successCount += 1;
    lastSuccessAt = new Date().toISOString();
    if (tick.failed > 0) {
      lastTickStatus = 'partial_failure';
      lastErrorAt = new Date().toISOString();
      lastError = `Partial failure: ${tick.failed}/${tick.processed} sources failed`;
    } else {
      lastTickStatus = 'success';
      lastError = null;
    }
    lastDurationMs = Date.now() - startMs;
    if (tick.processed === 0) {
      return {
        ok: true,
        message: `News tick completed: processed=0 sent=0 failed=0 noCandidate=${tick.skippedNoCandidate} (no matching subscriptions for this guild)`,
      };
    }

    if (tick.failed > 0) {
      return {
        ok: true,
        message: `News tick partial: processed=${tick.processed} sent=${tick.sent} failed=${tick.failed} duplicate=${tick.skippedDuplicate} locked=${tick.skippedLocked} noCandidate=${tick.skippedNoCandidate}`,
      };
    }

    return {
      ok: true,
      message: `News tick completed: processed=${tick.processed} sent=${tick.sent} failed=0 duplicate=${tick.skippedDuplicate} locked=${tick.skippedLocked} noCandidate=${tick.skippedNoCandidate}`,
    };
  } catch (error) {
    failCount += 1;
    lastTickStatus = 'failed';
    lastTickProcessedSources = 0;
    lastTickFailedSources = 0;
    lastErrorAt = new Date().toISOString();
    lastError = getErrorMessage(error);
    lastDurationMs = Date.now() - startMs;
    logger.warn('[NEWS-MONITOR] tick failed: %s', getErrorMessage(error));
    return { ok: false, message: lastError || 'News tick failed' as const };
  } finally {
    running = false;
  }
};

export const isNewsSentimentMonitorEnabled = () => parseBooleanEnv(process.env.AUTOMATION_NEWS_ENABLED, false);

export const startNewsSentimentMonitor = (sink: ChannelSink) => {
  if (started || !isNewsSentimentMonitorEnabled()) {
    return;
  }

  started = true;
  void executeTick(sink);
  timer = setInterval(() => {
    void executeTick(sink);
  }, INTERVAL_MS);
  timer.unref();

  logger.info('[NEWS-MONITOR] started (intervalMs=%d, instance=%s)', INTERVAL_MS, INSTANCE_ID);
};

export const triggerNewsSentimentMonitor = async (sink: ChannelSink, guildId?: string) => {
  if (!started) {
    return { ok: false, message: 'News monitor is not started' };
  }

  return executeTick(sink, guildId);
};

export const getNewsSentimentMonitorSnapshot = () => ({
  started,
  running,
  intervalMs: INTERVAL_MS,
  runCount,
  successCount,
  failCount,
  lastRunAt,
  lastSuccessAt,
  lastErrorAt,
  lastError,
  lastDurationMs,
  lastTickProcessedSources,
  lastTickFailedSources,
  lastTickStatus,
});

export const stopNewsSentimentMonitor = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
  running = false;
};
