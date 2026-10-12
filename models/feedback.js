const mongoose = require('mongoose');
const taxonomy = require('../config/taxonomy');

const embeddedAnalysisSchema = new mongoose.Schema({
  sentiment: { type: String, required: true, enum: ['positive', 'neutral', 'negative', 'mixed'] },
  sentimentScore: { type: Number, required: true, min: -1, max: 1 },
  topic: { type: String, required: true, enum: taxonomy.map((item) => item.key) },
  severity: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  isComplaint: { type: Boolean, required: true },
  issueSummary: { type: String, required: true },
  suggestedAction: { type: String, required: true },
  producedBy: { type: String, required: true, enum: ['adaption', 'llm', 'fallback'] },
  adaptionRunId: { type: String, default: null },
}, { _id: false });

const feedbackSchema = new mongoose.Schema({
  text: { type: String, required: true },
  textHash: { type: String, required: true, match: /^[a-f0-9]{40}$/ },
  originalCategory: { type: String, required: true, trim: true },
  source: { type: String, required: true, enum: ['Review', 'Survey', 'Support'] },
  createdAt: { type: Date, required: true },
  isSimulated: { type: Boolean, required: true, default: false },
  analysis: { type: embeddedAnalysisSchema, required: true },
  seedBatch: { type: String },
  seedKey: { type: String },
}, { versionKey: false });

// Content hashes deliberately are not unique: the source CSV contains duplicates.
feedbackSchema.index({ textHash: 1 }, { name: 'feedback_text_hash' });
feedbackSchema.index({ originalCategory: 1, createdAt: -1 }, { name: 'category_created_at' });
feedbackSchema.index({ seedKey: 1 }, { unique: true, sparse: true, name: 'seed_row_idempotency' });

module.exports = mongoose.models.Feedback || mongoose.model('Feedback', feedbackSchema);
