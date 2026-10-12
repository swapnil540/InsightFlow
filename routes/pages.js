const express = require('express');
const mongoose = require('mongoose');
const Feedback = require('../models/feedback');
const Analysis = require('../models/analysis');
const AdaptionRun = require('../models/adaptionRun');
const {
  CATEGORY_VALUES,
  SENTIMENT_VALUES,
  SOURCE_VALUES,
  TOPIC_GROUPS,
  SORT_VALUES,
  LIMIT_VALUES,
  parseFilters,
} = require('../services/filters');
const { getFeedbackPage } = require('../services/feedbackService');
const taxonomy = require('../config/taxonomy');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('pages/home', {
    pageTitle: 'Home',
  });
});

function feedbackUrl(filters, overrides = {}) {
  const params = new URLSearchParams();
  const queryValues = {
    category: filters.category,
    sentiment: filters.sentiment,
    topic: filters.topic,
    source: filters.source,
    from: filters.from,
    to: filters.to,
    q: filters.q,
    complaint: filters.complaint ? '1' : undefined,
    batch: filters.batch,
    view: filters.view,
    sort: filters.sort,
    limit: String(filters.limit),
    page: String(filters.page),
    ...overrides,
  };
  for (const [key, value] of Object.entries(queryValues)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return `/feedback?${params.toString()}`;
}

router.get('/feedback', async (req, res) => {
  const filters = parseFilters(req.query);
  const { rows, filteredTotal, totals, page } = await getFeedbackPage(filters);
  filters.page = page;
  const pageCount = Math.max(1, Math.ceil(filteredTotal / filters.limit));
  const firstItem = filteredTotal === 0 ? 0 : ((page - 1) * filters.limit) + 1;
  const lastItem = Math.min(page * filters.limit, filteredTotal);
  const topicLabels = new Map(taxonomy.map((topic) => [topic.key, topic]));
  const displayRows = rows.map((row) => {
    const topic = topicLabels.get(row.feedback.analysis?.topic);
    return {
      ...row,
      topicLabel: topic?.label || 'Unknown topic',
      topicParentCategory: topic?.parentCategory || row.feedback.originalCategory,
      allHref: feedbackUrl(filters, { view: 'all', q: row.feedback.text, page: '1' }),
    };
  });
  const chipDefinitions = [
    ['category', 'Category', filters.category],
    ['sentiment', 'Sentiment', filters.sentiment],
    ['topic', 'Topic', filters.topic ? topicLabels.get(filters.topic)?.label : undefined],
    ['source', 'Source', filters.source],
    ['from', 'From', filters.from],
    ['to', 'To', filters.to],
    ['q', 'Search', filters.q],
    ['batch', 'Import batch', filters.batch],
    ['complaint', 'Complaints', filters.complaint ? 'Only complaints' : undefined],
  ];
  const activeFilters = chipDefinitions.filter(([, , value]) => value).map(([key, label, value]) => ({
    label,
    value,
    href: feedbackUrl(filters, { [key]: null, page: '1' }),
  }));
  const pageItems = [];
  if (page > 1) pageItems.push({ label: 'Previous', href: feedbackUrl(filters, { page: String(page - 1) }) });
  const startPage = Math.max(1, page - 2);
  const endPage = Math.min(pageCount, page + 2);
  for (let number = startPage; number <= endPage; number += 1) {
    pageItems.push({ label: String(number), current: number === page, href: feedbackUrl(filters, { page: String(number) }) });
  }
  if (page < pageCount) pageItems.push({ label: 'Next', href: feedbackUrl(filters, { page: String(page + 1) }) });

  res.render('pages/feedback', {
    pageTitle: 'Feedback',
    activeNav: 'feedback',
    filters,
    categories: CATEGORY_VALUES,
    sentiments: SENTIMENT_VALUES,
    sources: SOURCE_VALUES,
    topicGroups: TOPIC_GROUPS,
    sortOptions: SORT_VALUES,
    pageSizes: LIMIT_VALUES.filter((limit) => limit <= 50),
    rows: displayRows,
    filteredTotal,
    totals,
    firstItem,
    lastItem,
    activeFilters,
    pagination: pageItems,
    resetHref: '/feedback',
    groupedHref: feedbackUrl(filters, { view: 'grouped', sort: 'mentions', page: '1' }),
    allEntriesHref: feedbackUrl(filters, { view: 'all', sort: 'newest', page: '1' }),
  });
});

const placeholders = [
  { path: '/dashboard', key: 'dashboard', title: 'Dashboard', phase: 'Planned for Phase 5', icon: 'bar-chart-line', description: 'A filterable overview of feedback volume, sentiment, topics, and trends will appear here.' },
  { path: '/import', key: 'import', title: 'Import feedback', phase: 'Building in Phase 3', icon: 'cloud-arrow-up', description: 'Preview and import a feedback CSV here. CSV import is coming in a later Phase 3 step.' },
  { path: '/insights', key: 'insights', title: 'Insights', phase: 'Planned for Phase 6', icon: 'lightbulb', description: 'Prioritized customer issues, supporting evidence, and actionable recommendations will appear here.' },
  { path: '/issues', key: 'issues', title: 'Issues', phase: 'Planned for Phase 7', icon: 'kanban', description: 'Track issue status, ownership, and team notes here.' },
  { path: '/reports', key: 'reports', title: 'Reports', phase: 'Planned for Phase 7', icon: 'file-earmark-bar-graph', description: 'Create and share reports built from feedback and issue snapshots here.' },
  { path: '/adaption', key: 'adaption', title: 'Adaption', phase: 'Planned for Phase 8', icon: 'diagram-3', description: 'See how Adaption contributes to the project data workflow and review run details here.' },
];

for (const page of placeholders) {
  router.get(page.path, (req, res) => res.render('pages/placeholder', {
    pageTitle: page.title,
    activeNav: page.key,
    heading: page.title,
    phaseLabel: page.phase,
    icon: page.icon,
    description: page.description,
  }));
}

router.get('/health', async (req, res) => {
  let state = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  let counts = { feedbacks: null, analyses: null, adaptionRuns: null };

  if (state === 'connected') {
    try {
      const [feedbacks, analyses, adaptionRuns] = await Promise.all([
        Feedback.countDocuments(),
        Analysis.countDocuments(),
        AdaptionRun.countDocuments(),
      ]);
      counts = { feedbacks, analyses, adaptionRuns };
    } catch {
      state = 'disconnected';
    }
  }

  res.json({
    ok: true,
    db: state,
    counts,
    time: new Date().toISOString(),
  });
});

module.exports = router;
