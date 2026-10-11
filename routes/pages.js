const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('pages/home', {
    pageTitle: 'Home',
  });
});

router.get('/health', (req, res) => {
  const state = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

  res.json({
    ok: true,
    db: state,
    time: new Date().toISOString(),
  });
});

module.exports = router;
