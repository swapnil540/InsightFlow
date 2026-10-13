const express = require('express');
const mongoose = require('mongoose');
const Feedback = require('../models/feedback');
const Analysis = require('../models/analysis');
const AdaptionRun = require('../models/adaptionRun');
const Issue = require('../models/issue');
const { getPriorities } = require('../services/priorityService');
const { trackIssue, getIssues, updateIssue } = require('../services/issueService');
const { generateReport, getReportByToken, listReports } = require('../services/reportService');
const {
  CATEGORY_VALUES,
  SENTIMENT_VALUES,
  SOURCE_VALUES,
  TOPIC_GROUPS,
  SORT_VALUES,
  LIMIT_VALUES,
  parseFilters,
} = require('../services/filters');
const { getFeedbackPage, validateNewFeedback, createFeedback } = require('../services/feedbackService');
const taxonomy = require('../config/taxonomy');
const multer = require('multer');
const { prepareImportPreview, confirmImport } = require('../services/csvImportService');
const { getImport, deleteImport } = require('../services/importStore');
const { getSampleStatus, loadSampleData } = require('../services/sampleLoader');

const router = express.Router();

const FEEDBACK_NOTICES = {
  added: { type: 'success', icon: 'check-circle-fill', message: 'Feedback added successfully.' },
};
const IMPORT_NOTICES = {
  expired: { type: 'warning', icon: 'clock-history', message: 'This preview expired. Upload the CSV again to continue.' },
};
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!/\.csv$/i.test(file.originalname)) return callback(new Error('Upload a file with the .csv extension.'));
    callback(null, true);
  },
}).single('file');

router.get('/', async (req, res) => {
  res.render('pages/home', {
    pageTitle: 'Home',
    sampleStatus: await getSampleStatus(),
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
      allHref: feedbackUrl(filters, { view: 'all', q: row.feedback.text.slice(0, 100), page: '1' }),
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
    notice: typeof req.query.notice === 'string' ? FEEDBACK_NOTICES[req.query.notice] : undefined,
  });
});

router.get('/feedback/new', (req, res) => {
  res.render('pages/feedback-new', {
    pageTitle: 'Add feedback',
    activeNav: 'feedback',
    categories: CATEGORY_VALUES,
    sources: SOURCE_VALUES,
    values: { text: '', category: '', source: 'Review' },
    errors: {},
  });
});

router.post('/feedback', async (req, res) => {
  const { errors, values } = validateNewFeedback(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).render('pages/feedback-new', {
      pageTitle: 'Add feedback',
      activeNav: 'feedback',
      categories: CATEGORY_VALUES,
      sources: SOURCE_VALUES,
      values,
      errors,
    });
  }

  const { feedback, analysisResult } = await createFeedback(values);
  res.render('pages/feedback-result', {
    pageTitle: 'Feedback analyzed',
    activeNav: 'feedback',
    feedback,
    analysisResult,
    lowConfidence: analysisResult.confidence < 0.5,
  });
});

router.get('/import/template.csv', (req, res) => {
  const template = 'review,category,source,date\r\n"A customer feedback example.",Product Feedback,Review,2026-10-12\r\n';
  res.type('text/csv').attachment('insightflow-import-template.csv').send(template);
});

router.get('/import', async (req, res) => {
  res.render('pages/import', {
    pageTitle: 'Import feedback',
    activeNav: 'import',
    notice: typeof req.query.notice === 'string' ? IMPORT_NOTICES[req.query.notice] : undefined,
    sampleStatus: await getSampleStatus(),
  });
});

router.post('/import/sample', async (req, res) => {
  const result = await loadSampleData();
  const status = result.alreadyLoaded
    ? `Sample data already loaded: ${result.feedbackCount.toLocaleString()} entries and ${result.uniqueTextCount} unique texts.`
    : `Sample data loaded: ${result.addedCount.toLocaleString()} entries added (${result.feedbackCount.toLocaleString()} total sample entries).`;
  res.render('pages/import', {
    pageTitle: 'Import feedback',
    activeNav: 'import',
    notice: undefined,
    sampleStatus: await getSampleStatus(),
    sampleNotice: status,
  });
});

router.post('/import/preview', (req, res, next) => {
  csvUpload(req, res, (uploadError) => {
    if (uploadError) {
      const isSizeError = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE';
      const message = isSizeError ? 'The CSV file must be 5 MB or smaller.' : 'Upload one CSV file with a .csv extension.';
      return res.status(400).render('pages/import', {
        pageTitle: 'Import feedback',
        activeNav: 'import',
        notice: { type: 'danger', icon: 'exclamation-triangle', message },
      });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).render('pages/import', {
      pageTitle: 'Import feedback',
      activeNav: 'import',
      notice: { type: 'danger', icon: 'exclamation-triangle', message: 'Choose a CSV file to preview.' },
    });
  }
  try {
    const preview = await prepareImportPreview(req.file.buffer);
    res.render('pages/import-preview', {
      pageTitle: 'Preview CSV import',
      activeNav: 'import',
      fileName: req.file.originalname,
      preview,
      reasonLabels: {
        empty: 'Empty feedback row',
        too_short: 'Feedback shorter than 5 characters',
        too_long: 'Feedback longer than 1,000 characters',
        bad_date: 'Invalid date',
        invalid_category: 'Invalid category',
        invalid_source: 'Invalid source',
      },
    });
  } catch (error) {
    const message = error.message.includes('Database is not connected')
      ? 'The database is not connected. Reconnect and try the preview again.'
      : error.message;
    res.status(400).render('pages/import', {
      pageTitle: 'Import feedback',
      activeNav: 'import',
      notice: { type: 'danger', icon: 'exclamation-triangle', message },
    });
  }
});

router.post('/import/confirm', async (req, res) => {
  const previewId = typeof req.body.previewId === 'string' ? req.body.previewId : '';
  const stored = getImport(previewId);
  if (!stored) return res.redirect('/import?notice=expired');
  if (!stored.rows.length) return res.redirect('/import');

  const result = await confirmImport(stored.rows);
  deleteImport(previewId);
  res.render('pages/import-result', {
    pageTitle: 'Import complete',
    activeNav: 'import',
    ...result,
    skippedCount: stored.metadata.skippedCount || 0,
  });
});

router.get('/dashboard', (req, res) => {
  res.render('pages/dashboard', {
    pageTitle: 'Dashboard',
    activeNav: 'dashboard',
    categories: CATEGORY_VALUES,
    sentiments: SENTIMENT_VALUES,
    sources: SOURCE_VALUES,
    topicGroups: TOPIC_GROUPS,
  });
});

router.get('/insights', async (req, res) => {
  try {
    const data = await getPriorities(req.query);
    let trackedSet = new Set();
    if (mongoose.connection.readyState === 1) {
      const tracked = await Issue.find({ status: { $in: ['open', 'investigating'] } }, { topicKey: 1 }).lean();
      trackedSet = new Set(tracked.map((i) => i.topicKey));
    }

    let notice = null;
    if (req.query.notice === 'tracked') {
      notice = { type: 'success', icon: 'check-circle-fill', message: 'Issue is now tracked under Issues.' };
    } else if (req.query.notice === 'exists') {
      notice = { type: 'info', icon: 'info-circle-fill', message: 'An active issue for this topic is already being tracked.' };
    }

    res.render('pages/insights', {
      pageTitle: 'Priorities & Recommendations',
      activeNav: 'insights',
      window: data.window,
      priorities: data.priorities,
      topPriorities: data.priorities.slice(0, 5),
      trackedSet,
      selectedCategory: req.query.category || '',
      selectedPreset: req.query.preset || (req.query.from || req.query.to ? '' : '90'),
      categories: CATEGORY_VALUES,
      notice,
    });
  } catch (error) {
    res.render('pages/insights', {
      pageTitle: 'Priorities & Recommendations',
      activeNav: 'insights',
      window: { from: null, to: null, days: 0 },
      priorities: [],
      topPriorities: [],
      trackedSet: new Set(),
      selectedCategory: req.query.category || '',
      selectedPreset: req.query.preset || '90',
      categories: CATEGORY_VALUES,
      notice: null,
      error: error.message,
    });
  }
});

const ISSUE_NOTICES = {
  created: { type: 'success', icon: 'check-circle-fill', message: 'Issue tracked successfully.' },
  updated: { type: 'success', icon: 'check-circle-fill', message: 'Issue updated successfully.' },
  exists: { type: 'warning', icon: 'info-circle-fill', message: 'An active issue for this topic is already being tracked.' },
  invalid: { type: 'danger', icon: 'exclamation-triangle', message: 'Invalid topic key.' },
};

const REPORT_NOTICES = {
  created: { type: 'success', icon: 'check-circle-fill', message: 'Report snapshot generated successfully.' },
};

router.post('/issues', async (req, res) => {
  const topicKey = req.body?.topicKey;
  try {
    const result = await trackIssue(topicKey);
    if (result.alreadyTracked) {
      return res.redirect('/issues?notice=exists');
    }
    return res.redirect('/issues?notice=created');
  } catch {
    return res.redirect('/insights?notice=invalid');
  }
});

router.get('/issues', async (req, res) => {
  try {
    const status = req.query.status;
    const { issues, counts } = await getIssues(status);
    const notice = ISSUE_NOTICES[req.query.notice] || null;
    res.render('pages/issues', {
      pageTitle: 'Tracked Issues',
      activeNav: 'issues',
      issues,
      counts,
      selectedStatus: status || '',
      notice,
    });
  } catch (error) {
    res.render('pages/issues', {
      pageTitle: 'Tracked Issues',
      activeNav: 'issues',
      issues: [],
      counts: { all: 0, open: 0, investigating: 0, resolved: 0 },
      selectedStatus: '',
      notice: { type: 'danger', icon: 'exclamation-triangle', message: 'Unable to load tracked issues.' },
    });
  }
});

router.post('/issues/:id', async (req, res) => {
  try {
    await updateIssue(req.params.id, req.body);
    res.redirect('/issues?notice=updated');
  } catch {
    res.redirect('/issues');
  }
});

router.get('/reports', async (req, res) => {
  try {
    const reports = await listReports();
    const notice = REPORT_NOTICES[req.query.notice] || null;
    res.render('pages/reports', {
      pageTitle: 'Executive Reports',
      activeNav: 'reports',
      reports,
      notice,
    });
  } catch {
    res.render('pages/reports', {
      pageTitle: 'Executive Reports',
      activeNav: 'reports',
      reports: [],
      notice: { type: 'danger', icon: 'exclamation-triangle', message: 'Unable to load reports.' },
    });
  }
});

router.post('/reports', async (req, res) => {
  try {
    const report = await generateReport(req.body?.title);
    res.redirect(`/r/${report.token}`);
  } catch {
    res.redirect('/reports');
  }
});

router.get('/r/:token', async (req, res) => {
  try {
    const report = await getReportByToken(req.params.token);
    if (!report) {
      return res.status(404).render('pages/404', { pageTitle: 'Report not found' });
    }
    res.render('pages/report-view', {
      layout: false,
      report,
      payload: report.payload || {},
    });
  } catch {
    res.status(500).render('pages/error', {
      pageTitle: 'Unable to load report',
      message: 'There was an issue opening this report snapshot.',
    });
  }
});

const placeholders = [
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
    dbState: mongoose.connection.readyState,
    dbConfigured: Boolean(process.env.MONGODB_URI),
    counts,
    time: new Date().toISOString(),
  });
});

module.exports = router;
