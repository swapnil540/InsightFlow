// Measures agreement with Adaption labels when each example is held out in turn.
const fs = require('node:fs');
const path = require('node:path');
const { buildIndex, classify } = require('../services/similarityClassifier');

const dataPath = path.join(__dirname, '..', 'data', 'adapted_analysis.json');
const examples = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const fields = ['sentiment', 'topic', 'isComplaint'];
const counts = Object.fromEntries(fields.map((field) => [field, { correct: 0, accepted: 0, eligible: 0, total: 0 }]));
const confusions = new Map();
const overallConfidence = { correct: [], wrong: [] };
const fieldConfidence = Object.fromEntries(fields.map((field) => [field, { correct: [], wrong: [] }]));

for (let heldOut = 0; heldOut < examples.length; heldOut += 1) {
  const target = examples[heldOut];
  const training = examples.filter((_, index) => index !== heldOut);
  const result = classify(buildIndex(training), target.review);
  let allCorrect = true;
  for (const field of fields) {
    const correct = result.analysis[field] === target.analysis[field];
    const metrics = counts[field];
    metrics.total += 1;
    if (correct) {
      metrics.correct += 1;
      fieldConfidence[field].correct.push(result.confidence);
    } else {
      allCorrect = false;
      fieldConfidence[field].wrong.push(result.confidence);
      if (field === 'topic') {
        const key = `${target.analysis.topic} -> ${result.analysis.topic}`;
        confusions.set(key, (confusions.get(key) || 0) + 1);
      }
    }
    if (result.confidence >= 0.5) {
      metrics.eligible += 1;
      metrics.accepted += Number(correct);
    }
  }
  overallConfidence[allCorrect ? 'correct' : 'wrong'].push(result.confidence);
}

function accuracy(correct, total) {
  return total ? `${(100 * correct / total).toFixed(2)}% (${correct}/${total})` : 'n/a (0/0)';
}

function mean(values) {
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3) : 'n/a';
}

console.log('Agreement with Adaption labels on held-out examples');
console.log('Caveat: the data is highly templated and contains near-duplicate sentences, so these results are optimistic and are not general accuracy.');
console.log(`Examples: ${examples.length}`);
for (const field of fields) {
  const metric = counts[field];
  console.log(`${field} agreement: ${accuracy(metric.correct, metric.total)}`);
  console.log(`${field} agreement at confidence >= 0.5: ${accuracy(metric.accepted, metric.eligible)}`);
  console.log(`${field} mean confidence (correct / wrong): ${mean(fieldConfidence[field].correct)} / ${mean(fieldConfidence[field].wrong)}`);
}
console.log(`All-three-label mean confidence (all correct / at least one wrong): ${mean(overallConfidence.correct)} / ${mean(overallConfidence.wrong)}`);
console.log('Five most common topic confusions:');
const topConfusions = [...confusions].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
if (!topConfusions.length) console.log('  none');
for (const [pair, count] of topConfusions) console.log(`  ${pair}: ${count}`);
