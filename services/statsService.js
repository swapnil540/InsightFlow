const Feedback = require('../models/feedback');
const taxonomy = require('../config/taxonomy');
const {
  CATEGORY_VALUES,
  SENTIMENT_VALUES,
  SOURCE_VALUES,
  TOPIC_VALUES,
  parseFilters,
  buildFeedbackFilter,
} = require('./filters');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 90;
const TREND_DAYS = 14;
const MAX_TREND_TOPICS = 5;
const DEFAULT_TREND_TOPIC_COUNT = 3;
const SENTIMENT_KEYS = ['positive', 'neutral', 'mixed', 'negative'];
const topicMeta = new Map(taxonomy.map((topic) => [topic.key, topic]));

const ANALYSED_MATCH = {
  'analysis.notAnalyzed': { $ne: true },
  'analysis.topic': { $exists: true, $nin: [null, ''] },
  'analysis.sentiment': { $exists: true, $nin: [null, ''] },
};

function rawParam(query, key) {
  const value = query?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isoDateUtc(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function startOfUtcDay(dateString) {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function endOfUtcDay(dateString) {
  return new Date(`${dateString}T23:59:59.999Z`);
}

function startOfUtcWeekMonday(value) {
  const date = new Date(value);
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  day.setUTCDate(day.getUTCDate() - offset);
  return day;
}

function addUtcDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function queryError(message, status = 400) {
  return { status, message };
}

function validateStatsQuery(query = {}) {
  const filters = parseFilters(query);
  const dashboardFilters = {
    category: filters.category,
    sentiment: filters.sentiment,
    topic: filters.topic,
    source: filters.source,
    from: filters.from,
    to: filters.to,
  };

  for (const [key, allowed] of [
    ['category', CATEGORY_VALUES],
    ['sentiment', SENTIMENT_VALUES],
    ['topic', TOPIC_VALUES],
    ['source', SOURCE_VALUES],
  ]) {
    const raw = rawParam(query, key);
    if (!raw) continue;
    if (typeof query[key] !== 'string' || !allowed.includes(raw)) {
      return { error: queryError(`Invalid ${key}.`), filters: dashboardFilters };
    }
  }

  for (const key of ['from', 'to']) {
    const raw = rawParam(query, key);
    if (!raw) continue;
    if (typeof query[key] !== 'string' || dashboardFilters[key] !== raw) {
      return { error: queryError(`${key} must be a valid YYYY-MM-DD date.`), filters: dashboardFilters };
    }
  }

  if (dashboardFilters.from && dashboardFilters.to && dashboardFilters.from > dashboardFilters.to) {
    return { error: queryError('from must be on or before to.'), filters: dashboardFilters };
  }

  const granularityRaw = rawParam(query, 'granularity');
  let granularity;
  if (granularityRaw) {
    if (granularityRaw !== 'day' && granularityRaw !== 'week') {
      return { error: queryError('granularity must be day or week.'), filters: dashboardFilters };
    }
    granularity = granularityRaw;
  }

  let topicKeys;
  const topicsRaw = rawParam(query, 'topics');
  if (topicsRaw) {
    const keys = topicsRaw.split(',').map((item) => item.trim()).filter(Boolean);
    if (keys.length > MAX_TREND_TOPICS) {
      return { error: queryError(`topics accepts at most ${MAX_TREND_TOPICS} keys.`), filters: dashboardFilters };
    }
    if (keys.some((key) => !TOPIC_VALUES.includes(key))) {
      return { error: queryError('topics must be taxonomy topic keys.'), filters: dashboardFilters };
    }
    topicKeys = keys;
  }

  return { error: null, filters: dashboardFilters, granularity, topicKeys };
}

function analysedMatch() {
  return { ...ANALYSED_MATCH };
}

function unanalysedClause() {
  return {
    $or: [
      { 'analysis.notAnalyzed': true },
      { 'analysis.topic': { $exists: false } },
      { 'analysis.topic': { $in: [null, ''] } },
      { 'analysis.sentiment': { $exists: false } },
      { 'analysis.sentiment': { $in: [null, ''] } },
    ],
  };
}

function buildAttributeFilter(filters = {}) {
  return buildFeedbackFilter({
    category: filters.category,
    sentiment: filters.sentiment,
    topic: filters.topic,
    source: filters.source,
  });
}

function applyWindow(mongoFilter, window) {
  const next = { ...mongoFilter };
  if (window?.from && window?.to) {
    next.createdAt = { $gte: window.from, $lte: window.to };
  }
  return next;
}

function withAnalysed(mongoFilter) {
  return { $and: [mongoFilter, analysedMatch()] };
}

function buildMatch(query = {}, window) {
  const parsed = validateStatsQuery(query);
  if (parsed.error) {
    const error = new Error(parsed.error.message);
    error.status = parsed.error.status;
    throw error;
  }
  const mongoFilter = applyWindow(buildFeedbackFilter(parsed.filters), window);
  return withAnalysed(mongoFilter);
}

function resolveWindow(filters = {}, latestCreatedAt) {
  const hasFrom = Boolean(filters.from);
  const hasTo = Boolean(filters.to);
  let from;
  let to;

  if (hasFrom && hasTo) {
    from = startOfUtcDay(filters.from);
    to = endOfUtcDay(filters.to);
  } else if (hasTo) {
    to = endOfUtcDay(filters.to);
    from = new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
  } else if (hasFrom) {
    from = startOfUtcDay(filters.from);
    to = latestCreatedAt ? new Date(latestCreatedAt) : endOfUtcDay(isoDateUtc(new Date()));
  } else if (latestCreatedAt) {
    to = new Date(latestCreatedAt);
    from = new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
  } else {
    return null;
  }

  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  return {
    from,
    to,
    days,
    fromDate: isoDateUtc(from),
    toDate: isoDateUtc(to),
  };
}

function previousWindow(window) {
  if (!window?.from || !window?.to) return null;
  const duration = window.to.getTime() - window.from.getTime();
  if (duration <= 0) return null;
  const to = new Date(window.from.getTime() - 1);
  const from = new Date(to.getTime() - duration);
  return {
    from,
    to,
    days: window.days,
    fromDate: isoDateUtc(from),
    toDate: isoDateUtc(to),
  };
}

function resolveGranularity(requested, windowDays) {
  if (requested === 'day' || requested === 'week') return requested;
  return windowDays >= 60 ? 'week' : 'day';
}

function share(part, whole) {
  if (!whole) return 0;
  return part / whole;
}

function trendPct(current, previous) {
  if (previous == null || previous === 0) return null;
  return ((Number(current) - Number(previous)) / Number(previous)) * 100;
}

function roundShare(value) {
  return Math.round(value * 10000) / 10000;
}

function roundMetric(value, digits = 4) {
  if (value == null || Number.isNaN(Number(value))) return value == null ? null : 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function bucketStarts(from, to, granularity) {
  const starts = [];
  if (granularity === 'week') {
    let cursor = startOfUtcWeekMonday(from);
    const last = startOfUtcWeekMonday(to);
    while (cursor.getTime() <= last.getTime()) {
      starts.push(new Date(cursor));
      cursor = addUtcDays(cursor, 7);
    }
    return starts;
  }
  let cursor = startOfUtcDay(isoDateUtc(from));
  const last = startOfUtcDay(isoDateUtc(to));
  while (cursor.getTime() <= last.getTime()) {
    starts.push(new Date(cursor));
    cursor = addUtcDays(cursor, 1);
  }
  return starts;
}

function emptyBucket(date, topicKeys = []) {
  const topics = {};
  for (const key of topicKeys) topics[key] = 0;
  return {
    date,
    total: 0,
    complaints: 0,
    positive: 0,
    neutral: 0,
    mixed: 0,
    negative: 0,
    topics,
  };
}

function fillBuckets(from, to, granularity, sparse = [], topicKeys = []) {
  const byDate = new Map();
  for (const row of sparse) {
    if (row?.date) byDate.set(row.date, row);
  }
  return bucketStarts(from, to, granularity).map((start) => {
    const date = isoDateUtc(start);
    const row = byDate.get(date) || {};
    const bucket = emptyBucket(date, topicKeys);
    bucket.total = row.total || 0;
    bucket.complaints = row.complaints || 0;
    bucket.positive = row.positive || 0;
    bucket.neutral = row.neutral || 0;
    bucket.mixed = row.mixed || 0;
    bucket.negative = row.negative || 0;
    for (const key of topicKeys) {
      bucket.topics[key] = row.topics?.[key] || 0;
    }
    return bucket;
  });
}

function dateTruncExpression(granularity) {
  if (granularity === 'week') {
    return {
      $dateTrunc: {
        date: '$createdAt',
        unit: 'week',
        binSize: 1,
        timezone: 'UTC',
        startOfWeek: 'monday',
      },
    };
  }
  return {
    $dateTrunc: {
      date: '$createdAt',
      unit: 'day',
      binSize: 1,
      timezone: 'UTC',
    },
  };
}

function statsPipeline(match) {
  return [
    { $match: match },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              totalMentions: { $sum: 1 },
              uniqueHashes: { $addToSet: '$textHash' },
              complaintMentions: { $sum: { $cond: ['$analysis.isComplaint', 1, 0] } },
              negativeMentions: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
              avgSentimentScore: { $avg: '$analysis.sentimentScore' },
            },
          },
          {
            $project: {
              _id: 0,
              totalMentions: 1,
              uniquePhrasings: { $size: '$uniqueHashes' },
              complaintMentions: 1,
              negativeMentions: 1,
              avgSentimentScore: 1,
            },
          },
        ],
        sentiment: [{ $group: { _id: '$analysis.sentiment', count: { $sum: 1 } } }],
        byCategory: [{
          $group: {
            _id: { category: '$originalCategory', sentiment: '$analysis.sentiment' },
            count: { $sum: 1 },
          },
        }],
        bySource: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
        topIssue: [
          { $match: { 'analysis.isComplaint': true } },
          { $group: { _id: '$analysis.topic', mentions: { $sum: 1 } } },
          { $sort: { mentions: -1, _id: 1 } },
          { $limit: 1 },
        ],
      },
    },
  ];
}

function statsSummaryPipeline(match) {
  return [
    { $match: match },
    {
      $group: {
        _id: null,
        totalMentions: { $sum: 1 },
        complaintMentions: { $sum: { $cond: ['$analysis.isComplaint', 1, 0] } },
        negativeMentions: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
      },
    },
  ];
}

function topicsPipeline(attributeMatch, window) {
  const last14Start = new Date(window.to.getTime() - TREND_DAYS * DAY_MS);
  const prev14Start = new Date(window.to.getTime() - (TREND_DAYS * 2) * DAY_MS);
  return [
    { $match: { $and: [attributeMatch, analysedMatch(), { createdAt: { $lte: window.to } }] } },
    { $match: { 'analysis.isComplaint': true } },
    {
      $facet: {
        inWindow: [
          { $match: { createdAt: { $gte: window.from } } },
          {
            $group: {
              _id: '$analysis.topic',
              mentions: { $sum: 1 },
              uniqueHashes: { $addToSet: '$textHash' },
              avgSeverity: { $avg: '$analysis.severity' },
              negativeMentions: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
            },
          },
        ],
        recent: [
          { $match: { createdAt: { $gte: prev14Start } } },
          {
            $group: {
              _id: '$analysis.topic',
              mentionsLast14d: {
                $sum: { $cond: [{ $gte: ['$createdAt', last14Start] }, 1, 0] },
              },
              mentionsPrev14d: {
                $sum: { $cond: [{ $lt: ['$createdAt', last14Start] }, 1, 0] },
              },
            },
          },
        ],
      },
    },
  ];
}

function trendsPipeline(match, granularity) {
  const bucket = dateTruncExpression(granularity);
  return [
    { $match: match },
    {
      $facet: {
        overall: [
          {
            $group: {
              _id: bucket,
              total: { $sum: 1 },
              complaints: { $sum: { $cond: ['$analysis.isComplaint', 1, 0] } },
              positive: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'positive'] }, 1, 0] } },
              neutral: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'neutral'] }, 1, 0] } },
              mixed: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'mixed'] }, 1, 0] } },
              negative: { $sum: { $cond: [{ $eq: ['$analysis.sentiment', 'negative'] }, 1, 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byTopic: [
          { $match: { 'analysis.isComplaint': true } },
          { $group: { _id: { date: bucket, topic: '$analysis.topic' }, count: { $sum: 1 } } },
        ],
      },
    },
  ];
}

function emptySummary() {
  return {
    totalMentions: 0,
    uniquePhrasings: 0,
    complaintMentions: 0,
    negativeMentions: 0,
    avgSentimentScore: 0,
  };
}

function formatSentiment(rows = []) {
  const counts = { positive: 0, neutral: 0, mixed: 0, negative: 0 };
  for (const row of rows) {
    if (SENTIMENT_KEYS.includes(row._id)) counts[row._id] = row.count;
  }
  return counts;
}

function formatByCategory(rows = []) {
  const byCategory = new Map(CATEGORY_VALUES.map((category) => [category, {
    category,
    positive: 0,
    neutral: 0,
    mixed: 0,
    negative: 0,
    total: 0,
  }]));
  for (const row of rows) {
    const category = row._id?.category;
    const sentiment = row._id?.sentiment;
    const entry = byCategory.get(category);
    if (!entry || !SENTIMENT_KEYS.includes(sentiment)) continue;
    entry[sentiment] += row.count;
    entry.total += row.count;
  }
  return CATEGORY_VALUES.map((category) => byCategory.get(category));
}

function formatBySource(rows = []) {
  const counts = new Map(SOURCE_VALUES.map((source) => [source, 0]));
  for (const row of rows) {
    if (counts.has(row._id)) counts.set(row._id, row.count);
  }
  return SOURCE_VALUES.map((source) => ({ source, count: counts.get(source) }));
}

function formatTopIssue(rows = []) {
  const row = rows[0];
  if (!row?._id) return null;
  const meta = topicMeta.get(row._id);
  return {
    key: row._id,
    label: meta?.label || row._id,
    mentions: row.mentions,
  };
}

function emptyStatsPayload(window) {
  return {
    window: window ? {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      days: window.days,
    } : { from: null, to: null, days: 0 },
    kpis: {
      totalMentions: 0,
      uniquePhrasings: 0,
      complaintMentions: 0,
      complaintShare: 0,
      negativeShare: 0,
      avgSentimentScore: 0,
      topIssue: null,
    },
    deltas: { complaintMentions: null, negativeShare: null },
    sentiment: { positive: 0, neutral: 0, mixed: 0, negative: 0 },
    byCategory: formatByCategory(),
    bySource: formatBySource(),
    unanalysed: 0,
  };
}

async function latestCreatedAt() {
  const row = await Feedback.findOne({}, { createdAt: 1 }).sort({ createdAt: -1 }).lean();
  return row?.createdAt || null;
}

async function getStats(query = {}) {
  const parsed = validateStatsQuery(query);
  if (parsed.error) {
    const error = new Error(parsed.error.message);
    error.status = parsed.error.status;
    throw error;
  }
  const latest = await latestCreatedAt();
  const window = resolveWindow(parsed.filters, latest);
  if (!window) return emptyStatsPayload(null);

  const currentMatch = withAnalysed(applyWindow(buildAttributeFilter(parsed.filters), window));
  const prev = previousWindow(window);
  const prevMatch = prev ? withAnalysed(applyWindow(buildAttributeFilter(parsed.filters), prev)) : null;
  const unanalysedMatch = {
    $and: [applyWindow(buildAttributeFilter(parsed.filters), window), unanalysedClause()],
  };

  const [currentRows, previousRows, unanalysed] = await Promise.all([
    Feedback.aggregate(statsPipeline(currentMatch)),
    prevMatch ? Feedback.aggregate(statsSummaryPipeline(prevMatch)) : Promise.resolve([]),
    Feedback.countDocuments(unanalysedMatch),
  ]);

  const facet = currentRows[0] || {};
  const summary = facet.summary?.[0] || emptySummary();
  const previous = previousRows[0] || null;
  const complaintShare = share(summary.complaintMentions, summary.totalMentions);
  const negativeShare = share(summary.negativeMentions, summary.totalMentions);
  const previousNegativeShare = previous
    ? share(previous.negativeMentions, previous.totalMentions)
    : null;
  const hasPrevious = Boolean(previous && previous.totalMentions > 0);

  return {
    window: {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      days: window.days,
    },
    kpis: {
      totalMentions: summary.totalMentions,
      uniquePhrasings: summary.uniquePhrasings || 0,
      complaintMentions: summary.complaintMentions,
      complaintShare: roundShare(complaintShare),
      negativeShare: roundShare(negativeShare),
      avgSentimentScore: roundMetric(summary.avgSentimentScore || 0, 4) || 0,
      topIssue: formatTopIssue(facet.topIssue),
    },
    deltas: {
      complaintMentions: hasPrevious
        ? roundMetric(trendPct(summary.complaintMentions, previous.complaintMentions), 2)
        : null,
      negativeShare: hasPrevious
        ? roundMetric(trendPct(negativeShare, previousNegativeShare), 2)
        : null,
    },
    sentiment: formatSentiment(facet.sentiment),
    byCategory: formatByCategory(facet.byCategory),
    bySource: formatBySource(facet.bySource),
    unanalysed,
  };
}

function formatTopics(facet = {}) {
  const recent = new Map((facet.recent || []).map((row) => [row._id, row]));
  const topics = (facet.inWindow || []).map((row) => {
    const meta = topicMeta.get(row._id) || { key: row._id, label: row._id, parentCategory: '' };
    const mentions = row.mentions || 0;
    const uniquePhrasings = Array.isArray(row.uniqueHashes) ? row.uniqueHashes.length : 0;
    const trend = recent.get(row._id) || { mentionsLast14d: 0, mentionsPrev14d: 0 };
    return {
      key: row._id,
      label: meta.label,
      parentCategory: meta.parentCategory,
      mentions,
      uniquePhrasings,
      avgSeverity: roundMetric(row.avgSeverity || 0, 2) || 0,
      negativeShare: roundShare(share(row.negativeMentions || 0, mentions)),
      mentionsLast14d: trend.mentionsLast14d || 0,
      mentionsPrev14d: trend.mentionsPrev14d || 0,
      trendPct: roundMetric(trendPct(trend.mentionsLast14d || 0, trend.mentionsPrev14d || 0), 2),
    };
  });
  topics.sort((a, b) => b.mentions - a.mentions || a.key.localeCompare(b.key));
  return topics;
}

async function getTopics(query = {}) {
  const parsed = validateStatsQuery(query);
  if (parsed.error) {
    const error = new Error(parsed.error.message);
    error.status = parsed.error.status;
    throw error;
  }
  const latest = await latestCreatedAt();
  const window = resolveWindow(parsed.filters, latest);
  if (!window) return [];
  const attributeMatch = buildAttributeFilter(parsed.filters);
  const rows = await Feedback.aggregate(topicsPipeline(attributeMatch, window));
  return formatTopics(rows[0] || {});
}

function pickTrendTopics(byTopicRows, requestedKeys) {
  if (requestedKeys?.length) return requestedKeys;
  const totals = new Map();
  for (const row of byTopicRows) {
    const key = row._id?.topic;
    if (!key) continue;
    totals.set(key, (totals.get(key) || 0) + row.count);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, DEFAULT_TREND_TOPIC_COUNT)
    .map(([key]) => key);
}

async function getTrends(query = {}) {
  const parsed = validateStatsQuery(query);
  if (parsed.error) {
    const error = new Error(parsed.error.message);
    error.status = parsed.error.status;
    throw error;
  }
  const latest = await latestCreatedAt();
  const window = resolveWindow(parsed.filters, latest);
  if (!window) {
    return { granularity: parsed.granularity || 'day', topics: [], buckets: [] };
  }
  const granularity = resolveGranularity(parsed.granularity, window.days);
  const match = withAnalysed(applyWindow(buildAttributeFilter(parsed.filters), window));
  const rows = await Feedback.aggregate(trendsPipeline(match, granularity));
  const facet = rows[0] || { overall: [], byTopic: [] };
  const topicKeys = pickTrendTopics(facet.byTopic || [], parsed.topicKeys);
  const sparse = (facet.overall || []).map((row) => ({
    date: isoDateUtc(row._id),
    total: row.total,
    complaints: row.complaints,
    positive: row.positive,
    neutral: row.neutral,
    mixed: row.mixed,
    negative: row.negative,
    topics: {},
  }));
  const sparseByDate = new Map(sparse.map((row) => [row.date, row]));
  for (const row of facet.byTopic || []) {
    const key = row._id?.topic;
    if (!topicKeys.includes(key)) continue;
    const date = isoDateUtc(row._id.date);
    const bucket = sparseByDate.get(date);
    if (!bucket) continue;
    bucket.topics[key] = row.count;
  }
  return {
    granularity,
    topics: topicKeys.map((key) => ({
      key,
      label: topicMeta.get(key)?.label || key,
    })),
    buckets: fillBuckets(window.from, window.to, granularity, sparse, topicKeys),
  };
}

module.exports = {
  DAY_MS,
  DEFAULT_WINDOW_DAYS,
  TREND_DAYS,
  MAX_TREND_TOPICS,
  validateStatsQuery,
  buildMatch,
  buildAttributeFilter,
  analysedMatch,
  unanalysedClause,
  resolveWindow,
  previousWindow,
  resolveGranularity,
  share,
  trendPct,
  fillBuckets,
  startOfUtcWeekMonday,
  statsPipeline,
  topicsPipeline,
  trendsPipeline,
  latestCreatedAt,
  getStats,
  getTopics,
  getTrends,
};
