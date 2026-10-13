const Issue = require('../models/issue');
const taxonomy = require('../config/taxonomy');
const { getPriorities } = require('./priorityService');

const VALID_STATUSES = ['open', 'investigating', 'resolved'];
const topicMeta = new Map(taxonomy.map((t) => [t.key, t]));

async function trackIssue(topicKey) {
  if (!topicKey || typeof topicKey !== 'string') {
    throw new Error('topicKey is required.');
  }
  const cleanKey = topicKey.trim();
  const meta = topicMeta.get(cleanKey);
  if (!meta) {
    throw new Error(`Unknown topic key: ${cleanKey}`);
  }

  // Check if open or investigating issue already exists
  const existing = await Issue.findOne({
    topicKey: cleanKey,
    status: { $in: ['open', 'investigating'] },
  });
  if (existing) {
    return { created: false, issue: existing, alreadyTracked: true };
  }

  // Get current priority snapshot
  let prioritySnapshot = null;
  try {
    const data = await getPriorities({});
    prioritySnapshot = data.priorities.find((p) => p.key === cleanKey) || null;
  } catch {
    prioritySnapshot = null;
  }

  const shortReason = prioritySnapshot
    ? `${prioritySnapshot.priorityLevel} priority (${prioritySnapshot.score}/100)`
    : 'Identified from feedback analysis';
  const title = `${meta.label}: ${shortReason}`;

  const issue = await Issue.create({
    topicKey: cleanKey,
    title,
    status: 'open',
    owner: '',
    notes: '',
    prioritySnapshot,
  });

  return { created: true, issue, alreadyTracked: false };
}

async function getIssues(statusFilter) {
  const query = {};
  if (statusFilter && VALID_STATUSES.includes(statusFilter)) {
    query.status = statusFilter;
  }

  const [issues, statusCounts] = await Promise.all([
    Issue.find(query).sort({ createdAt: -1 }).lean(),
    Issue.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const counts = { all: 0, open: 0, investigating: 0, resolved: 0 };
  for (const row of statusCounts) {
    if (counts[row._id] !== undefined) {
      counts[row._id] = row.count;
      counts.all += row.count;
    }
  }

  return { issues, counts };
}

async function updateIssue(id, data = {}) {
  const issue = await Issue.findById(id);
  if (!issue) {
    throw new Error('Issue not found.');
  }

  if (data.status) {
    if (!VALID_STATUSES.includes(data.status)) {
      throw new Error(`Invalid status: ${data.status}`);
    }
    issue.status = data.status;
  }

  if (typeof data.owner === 'string') {
    issue.owner = data.owner.trim().slice(0, 100);
  }

  if (typeof data.notes === 'string') {
    issue.notes = data.notes.trim().slice(0, 1000);
  }

  await issue.save();
  return issue;
}

module.exports = {
  VALID_STATUSES,
  trackIssue,
  getIssues,
  updateIssue,
};
