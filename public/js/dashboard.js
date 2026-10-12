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
  let debounceTimer;

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
    try {
      const response = await fetch(`/api/stats${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to load analytics.');
      if (id !== requestId) return;
      renderStats(payload);
    } catch (error) {
      if (id !== requestId) return;
      errorMessage.textContent = error.message || 'Unable to load analytics.';
      errorBox.hidden = false;
    } finally {
      if (id === requestId) setLoading(false);
    }
  }

  function applyQuery() {
    const params = new URLSearchParams(location.search);
    for (const [key, control] of Object.entries(controls)) {
      const value = params.get(key) || '';
      if ([...control.options].some((option) => option.value === value)) control.value = value;
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

  applyQuery();
  loadStats(false);
})();
