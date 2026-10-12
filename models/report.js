const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, trim: true },
  title: { type: String, required: true, trim: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Report || mongoose.model('Report', reportSchema);
