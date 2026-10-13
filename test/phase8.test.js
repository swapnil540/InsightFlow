const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

test('adaption.ejs template renders cleanly with populated adaption runs', async () => {
  const templatePath = path.join(__dirname, '..', 'views', 'pages', 'adaption.ejs');
  const mockRuns = [
    {
      role: 'smoke_test',
      status: 'succeeded',
      datasetId: 'f758c682-2efb-4887-8907-11ef59a810d7',
      runId: 'dataset-f758c682-2efb-4887-8907-11ef59a810d7-1791777733848',
      rowsIn: 50,
      rowsOut: 50,
      scoreBefore: 5.0,
      scoreAfter: 9.4,
      gradeBefore: 'C',
      gradeAfter: 'A',
      percentile: 57.7,
      improvementPercent: 88.0,
      evaluatedOnRows: null,
      notes: 'Estimated credits: 1.0; estimated minutes: 11.',
    },
    {
      role: 'labels',
      status: 'succeeded',
      datasetId: '456aec4e-901a-4825-91b1-60b1a936e52f',
      runId: 'dataset-456aec4e-901a-4825-91b1-60b1a936e52f-1791779272014',
      rowsIn: 320,
      rowsOut: 320,
      scoreBefore: null,
      scoreAfter: null,
      gradeBefore: null,
      gradeAfter: null,
      percentile: null,
      improvementPercent: null,
      evaluatedOnRows: null,
      notes: 'This labels retest has no evaluation of its own.',
    },
    {
      role: 'evaluation',
      status: 'succeeded',
      datasetId: '456aec4e-901a-4825-91b1-60b1a936e52f',
      runId: 'dataset-456aec4e-901a-4825-91b1-60b1a936e52f-1791778526064',
      rowsIn: 320,
      rowsOut: 320,
      scoreBefore: 5.0,
      scoreAfter: 9.5,
      gradeBefore: 'C',
      gradeAfter: 'A',
      percentile: 57.7,
      improvementPercent: 90.0,
      evaluatedOnRows: 100,
      notes: 'The source file had no completions, so most of the quality gain comes from Adaption generating them; prompt quality was essentially unchanged.',
    },
  ];

  const html = await ejs.renderFile(templatePath, {
    pageTitle: 'Adaption Pipeline & Evaluation',
    activeNav: 'adaption',
    adaptionRuns: mockRuns,
    feedbackCount: 7000,
    analysisCount: 320,
    producerDistribution: [
      { _id: 'adaption', count: 7000 },
    ],
  });

  assert.ok(html.includes('1. The Problem'));
  assert.ok(html.includes('2. Data Pipeline Architecture'));
  assert.ok(html.includes('3. Adaption Run Results & Evaluation'));
  assert.ok(html.includes('4. What We Configured & Iterated'));
  assert.ok(html.includes('5. How It Is Used in the Application'));
  assert.ok(html.includes('Demo data: dates and sources are simulated.'));
  assert.ok(html.includes('7,000'));
  assert.ok(html.includes('320'));
  assert.ok(html.includes('smoke_test'));
  assert.ok(html.includes('evaluation'));
});

test('adaption.ejs template handles empty adaption runs gracefully', async () => {
  const templatePath = path.join(__dirname, '..', 'views', 'pages', 'adaption.ejs');
  const html = await ejs.renderFile(templatePath, {
    pageTitle: 'Adaption Pipeline & Evaluation',
    activeNav: 'adaption',
    adaptionRuns: [],
    feedbackCount: 0,
    analysisCount: 0,
    producerDistribution: [],
  });

  assert.ok(html.includes('1. The Problem'));
  assert.ok(html.includes('2. Data Pipeline Architecture'));
  assert.ok(html.includes('Adaption runs are currently empty or loading.'));
  assert.ok(html.includes('Demo data: dates and sources are simulated.'));
});
