const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeText, textHash } = require('../services/textHash');
const { DAY_MS, SOURCE_VALUES, loadSeedData, summarize, buildSeedData } = require('../services/seedData');
const Feedback = require('../models/feedback');
const Issue = require('../models/issue');
const Report = require('../models/report');
const AdaptionRun = require('../models/adaptionRun');

const root = path.resolve(__dirname, '..');

test('text normalization and SHA-1 contract matches prepared unique counts and adapted hashes', () => {
  assert.equal(normalizeText(' \t Hello\n  WORLD \r\n'), 'Hello WORLD');
  const lines = fs.readFileSync(path.join(root, 'data/unique_counts.csv'), 'utf8').trimEnd().split(/\r?\n/).slice(1);
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{40}),("(?:[^"]|"")*"|.*),([^,]+),(\d+)$/);
    assert.ok(match, `Could not parse unique_counts row: ${line}`);
    const review = match[2].startsWith('"')
      ? match[2].slice(1, -1).replace(/""/g, '"')
      : match[2];
    assert.equal(textHash(review), match[1]);
  }
  const adapted = JSON.parse(fs.readFileSync(path.join(root, 'data/adapted_analysis.json'), 'utf8'));
  for (const item of adapted) assert.equal(textHash(item.review), item.textHash);
});

test('seed records retain source rows with deterministic 90-day dates and weighted sources', () => {
  const anchor = new Date('2026-10-12T12:00:00.000Z');
  const first = loadSeedData(root, { anchor });
  const second = loadSeedData(root, { anchor });
  assert.equal(first.feedbacks.length, 7000);
  assert.equal(first.analyses.length, 320);
  assert.equal(new Set(first.feedbacks.map((row) => row.textHash)).size, 320);
  const sourceRows = require('../services/seedData').parseCsv(
    fs.readFileSync(path.join(root, 'data/raw_feedback.csv'), 'utf8'),
  );
  assert.deepEqual(first.feedbacks.map(({ text, originalCategory }) => ({ text, originalCategory })), sourceRows);
  assert.deepEqual(summarize(first.feedbacks, first.analyses).categories, {
    'Product Feedback': 1738,
    'Customer Service': 1707,
    'Operational Issues': 1800,
    'Fraud and Scam': 1755,
  });
  const oldestAllowed = anchor.getTime() - 90 * DAY_MS;
  const recentStart = anchor.getTime() - 21 * DAY_MS;
  assert.ok(first.feedbacks.every((row) => row.isSimulated
    && row.createdAt.getTime() >= oldestAllowed
    && row.createdAt.getTime() <= anchor.getTime()));
  assert.ok(first.feedbacks.every((row) => SOURCE_VALUES.includes(row.source)));
  const storyComplaints = first.feedbacks.filter((row) => row.analysis.isComplaint
    && (row.analysis.topic.startsWith('fraud_') || row.analysis.topic === 'delivery_delay'));
  const otherRows = first.feedbacks.filter((row) => !(row.analysis.isComplaint
    && (row.analysis.topic.startsWith('fraud_') || row.analysis.topic === 'delivery_delay')));
  const recentShare = (rows) => rows.filter((row) => row.createdAt.getTime() >= recentStart).length / rows.length;
  assert.ok(recentShare(storyComplaints) >= 0.35 && recentShare(storyComplaints) <= 0.55);
  assert.ok(recentShare(otherRows) >= 0.18 && recentShare(otherRows) <= 0.28);
  const customerServiceRows = first.feedbacks.filter((row) => row.originalCategory === 'Customer Service');
  const supportShare = customerServiceRows.filter((row) => row.source === 'Support').length / customerServiceRows.length;
  assert.ok(supportShare >= 0.52 && supportShare <= 0.68);
  assert.deepEqual(first.feedbacks, second.feedbacks);
  assert.deepEqual(first.analyses, second.analyses);
  assert.equal(new Set(first.feedbacks.map((row) => row.seedKey)).size, 7000);
  assert.equal(summarize(first.feedbacks, first.analyses).embeddedAnalysisMatches, true);
});

test('seed builder rejects mismatched hashes and missing analysis references', () => {
  assert.throws(() => buildSeedData({ csvText: 'review,category\nHi,Product Feedback\n', analyses: [{ textHash: 'bad', review: 'Hi' }] }), /hash mismatch/);
  assert.throws(() => buildSeedData({ csvText: 'review,category\nHi,Product Feedback\n', analyses: [] }), /No adapted analysis/);
});

test('Phase 2 models declare required Feedback indexes and later-phase schemas', () => {
  const feedbackIndexes = Feedback.schema.indexes().map(([keys]) => Object.keys(keys).join(','));
  for (const expected of ['textHash', 'createdAt', 'analysis.topic', 'analysis.sentiment', 'originalCategory', 'source', 'text']) {
    assert.ok(feedbackIndexes.includes(expected), `Missing Feedback index for ${expected}`);
  }
  assert.equal(Issue.schema.path('status').defaultValue, 'open');
  assert.equal(Report.schema.path('token').options.unique, true);
  assert.deepEqual(AdaptionRun.schema.path('role').enumValues, ['smoke_test', 'labels', 'evaluation']);
});
