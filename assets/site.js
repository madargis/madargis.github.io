const form = document.querySelector('form[data-mailto]');

if (form) {
  const boxes = [...form.querySelectorAll('input[name="formats"]')];
  const syncBoxes = () => boxes[0].setCustomValidity(boxes.some((box) => box.checked) ? '' : form.dataset.checksError);
  boxes.forEach((box) => box.addEventListener('change', syncBoxes));
  syncBoxes();

  const answer = (group) => {
    const values = [...group.querySelectorAll('input, select, textarea')]
      .filter((control) => control.type !== 'checkbox' || control.checked)
      .map((control) => control.value.trim())
      .filter(Boolean);
    return values.join(group.dataset.field === 'size' ? ' ' : ', ');
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const lines = [...form.querySelectorAll('[data-field]')]
      .map((group) => [group.dataset.label, answer(group)])
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`);
    const query = `subject=${encodeURIComponent(form.dataset.subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
    window.location.href = `mailto:${form.dataset.mailto}?${query}`;
  });
}
