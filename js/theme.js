(() => {
  'use strict';

  const KEY = 'isearch-theme';

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
    const saved = localStorage.getItem(KEY);
    apply(saved || systemTheme());

    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = cur === 'dark' ? 'light' : 'dark';
        localStorage.setItem(KEY, next);
        apply(next);
      });
    }

    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (!localStorage.getItem(KEY)) apply(systemTheme());
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
