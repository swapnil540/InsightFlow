const express = require('express');
const { analyzeText } = require('../services/analysisService');

const router = express.Router();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30;
const requestsByIp = new Map();

router.post('/analyze', async (req, res) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  let bucket = requestsByIp.get(ip);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    requestsByIp.set(ip, bucket);
  }
  bucket.count += 1;
  res.set('RateLimit-Limit', String(RATE_LIMIT));
  res.set('RateLimit-Remaining', String(Math.max(0, RATE_LIMIT - bucket.count)));
  if (bucket.count > RATE_LIMIT) return res.status(429).json({ error: 'Too many analysis requests. Try again in a minute.' });

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text must be a non-empty string.' });
  if (text.length > 1000) return res.status(400).json({ error: 'text must be 1,000 characters or fewer.' });

  const result = await analyzeText(text);
  return res.json({
    analysis: result.analysis,
    confidence: result.confidence,
    matchedTextHash: result.matchedTextHash,
    neighbours: result.neighbours.slice(0, 3),
    lowConfidence: result.confidence < 0.5,
    notAnalyzed: result.notAnalyzed,
  });
});

module.exports = router;
