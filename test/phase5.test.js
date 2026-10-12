const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateStatsQuery,
  buildMatch,
  resolveWindow,
  previousWindow,
  resolveGranularity,
  share,
  trendPct,
  fillBuckets,
  startOfUtcWeekMonday,
  DEFAULT_WINDOW_DAYS,
  DAY_MS,
} = require('../services/statsService');

test('stats query validation rejects unknown enums and malformed dates', () => {
  assert.equal(validateStatsQuery({ category: 'Returns' }).error.status, 400);
  assert.equal(validateStatsQuery({ sentiment: 'happy' }).error.status, 400);
  assert.equal(validateStatsQuery({ topic: 'not_a_topic' }).error.status, 400);
  assert.equal(validateStatsQuery({ source: 'Twitter' }).error.status, 400);
  assert.match(validateStatsQuery({ from: '12/10/2026' }).error.message, /YYYY-MM-DD/);
  assert.match(validateStatsQuery({ to: '2026-13-40' }).error.message, /YYYY-MM-DD/);
  assert.match(validateStatsQuery({ from: '2026-10-12', to: '2026-10-01' }).error.message, /on or before/);
  assert.match(validateStatsQuery({ granularity: 'month' }).error.message, /day or week/);
  assert.match(validateStatsQuery({ topics: 'delivery_delay,missing' }).error.message, /taxonomy/);
  assert.match(validateStatsQuery({
    topics: 'delivery_delay,fraud_seller_scamming,product_quality,product_value,product_setup_usage,product_reliability_durability',
  }).error.message, /at most 5/);
});

test('stats query validation accepts whitelisted filters and ignores blank values', () => {
  const parsed = validateStatsQuery({
    category: 'Operational Issues',
    sentiment: 'negative',
    topic: 'delivery_delay',
    source: 'Support',
    from: '2026-09-21',
    to: '2026-10-12',
    granularity: 'day',
    topics: 'delivery_delay,fraud_seller_scamming',
    q: 'ignored-by-dashboard',
  });
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.filters, {
    category: 'Operational Issues',
    sentiment: 'negative',
    topic: 'delivery_delay',
    source: 'Support',
    from: '2026-09-21',
    to: '2026-10-12',
  });
  assert.equal(parsed.granularity, 'day');
  assert.deepEqual(parsed.topicKeys, ['delivery_delay', 'fraud_seller_scamming']);
  assert.equal(validateStatsQuery({ category: '', from: '' }).error, null);
});

test('buildMatch never copies raw query values into the Mongo filter', () => {
  const match = buildMatch({
    category: 'Fraud and Scam',
    sentiment: 'negative',
    topic: 'fraud_seller_scamming',
    source: 'Review',
    from: '2026-09-21',
    to: '2026-10-12',
  });
  const attributes = match.$and[0];
  const analysed = match.$and[1];
  assert.equal(attributes.originalCategory, 'Fraud and Scam');
  assert.equal(attributes['analysis.sentiment'], 'negative');
  assert.equal(attributes['analysis.topic'], 'fraud_seller_scamming');
  assert.equal(attributes.source, 'Review');
  assert.equal(analysed['analysis.notAnalyzed'].$ne, true);
  assert.equal(attributes.createdAt.$gte.toISOString(), '2026-09-21T00:00:00.000Z');
  assert.equal(attributes.createdAt.$lte.toISOString(), '2026-10-12T23:59:59.999Z');
  assert.throws(() => buildMatch({ sentiment: 'angry' }), { status: 400 });
});

test('buildMatch applies an explicit window and keeps unanalysed rows out', () => {
  const from = new Date('2026-07-14T08:00:00.000Z');
  const to = new Date('2026-10-12T07:34:51.582Z');
  const match = buildMatch({}, { from, to });
  const attributes = match.$and[0];
  const analysed = match.$and[1];
  assert.equal(analysed['analysis.notAnalyzed'].$ne, true);
  assert.ok(analysed['analysis.topic'].$exists);
  assert.ok(analysed['analysis.sentiment'].$exists);
  assert.equal(attributes.createdAt.$gte.toISOString(), from.toISOString());
  assert.equal(attributes.createdAt.$lte.toISOString(), to.toISOString());
  assert.equal(attributes.originalCategory, undefined);
});

test('resolveWindow uses the latest createdAt as the end of the default 90-day span', () => {
  const latest = new Date('2026-10-12T07:34:51.582Z');
  const window = resolveWindow({}, latest);
  assert.equal(window.to.toISOString(), latest.toISOString());
  assert.equal(window.from.toISOString(), new Date(latest.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS).toISOString());
  assert.equal(window.days, DEFAULT_WINDOW_DAYS);
  const custom = resolveWindow({ from: '2026-09-01', to: '2026-09-30' }, latest);
  assert.equal(custom.from.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(custom.to.toISOString(), '2026-09-30T23:59:59.999Z');
  assert.equal(resolveWindow({}, null), null);
});

test('previousWindow is the same length and does not overlap the current window', () => {
  const window = resolveWindow({}, new Date('2026-10-12T08:00:00.000Z'));
  const previous = previousWindow(window);
  assert.equal(previous.to.getTime(), window.from.getTime() - 1);
  assert.equal(previous.to.getTime() - previous.from.getTime(), window.to.getTime() - window.from.getTime());
  assert.ok(previous.to.getTime() < window.from.getTime());
});

test('bucket filling inserts zero rows so day and week series have no gaps', () => {
  const from = new Date('2026-10-01T08:00:00.000Z');
  const to = new Date('2026-10-04T18:00:00.000Z');
  const days = fillBuckets(from, to, 'day', [
    { date: '2026-10-01', total: 4, complaints: 2, negative: 1 },
    { date: '2026-10-04', total: 1, complaints: 0, positive: 1 },
  ], ['delivery_delay']);
  assert.deepEqual(days.map((row) => row.date), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(days[1].total, 0);
  assert.equal(days[1].complaints, 0);
  assert.equal(days[1].topics.delivery_delay, 0);
  assert.equal(days[0].total, 4);
  assert.equal(days[3].positive, 1);

  const weekFrom = new Date('2026-09-28T00:00:00.000Z');
  const weekTo = new Date('2026-10-12T00:00:00.000Z');
  const weeks = fillBuckets(weekFrom, weekTo, 'week', [
    { date: isoWeek(weekFrom), total: 10, complaints: 3 },
  ]);
  assert.equal(weeks.length, 3);
  assert.equal(weeks[0].date, '2026-09-28');
  assert.equal(weeks[1].date, '2026-10-05');
  assert.equal(weeks[2].date, '2026-10-12');
  assert.equal(weeks[1].total, 0);
  assert.equal(weeks[1].complaints, 0);
});

test('trend percentage is relative change and null when there is no previous volume', () => {
  assert.equal(trendPct(12, 8), 50);
  assert.equal(trendPct(8, 10), -20);
  assert.equal(trendPct(0, 10), -100);
  assert.equal(trendPct(5, 0), null);
  assert.equal(trendPct(0, 0), null);
  assert.equal(trendPct(4, null), null);
  assert.equal(share(25, 100), 0.25);
  assert.equal(share(3, 0), 0);
  assert.equal(resolveGranularity(undefined, 90), 'week');
  assert.equal(resolveGranularity(undefined, 21), 'day');
  assert.equal(resolveGranularity('day', 90), 'day');
});

function isoWeek(value) {
  return startOfUtcWeekMonday(value).toISOString().slice(0, 10);
}
