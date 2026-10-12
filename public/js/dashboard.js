(() => {
  const root = document.getElementById('dashboard');
  if (!root) return;

  const controls = Object.fromEntries(['category', 'sentiment', 'topic', 'source', 'from', 'to'].map((key) => [key, document.getElementById(`filter${key[0].toUpperCase()}${key.slice(1)}`)]));
  const loading = document.getElementById('dashboardLoading');
  const errorBox = document.getElementById('dashboardError');
  const errorMessage = document.getElementById('dashboardErrorMessage');
  const kpiCards = [...document.querySelectorAll('.dashboard-kpi')];
  let latestWindow = null;
  let requestId = 0;
  let topicRequestId = 0;
  let trendRequestId = 0;
  let debounceTimer;
  let statsData = null;
  let topicData = [];
  let trendData = null;
  let issueMetric = 'mentions';
  let trendGranularity = 'week';
  let trendMetric = 'total';
  const charts = {};
  const sentimentColors = { positive: '#159a83', mixed: '#d99a24', neutral: '#77869a', negative: '#d85645' };
  const sentimentLabels = ['positive', 'neutral', 'mixed', 'negative'];

  function chartState(name, message = '') {
    const canvas = document.getElementById(`${name}Chart`);
    const state = document.getElementById(`${name}ChartState`);
    state.textContent = message;
    state.hidden = !message;
    canvas.hidden = Boolean(message);
    if (message && charts[name]) {
      charts[name].destroy();
      delete charts[name];
    }
  }

  function replaceChart(name, config, summary) {
    const canvas = document.getElementById(`${name}Chart`);
    chartState(name);
    if (charts[name]) charts[name].destroy();
    charts[name] = new Chart(canvas, config);
    document.getElementById(`${name}ChartSummary`).textContent = summary;
  }

  function chartOptions(onClick) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      onClick,
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } },
        tooltip: { callbacks: { label(context) {
          const value = Number(context.parsed?.y ?? context.parsed?.x ?? context.parsed ?? 0);
          const total = context.dataset.data.reduce((sum, count) => sum + Number(count || 0), 0);
          const percent = total ? ` (${(value / total * 100).toFixed(1)}%)` : '';
          return `${context.dataset.label || context.label}: ${formatNumber(value)}${percent}`;
        } } },
      },
    };
  }

  function renderSentiment(data) {
    const counts = sentimentLabels.map((key) => Number(data.sentiment?.[key] || 0));
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (!total) return chartState('sentiment', 'No feedback matches these filters. Reset filters to see all feedback.');
    replaceChart('sentiment', {
      type: 'doughnut',
      data: { labels: sentimentLabels.map((key) => `${key[0].toUpperCase()}${key.slice(1)}`), datasets: [{ data: counts, backgroundColor: sentimentLabels.map((key) => sentimentColors[key]), borderWidth: 2, borderColor: '#fff' }] },
      options: { ...chartOptions((event, elements) => { if (elements.length) { controls.sentiment.value = sentimentLabels[elements[0].index]; loadStats(); } }), cutout: '62%' },
    }, `Sentiment counts: ${sentimentLabels.map((key, i) => `${key} ${formatNumber(counts[i])}`).join(', ')}.`);
  }

  function renderIssues(topics) {
    const rows = topics.slice().sort((a, b) => b[issueMetric] - a[issueMetric] || a.key.localeCompare(b.key)).slice(0, 8);
    const values = rows.map((topic) => Number(topic[issueMetric] || 0));
    if (!rows.length || !values.some(Boolean)) return chartState('issues', 'No complaint issues match these filters. Reset filters to see all issues.');
    const labels = rows.map((topic) => topic.label);
    replaceChart('issues', {
      type: 'bar',
      data: { labels, datasets: [{ label: issueMetric === 'mentions' ? 'Total mentions' : 'Unique phrasings', data: values, backgroundColor: '#5579d8', borderRadius: 5, maxBarThickness: 28 }] },
      options: { ...chartOptions((event, elements) => { if (elements.length) { controls.topic.value = rows[elements[0].index].key; loadStats(); } }), indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } }, plugins: { ...chartOptions().plugins, legend: { display: false } } },
    }, `Top complaint issues by ${issueMetric === 'mentions' ? 'total mentions' : 'unique phrasings'}: ${rows.map((topic) => `${topic.label}, ${formatNumber(topic[issueMetric])}`).join('; ')}.`);
  }

  function renderCategories(data) {
    const rows = data.byCategory || [];
    const labels = rows.map((row) => row.category);
    const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    if (!total) return chartState('category', 'No feedback matches these filters. Reset filters to see all categories.');
    replaceChart('category', {
      type: 'bar',
      data: { labels, datasets: sentimentLabels.map((key) => ({ label: `${key[0].toUpperCase()}${key.slice(1)}`, data: rows.map((row) => Number(row[key] || 0)), backgroundColor: sentimentColors[key], borderRadius: 3 })) },
      options: { ...chartOptions((event, elements) => { if (elements.length) { controls.category.value = rows[elements[0].index].category; loadStats(); } }), scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
    }, `Sentiment by category: ${rows.map((row) => `${row.category}, ${sentimentLabels.map((key) => `${key} ${formatNumber(row[key])}`).join(', ')}`).join('; ')}.`);
  }

  function renderTrend(data) {
    const buckets = data.buckets || [];
    const labels = buckets.map((bucket) => bucket.date);
    const line = (label, key, color) => ({
      label,
      data: buckets.map((bucket) => Number(bucket[key] || 0)),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: buckets.length > 45 ? 0 : 2,
      pointHoverRadius: 5,
      tension: 0.25,
      fill: false,
    });
    let datasets;
    if (trendMetric === 'sentiment') {
      datasets = sentimentLabels.map((key) => line(`${key[0].toUpperCase()}${key.slice(1)}`, key, sentimentColors[key]));
    } else if (trendMetric === 'complaints') {
      datasets = [line('Complaints', 'complaints', '#d85645')];
    } else {
      datasets = [line('Total feedback', 'total', '#5579d8')];
    }
    const total = datasets.reduce((sum, dataset) => sum + dataset.data.reduce((part, value) => part + value, 0), 0);
    if (!buckets.length || !total) return chartState('trend', 'No feedback matches these filters. Reset filters to see the trend.');
    replaceChart('trend', {
      type: 'line',
      data: { labels, datasets },
      options: {
        ...chartOptions(),
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { maxTicksLimit: 10, maxRotation: 0 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    }, `${trendMetric === 'sentiment' ? 'Feedback by sentiment' : trendMetric === 'complaints' ? 'Complaint' : 'Total feedback'} per ${data.granularity}: ${datasets.map((dataset) => `${dataset.label}, ${formatNumber(dataset.data.reduce((sum, value) => sum + value, 0))} in total`).join('; ')}.`);
  }

  function loadTrend(query, id) {
    const trendId = ++trendRequestId;
    chartState('trend', 'Loading feedback trend…');
    const params = new URLSearchParams(query);
    params.set('granularity', trendGranularity);
    return fetch(`/api/trends?${params.toString()}`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load the feedback trend.');
        if (id !== requestId || trendId !== trendRequestId) return;
        trendData = payload;
        renderTrend(trendData);
      })
      .catch((error) => {
        if (id === requestId && trendId === trendRequestId) chartState('trend', `${error.message || 'Unable to load the feedback trend.'} Retry by changing a filter.`);
      });
  }

  function loadTopics(query, id) {
    const topicId = ++topicRequestId;
    chartState('issues', 'Loading complaint issues…');
    return fetch(`/api/topics${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load complaint issues.');
        if (id !== requestId || topicId !== topicRequestId) return;
        topicData = payload;
        renderIssues(topicData);
      })
      .catch((error) => {
        if (id === requestId && topicId === topicRequestId) chartState('issues', `${error.message || 'Unable to load complaint issues.'} Retry by changing a filter.`);
      });
  }

  function setLoading(isLoading) {
    loading.hidden = !isLoading;
    kpiCards.forEach((card) => {
      card.querySelector('.dashboard-skeleton').hidden = !isLoading;
      card.querySelector('.dashboard-kpi-content').hidden = isLoading;
    });
  }

  function readFilters() {
    return Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value]));
  }

  function queryString(filters) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return params.toString();
  }

  function syncUrl() {
    const query = queryString(readFilters());
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }

  function setWindowDates(window) {
    if (!window?.from || !window?.to) return;
    latestWindow = { to: window.to.slice(0, 10) };
    const defaultStart = new Date(`${latestWindow.to}T00:00:00Z`);
    defaultStart.setUTCDate(defaultStart.getUTCDate() - 89);
    latestWindow.from = defaultStart.toISOString().slice(0, 10);
    if (!controls.from.value) controls.from.value = latestWindow.from;
    if (!controls.to.value) controls.to.value = latestWindow.to;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function setDelta(key, value, label, isBadWhenUp = false) {
    const element = document.querySelector(`[data-delta="${key}"]`);
    if (value == null || !Number.isFinite(Number(value))) {
      element.hidden = true;
      return;
    }
    const numeric = Number(value);
    element.hidden = false;
    element.classList.remove('text-danger', 'text-success', 'text-secondary');
    element.classList.add(numeric === 0 ? 'text-secondary' : ((numeric > 0) === isBadWhenUp ? 'text-danger' : 'text-success'));
    element.textContent = `${numeric > 0 ? '↑' : numeric < 0 ? '↓' : '→'} ${Math.abs(numeric).toFixed(1)}% ${label} vs previous window`;
  }

  function renderStats(data) {
    setWindowDates(data.window);
    const kpis = data.kpis;
    const values = {
      totalMentions: formatNumber(kpis.totalMentions),
      uniquePhrasings: formatNumber(kpis.uniquePhrasings),
      complaints: formatNumber(kpis.complaintMentions),
      negativeShare: `${(kpis.negativeShare * 100).toFixed(1)}%`,
      averageScore: Number(kpis.avgSentimentScore || 0).toFixed(2),
      topIssue: kpis.topIssue ? `${kpis.topIssue.label} · ${formatNumber(kpis.topIssue.mentions)}` : 'No complaints',
    };
    for (const [key, value] of Object.entries(values)) document.querySelector(`[data-value="${key}"]`).textContent = value;
    document.querySelector('[data-hint="complaints"]').textContent = `${(kpis.complaintShare * 100).toFixed(1)}% of feedback`;
    setDelta('complaints', data.deltas?.complaintMentions, '', true);
    setDelta('negativeShare', data.deltas?.negativeShare, 'share');
    document.getElementById('unanalysedNote').hidden = !data.unanalysed;
    document.getElementById('unanalysedNote').textContent = `${formatNumber(data.unanalysed)} feedback items not analysed yet.`;
    document.getElementById('dashboardEmpty').hidden = data.kpis.totalMentions !== 0;
  }

  async function loadStats(updateUrl = true) {
    const id = ++requestId;
    if (updateUrl) syncUrl();
    errorBox.hidden = true;
    setLoading(true);
    const query = queryString(readFilters());
    chartState('sentiment', 'Loading sentiment distribution…');
    chartState('category', 'Loading category breakdown…');
    const topicsRequest = loadTopics(query, id);
    const trendRequest = loadTrend(query, id);
    try {
      const response = await fetch(`/api/stats${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load analytics.');
      if (id !== requestId) return;
      statsData = payload;
      renderStats(payload);
      renderSentiment(payload);
      renderCategories(payload);
    } catch (error) {
      if (id !== requestId) return;
      errorMessage.textContent = error.message || 'Unable to load analytics.';
      errorBox.hidden = false;
      chartState('sentiment', 'Unable to load sentiment data. Retry to try again.');
      chartState('category', 'Unable to load category data. Retry to try again.');
    } finally {
      if (id === requestId) {
        setLoading(false);
        await Promise.all([topicsRequest, trendRequest]);
      }
    }
  }

  function applyQuery() {
    const params = new URLSearchParams(location.search);
    for (const [key, control] of Object.entries(controls)) {
      const value = params.get(key) || '';
      if (!value) continue;
      // Select filters must match a known option; date inputs are validated by the API.
      if (control.tagName !== 'SELECT' || [...control.options].some((option) => option.value === value)) {
        control.value = value;
      }
    }
    if (controls.from.value || controls.to.value) document.getElementById('datePreset').value = 'custom';
  }

  function applyPreset() {
    if (!latestWindow) return;
    const days = Number(document.getElementById('datePreset').value);
    if (!days) return;
    const end = new Date(`${latestWindow.to}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    controls.from.value = start.toISOString().slice(0, 10);
    controls.to.value = latestWindow.to;
  }

  for (const control of Object.values(controls)) {
    control.addEventListener('change', () => {
      if (control === controls.from || control === controls.to) document.getElementById('datePreset').value = 'custom';
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadStats(), 120);
    });
  }
  document.getElementById('datePreset').addEventListener('change', (event) => {
    if (event.target.value !== 'custom') applyPreset();
    loadStats();
  });
  document.getElementById('dashboardReset').addEventListener('click', () => {
    Object.values(controls).forEach((control) => { control.value = ''; });
    document.getElementById('datePreset').value = '90';
    loadStats();
  });
  document.querySelectorAll('[data-dashboard-reset]').forEach((button) => button.addEventListener('click', () => document.getElementById('dashboardReset').click()));
  document.getElementById('dashboardRetry').addEventListener('click', () => loadStats(false));
  document.querySelectorAll('[data-issue-metric]').forEach((button) => button.addEventListener('click', () => {
    issueMetric = button.dataset.issueMetric;
    document.querySelectorAll('[data-issue-metric]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    if (topicData) renderIssues(topicData);
  }));
  document.querySelectorAll('[data-trend-granularity]').forEach((button) => button.addEventListener('click', () => {
    trendGranularity = button.dataset.trendGranularity;
    document.querySelectorAll('[data-trend-granularity]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    loadTrend(queryString(readFilters()), requestId);
  }));
  document.querySelectorAll('[data-trend-metric]').forEach((button) => button.addEventListener('click', () => {
    trendMetric = button.dataset.trendMetric;
    document.querySelectorAll('[data-trend-metric]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    if (trendData) renderTrend(trendData);
  }));

  applyQuery();
  loadStats(false);
})();
