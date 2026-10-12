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
