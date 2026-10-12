const test = require('node:test');
const assert = require('node:assert/strict');
const taxonomy = require('../config/taxonomy');
const Feedback = require('../models/feedback');
const { buildRulesAnalysis } = require('../services/analysisService');
const { parseImportCsv, MAX_IMPORT_ROWS, makeImportBatchId } = require('../services/csvImportService');
const fs = require('node:fs');
const path = require('node:path');

const topicKeys = new Set(taxonomy.map((topic) => topic.key));

test('rules treat fraud false alarms as positive and not complaints', () => {
  const examples = [
    'I was not a victim of fraud.',
    'No signs of fraudulent activity.',
    'No fraud was involved.',
  ];
  for (const text of examples) {
    const analysis = buildRulesAnalysis(text, 'Fraud and Scam');
    assert.equal(analysis.sentiment, 'positive', text);
    assert.equal(analysis.isComplaint, false, text);
    assert.equal(analysis.producedBy, 'rules');
  }
});

test('rules map website crashes to the ordering topic and mark them as complaints', () => {
  const analysis = buildRulesAnalysis('The website crashes whenever I try to check out.', 'Operational Issues');
  assert.equal(analysis.topic, 'order_processing_and_expectations');
  assert.equal(analysis.sentiment, 'negative');
  assert.equal(analysis.isComplaint, true);
  assert.equal(analysis.severity, 3);
});

test('rules map delivery delays to the delivery delay topic', () => {
  const analysis = buildRulesAnalysis('My delivery is late and delayed again.', 'Operational Issues');
  assert.equal(analysis.topic, 'delivery_delay');
  assert.equal(analysis.sentiment, 'negative');
  assert.equal(analysis.isComplaint, true);
});

test('rules recognize praise and keep all generated topics inside the taxonomy', () => {
  const analysis = buildRulesAnalysis('I love the product quality; it is excellent.', 'Product Feedback');
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

test('CSV import sample covers existing text, duplicates, optional fields, and skipped rows', () => {
  const sample = fs.readFileSync(path.join(__dirname, '../data/sample_import_test.csv'));
  const parsed = parseImportCsv(sample);
  assert.equal(parsed.totalRows, 17);
  assert.equal(parsed.validRows.length, 13);
  assert.equal(parsed.skippedCount, 4);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.skippedByReason.empty, 1);
  assert.equal(parsed.skippedByReason.too_short, 1);
  assert.equal(parsed.skippedByReason.bad_date, 1);
  assert.equal(parsed.skippedByReason.invalid_category, 1);
  assert.equal(parsed.skippedByReason.invalid_source, 1);
  assert.equal(parsed.validRows[5].text, "The product's innovative features have greatly improved my daily tasks.");
  assert.equal(parsed.validRows[10].source, 'Review');
  assert.equal(parsed.validRows[10].sourceDefaulted, true);
  assert.equal(parsed.mapping.text, 'review');
});

test('CSV parser accepts BOM, text aliases, and extra columns while normalizing optional fields', () => {
  const csv = '\uFEFFmessage,category,source,date,extra\n"  Helpful support replied quickly.  ",customer service,support,2026-10-12,ignored';
  const parsed = parseImportCsv(csv);
  assert.equal(parsed.validRows.length, 1);
  assert.equal(parsed.mapping.text, 'message');
  assert.equal(parsed.mapping.category, 'category');
  assert.equal(parsed.validRows[0].text, 'Helpful support replied quickly.');
  assert.equal(parsed.validRows[0].category, 'Customer Service');
  assert.equal(parsed.validRows[0].source, 'Support');
  assert.equal(parsed.validRows[0].date.toISOString(), '2026-10-12T00:00:00.000Z');
});

test('CSV parser marks very short and overlong feedback as skipped', () => {
  const csv = `review\nBad\n${'x'.repeat(1001)}`;
  const parsed = parseImportCsv(csv);
  assert.equal(parsed.validRows.length, 0);
  assert.equal(parsed.skippedByReason.too_short, 1);
  assert.equal(parsed.skippedByReason.too_long, 1);
});

test('CSV parser enforces the 10,000-row cap and requires a supported text header', () => {
  const tooManyRows = `review\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => 'A long enough review.').join('\n')}`;
  assert.throws(() => parseImportCsv(tooManyRows), /at most 10,000 rows/);
  assert.throws(() => parseImportCsv('category,source\nProduct Feedback,Review'), /text column named/);
});

test('import batch ids use the documented short timestamp and random suffix format', () => {
  assert.match(makeImportBatchId(new Date('2026-10-12T08:00:30.000Z')), /^imp-20261012-0800-[a-f0-9]{4}$/);
});
