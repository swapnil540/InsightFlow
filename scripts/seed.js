const mongoose = require('mongoose');
const { defaultAnchor, loadSeedData, parseAnchor, summarize } = require('../services/seedData');
const { buildAdaptionRunSeedData } = require('../services/adaptionRunSeedData');
const taxonomy = require('../config/taxonomy');

const SEED_BATCH = 'insightflow-phase2-v1';
const DAY_MS = 24 * 60 * 60 * 1000;

function mondayUtc(date) {
  const monday = new Date(date);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday;
}

function percent(numerator, denominator) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function validMongoUri(value) {
  if (!value || /your|placeholder|changeme|example/i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return ['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch { return false; }
}

async function ensureFeedbackSeedKeyIndex(Feedback) {
  const indexes = await Feedback.collection.indexes();
  const existing = indexes.find((index) => index.name === 'seed_row_idempotency'
    || (index.key?.seedKey === 1));
  if (existing) {
    if (existing.unique !== true || existing.sparse !== true) {
      // Remove only the seedKey index that could reject documents without a seedKey.
      await Feedback.collection.dropIndex(existing.name);
    }
  }
  await Feedback.collection.createIndex(
    { seedKey: 1 },
    { unique: true, sparse: true, name: 'seed_row_idempotency' },
  );
}

async function main() {
  const args = process.argv.slice(2);
  let write = false;
  let verify = false;
  let anchorValue;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--write') write = true;
    else if (args[index] === '--verify') verify = true;
    else if (args[index] === '--anchor') {
      if (anchorValue !== undefined || !args[index + 1]) throw new Error('--anchor requires one ISO date-time value.');
      anchorValue = args[index + 1];
      index += 1;
    } else throw new Error('Usage: node scripts/seed.js [--write | --verify] [--anchor ISO_DATE_TIME]');
  }
  if (write && verify) {
    throw new Error('Usage: node scripts/seed.js [--write | --verify] [--anchor ISO_DATE_TIME]');
  }
  const anchor = anchorValue === undefined ? defaultAnchor() : parseAnchor(anchorValue);
  console.log(`Simulated timestamp anchor: ${anchor.toISOString()}`);
  const { feedbacks, analyses } = loadSeedData(undefined, { anchor });
  const adaptionRuns = buildAdaptionRunSeedData();
  console.log(JSON.stringify(summarize(feedbacks, analyses), null, 2));

  if (!write && !verify) {
    console.log('Dry run only. No database connection was attempted. Use --write to upsert sample records or --verify to inspect a configured database.');
    return;
  }
  const uri = process.env.MONGODB_URI;
  if (!validMongoUri(uri)) throw new Error('A valid MONGODB_URI is required for --write or --verify.');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const Feedback = require('../models/feedback');
    const Analysis = require('../models/analysis');
    const Issue = require('../models/issue');
    const Report = require('../models/report');
    const AdaptionRun = require('../models/adaptionRun');
    const models = [Feedback, Analysis, Issue, Report, AdaptionRun];
    await Promise.all(models.map((Model) => Model.createCollection()));
    await ensureFeedbackSeedKeyIndex(Feedback);
    await Promise.all(models.map((Model) => Model.ensureIndexes()));

    if (write) {
      const analysisOps = analyses.map((doc) => ({ updateOne: { filter: { textHash: doc.textHash }, update: { $setOnInsert: doc }, upsert: true } }));
      // Analysis timestamps are generated deterministically in seedData.js.
      // Disable Mongoose's bulkWrite timestamp injection to avoid conflicting
      // updates to updatedAt in the $setOnInsert documents.
      await Analysis.bulkWrite(analysisOps, { ordered: false, timestamps: false });
      const cached = await Analysis.find({ textHash: { $in: analyses.map((item) => item.textHash) } }).lean();
      const cachedByHash = new Map(cached.map((item) => [item.textHash, item]));
      const fields = ['sentiment', 'sentimentScore', 'topic', 'severity', 'isComplaint', 'issueSummary', 'suggestedAction', 'producedBy', 'adaptionRunId'];
      const feedbackOps = feedbacks.map((doc) => {
        const source = cachedByHash.get(doc.textHash);
        if (!source) throw new Error(`Analysis cache missing hash ${doc.textHash} after upsert.`);
        const embedded = Object.fromEntries(fields.map((key) => [key, source[key] ?? null]));
        return { updateOne: { filter: { seedKey: doc.seedKey }, update: { $set: { ...doc, analysis: embedded } }, upsert: true } };
      });
      console.log('Seed upserts completed; existing non-seed records were retained.');
      await Feedback.bulkWrite(feedbackOps, { ordered: false });
      const adaptionRunOps = adaptionRuns.map((doc) => ({
        updateOne: { filter: { runId: doc.runId }, update: { $set: doc }, upsert: true },
      }));
      await AdaptionRun.bulkWrite(adaptionRunOps, { ordered: false });
    }

    const seedFilter = { seedBatch: SEED_BATCH };
    const datasetHashes = analyses.map((item) => item.textHash);
    const analysisCount = await Analysis.countDocuments({ textHash: { $in: datasetHashes } });
    const [feedbackCount, adaptionRunCount, simulatedCount, missingAnalysisResult, invalidTopicCount, invalidEmbeddedAnalysisCount] = await Promise.all([
      Feedback.countDocuments(seedFilter),
      AdaptionRun.countDocuments({ runId: { $in: adaptionRuns.map((item) => item.runId) } }),
      Feedback.countDocuments({ ...seedFilter, isSimulated: true }),
      Feedback.aggregate([
        { $match: seedFilter },
        { $lookup: { from: Analysis.collection.name, localField: 'textHash', foreignField: 'textHash', as: 'cachedAnalysis' } },
        { $match: { cachedAnalysis: { $eq: [] } } },
        { $count: 'count' },
      ]),
      Feedback.countDocuments({ ...seedFilter, 'analysis.topic': { $nin: taxonomy.map((item) => item.key) } }),
      Feedback.countDocuments({
        ...seedFilter,
        $or: [
          { 'analysis.sentiment': { $exists: false } }, { 'analysis.topic': { $exists: false } },
          { 'analysis.sentimentScore': { $exists: false } }, { 'analysis.severity': { $exists: false } },
        ],
      }),
    ]);
    const missingAnalysisCount = missingAnalysisResult[0]?.count || 0;
    const [seededFeedback, seededAnalyses] = await Promise.all([
      Feedback.find(seedFilter).select('textHash analysis').lean(),
      Analysis.find({ textHash: { $in: datasetHashes } }).lean(),
    ]);
    const cacheByHash = new Map(seededAnalyses.map((item) => [item.textHash, item]));
    const comparisonFields = ['sentiment', 'sentimentScore', 'topic', 'severity', 'isComplaint', 'issueSummary', 'suggestedAction', 'producedBy', 'adaptionRunId'];
    const inconsistentAnalysisReferenceCount = seededFeedback.filter((feedback) => {
      const cache = cacheByHash.get(feedback.textHash);
      return !cache || comparisonFields.some((key) => (feedback.analysis?.[key] ?? null) !== (cache[key] ?? null));
    }).length;
    const groupedCounts = async (field) => Feedback.aggregate([
      { $match: seedFilter },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]);
    const [categoryCounts, sentimentCounts, sourceCounts, dateRangeResult, complaintTopicsRaw] = await Promise.all([
      groupedCounts('originalCategory'),
      groupedCounts('analysis.sentiment'),
      groupedCounts('source'),
      Feedback.aggregate([
        { $match: seedFilter },
        { $group: { _id: null, min: { $min: '$createdAt' }, max: { $max: '$createdAt' } } },
      ]),
      Feedback.aggregate([
        { $match: { ...seedFilter, 'analysis.isComplaint': true } },
        { $group: {
          _id: '$analysis.topic',
          mentions: { $sum: 1 },
          uniqueTextHashes: { $addToSet: '$textHash' },
        } },
        { $project: { _id: 0, topic: '$_id', mentions: 1, uniquePhrasings: { $size: '$uniqueTextHashes' } } },
        { $sort: { mentions: -1, topic: 1 } },
      ]),
    ]);
    const dateRange = dateRangeResult[0] || { min: null, max: null };
    const dateWindowCounts = {};
    for (const days of [7, 21, 90]) {
      dateWindowCounts[`last${days}Days`] = await Feedback.countDocuments({
        ...seedFilter,
        createdAt: { $gte: new Date(anchor.getTime() - days * DAY_MS), $lte: anchor },
      });
    }

    const currentWeek = mondayUtc(anchor);
    const firstWeek = new Date(currentWeek.getTime() - 12 * 7 * DAY_MS);
    const weeklyRaw = await Feedback.aggregate([
      { $match: { ...seedFilter, 'analysis.isComplaint': true, createdAt: { $gte: firstWeek, $lte: anchor } } },
      { $group: {
        _id: { $dateTrunc: { date: '$createdAt', unit: 'week', startOfWeek: 'monday', timezone: 'UTC' } },
        complaints: { $sum: 1 },
      } },
    ]);
    const weeklyByDate = new Map(weeklyRaw.map((item) => [item._id.toISOString(), item.complaints]));
    const complaintsPerWeek = Array.from({ length: 13 }, (_, index) => {
      const weekStart = new Date(firstWeek.getTime() + index * 7 * DAY_MS);
      return { weekStarting: weekStart.toISOString().slice(0, 10), complaints: weeklyByDate.get(weekStart.toISOString()) || 0 };
    });

    const storyTopicConditions = [
      { 'analysis.topic': /^fraud_/ },
      { 'analysis.topic': 'delivery_delay' },
    ];
    const storyFilter = { ...seedFilter, 'analysis.isComplaint': true, $or: storyTopicConditions };
    const allOtherFilter = { ...seedFilter, $nor: [
      { 'analysis.isComplaint': true, 'analysis.topic': /^fraud_/ },
      { 'analysis.isComplaint': true, 'analysis.topic': 'delivery_delay' },
    ] };
    const cutoff21 = new Date(anchor.getTime() - 21 * DAY_MS);
    const recentWindow = { createdAt: { $gte: cutoff21, $lte: anchor } };
    const [storyTotal, storyRecent, otherTotal, otherRecent, recentFeedbackTotal] = await Promise.all([
      Feedback.countDocuments(storyFilter),
      Feedback.countDocuments({ ...storyFilter, ...recentWindow }),
      Feedback.countDocuments(allOtherFilter),
      Feedback.countDocuments({ ...allOtherFilter, ...recentWindow }),
      Feedback.countDocuments({ ...seedFilter, ...recentWindow }),
    ]);
    const storyTrend = {
      recentWindowDays: 21,
      storyComplaints: {
        recentCount: storyRecent,
        cohortTotal: storyTotal,
        recentSharePercent: percent(storyRecent, storyTotal),
        shareOfRecentFeedbackPercent: percent(storyRecent, recentFeedbackTotal),
      },
      allOtherFeedback: {
        recentCount: otherRecent,
        cohortTotal: otherTotal,
        recentSharePercent: percent(otherRecent, otherTotal),
      },
      allRecentFeedbackCount: recentFeedbackTotal,
    };
    const textSearchResults = await Feedback.find({ $text: { $search: 'scam' } })
      .limit(3)
      .select('text textHash originalCategory source createdAt analysis')
      .lean();
    const samples = await Feedback.find(seedFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .select('text textHash originalCategory source createdAt isSimulated analysis')
      .lean();
    const actual = {
      anchor: anchor.toISOString(),
      counts: { feedbacks: feedbackCount, analyses: analysisCount, adaptionruns: adaptionRunCount },
      checks: {
        feedbacksWithoutMatchingAnalysis: missingAnalysisCount,
        feedbacksWithTopicsOutsideTaxonomy: invalidTopicCount,
        invalidEmbeddedAnalysisCount,
        inconsistentAnalysisReferenceCount,
        simulatedFeedbacks: simulatedCount,
      },
      countsBy: { originalCategory: categoryCounts, sentiment: sentimentCounts, source: sourceCounts },
      createdAt: { min: dateRange.min, max: dateRange.max, countsInWindow: dateWindowCounts },
      complaintsByTopic: complaintTopicsRaw,
      complaintsPerWeekLast13Weeks: complaintsPerWeek,
      storyTrendLast21Days: storyTrend,
      textSearchScam: { resultCount: textSearchResults.length, results: textSearchResults },
      sampleFeedback: samples,
    };
    console.log(JSON.stringify(actual, null, 2));

    const checksPassed = feedbackCount === 7000
      && analysisCount === 320
      && adaptionRunCount === 3
      && simulatedCount === 7000
      && missingAnalysisCount === 0
      && invalidTopicCount === 0
      && invalidEmbeddedAnalysisCount === 0
      && inconsistentAnalysisReferenceCount === 0
      && textSearchResults.length > 0
      && storyTrend.storyComplaints.recentSharePercent >= 35
      && storyTrend.storyComplaints.recentSharePercent <= 55
      && storyTrend.allOtherFeedback.recentSharePercent >= 18
      && storyTrend.allOtherFeedback.recentSharePercent <= 28;
    const expectedCategories = { 'Customer Service': 1707, 'Fraud and Scam': 1755, 'Operational Issues': 1800, 'Product Feedback': 1738 };
    const actualCategories = Object.fromEntries(categoryCounts.map(({ _id, count }) => [_id, count]));
    const categoriesMatch = Object.keys(expectedCategories).every((key) => actualCategories[key] === expectedCategories[key])
      && Object.keys(actualCategories).length === Object.keys(expectedCategories).length;
    if (!checksPassed || !categoriesMatch) throw new Error('Database verification failed: review the reported counts, references, topics, categories, text search, or recent trend shares.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
