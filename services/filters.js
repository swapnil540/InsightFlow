const taxonomy = require('../config/taxonomy');

const CATEGORY_VALUES = ['Customer Service', 'Fraud and Scam', 'Operational Issues', 'Product Feedback'];
const SENTIMENT_VALUES = ['positive', 'neutral', 'negative', 'mixed'];
const SOURCE_VALUES = ['Review', 'Survey', 'Support'];
const TOPIC_VALUES = taxonomy.map(({ key }) => key);
const TOPIC_GROUPS = CATEGORY_VALUES.map((parentCategory) => ({
  parentCategory,
  topics: taxonomy.filter((topic) => topic.parentCategory === parentCategory),
}));
const VIEW_VALUES = ['grouped', 'all'];
const SORT_VALUES = ['newest', 'oldest', 'severity', 'mentions'];
const LIMIT_VALUES = [10, 20, 50, 100];

function queryString(query, key) {
  const value = query?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function enumValue(value, allowedValues) {
  return allowedValues.includes(value) ? value : undefined;
}

function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function integerValue(value, minimum, maximum) {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function parseFilters(query = {}) {
  const filters = {};
  const category = enumValue(queryString(query, 'category'), CATEGORY_VALUES);
  const sentiment = enumValue(queryString(query, 'sentiment'), SENTIMENT_VALUES);
  const topic = enumValue(queryString(query, 'topic'), TOPIC_VALUES);
  const source = enumValue(queryString(query, 'source'), SOURCE_VALUES);
  const from = dateValue(queryString(query, 'from'));
  const to = dateValue(queryString(query, 'to'));
  const search = queryString(query, 'q');
  const batch = queryString(query, 'batch');
  const view = enumValue(queryString(query, 'view'), VIEW_VALUES) || 'grouped';
  const requestedSort = enumValue(queryString(query, 'sort'), SORT_VALUES);
  const page = integerValue(queryString(query, 'page'), 1, 1000000);
  const limit = integerValue(queryString(query, 'limit'), 1, 100);

  if (category) filters.category = category;
  if (sentiment) filters.sentiment = sentiment;
  if (topic) filters.topic = topic;
  if (source) filters.source = source;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (search && search.length <= 100) filters.q = search;
  if (batch && batch.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(batch)) filters.batch = batch;

  filters.view = view;
  filters.sort = requestedSort && !(view === 'all' && requestedSort === 'mentions')
    ? requestedSort
    : (view === 'all' ? 'newest' : 'mentions');
  filters.page = page || 1;
  filters.limit = limit || 20;
  if (queryString(query, 'complaint') === '1') filters.complaint = true;
  return filters;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFeedbackFilter(filters = {}) {
  const mongoFilter = {};
  if (CATEGORY_VALUES.includes(filters.category)) mongoFilter.originalCategory = filters.category;
  if (SENTIMENT_VALUES.includes(filters.sentiment)) mongoFilter['analysis.sentiment'] = filters.sentiment;
  if (TOPIC_VALUES.includes(filters.topic)) mongoFilter['analysis.topic'] = filters.topic;
  if (SOURCE_VALUES.includes(filters.source)) mongoFilter.source = filters.source;
  if (filters.complaint === true) mongoFilter['analysis.isComplaint'] = true;
  if (typeof filters.batch === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(filters.batch)) {
    mongoFilter.importBatch = filters.batch;
  }

  const createdAt = {};
  const from = dateValue(typeof filters.from === 'string' ? filters.from : '');
  const to = dateValue(typeof filters.to === 'string' ? filters.to : '');
  if (from) createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
  if (to) createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  if (Object.keys(createdAt).length) mongoFilter.createdAt = createdAt;

  if (typeof filters.q === 'string' && filters.q.length > 0 && filters.q.length <= 100) {
    mongoFilter.text = { $regex: escapeRegex(filters.q), $options: 'i' };
  }
  return mongoFilter;
}

module.exports = {
  CATEGORY_VALUES,
  SENTIMENT_VALUES,
  SOURCE_VALUES,
  TOPIC_VALUES,
  TOPIC_GROUPS,
  VIEW_VALUES,
  SORT_VALUES,
  LIMIT_VALUES,
  parseFilters,
  buildFeedbackFilter,
};
