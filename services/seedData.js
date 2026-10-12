const fs = require('fs');
const path = require('path');
const { textHash } = require('./textHash');
const taxonomy = require('../config/taxonomy');
const topicKeys = new Set(taxonomy.map((item) => item.key));

const SEED_BATCH = 'insightflow-phase2-v1';
const RANDOM_SEED = 0x1f10f10;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_VALUES = ['Review', 'Survey', 'Support'];

function defaultAnchor(now = new Date()) {
  const anchor = new Date(now);
  anchor.setUTCMinutes(0, 0, 0);
  return anchor;
}

function parseAnchor(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value);
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error('Anchor must be an ISO date-time with timezone, such as 2026-10-12T12:00:00Z.');
  }
  const anchor = new Date(value);
  if (!Number.isFinite(anchor.getTime())) throw new Error(`Invalid anchor date: ${value}`);
  return anchor;
}

function mulberry32(seed = RANDOM_SEED) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseSource(category, random) {
  const choices = category === 'Customer Service'
    ? [['Support', 0.60], ['Review', 0.25], ['Survey', 0.15]]
    : [['Review', 0.55], ['Survey', 0.25], ['Support', 0.20]];
  const draw = random();
  let boundary = 0;
  for (const [source, weight] of choices) {
    boundary += weight;
    if (draw < boundary) return source;
  }
  return choices[choices.length - 1][0];
}

function generatedTimestamp(analysis, anchorMs, random) {
  const isStoryComplaint = analysis.isComplaint
    && (analysis.topic.startsWith('fraud_') || analysis.topic === 'delivery_delay');
  const recentStart = anchorMs - 21 * DAY_MS;
  const oldest = anchorMs - 90 * DAY_MS;
  let start;
  let duration;
  if (isStoryComplaint && random() < 0.45) {
    start = recentStart;
    duration = 21 * DAY_MS;
  } else if (isStoryComplaint) {
    start = oldest;
    duration = 69 * DAY_MS;
  } else {
    start = oldest;
    duration = 90 * DAY_MS;
  }
  return new Date(Math.min(anchorMs, start + Math.floor(random() * duration)));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field.');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length || rows[0][0] !== 'review' || rows[0][1] !== 'category') {
    throw new Error('Expected CSV headers: review,category.');
  }
  return rows.slice(1).map((values, index) => {
    if (values.length !== 2 || !values[0].trim() || !values[1].trim()) {
      throw new Error(`Invalid raw feedback row ${index + 2}.`);
    }
    return { text: values[0], originalCategory: values[1] };
  });
}

function buildSeedData({ csvText, analyses, anchor = defaultAnchor() }) {
  const resolvedAnchor = parseAnchor(anchor);
  const random = mulberry32();
  const rawRows = parseCsv(csvText);
  if (!Array.isArray(analyses)) throw new Error('Adapted analyses must be an array.');

  const analysisByHash = new Map();
  for (const item of analyses) {
    const actualHash = textHash(item.review);
    if (actualHash !== item.textHash) throw new Error(`Adapted analysis hash mismatch: ${item.textHash}`);
    if (analysisByHash.has(item.textHash)) throw new Error(`Duplicate adapted analysis hash: ${item.textHash}`);
    if (!topicKeys.has(item.analysis?.topic)) throw new Error(`Unknown adapted analysis topic: ${item.analysis?.topic}`);
    const analysis = { ...item.analysis, producedBy: item.producedBy, adaptionRunId: item.adaptionRunId || null };
    analysisByHash.set(item.textHash, analysis);
  }

  const feedbacks = rawRows.map(({ text, originalCategory }, index) => {
    const hash = textHash(text);
    const analysis = analysisByHash.get(hash);
    if (!analysis) throw new Error(`No adapted analysis found for raw row ${index + 1} (${hash}).`);
    return {
      text,
      textHash: hash,
      originalCategory,
      source: chooseSource(originalCategory, random),
      createdAt: generatedTimestamp(analysis, resolvedAnchor.getTime(), random),
      isSimulated: true,
      analysis: { ...analysis },
      seedBatch: SEED_BATCH,
      seedKey: `${SEED_BATCH}:feedback:${String(index + 1).padStart(4, '0')}`,
    };
  });

  const uniqueAnalyses = analyses.map((item) => ({
    textHash: item.textHash,
    ...item.analysis,
    producedBy: item.producedBy,
    adaptionRunId: item.adaptionRunId || null,
    seedBatch: SEED_BATCH,
  }));
  if (rawRows.length !== 7000) throw new Error(`Expected 7000 raw feedback rows; got ${rawRows.length}.`);
  if (uniqueAnalyses.length !== 320) throw new Error(`Expected 320 adapted analyses; got ${uniqueAnalyses.length}.`);
  return { feedbacks, analyses: uniqueAnalyses };
}

function loadSeedData(root = path.resolve(__dirname, '..'), options = {}) {
  const csvText = fs.readFileSync(path.join(root, 'data', 'raw_feedback.csv'), 'utf8');
  const analyses = JSON.parse(fs.readFileSync(path.join(root, 'data', 'adapted_analysis.json'), 'utf8'));
  return buildSeedData({ csvText, analyses, ...options });
}

function summarize(feedbacks, analyses) {
  const categories = {};
  for (const feedback of feedbacks) categories[feedback.originalCategory] = (categories[feedback.originalCategory] || 0) + 1;
  return {
    feedbackCount: feedbacks.length,
    analysisCount: analyses.length,
    categories,
    simulatedFeedbackCount: feedbacks.filter((item) => item.isSimulated).length,
    embeddedAnalysisMatches: feedbacks.every((item) => {
      const cached = analyses.find((analysis) => analysis.textHash === item.textHash);
      return cached && JSON.stringify(item.analysis) === JSON.stringify(Object.fromEntries(
        ['sentiment', 'sentimentScore', 'topic', 'severity', 'isComplaint', 'issueSummary', 'suggestedAction', 'producedBy', 'adaptionRunId']
          .filter((key) => cached[key] !== undefined).map((key) => [key, cached[key]]),
      ));
    }),
  };
}

module.exports = { DAY_MS, RANDOM_SEED, SEED_BATCH, SOURCE_VALUES, buildSeedData, defaultAnchor, loadSeedData, mulberry32, parseAnchor, parseCsv, summarize };
