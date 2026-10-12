// A small, deterministic TF-IDF nearest-neighbour classifier for adapted reviews.
const NEGATION_AND_CONTRAST = new Set([
  'not', 'no', 'never', 'without', 'cannot', "can't", "didn't", "wasn't", 'but', 'however',
]);

function tokenize(text) {
  const words = String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      // Keep common negation contractions intact even when punctuation is stripped.
      if (word === 'cant') return "can't";
      if (word === 'didnt') return "didn't";
      if (word === 'wasnt') return "wasn't";
      return word;
    });
  const tokens = [...words];
  for (let i = 0; i < words.length - 1; i += 1) tokens.push(`${words[i]} ${words[i + 1]}`);
  return tokens;
}

function vectorize(text, idf) {
  const terms = tokenize(text);
  const counts = new Map();
  for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
  const vector = new Map();
  let norm = 0;
  for (const [term, count] of counts) {
    if (!idf.has(term)) continue;
    const weight = (1 + Math.log(count)) * idf.get(term);
    vector.set(term, weight);
    norm += weight * weight;
  }
  norm = Math.sqrt(norm);
  if (norm) for (const [term, weight] of vector) vector.set(term, weight / norm);
  return vector;
}

function buildIndex(analyses) {
  const items = Array.isArray(analyses) ? analyses.filter((item) => item && item.review && item.analysis) : [];
  const documentFrequency = new Map();
  const termSets = items.map((item) => new Set(tokenize(item.review)));
  for (const terms of termSets) for (const term of terms) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  const idf = new Map([...documentFrequency].map(([term, frequency]) => [term, Math.log((items.length + 1) / (frequency + 1)) + 1]));
  return { items, idf, vectors: items.map((item) => vectorize(item.review, idf)) };
}

function weightedWinner(neighbours, selector, fallback) {
  const votes = new Map();
  for (const neighbour of neighbours) {
    const value = selector(neighbour.item);
    if (value === undefined || value === null) continue;
    votes.set(value, (votes.get(value) || 0) + neighbour.similarity);
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

function classify(index, text, { k = 3 } = {}) {
  const emptyAnalysis = {
    sentiment: 'neutral', sentimentScore: 0, topic: 'product_quality', severity: 1,
    isComplaint: false, issueSummary: String(text || '').trim().split(/\s+/).slice(0, 12).join(' '),
    suggestedAction: 'Monitor feedback for a clearer emerging pattern.',
  };
  const query = vectorize(text, index?.idf || new Map());
  if (!query.size || !index?.items?.length) {
    return { analysis: emptyAnalysis, confidence: 0, matchedTextHash: null, neighbours: [], lowConfidence: true };
  }
  const scored = index.items.map((item, i) => {
    let similarity = 0;
    for (const [term, weight] of query) similarity += weight * (index.vectors[i].get(term) || 0);
    return { item, similarity };
  }).sort((a, b) => b.similarity - a.similarity).slice(0, Math.max(1, k));
  // Preserve the source label when the submitted text is already in the index.
  const normalizedText = String(text).trim().replace(/\s+/g, ' ').toLowerCase();
  const exact = index.items.find((item) => String(item.review).trim().replace(/\s+/g, ' ').toLowerCase() === normalizedText);
  if (exact) {
    return {
      analysis: { ...exact.analysis, issueSummary: String(text).trim().split(/\s+/).slice(0, 12).join(' ') },
      confidence: 1,
      matchedTextHash: exact.textHash || null,
      neighbours: [{ textHash: exact.textHash, review: exact.review, similarity: 1 }],
      lowConfidence: false,
    };
  }
  const neighbours = scored.filter(({ similarity }) => similarity > 0);
  if (!neighbours.length) return { analysis: emptyAnalysis, confidence: 0, matchedTextHash: null, neighbours: [], lowConfidence: true };

  const sentiment = weightedWinner(neighbours, (item) => item.analysis.sentiment, 'neutral');
  const topic = weightedWinner(neighbours, (item) => item.analysis.topic, 'product_quality');
  const isComplaint = weightedWinner(neighbours, (item) => item.analysis.isComplaint, false);
  const totalWeight = neighbours.reduce((sum, neighbour) => sum + neighbour.similarity, 0);
  const sentimentScore = neighbours.reduce((sum, neighbour) => sum + (Number(neighbour.item.analysis.sentimentScore) || 0) * neighbour.similarity, 0) / totalWeight;
  const severityAverage = neighbours.reduce((sum, neighbour) => sum + (Number(neighbour.item.analysis.severity) || 1) * neighbour.similarity, 0) / totalWeight;
  const bestForLabel = neighbours.find(({ item }) => item.analysis.topic === topic && item.analysis.sentiment === sentiment)?.item || neighbours[0].item;
  return {
    analysis: {
      sentiment, sentimentScore, topic,
      severity: (sentiment === 'positive' || sentiment === 'neutral') && !isComplaint ? 1 : Math.max(1, Math.min(5, Math.round(severityAverage))),
      isComplaint,
      issueSummary: String(text || '').trim().split(/\s+/).filter(Boolean).slice(0, 12).join(' '),
      suggestedAction: bestForLabel.analysis.suggestedAction || 'Review this feedback and investigate the customer concern.',
    },
    confidence: Math.max(0, Math.min(1, scored[0].similarity)),
    matchedTextHash: scored[0].item.textHash || null,
    neighbours: neighbours.map(({ item, similarity }) => ({ textHash: item.textHash, review: item.review, similarity })),
    lowConfidence: scored[0].similarity < 0.5,
  };
}

module.exports = { tokenize, buildIndex, classify };
