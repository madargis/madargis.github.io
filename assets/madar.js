const KEY = 'madar-lang';
const still = window.matchMedia('(prefers-reduced-motion: reduce)');
window.madarReady = true;

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-lang]');
  if (!link) return;
  try {
    localStorage.setItem(KEY, link.dataset.lang);
  } catch {}
});

const parse = (text) => {
  const clean = String(text).replace(/,/g, '');
  return { value: Number(clean), decimals: (clean.split('.')[1] ?? '').length, grouped: String(text).includes(',') };
};

const format = (value, target) =>
  value.toLocaleString('en-US', {
    minimumFractionDigits: target.decimals,
    maximumFractionDigits: target.decimals,
    useGrouping: target.grouped,
  });

function prepareCount(element) {
  const target = parse(element.dataset.count);
  if (!Number.isFinite(target.value) || target.value === 0) return null;
  const spoken = document.createElement('span');
  spoken.className = 'visually-hidden';
  spoken.textContent = element.textContent;
  element.after(spoken);
  element.setAttribute('aria-hidden', 'true');
  element.textContent = format(0, target);
  return target;
}

function runCount(element, target) {
  const start = performance.now();
  const duration = 1600;
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    element.textContent = format(target.value * (1 - (1 - progress) ** 4), target);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const reveals = [...document.querySelectorAll('[data-reveal]')];
const counters = [...document.querySelectorAll('[data-count]')];

if (still.matches || !('IntersectionObserver' in window)) {
  reveals.forEach((element) => element.classList.add('is-in'));
} else {
  const targets = new Map(counters.map((element) => [element, prepareCount(element)]).filter(([, target]) => target));
  const observer = new IntersectionObserver(
    (entries) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .forEach((entry, order) => {
          const element = entry.target;
          observer.unobserve(element);
          if (element.hasAttribute('data-reveal')) {
            element.style.setProperty('--delay', `${Math.min(order, 6) * 80}ms`);
            element.classList.add('is-in');
          }
          if (targets.has(element)) runCount(element, targets.get(element));
        });
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.08 },
  );
  reveals.forEach((element) => observer.observe(element));
  targets.forEach((target, element) => observer.observe(element));
}
