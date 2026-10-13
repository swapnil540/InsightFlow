const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scoreTopics,
  clamp,
  WEIGHT_VOLUME,
  WEIGHT_NEGATIVITY,
  WEIGHT_SEVERITY,
  WEIGHT_TREND,
  MIN_COMPLAINTS,
} = require('../services/priorityService');

test('priority weights sum to 1.0', () => {
  const sum = WEIGHT_VOLUME + WEIGHT_NEGATIVITY + WEIGHT_SEVERITY + WEIGHT_TREND;
  assert.equal(Math.round(sum * 100) / 100, 1.0);
});

test('clamp helper bounds values to [min, max]', () => {
  assert.equal(clamp(-0.5, 0, 1), 0);
  assert.equal(clamp(1.5, 0, 1), 1);
  assert.equal(clamp(0.42, 0, 1), 0.42);
  assert.equal(clamp(NaN, 0, 1), 0);
  assert.equal(clamp(null, 0, 1), 0);
});

test('topics with fewer than 5 complaints are excluded', () => {
  const fakeRows = [
    {
      key: 'delivery_delay',
      mentions: 50,
      negativeMixedMentions: 40,
      complaints: 4, // below minimum 5
      avgSeverity: 4.5,
      recent14: 4,
      prev14: 0,
      uniquePhrasings: 2,
    },
    {
      key: 'product_quality',
      mentions: 60,
      negativeMixedMentions: 55,
      complaints: 5, // exactly minimum 5
      avgSeverity: 4.0,
      recent14: 3,
      prev14: 2,
      uniquePhrasings: 3,
    },
  ];

  const results = scoreTopics(fakeRows);
  assert.equal(results.length, 1);
  assert.equal(results[0].key, 'product_quality');
  assert.equal(results[0].rank, 1);
});

test('ranking order is descending by priority score and factors are within [0, 1]', () => {
  const fakeRows = [
    {
      key: 'customer_service_response_time',
      mentions: 100,
      negativeMixedMentions: 80,
      complaints: 20,
      avgSeverity: 3.0,
      recent14: 10,
      prev14: 10,
      uniquePhrasings: 5,
      evidence: [{ text: 'Waited 3 days for reply', mentions: 15, severity: 3 }],
      suggestedAction: 'Hire more agents',
    },
    {
      key: 'fraud_seller_scamming',
      mentions: 300,
      negativeMixedMentions: 290,
      complaints: 100,
      avgSeverity: 4.8,
      recent14: 60,
      prev14: 20,
      uniquePhrasings: 12,
      evidence: [{ text: 'Seller vanished with money', mentions: 80, severity: 5 }],
      suggestedAction: 'Freeze fraudulent accounts',
    },
    {
      key: 'delivery_delay',
      mentions: 150,
      negativeMixedMentions: 120,
      complaints: 50,
      avgSeverity: 3.5,
      recent14: 25,
      prev14: 25,
      uniquePhrasings: 8,
    },
  ];

  const results = scoreTopics(fakeRows);

  assert.equal(results.length, 3);
  // Fraud topic has highest volume, negativity, severity, and positive trend -> Ranked #1
  assert.equal(results[0].key, 'fraud_seller_scamming');
  assert.equal(results[0].rank, 1);
  assert.equal(results[1].rank, 2);
  assert.equal(results[2].rank, 3);
  assert.ok(results[0].score >= results[1].score);
  assert.ok(results[1].score >= results[2].score);

  // Check factor bounds [0, 1] for all items
  for (const item of results) {
    assert.ok(item.factors.volume >= 0 && item.factors.volume <= 1, `volume factor out of range: ${item.factors.volume}`);
    assert.ok(item.factors.negativity >= 0 && item.factors.negativity <= 1, `negativity factor out of range: ${item.factors.negativity}`);
    assert.ok(item.factors.severity >= 0 && item.factors.severity <= 1, `severity factor out of range: ${item.factors.severity}`);
    assert.ok(item.factors.trend >= 0 && item.factors.trend <= 1, `trend factor out of range: ${item.factors.trend}`);
    assert.ok(item.score >= 0 && item.score <= 100, `score out of range: ${item.score}`);
    assert.ok(['Critical', 'High', 'Medium', 'Low'].includes(item.priorityLevel));
    assert.ok(item.recommendation && item.recommendation.team && item.recommendation.action);
  }
});

test('trend clamp handles downward and explosive upward shifts cleanly', () => {
  const declining = [
    {
      key: 'delivery_delay',
      mentions: 100,
      negativeMixedMentions: 80,
      complaints: 50,
      avgSeverity: 3.0,
      recent14: 5,
      prev14: 30, // Sharp decline -> negative trend clamped to 0
      uniquePhrasings: 5,
    },
  ];
  const decliningResult = scoreTopics(declining);
  assert.equal(decliningResult[0].factors.trend, 0);
  assert.match(decliningResult[0].explanation, /down 83% in the last 14 days vs the previous 14/);

  const surging = [
    {
      key: 'fraud_payment_pressure',
      mentions: 100,
      negativeMixedMentions: 95,
      complaints: 50,
      avgSeverity: 4.5,
      recent14: 50,
      prev14: 5, // (50 - 5) / max(5, 10) = 45 / 10 = 4.5 -> clamped to 1.0
      uniquePhrasings: 6,
    },
  ];
  const surgingResult = scoreTopics(surging);
  assert.equal(surgingResult[0].factors.trend, 1);
  assert.match(surgingResult[0].explanation, /up 900% in the last 14 days vs the previous 14/);
});

test('explanation sentence contains all required numbers and formatting', () => {
  const rows = [
    {
      key: 'fraud_counterfeit_or_misrepresentation',
      mentions: 200,
      negativeMixedMentions: 180, // 90%
      complaints: 60,
      avgSeverity: 4.6,
      recent14: 35,
      prev14: 25, // up 40%
      uniquePhrasings: 15,
    },
  ];

  const results = scoreTopics(rows);
  const item = results[0];

  assert.equal(item.rank, 1);
  // Ranked #1: 60 complaints (100% of all complaints, 15 unique phrasings); 90% of mentions are negative; average severity 4.6/5; up 40% in the last 14 days vs the previous 14.
  assert.match(item.explanation, /^Ranked #1: 60 complaints \(100% of all complaints, 15 unique phrasings\); 90% of mentions are negative; average severity 4\.6\/5; up 40% in the last 14 days vs the previous 14\.$/);
});

test('stable trend produces stable wording in explanation', () => {
  const rows = [
    {
      key: 'product_setup_usage',
      mentions: 50,
      negativeMixedMentions: 30,
      complaints: 10,
      avgSeverity: 2.5,
      recent14: 5,
      prev14: 5,
      uniquePhrasings: 4,
    },
  ];

  const results = scoreTopics(rows);
  assert.match(results[0].explanation, /stable in the last 14 days vs the previous 14/);
});

test('insights.ejs renders cleanly with stub data', async () => {
  const ejs = require('ejs');
  const path = require('path');
  const fakeRows = [
    {
      key: 'fraud_seller_scamming',
      mentions: 50,
      negativeMixedMentions: 48,
      complaints: 40,
      avgSeverity: 4.8,
      recent14: 25,
      prev14: 15,
      uniquePhrasings: 8,
      evidence: [{ text: 'Scam review quote', mentions: 10, severity: 5 }],
      suggestedAction: 'Audit seller',
    },
  ];
  const priorities = scoreTopics(fakeRows);
  const templatePath = path.join(__dirname, '../views/pages/insights.ejs');
  const html = await ejs.renderFile(templatePath, {
    window: { from: '2026-07-14', to: '2026-10-12', days: 90 },
    priorities,
    topPriorities: priorities.slice(0, 5),
    trackedSet: new Set(['fraud_seller_scamming']),
    selectedCategory: '',
    selectedPreset: '90',
    categories: ['Customer Service', 'Fraud and Scam', 'Operational Issues', 'Product Feedback'],
    notice: null,
  });
  assert.ok(html.includes('Priorities &amp; Recommendations'));
  assert.ok(html.includes('Why this matters:'));
  assert.ok(html.includes('Scam review quote'));
  assert.ok(html.includes('Tracked'));
});

test('insights.ejs renders error state with retry button when loadError is present', async () => {
  const ejs = require('ejs');
  const path = require('path');
  const templatePath = path.join(__dirname, '../views/pages/insights.ejs');
  const html = await ejs.renderFile(templatePath, {
    window: { from: null, to: null, days: 0 },
    priorities: [],
    topPriorities: [],
    trackedSet: new Set(),
    selectedCategory: '',
    selectedPreset: '90',
    categories: ['Customer Service', 'Fraud and Scam', 'Operational Issues', 'Product Feedback'],
    notice: null,
    loadError: 'Could not load priorities',
  });
  assert.ok(html.includes('Could not load priorities'));
  assert.ok(html.includes('Retry'));
  assert.ok(!html.includes('No high-priority issues found'));
});

test('statsService exports required functions for priorityService', () => {
  const statsService = require('../services/statsService');
  assert.equal(typeof statsService.latestCreatedAt, 'function');
  assert.equal(typeof statsService.buildAttributeFilter, 'function');
});

