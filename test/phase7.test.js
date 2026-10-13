const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');
const { VALID_STATUSES } = require('../services/issueService');
const { buildExecutiveSummary } = require('../services/reportService');

test('issue statuses match specification enum', () => {
  assert.deepEqual(VALID_STATUSES, ['open', 'investigating', 'resolved']);
});

test('buildExecutiveSummary generates 3 grounded bullets from snapshot payload', () => {
  const fakePayload = {
    window: { from: '2026-07-14T00:00:00.000Z', to: '2026-10-12T23:59:59.999Z', days: 90 },
    kpis: {
      totalMentions: 7000,
      uniquePhrasings: 320,
      complaintMentions: 1200,
      complaintShare: 0.1714,
      negativeShare: 0.35,
      avgSentimentScore: -0.22,
    },
    topPriorities: [
      {
        rank: 1,
        key: 'fraud_counterfeit_or_misrepresentation',
        label: 'Counterfeit or Misrepresentation',
        score: 85,
        complaints: 310,
        factors: { negativity: 0.92 },
        rawFactors: {
          severity: { avgSeverity: 4.8 },
          trend: { recent14: 40, prev14: 25 },
        },
      },
      {
        rank: 2,
        key: 'delivery_delay',
        label: 'Delivery Delays',
        score: 65,
        complaints: 200,
        factors: { negativity: 0.80 },
        rawFactors: {
          severity: { avgSeverity: 3.5 },
          trend: { recent14: 30, prev14: 30 },
        },
      },
    ],
  };

  const bullets = buildExecutiveSummary(fakePayload);
  assert.equal(bullets.length, 3);
  assert.match(bullets[0], /Top issue: Counterfeit or Misrepresentation/);
  assert.match(bullets[0], /Rank #1, score 85\/100/);
  assert.match(bullets[0], /92% negative\/mixed sentiment/);
  assert.match(bullets[1], /Fastest-rising issue: Counterfeit or Misrepresentation/);
  assert.match(bullets[1], /\+15 complaints/);
  assert.match(bullets[2], /Overall negative sentiment share is 35%/);
  assert.match(bullets[2], /1200 complaint mentions out of 7000 total feedback items/);
});

test('issues.ejs template renders with stub data and status counts', async () => {
  const templatePath = path.join(__dirname, '../views/pages/issues.ejs');
  const html = await ejs.renderFile(templatePath, {
    pageTitle: 'Tracked Issues',
    activeNav: 'issues',
    selectedStatus: '',
    counts: { all: 2, open: 1, investigating: 1, resolved: 0 },
    issues: [
      {
        _id: '507f1f77bcf86cd799439011',
        title: 'Counterfeit or Misrepresentation: Critical priority (85/100)',
        topicKey: 'fraud_counterfeit_or_misrepresentation',
        status: 'open',
        owner: 'Alex T.',
        notes: 'Reviewing seller listings',
        createdAt: new Date('2026-10-12'),
        prioritySnapshot: {
          score: 85,
          priorityLevel: 'Critical',
          recommendation: { team: 'Trust & Safety', action: 'Delist counterfeit items' },
        },
      },
    ],
    notice: null,
  });

  assert.ok(html.includes('Tracked Issues'));
  assert.ok(html.includes('Alex T.'));
  assert.ok(html.includes('Reviewing seller listings'));
  assert.ok(html.includes('Critical'));
});

test('reports.ejs template renders with saved reports', async () => {
  const templatePath = path.join(__dirname, '../views/pages/reports.ejs');
  const html = await ejs.renderFile(templatePath, {
    pageTitle: 'Executive Reports',
    activeNav: 'reports',
    notice: null,
    reports: [
      {
        token: 'abcd1234efgh5678',
        title: 'Q3 Executive Summary Report',
        createdAt: new Date('2026-10-12'),
        payload: { window: { days: 90 } },
      },
    ],
  });

  assert.ok(html.includes('Executive Reports'));
  assert.ok(html.includes('Q3 Executive Summary Report'));
  assert.ok(html.includes('/r/abcd1234efgh5678'));
});

test('report-view.ejs renders complete business-friendly document without admin navbar', async () => {
  const templatePath = path.join(__dirname, '../views/pages/report-view.ejs');
  const html = await ejs.renderFile(templatePath, {
    report: {
      token: 'abcd1234efgh5678',
      title: 'Board Briefing on Customer Feedback',
      createdAt: new Date('2026-10-12'),
    },
    payload: {
      window: { from: '2026-07-14T00:00:00.000Z', to: '2026-10-12T23:59:59.999Z', days: 90 },
      executiveSummary: [
        'Top issue: Counterfeit or Misrepresentation with 310 complaints.',
        'Fastest-rising issue: Delivery Delays up 15%.',
        'Overall negative sentiment share is 35%.',
      ],
      kpis: {
        totalMentions: 7000,
        uniquePhrasings: 320,
        complaintMentions: 1200,
        complaintShare: 0.17,
        negativeShare: 0.35,
        avgSentimentScore: -0.22,
      },
      topPriorities: [
        {
          rank: 1,
          label: 'Counterfeit or Misrepresentation',
          parentCategory: 'Fraud and Scam',
          score: 85,
          priorityLevel: 'Critical',
          complaints: 310,
          uniquePhrasings: 15,
          explanation: 'Ranked #1: 310 complaints; 92% negative.',
          recommendation: { team: 'Trust & Safety', action: 'Delist counterfeit products immediately.' },
          suggestedAction: 'Enforce merchant verification',
          evidence: [{ text: 'Fake item received from fraudulent seller', mentions: 80, severity: 5 }],
        },
      ],
      trackedIssues: [
        {
          title: 'Counterfeit or Misrepresentation: Critical priority (85/100)',
          status: 'open',
          owner: 'Alex T.',
          notes: 'Active investigation',
          createdAt: '2026-10-12',
        },
      ],
      note: 'Feedback labels generated with Adaption Adaptive Data; dates and sources in this demo are simulated.',
    },
  });

  // Verify business-friendly requirements
  assert.ok(html.includes('<meta name="robots" content="noindex">'), 'Missing noindex meta tag');
  assert.ok(html.includes('Print / Save as PDF'), 'Missing print button');
  assert.ok(html.includes('Copy share link'), 'Missing copy share link button');
  assert.ok(html.includes('@media print'), 'Missing print stylesheet');
  assert.ok(html.includes('Board Briefing on Customer Feedback'), 'Missing title');
  assert.ok(html.includes('Executive Summary'), 'Missing executive summary section');
  assert.ok(html.includes('Key Metrics Overview'), 'Missing KPI strip');
  assert.ok(html.includes('Delist counterfeit products immediately.'), 'Missing recommendation action');
  assert.ok(html.includes('Fake item received from fraudulent seller'), 'Missing evidence quote');
  assert.ok(html.includes('Feedback labels generated with Adaption Adaptive Data; dates and sources in this demo are simulated.'), 'Missing simulated footnote');
  // Check that admin links (e.g. /import, /dashboard) are NOT in the report header
  assert.ok(!html.includes('href="/import"'), 'Admin links should not appear in report view');
  assert.ok(!html.includes('href="/dashboard"'), 'Admin links should not appear in report view');
});

