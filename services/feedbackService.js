const Feedback = require('../models/feedback');
const { buildFeedbackFilter, CATEGORY_VALUES, SOURCE_VALUES } = require('./filters');
const taxonomy = require('../config/taxonomy');
const { analyzeText } = require('./analysisService');
const { normalizeText, textHash } = require('./textHash');

const topicByKey = new Map(taxonomy.map((topic) => [topic.key, topic]));

function validDateInput(value) {
  if (!value) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function validateNewFeedback(body = {}) {
  const errors = {};
  const rawText = typeof body.text === 'string' ? body.text : '';
  const text = normalizeText(rawText);
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const source = typeof body.source === 'string' ? body.source.trim() : '';
  const dateInput = typeof body.date === 'string' ? body.date.trim() : '';
  const date = validDateInput(dateInput);

  if (text.length < 10) errors.text = 'Enter at least 10 characters of feedback.';
  else if (text.length > 1000) errors.text = 'Feedback must be 1,000 characters or fewer.';
  if (category && !CATEGORY_VALUES.includes(category)) errors.category = 'Choose a listed category or leave it on auto.';
  if (!SOURCE_VALUES.includes(source)) errors.source = 'Choose Review, Survey, or Support.';
  if (date === null) errors.date = 'Enter a valid date.';

  return {
    errors,
    values: { text, category, source, date: dateInput },
    date: date || undefined,
  };
}

async function createFeedback(values) {
  const { analysis } = await analyzeText(values.text, { category: values.category || undefined });
  const topic = topicByKey.get(analysis.topic);
  const feedback = await Feedback.create({
    text: values.text,
    textHash: textHash(values.text),
    originalCategory: values.category || topic.parentCategory,
    source: values.source,
    createdAt: values.date || new Date(),
    isSimulated: false,
    analysis,
  });
  return feedback;
}

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

module.exports = { getFeedbackPage, validateNewFeedback, createFeedback };
