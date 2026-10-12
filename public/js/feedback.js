(() => {
  const modal = document.getElementById('feedbackDetailModal');
  if (!modal) return;

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value || '—';
  };

  modal.addEventListener('show.bs.modal', (event) => {
    const trigger = event.relatedTarget;
    if (!trigger) return;
    const data = trigger.dataset;
    setText('detailText', data.text);
    setText('detailSentiment', data.sentiment);
    setText('detailScore', data.score);
    setText('detailTopic', data.topic);
    setText('detailParentCategory', data.parentCategory);
    setText('detailSeverity', `${data.severity} / 5`);
    setText('detailComplaint', data.complaint);
    setText('detailSource', data.source);
    setText('detailProvider', data.provider);
    setText('detailConfidence', data.confidence);
    setText('detailSummary', data.summary);
    setText('detailAction', data.action);

    const date = new Date(data.date);
    const dateText = Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
    setText('detailDate', data.simulated === 'true' ? `${dateText} (simulated demo date)` : dateText);

    const mentionCount = Number(data.mentions || 0);
    const mentionsWrap = document.getElementById('detailMentionsWrap');
    if (mentionsWrap) mentionsWrap.hidden = mentionCount < 2;
    setText('detailMentions', `${mentionCount.toLocaleString()} mentions`);

    const allLink = document.getElementById('detailAllLink');
    if (allLink) allLink.href = data.allHref || '/feedback';
  });
})();
