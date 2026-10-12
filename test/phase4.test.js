const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tokenize, buildIndex, classify } = require('../services/similarityClassifier');

const examples = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/adapted_analysis.json'), 'utf8'));
const index = buildIndex(examples);

test('tokenizer retains negation and adds adjacent bigrams', () => {
  const tokens = tokenize("I was not a victim of fraud, and I can't pay!");
  assert.ok(tokens.includes('not'));
  assert.ok(tokens.includes("can't"));
  assert.ok(tokens.includes('not a'));
  assert.ok(tokens.includes('victim of'));
});

test('exact known reviews reproduce their adapted labels with a near-perfect match', () => {
  for (const item of examples) {
    const result = classify(index, item.review);
    assert.equal(result.analysis.sentiment, item.analysis.sentiment, item.review);
    assert.equal(result.analysis.topic, item.analysis.topic, item.review);
    assert.equal(result.analysis.isComplaint, item.analysis.isComplaint, item.review);
    assert.ok(result.confidence > 0.999, `${item.review}: ${result.confidence}`);
  }
});

test('negated fraud mention is positive and not a complaint', () => {
  const result = classify(index, 'I was not a victim of fraud, the seller was honest and sent the genuine item');
  assert.equal(result.analysis.sentiment, 'positive');
  assert.equal(result.analysis.isComplaint, false);
  assert.match(result.analysis.topic, /^fraud_/);
});

test('seller taking money without sending product is a severe fraud complaint', () => {
  const { analysis } = classify(index, 'The seller took my money and never sent the product');
  assert.equal(analysis.sentiment, 'negative');
  assert.equal(analysis.isComplaint, true);
  assert.match(analysis.topic, /^fraud_/);
  assert.ok([4, 5].includes(analysis.severity));
});

test('unanswered support emails map to a customer service complaint', () => {
  const { analysis } = classify(index, 'Support never replied to my emails');
  assert.equal(analysis.sentiment, 'negative');
  assert.equal(analysis.isComplaint, true);
  assert.match(analysis.topic, /^customer_service_/);
});

test('website checkout crash maps to a non-product complaint topic', () => {
  const { analysis } = classify(index, 'The website kept crashing when I tried to pay');
  assert.equal(analysis.sentiment, 'negative');
  assert.equal(analysis.isComplaint, true);
  assert.equal(analysis.topic.startsWith('product_'), false);
});

test('early delivery and a fine experience are positive and not a complaint', () => {
  const { analysis } = classify(index, 'Delivery arrived early and everything was fine');
  assert.equal(analysis.sentiment, 'positive');
  assert.equal(analysis.isComplaint, false);
});

test('empty and unknown text return a low-confidence neutral result', () => {
  for (const text of ['', 'qzxv plmokn asdfgh']) {
    const result = classify(index, text);
    assert.equal(result.confidence, 0);
    assert.equal(result.analysis.sentiment, 'neutral');
    assert.equal(result.analysis.isComplaint, false);
    assert.equal(result.lowConfidence, true);
  }
});
