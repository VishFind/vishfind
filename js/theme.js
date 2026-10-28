(() => {
  'use strict';

  const KEY = 'vishfind-theme';
  const OLD_KEY = 'isearch-theme';

  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function apply(theme) {
    const t = theme === 'light' || theme === 'dark' ? theme : systemTheme();
    document.documentElement.setAttribute('data-theme', t);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
      btn.setAttribute('aria-label', t === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
      btn.textContent = t === 'dark' ? 'Светлая' : 'Тёмная';
    }
    return t;
  }

  function init() {
    const saved = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
    if (saved && !localStorage.getItem(KEY)) localStorage.setItem(KEY, saved);
    apply(saved || 'light');

    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') || 'light';
        const next = cur === 'dark' ? 'light' : 'dark';
        localStorage.setItem(KEY, next);
        apply(next);
      });
    }

    const header = document.querySelector('.site-header');
    const navBtn = document.getElementById('nav-toggle');
    if (navBtn && header) {
      navBtn.addEventListener('click', () => {
        const open = header.classList.toggle('is-nav-open');
        navBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      header.querySelectorAll('.nav a').forEach((a) => {
        a.addEventListener('click', () => {
          header.classList.remove('is-nav-open');
          navBtn.setAttribute('aria-expanded', 'false');
        });
      });
    }

    const onScroll = () => {
      if (!header) return;
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('.reveal').forEach((node) => {
      if (reduce || !('IntersectionObserver' in window)) {
        node.classList.add('is-in');
        return;
      }
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        });
      }, { threshold: 0.12 });
      io.observe(node);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
