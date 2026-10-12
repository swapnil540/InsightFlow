const mongoose = require('mongoose');
const Analysis = require('../models/analysis');
const taxonomy = require('../config/taxonomy');
const { CATEGORY_VALUES } = require('./filters');
const { normalizeText, textHash } = require('./textHash');

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
  };
}

async function analyzeText(text, { category } = {}) {
  const normalized = normalizeText(text);
  const hash = textHash(normalized);
  if (mongoose.connection.readyState === 1) {
    try {
      const cached = await Analysis.findOne({ textHash: hash }).lean();
      if (cached) return { analysis: cachedAnalysisFields(cached), fromCache: true };
    } catch {
      // A cache outage must not prevent the rules-based analysis from working.
    }
  }
  return { analysis: buildRulesAnalysis(normalized, category), fromCache: false };
}

module.exports = { analyzeText, buildRulesAnalysis };
