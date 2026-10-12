const mongoose = require('mongoose');

const adaptionRunSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true, trim: true },
  datasetId: { type: String, required: true, trim: true },
  role: { type: String, required: true, enum: ['smoke_test', 'labels', 'evaluation'] },
  status: { type: String, required: true, trim: true },
  rowsIn: { type: Number, default: null },
  rowsOut: { type: Number, default: null },
  scoreBefore: { type: Number, default: null },
  scoreAfter: { type: Number, default: null },
  gradeBefore: { type: String, default: null },
  gradeAfter: { type: String, default: null },
  percentile: { type: Number, default: null },
  improvementPercent: { type: Number, default: null },
  evaluatedOnRows: { type: Number, default: null },
  messageQualityBefore: { type: Number, default: null },
  messageQualityAfter: { type: Number, default: null },
  completionQualityBefore: { type: Number, default: null },
  completionQualityAfter: { type: Number, default: null },
  credits: { type: Number, default: null },
  minutes: { type: Number, default: null },
  notes: { type: String, default: '' },
  config: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.AdaptionRun || mongoose.model('AdaptionRun', adaptionRunSchema);
