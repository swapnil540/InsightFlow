const crypto = require('crypto');
const Report = require('../models/report');
const Issue = require('../models/issue');
const { getStats } = require('./statsService');
const { getPriorities } = require('./priorityService');

function buildExecutiveSummary(payload) {
  const bullets = [];
  const top = payload.topPriorities?.[0];
  const kpis = payload.kpis || {};
  const windowDays = payload.window?.days || 90;

  // Bullet 1: Top issue and why
  if (top) {
    const negPct = Math.round((top.factors?.negativity || 0) * 100);
    const sev = top.rawFactors?.severity?.avgSeverity || 0;
    bullets.push(
      `Top issue: ${top.label} (Rank #1, score ${top.score}/100) — ${top.complaints} complaints with ${negPct}% negative/mixed sentiment and ${sev}/5.0 average severity.`
    );
  } else {
    bullets.push('No issues exceeded the 5-complaint critical threshold during this observation window.');
  }

  // Bullet 2: Fastest-rising issue
  const rising = [...(payload.topPriorities || [])]
    .filter((p) => (p.rawFactors?.trend?.recent14 || 0) > (p.rawFactors?.trend?.prev14 || 0))
    .sort((a, b) => {
      const diffA = (a.rawFactors?.trend?.recent14 || 0) - (a.rawFactors?.trend?.prev14 || 0);
      const diffB = (b.rawFactors?.trend?.recent14 || 0) - (b.rawFactors?.trend?.prev14 || 0);
      return diffB - diffA;
    })[0];

  if (rising) {
    const recent = rising.rawFactors.trend.recent14;
    const prev = rising.rawFactors.trend.prev14;
    const diff = recent - prev;
    bullets.push(
      `Fastest-rising issue: ${rising.label} increased by +${diff} complaints in the last 14 days (${recent} recent vs ${prev} prior).`
    );
  } else {
    bullets.push('Complaint volumes remained stable or declining across all top categories over the last 14 days.');
  }

  // Bullet 3: Overall negative sentiment share
  const negSharePct = Math.round((kpis.negativeShare || 0) * 100);
  const totalComplaints = kpis.complaintMentions || 0;
  const totalMentions = kpis.totalMentions || 0;
  bullets.push(
    `Overall negative sentiment share is ${negSharePct}% (${totalComplaints} complaint mentions out of ${totalMentions} total feedback items) across the ${windowDays}-day observation window.`
  );

  return bullets;
}

async function generateReport(titleInput) {
  const today = new Date().toISOString().slice(0, 10);
  const title = (typeof titleInput === 'string' && titleInput.trim())
    ? titleInput.trim().slice(0, 150)
    : `InsightFlow Executive Report — ${today}`;

  const [stats, prioritiesData, issues] = await Promise.all([
    getStats({}),
    getPriorities({}),
    Issue.find({}).sort({ createdAt: -1 }).lean(),
  ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    window: stats.window,
    kpis: stats.kpis,
    topPriorities: prioritiesData.priorities.slice(0, 5),
    trackedIssues: issues.map((i) => ({
      id: String(i._id),
      topicKey: i.topicKey,
      title: i.title,
      status: i.status,
      owner: i.owner || 'Unassigned',
      notes: i.notes || '',
      score: i.prioritySnapshot?.score ?? null,
      level: i.prioritySnapshot?.priorityLevel ?? null,
      createdAt: i.createdAt ? new Date(i.createdAt).toISOString().slice(0, 10) : today,
    })),
    note: 'Feedback labels generated with Adaption Adaptive Data; dates and sources in this demo are simulated.',
  };

  payload.executiveSummary = buildExecutiveSummary(payload);

  const token = crypto.randomBytes(16).toString('hex');
  const report = await Report.create({
    token,
    title,
    payload,
  });

  return report;
}

async function getReportByToken(token) {
  if (!token || typeof token !== 'string') return null;
  return Report.findOne({ token: token.trim() }).lean();
}

async function listReports() {
  return Report.find({}, { token: 1, title: 1, createdAt: 1, 'payload.window': 1 })
    .sort({ createdAt: -1 })
    .lean();
}

module.exports = {
  buildExecutiveSummary,
  generateReport,
  getReportByToken,
  listReports,
};
