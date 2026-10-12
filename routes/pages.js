const express = require('express');
const mongoose = require('mongoose');
const Feedback = require('../models/feedback');
const Analysis = require('../models/analysis');
const AdaptionRun = require('../models/adaptionRun');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('pages/home', {
    pageTitle: 'Home',
  });
});

const placeholders = [
  { path: '/dashboard', key: 'dashboard', title: 'Dashboard', phase: 'Planned for Phase 5', icon: 'bar-chart-line', description: 'A filterable overview of feedback volume, sentiment, topics, and trends will appear here.' },
  { path: '/feedback', key: 'feedback', title: 'Feedback', phase: 'Building in Phase 3', icon: 'chat-left-text', description: 'Browse, search, and manage customer feedback here. The feedback list is coming in the next Phase 3 step.' },
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
