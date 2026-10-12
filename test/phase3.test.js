const test = require('node:test');
const assert = require('node:assert/strict');
const taxonomy = require('../config/taxonomy');
const Feedback = require('../models/feedback');
const { analyzeText, buildRulesAnalysis } = require('../services/analysisService');

const topicKeys = new Set(taxonomy.map((topic) => topic.key));

test('rules treat fraud false alarms as positive and not complaints', async () => {
  const examples = [
    'I was not a victim of fraud.',
    'No signs of fraudulent activity.',
    'No fraud was involved.',
  ];
  for (const text of examples) {
    const result = await analyzeText(text, { category: 'Fraud and Scam' });
    assert.equal(result.fromCache, false);
    assert.equal(result.analysis.sentiment, 'positive', text);
    assert.equal(result.analysis.isComplaint, false, text);
    assert.equal(result.analysis.producedBy, 'rules');
  }
});

test('rules map website crashes to the ordering topic and mark them as complaints', async () => {
  const { analysis } = await analyzeText('The website crashes whenever I try to check out.', { category: 'Operational Issues' });
  assert.equal(analysis.topic, 'order_processing_and_expectations');
  assert.equal(analysis.sentiment, 'negative');
  assert.equal(analysis.isComplaint, true);
  assert.equal(analysis.severity, 3);
});

test('rules map delivery delays to the delivery delay topic', async () => {
  const { analysis } = await analyzeText('My delivery is late and delayed again.', { category: 'Operational Issues' });
  assert.equal(analysis.topic, 'delivery_delay');
  assert.equal(analysis.sentiment, 'negative');
  assert.equal(analysis.isComplaint, true);
});

test('rules recognize praise and keep all generated topics inside the taxonomy', async () => {
  const { analysis, fromCache } = await analyzeText('I love the product quality; it is excellent.', { category: 'Product Feedback' });
  assert.equal(fromCache, false);
  assert.equal(analysis.sentiment, 'positive');
  assert.equal(analysis.isComplaint, false);
  assert.equal(analysis.severity, 1);
  assert.ok(topicKeys.has(analysis.topic));
});

test('rules output valid topics, summaries, and the rules producer value', () => {
  for (const text of [
    'The support team replied quickly and was helpful.',
    'The price is too expensive for this product.',
    'The package arrived with damaged contents.',
    'The delivery tracking has no updates.',
    'I was not a victim of fraud.',
  ]) {
    const analysis = buildRulesAnalysis(text, 'Product Feedback');
    assert.ok(topicKeys.has(analysis.topic), text);
    assert.ok(analysis.issueSummary.split(/\s+/).length >= 8 && analysis.issueSummary.split(/\s+/).length <= 12);
    assert.equal(analysis.producedBy, 'rules');
  }
});

test('Feedback embedded analysis accepts the rules producer', async () => {
  const analysis = buildRulesAnalysis('The website has a crash.', 'Operational Issues');
  await new Feedback({
    text: 'The website has a crash.',
    textHash: 'a'.repeat(40),
    originalCategory: 'Operational Issues',
    source: 'Review',
    createdAt: new Date(),
    isSimulated: false,
    analysis,
  }).validate();
});
