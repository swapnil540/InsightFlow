const Feedback = require('../models/feedback');
const taxonomy = require('../config/taxonomy');
const recommendations = require('../config/recommendations');
const {
  validateStatsQuery,
  buildAttributeFilter,
  analysedMatch,
  resolveWindow,
  latestCreatedAt,
  DAY_MS,
  TREND_DAYS,
} = require('./statsService');

function roundMetric(value, digits = 4) {
  if (value == null || Number.isNaN(Number(value))) return value == null ? null : 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

const WEIGHT_VOLUME = 0.35;
const WEIGHT_NEGATIVITY = 0.30;
const WEIGHT_SEVERITY = 0.20;
const WEIGHT_TREND = 0.15;
const MIN_COMPLAINTS = 5;

const topicMeta = new Map(taxonomy.map((t) => [t.key, t]));

function clamp(value, min, max) {
  if (Number.isNaN(value) || value == null) return min;
  return Math.max(min, Math.min(max, value));
}

function formatExplanation(rank, complaints, shareOfComplaints, uniquePhrasings, negativity, avgSeverity, recent14, prev14) {
  const sharePct = Math.round((shareOfComplaints || 0) * 100);
  const negPct = Math.round((negativity || 0) * 100);
  const sevDisplay = (avgSeverity || 0).toFixed(1);

  let trendText;
  if (recent14 > prev14) {
    if (prev14 > 0) {
      const pct = Math.round(((recent14 - prev14) / prev14) * 100);
      trendText = `up ${pct}% in the last 14 days vs the previous 14`;
    } else {
      trendText = `up from 0 in the last 14 days vs the previous 14`;
    }
  } else if (recent14 === prev14) {
    trendText = 'stable in the last 14 days vs the previous 14';
  } else {
    if (prev14 > 0) {
      const pct = Math.round(((prev14 - recent14) / prev14) * 100);
      trendText = `down ${pct}% in the last 14 days vs the previous 14`;
    } else {
      trendText = 'down in the last 14 days vs the previous 14';
    }
  }

  return `Ranked #${rank}: ${complaints} complaints (${sharePct}% of all complaints, ${uniquePhrasings} unique phrasings); ${negPct}% of mentions are negative; average severity ${sevDisplay}/5; ${trendText}.`;
}

/**
 * PURE scoring function: accepts aggregated rows and produces ranked topics.
 * @param {Array} rows - Array of objects with topic statistics.
 * @param {Object} [opts] - Optional parameters { totalComplaints, maxComplaints, limit }.
 * @returns {Array} Scored, ranked priorities.
 */
function scoreTopics(rows = [], opts = {}) {
  // Only topics with at least MIN_COMPLAINTS (5) complaints
  const eligible = rows.filter((r) => (r.complaints || 0) >= MIN_COMPLAINTS);
  if (!eligible.length) return [];

  const maxComplaints = opts.maxComplaints ?? Math.max(...eligible.map((r) => r.complaints || 0));
  const totalComplaints = opts.totalComplaints ?? eligible.reduce((sum, r) => sum + (r.complaints || 0), 0);

  const scored = eligible.map((row) => {
    const meta = topicMeta.get(row.key) || { key: row.key, label: row.key, parentCategory: '' };
    const complaints = row.complaints || 0;
    const mentions = row.mentions || 0;
    const negMixed = row.negativeMixedMentions != null
      ? row.negativeMixedMentions
      : (row.negativeMentions || 0) + (row.mixedMentions || 0);
    const avgSev = row.avgSeverity || 0;
    const recent14 = row.recent14 || 0;
    const prev14 = row.prev14 || 0;
    const uniquePhrasings = row.uniquePhrasings || 1;

    // Factors
    const volume = maxComplaints > 0 ? complaints / maxComplaints : 0;
    const negativity = mentions > 0 ? negMixed / mentions : 0;
    const severity = clamp(avgSev / 5, 0, 1);
    const trendDenominator = Math.max(prev14, 10);
    const rawTrend = (recent14 - prev14) / trendDenominator;
    const trend = clamp(rawTrend, 0, 1);

    const rawScore = 100 * (
      WEIGHT_VOLUME * volume +
      WEIGHT_NEGATIVITY * negativity +
      WEIGHT_SEVERITY * severity +
      WEIGHT_TREND * trend
    );
    const score = Math.round(rawScore);

    const shareOfComplaints = totalComplaints > 0 ? complaints / totalComplaints : 0;
    const priorityLevel = score >= 70 ? 'Critical' : score >= 50 ? 'High' : score >= 30 ? 'Medium' : 'Low';

    const recommendation = recommendations[row.key] || {
      team: 'Operations',
      action: `Review recurring customer complaints for ${meta.label} and establish mitigation procedures.`,
    };

    return {
      key: row.key,
      label: meta.label,
      parentCategory: meta.parentCategory,
      score,
      priorityLevel,
      priorityLabel: priorityLevel,
      level: priorityLevel,
      complaints,
      uniquePhrasings,
      shareOfComplaints: roundMetric(shareOfComplaints, 4),
      factors: {
        volume: roundMetric(volume, 4),
        negativity: roundMetric(negativity, 4),
        severity: roundMetric(severity, 4),
        trend: roundMetric(trend, 4),
      },
      rawFactors: {
        volume: { complaints, maxComplaints },
        negativity: { negativeMixedMentions: negMixed, totalMentions: mentions },
        severity: { avgSeverity: roundMetric(avgSev, 2) },
        trend: { recent14, prev14 },
      },
      evidence: Array.isArray(row.evidence) ? row.evidence.slice(0, 3) : [],
      suggestedAction: row.suggestedAction || 'Investigate root cause and respond to affected customers.',
      suggestedActionLabel: "Most common action suggested in Adaption's analysis",
      recommendation,
      _sortKey: { score, complaints, key: row.key },
    };
  });

  // Sort descending by score, tie-break by complaints, then key alphabetically
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.complaints !== a.complaints) return b.complaints - a.complaints;
    return a.key.localeCompare(b.key);
  });

  // Assign ranks and generate explanation sentences
  const ranked = scored.map((item, index) => {
    const rank = index + 1;
    const explanation = formatExplanation(
      rank,
      item.complaints,
      item.shareOfComplaints,
      item.uniquePhrasings,
      item.factors.negativity,
      item.rawFactors.severity.avgSeverity,
      item.rawFactors.trend.recent14,
      item.rawFactors.trend.prev14,
    );
    const { _sortKey, ...rest } = item;
    return {
      rank,
      ...rest,
      explanation,
    };
  });

  if (opts.limit && Number.isSafeInteger(Number(opts.limit)) && Number(opts.limit) > 0) {
    return ranked.slice(0, Number(opts.limit));
  }
  return ranked;
}

/**
 * Single aggregation database query to fetch topic statistics and feed scoreTopics.
 * @param {Object} query - Express request query.
 * @returns {Promise<Object>} { window, priorities }
 */
async function getPriorities(query = {}) {
  const latest = await latestCreatedAt();
  const queryWithPreset = { ...query };

  if (query.preset && !query.from && !query.to && latest) {
    const days = query.preset === '7' ? 7 : query.preset === '30' ? 30 : 90;
    const toDate = new Date(latest);
    const fromDate = new Date(toDate.getTime() - days * DAY_MS);
    queryWithPreset.from = fromDate.toISOString().slice(0, 10);
    queryWithPreset.to = toDate.toISOString().slice(0, 10);
  }

  const parsed = validateStatsQuery(queryWithPreset);
  if (parsed.error) {
    const error = new Error(parsed.error.message);
    error.status = parsed.error.status;
    throw error;
  }

  const window = resolveWindow(parsed.filters, latest);
  if (!window) {
    return {
      window: { from: null, to: null, days: 0 },
      priorities: [],
    };
  }

  const last14Start = new Date(window.to.getTime() - TREND_DAYS * DAY_MS);
  const prev14Start = new Date(window.to.getTime() - (TREND_DAYS * 2) * DAY_MS);
  const earliestNeeded = new Date(Math.min(window.from.getTime(), prev14Start.getTime()));

  const matchCriteria = {
    $and: [
      buildAttributeFilter(parsed.filters),
      analysedMatch(),
      { createdAt: { $gte: earliestNeeded, $lte: window.to } },
    ],
  };

  const aggregateResult = await Feedback.aggregate([
    { $match: matchCriteria },
    {
      $facet: {
        topics: [
          {
            $group: {
              _id: '$analysis.topic',
              mentions: {
                $sum: { $cond: [{ $gte: ['$createdAt', window.from] }, 1, 0] },
              },
              negativeMixedMentions: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$createdAt', window.from] },
                        { $in: ['$analysis.sentiment', ['negative', 'mixed']] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              complaints: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$createdAt', window.from] },
                        { $eq: ['$analysis.isComplaint', true] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              complaintHashes: {
                $addToSet: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$createdAt', window.from] },
                        { $eq: ['$analysis.isComplaint', true] },
                      ],
                    },
                    '$textHash',
                    '$$REMOVE',
                  ],
                },
              },
              complaintSeveritySum: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$createdAt', window.from] },
                        { $eq: ['$analysis.isComplaint', true] },
                      ],
                    },
                    '$analysis.severity',
                    0,
                  ],
                },
              },
              recent14: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$analysis.isComplaint', true] },
                        { $gte: ['$createdAt', last14Start] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              prev14: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$analysis.isComplaint', true] },
                        { $gte: ['$createdAt', prev14Start] },
                        { $lt: ['$createdAt', last14Start] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        complaintTexts: [
          {
            $match: {
              'analysis.isComplaint': true,
              createdAt: { $gte: window.from },
            },
          },
          {
            $group: {
              _id: { topic: '$analysis.topic', textHash: '$textHash' },
              text: { $first: '$text' },
              severity: { $max: '$analysis.severity' },
              suggestedAction: { $first: '$analysis.suggestedAction' },
              mentions: { $sum: 1 },
            },
          },
          { $sort: { '_id.topic': 1, severity: -1, mentions: -1 } },
        ],
      },
    },
  ]);

  const facet = aggregateResult[0] || { topics: [], complaintTexts: [] };
  const rawTopics = facet.topics || [];
  const complaintTexts = facet.complaintTexts || [];

  // Group complaint texts by topic
  const textsByTopic = new Map();
  const actionVotesByTopic = new Map();

  for (const item of complaintTexts) {
    const topicKey = item._id?.topic;
    if (!topicKey) continue;

    if (!textsByTopic.has(topicKey)) {
      textsByTopic.set(topicKey, []);
    }
    textsByTopic.get(topicKey).push({
      text: item.text,
      severity: item.severity,
      mentions: item.mentions,
    });

    if (item.suggestedAction) {
      if (!actionVotesByTopic.has(topicKey)) {
        actionVotesByTopic.set(topicKey, new Map());
      }
      const votes = actionVotesByTopic.get(topicKey);
      votes.set(item.suggestedAction, (votes.get(item.suggestedAction) || 0) + item.mentions);
    }
  }

  const rows = rawTopics.map((row) => {
    const key = row._id;
    const complaints = row.complaints || 0;
    const avgSeverity = complaints > 0 ? (row.complaintSeveritySum || 0) / complaints : 0;
    const evidence = (textsByTopic.get(key) || []).slice(0, 3);

    let topAction = null;
    const actionVotes = actionVotesByTopic.get(key);
    if (actionVotes && actionVotes.size > 0) {
      topAction = [...actionVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    return {
      key,
      mentions: row.mentions || 0,
      negativeMixedMentions: row.negativeMixedMentions || 0,
      complaints,
      uniquePhrasings: Array.isArray(row.complaintHashes) ? row.complaintHashes.length : 0,
      avgSeverity,
      recent14: row.recent14 || 0,
      prev14: row.prev14 || 0,
      evidence,
      suggestedAction: topAction,
    };
  });

  const limitParam = query.limit ? parseInt(query.limit, 10) : undefined;
  const priorities = scoreTopics(rows, { limit: limitParam });

  return {
    window: {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      days: window.days,
    },
    priorities,
  };
}

module.exports = {
  WEIGHT_VOLUME,
  WEIGHT_NEGATIVITY,
  WEIGHT_SEVERITY,
  WEIGHT_TREND,
  MIN_COMPLAINTS,
  clamp,
  formatExplanation,
  scoreTopics,
  getPriorities,
};
