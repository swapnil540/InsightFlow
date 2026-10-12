const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema({
  topicKey: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  status: { type: String, enum: ['open', 'investigating', 'resolved'], default: 'open', required: true },
  owner: { type: String, default: '' },
  notes: { type: String, default: '' },
  prioritySnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Issue || mongoose.model('Issue', issueSchema);
