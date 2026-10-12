const Feedback = require('../models/feedback');
const { buildFeedbackFilter } = require('./filters');

function sortForAll(sort) {
  if (sort === 'oldest') return { createdAt: 1, _id: 1 };
  if (sort === 'severity') return { 'analysis.severity': -1, createdAt: -1, _id: -1 };
  return { createdAt: -1, _id: -1 };
}

function groupedSort(sort) {
  if (sort === 'oldest') return { latest: 1, _id: 1 };
  if (sort === 'severity') return { 'feedback.analysis.severity': -1, latest: -1, _id: 1 };
  if (sort === 'newest') return { latest: -1, _id: 1 };
  return { mentions: -1, latest: -1, _id: 1 };
}

function groupedPipeline(match, page, limit, sort) {
  return [
    { $match: match },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: {
      _id: '$textHash',
      mentions: { $sum: 1 },
      latest: { $max: '$createdAt' },
      representative: { $first: '$$ROOT' },
    } },
    { $project: {
      _id: 0,
      textHash: '$_id',
      mentions: 1,
      latest: 1,
      feedback: '$representative',
    } },
    { $facet: {
      items: [
        { $sort: groupedSort(sort) },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ],
      total: [{ $count: 'value' }],
    } },
  ];
}

async function getFeedbackPage(filters) {
  const mongoFilter = buildFeedbackFilter(filters);
  const [entriesTotal, uniqueTotal] = await Promise.all([
    Feedback.countDocuments(),
    Feedback.distinct('textHash').then((hashes) => hashes.length),
  ]);
  const totals = { entries: entriesTotal, uniqueTexts: uniqueTotal };

  if (filters.view === 'all') {
    const filteredTotal = await Feedback.countDocuments(mongoFilter);
    const pageCount = Math.max(1, Math.ceil(filteredTotal / filters.limit));
    const page = Math.min(filters.page, pageCount);
    const rows = filteredTotal === 0 ? [] : await Feedback.find(mongoFilter)
      .sort(sortForAll(filters.sort))
      .skip((page - 1) * filters.limit)
      .limit(filters.limit)
      .lean();
    return { rows: rows.map((feedback) => ({ feedback, mentions: 1, latest: feedback.createdAt })), filteredTotal, totals, page };
  }

  let page = filters.page;
  let [result] = await Feedback.aggregate(groupedPipeline(mongoFilter, page, filters.limit, filters.sort));
  const filteredTotal = result?.total?.[0]?.value || 0;
  const pageCount = Math.max(1, Math.ceil(filteredTotal / filters.limit));
  const clampedPage = Math.min(page, pageCount);
  if (clampedPage !== page) {
    page = clampedPage;
    [result] = await Feedback.aggregate(groupedPipeline(mongoFilter, page, filters.limit, filters.sort));
  }
  const rows = (result?.items || []).map(({ feedback, mentions, latest, textHash }) => ({
    feedback,
    mentions,
    latest,
    textHash,
  }));
  return { rows, filteredTotal, totals, page };
}

module.exports = { getFeedbackPage };
