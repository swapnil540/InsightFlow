(() => {
  const form = document.getElementById('addFeedbackForm');
  const text = document.getElementById('feedbackText');
  const count = document.getElementById('feedbackCharacterCount');
  const button = document.getElementById('submitFeedbackButton');
  if (!form || !text || !count || !button) return;

  text.addEventListener('input', () => { count.textContent = String(text.value.length); });
  form.addEventListener('submit', (event) => {
    if (!form.checkValidity()) return;
    event.preventDefault();
    button.disabled = true;
    button.querySelector('.submit-label').classList.add('d-none');
    button.querySelector('.submit-loading').classList.remove('d-none');
    form.submit();
  });
})();
