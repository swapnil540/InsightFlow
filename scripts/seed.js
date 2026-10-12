const mongoose = require('mongoose');
const { defaultAnchor, loadSeedData, parseAnchor, summarize } = require('../services/seedData');

function validMongoUri(value) {
  if (!value || /your|placeholder|changeme|example/i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return ['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch { return false; }
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
    await Promise.all([Feedback.createCollection(), Analysis.createCollection()]);
    await Promise.all([Feedback.ensureIndexes(), Analysis.ensureIndexes()]);

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
    }

    const feedbackCount = await Feedback.countDocuments({ seedBatch: 'insightflow-phase2-v1' });
    const datasetHashes = analyses.map((item) => item.textHash);
    const analysisCount = await Analysis.countDocuments({ textHash: { $in: datasetHashes } });
    const simulatedCount = await Feedback.countDocuments({ seedBatch: 'insightflow-phase2-v1', isSimulated: true });
    const categoryCounts = await Feedback.aggregate([
      { $match: { seedBatch: 'insightflow-phase2-v1' } },
      { $group: { _id: '$originalCategory', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const embeddedCount = await Feedback.countDocuments({
      seedBatch: 'insightflow-phase2-v1',
      $or: [
        { 'analysis.sentiment': { $exists: false } }, { 'analysis.topic': { $exists: false } },
        { 'analysis.sentimentScore': { $exists: false } }, { 'analysis.severity': { $exists: false } },
      ],
    });
    const seededFeedback = await Feedback.find({ seedBatch: 'insightflow-phase2-v1' }).select('textHash analysis').lean();
    const seededAnalyses = await Analysis.find({ textHash: { $in: datasetHashes } }).lean();
    const cacheByHash = new Map(seededAnalyses.map((item) => [item.textHash, item]));
    const comparisonFields = ['sentiment', 'sentimentScore', 'topic', 'severity', 'isComplaint', 'issueSummary', 'suggestedAction', 'producedBy', 'adaptionRunId'];
    const inconsistentReferences = seededFeedback.filter((feedback) => {
      const cache = cacheByHash.get(feedback.textHash);
      return !cache || comparisonFields.some((key) => (feedback.analysis?.[key] ?? null) !== (cache[key] ?? null));
    }).length;
    const actual = { feedbackCount, analysisCount, simulatedCount, categoryCounts, invalidEmbeddedAnalysisCount: embeddedCount, inconsistentAnalysisReferenceCount: inconsistentReferences };
    console.log(JSON.stringify(actual, null, 2));
    const expectedCategories = { 'Customer Service': 1707, 'Fraud and Scam': 1755, 'Operational Issues': 1800, 'Product Feedback': 1738 };
    const actualCategories = Object.fromEntries(categoryCounts.map(({ _id, count }) => [_id, count]));
    if (feedbackCount !== 7000 || analysisCount !== 320 || simulatedCount !== 7000 || embeddedCount !== 0 || inconsistentReferences !== 0 || JSON.stringify(actualCategories) !== JSON.stringify(expectedCategories)) {
      throw new Error('Database verification failed: seeded totals or embedded analysis fields do not match expectations.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
