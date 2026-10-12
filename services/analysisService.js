const mongoose = require('mongoose');
const Analysis = require('../models/analysis');
const taxonomy = require('../config/taxonomy');
const { CATEGORY_VALUES } = require('./filters');
const { normalizeText, textHash } = require('./textHash');
const { buildIndex, classify } = require('./similarityClassifier');
const fs = require('node:fs');
const path = require('node:path');
const Feedback = require('../models/feedback');

const topicByKey = new Map(taxonomy.map((topic) => [topic.key, topic]));
const defaultTopics = {
  'Customer Service': 'customer_service_resolution_quality',
  'Fraud and Scam': 'fraud_seller_scamming',
  'Operational Issues': 'order_processing_and_expectations',
  'Product Feedback': 'product_quality',
};

const topicRules = [
  { topic: 'fraud_counterfeit_or_misrepresentation', pattern: /\b(counterfeit|fake product|misrepresented|not as advertised|false advertising)\b/i },
  { topic: 'fraud_payment_pressure', pattern: /\b(extra charge|charged extra|additional payment|asked to pay more|pay more|overcharg(?:ed|ing)|charged twice|unexpected charge|charged)\b/i },
  { topic: 'fraud_seller_scamming', pattern: /\b(scam|fraud(?:ulent)?|seller trick|deceptive|phish(?:ing)?)\b/i },
  { topic: 'order_processing_and_expectations', pattern: /\b(website|web ?site|checkout|crash(?:ed|es)?|glitch(?:y)?|bug|page error|couldn't order)\b/i },
  { topic: 'delivery_damage_or_condition', pattern: /\b(damag(?:ed|e)|broken|defective|poor condition)\b/i },
  { topic: 'shipping_packaging_and_handling', pattern: /\b(packaging|package|packaged|handling)\b/i },
  { topic: 'delivery_tracking_and_updates', pattern: /\b(track(?:ing)?|updates?|order status|where is my order|no updates)\b/i },
  { topic: 'delivery_delay', pattern: /\b(delay(?:ed|s)?|late|took too long|never arrived|not arrive|delivery|shipping|shipped)\b/i },
  { topic: 'customer_service_response_time', pattern: /\b(wait(?:ed|ing)?|slow response|quick response|response time|repl(?:y|ied))\b/i },
  { topic: 'customer_service_resolution_quality', pattern: /\b(resolv(?:ed|e|ing)|fixed|refund|solution)\b/i },
  { topic: 'customer_service_staff_behavior', pattern: /\b(support|service|helpful|rude|friendly|polite|staff|agent)\b/i },
  { topic: 'product_setup_usage', pattern: /\b(set ?up|install(?:ation)?|easy to use|difficult to use)\b/i },
  { topic: 'product_value', pattern: /\b(price|cost|worth|value|affordable|expensive|overpriced|cheap)\b/i },
  { topic: 'product_reliability_durability', pattern: /\b(durab(?:le|ility)|lasted|reliable|reliability|wear|consistent)\b/i },
  { topic: 'product_quality', pattern: /\b(quality|craftsmanship|material|defect|damaged product)\b/i },
  { topic: 'product_feature_functionality', pattern: /\b(feature|function(?:ality)?|performance|design|works well)\b/i },
];

let similarityIndexPromise;

function loadAdaptedFile() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'adapted_analysis.json'), 'utf8'));
}

async function loadAdaptedExamples() {
  try {
    if (mongoose.connection.readyState !== 1) throw new Error('Database is disconnected');
    const cached = await Analysis.find({ producedBy: 'adaption' }).lean();
    if (!cached.length) return loadAdaptedFile();
    const hashes = cached.map((item) => item.textHash);
    const feedbacks = await Feedback.find({ textHash: { $in: hashes } }).select('text textHash').lean();
    const reviewsByHash = new Map(feedbacks.map((item) => [item.textHash, item.text]));
    const fileByHash = new Map(loadAdaptedFile().map((item) => [item.textHash, item]));
    const examples = cached.map((item) => {
      const source = fileByHash.get(item.textHash);
      return {
        textHash: item.textHash,
        review: reviewsByHash.get(item.textHash) || source?.review,
        analysis: source?.analysis || {
          sentiment: item.sentiment, sentimentScore: item.sentimentScore, topic: item.topic,
          severity: item.severity, isComplaint: item.isComplaint,
          issueSummary: item.issueSummary, suggestedAction: item.suggestedAction,
        },
      };
    }).filter((item) => item.review && item.analysis?.topic);
    return examples.length ? examples : loadAdaptedFile();
  } catch {
    return loadAdaptedFile();
  }
}

async function getSimilarityIndex() {
  if (!similarityIndexPromise) {
    similarityIndexPromise = loadAdaptedExamples().then((examples) => {
      console.log(`Similarity index loaded ${examples.length} Adaption-labelled examples.`);
      return buildIndex(examples);
    }).catch((error) => {
      similarityIndexPromise = undefined;
      throw error;
    });
  }
  return similarityIndexPromise;
}

const positiveWords = /\b(love|great|excellent|amazing|wonderful|fantastic|helpful|friendly|fast|reliable|satisfied|happy|recommend|perfect|smooth|easy)\b/i;
const negativeWords = /\b(bad|poor|terrible|awful|broken|damaged|defect(?:ive)?|late|delay(?:ed)?|scam|fraud|fake|rude|unhelpful|slow|crash(?:ed|es)?|glitch|problem|issue|missing|never arrived|overpriced|expensive|disappointed|waste)\b/i;
const fraudFalseAlarm = /\b(?:not\s+(?:a\s+)?victim\s+of\s+(?:any\s+)?fraud|no\s+signs?\s+of\s+(?:any\s+)?fraud(?:ulent\s+activity)?|no\s+fraud(?:ulent\s+activity)?|not\s+fraud(?:ulent)?|never\s+experienced\s+fraud)\b/i;

function pickTopic(text, category) {
  const matched = topicRules.find((rule) => rule.pattern.test(text));
  const key = matched?.topic || defaultTopics[category] || defaultTopics['Product Feedback'];
  return topicByKey.get(key);
}

function buildRulesAnalysis(text, category) {
  const normalized = normalizeText(text);
  const validCategory = CATEGORY_VALUES.includes(category) ? category : undefined;
  const topic = pickTopic(normalized, validCategory);
  const hasFalseAlarmNegation = fraudFalseAlarm.test(normalized);
  const hasPositive = positiveWords.test(normalized) || /\bnot bad\b/i.test(normalized);
  const hasNegative = negativeWords.test(normalized) && !/\bnot bad\b/i.test(normalized);
  let sentiment = 'neutral';
  if (hasFalseAlarmNegation) sentiment = 'positive';
  else if (hasPositive && hasNegative) sentiment = 'mixed';
  else if (hasNegative) sentiment = 'negative';
  else if (hasPositive) sentiment = 'positive';

  const isComplaint = sentiment === 'negative' || sentiment === 'mixed';
  const score = sentiment === 'positive' ? 0.7 : sentiment === 'negative' ? -0.7 : 0;
  const topicLabel = topic.label.toLowerCase();
  const issueSummary = isComplaint
    ? `Customer reports a concern with ${topic.label} affecting their experience.`
    : sentiment === 'positive'
      ? `Customer shared positive feedback about ${topic.label} in this experience.`
      : 'Customer feedback mentions the topic without a clear positive or negative view.';
  const suggestedAction = isComplaint
    ? `Review feedback about ${topicLabel} and investigate the reported customer concern.`
    : sentiment === 'positive'
      ? `Use this positive feedback about ${topicLabel} to reinforce what customers value.`
      : `Monitor feedback about ${topicLabel} for a clearer emerging pattern.`;

  let severity = 1;
  if (isComplaint) {
    severity = topic.key.startsWith('fraud_')
      ? (topic.key === 'fraud_payment_pressure' ? 5 : 4)
      : ['delivery_delay', 'delivery_damage_or_condition', 'order_processing_and_expectations'].includes(topic.key) ? 3 : 2;
  }

  return {
    sentiment,
    sentimentScore: score,
    topic: topic.key,
    severity,
    isComplaint,
    issueSummary,
    suggestedAction,
    producedBy: 'rules',
    adaptionRunId: null,
  };
}

function cachedAnalysisFields(cached) {
  return {
    sentiment: cached.sentiment,
    sentimentScore: cached.sentimentScore,
    topic: cached.topic,
    severity: cached.severity,
    isComplaint: cached.isComplaint,
    issueSummary: cached.issueSummary,
    suggestedAction: cached.suggestedAction,
    producedBy: cached.producedBy,
    adaptionRunId: cached.adaptionRunId || null,
    ...(cached.confidence === undefined ? {} : { confidence: cached.confidence }),
    ...(cached.matchedTextHash ? { matchedTextHash: cached.matchedTextHash } : {}),
  };
}

function neutralFailure(text) {
  const normalized = typeof text === 'string' ? normalizeText(text) : '';
  return {
    analysis: {
      sentiment: 'neutral', sentimentScore: 0, topic: 'product_quality', severity: 1,
      isComplaint: false,
      issueSummary: normalized.split(/\s+/).filter(Boolean).slice(0, 12).join(' '),
      suggestedAction: 'Monitor feedback for a clearer emerging pattern.',
      producedBy: 'rules', adaptionRunId: null, confidence: 0,
      notAnalyzed: true,
    },
    confidence: 0, matchedTextHash: null, neighbours: [], fromCache: false, notAnalyzed: true,
  };
}

async function analyzeText(text) {
  if (typeof text !== 'string') return neutralFailure('');
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 1000) return neutralFailure(normalized);
  const hash = textHash(normalized);
  try {
    if (mongoose.connection.readyState === 1) {
      const cached = await Analysis.findOne({ textHash: hash }).lean();
      if (cached) {
        const matchedHash = cached.matchedTextHash || hash;
        const source = await Feedback.findOne({ textHash: matchedHash }).select('text').lean().catch(() => null);
        const analysis = cachedAnalysisFields(cached);
        analysis.confidence = 1;
        analysis.matchedTextHash = matchedHash;
        const fallbackExample = source?.text ? null : loadAdaptedFile().find((item) => item.textHash === matchedHash);
        const matchedReview = source?.text || fallbackExample?.review;
        return {
          analysis, confidence: 1, matchedTextHash: matchedHash,
          neighbours: matchedReview ? [{ textHash: matchedHash, review: matchedReview, similarity: 1 }] : [],
          fromCache: true, notAnalyzed: false,
        };
      }
    }

    const result = classify(await getSimilarityIndex(), normalized);
    const analysis = {
      ...result.analysis,
      producedBy: 'similarity',
      adaptionRunId: null,
      confidence: result.confidence,
      matchedTextHash: result.matchedTextHash || undefined,
    };
    if (mongoose.connection.readyState === 1 && result.confidence > 0) {
      const cacheFields = {
        textHash: hash,
        sentiment: analysis.sentiment,
        sentimentScore: analysis.sentimentScore,
        topic: analysis.topic,
        severity: analysis.severity,
        isComplaint: analysis.isComplaint,
        issueSummary: analysis.issueSummary,
        suggestedAction: analysis.suggestedAction,
        producedBy: 'similarity',
        confidence: result.confidence,
        matchedTextHash: result.matchedTextHash || undefined,
        adaptionRunId: null,
      };
      try {
        await Analysis.updateOne({ textHash: hash }, { $setOnInsert: cacheFields }, { upsert: true });
        const saved = await Analysis.findOne({ textHash: hash }).lean();
        if (saved?.producedBy === 'adaption') {
          const preserved = cachedAnalysisFields(saved);
          preserved.confidence = 1;
          preserved.matchedTextHash = hash;
          return { analysis: preserved, confidence: 1, matchedTextHash: hash, neighbours: result.neighbours, fromCache: true, notAnalyzed: false };
        }
      } catch {
        // A cache write failure does not prevent the analysis from being returned.
      }
    }
    return { ...result, analysis, fromCache: false, notAnalyzed: false };
  } catch {
    return neutralFailure(normalized);
  }
}

async function analyzeMany(texts) {
  if (!Array.isArray(texts)) return [];
  const unique = new Map();
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    const normalized = normalizeText(text);
    const hash = textHash(normalized);
    if (!unique.has(hash)) unique.set(hash, analyzeText(normalized));
  }
  const resolved = new Map(await Promise.all([...unique].map(async ([hash, promise]) => [hash, await promise])));
  return texts.map((text) => typeof text === 'string' ? resolved.get(textHash(normalizeText(text))) : neutralFailure(''));
}

module.exports = { analyzeText, analyzeMany, buildRulesAnalysis, getSimilarityIndex };
