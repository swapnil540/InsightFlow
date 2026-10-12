const mongoose = require('mongoose');
const taxonomy = require('../config/taxonomy');

const analysisSchema = new mongoose.Schema({
  textHash: { type: String, required: true, match: /^[a-f0-9]{40}$/ },
  sentiment: { type: String, required: true, enum: ['positive', 'neutral', 'negative', 'mixed'] },
  sentimentScore: { type: Number, required: true, min: -1, max: 1 },
  topic: { type: String, required: true, enum: taxonomy.map((item) => item.key) },
  severity: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  isComplaint: { type: Boolean, required: true },
  issueSummary: { type: String, required: true, trim: true },
  suggestedAction: { type: String, required: true, trim: true },
  producedBy: { type: String, required: true, enum: ['adaption', 'similarity', 'llm-runtime', 'rules', 'llm', 'fallback'] },
  adaptionRunId: { type: String, default: null },
  seedBatch: { type: String, default: null },
  confidence: { type: Number, min: 0, max: 1 },
  matchedTextHash: { type: String, match: /^[a-f0-9]{40}$/ },
}, { timestamps: true, versionKey: false });

analysisSchema.index({ textHash: 1 }, { unique: true, name: 'one_analysis_per_text_hash' });

module.exports = mongoose.models.Analysis || mongoose.model('Analysis', analysisSchema);
