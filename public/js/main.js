// ---------- Starfield generator ----------
(function () {
  const fields = document.querySelectorAll('.starfield');
  fields.forEach((field) => {
    const count = 26;
    for (let i = 0; i < count; i++) {
      const star = document.createElement('span');
      star.className = 'star';
      const size = (Math.random() * 2 + 1).toFixed(1);
      star.style.width = size + 'px';
      star.style.height = size + 'px';
      star.style.top = Math.random() * 100 + '%';
      star.style.left = Math.random() * 100 + '%';
      star.style.animationDuration = (Math.random() * 3 + 2).toFixed(1) + 's';
      star.style.animationDelay = (Math.random() * 3).toFixed(1) + 's';
      field.appendChild(star);
    }
  });
})();

// ---------- Mobile nav toggle ----------
(function () {
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('mainNav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen);
  });
  nav.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    })
  );
})();

// ---------- FAQ accordion ----------
(function () {
  document.querySelectorAll('.faq-item').forEach((item) => {
    const q = item.querySelector('.faq-q');
    if (!q) return;
    q.addEventListener('click', () => {
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach((i) => i.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });
})();

// ---------- Scroll fade-up reveal ----------
(function () {
  const els = document.querySelectorAll('.card, .card-office, .testi-card, .section-head, .stat-block');
  if (!('IntersectionObserver' in window) || els.length === 0) {
    els.forEach((el) => el.classList.add('fade-up', 'in'));
    return;
  }
  els.forEach((el) => el.classList.add('fade-up'));
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  els.forEach((el) => io.observe(el));
})();

// ---------- Animated stat counters ----------
(function () {
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length === 0) return;

  function animateCounter(el) {
    const target = parseInt(el.dataset.count, 10) || 0;
    const duration = 1400;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target) + '+';
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if (!('IntersectionObserver' in window)) {
    counters.forEach(animateCounter);
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.4 }
  );
  counters.forEach((c) => io.observe(c));
})();
