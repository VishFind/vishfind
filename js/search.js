(() => {
  'use strict';

  const input = document.getElementById('q');
  const submitBtn = document.getElementById('btn-submit');
  const newQueryBtn = document.getElementById('btn-new-query');
  const newQueryRow = document.getElementById('new-query-row');
  const photoBtn = document.getElementById('btn-photo');
  const fileInput = document.getElementById('file-input');
  const preview = document.getElementById('photo-preview');
  const previewImg = document.getElementById('photo-img');
  const photoMeta = document.getElementById('photo-meta');
  const photoClear = document.getElementById('photo-clear');
  const statusEl = document.getElementById('status');
  const resultsBody = document.getElementById('results-body');
  const resultsSection = document.getElementById('results');
  const dropzone = document.getElementById('dropzone');
  const ready = document.getElementById('ready');
  const readyLabel = document.getElementById('ready-label');
  const hero = document.getElementById('hero');
  const examplesEl = document.getElementById('examples');
  const adBody = document.getElementById('ad-body');
  const sheetEl = document.getElementById('app-sheet');
  const sheetTitle = document.getElementById('sheet-title');
  const sheetToolbar = document.getElementById('sheet-toolbar');
  const sheetBody = document.getElementById('sheet-body');
  const btnSaved = document.getElementById('btn-saved');
  const btnHistory = document.getElementById('btn-history');
  const userCriteriaHost = document.getElementById('quick-chips');
  const Criteria = window.VishFindCriteria || null;
  const webSearchOpt = document.getElementById('opt-web-search');
  const webSearchHint = document.getElementById('web-search-opt-hint');

  if (!input || !submitBtn || !resultsBody) return;

  let sheetMode = null;
  let sheetOpener = null;
  let sheetScrollY = 0;
  let criteriaApi = null;

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_FILE = 8 * 1024 * 1024;
  const MAX_DATA = 6 * 1024 * 1024;
  const MAX_SIDE = 1024; // ТЗ: длинная сторона ≤ 1024 px
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let imageDataUrl = null;
  let busy = false;
  let aiEnabled = false;
  let ebayConfigured = false;
  /** Серверная возможность WEB_SEARCH (не включает поиск сама по себе). */
  let webSearchServerEnabled = false;
  let lastData = null;
  let lastArgs = null;
  let searchSeq = 0;
  let activeAbort = null;
  let userScrolledDuringSearch = false;
  let scrollGuardBound = false;
  /** Клиентский фильтр групп уже полученных ссылок: all|official|reseller|other|marketplace */
  let linkGroupFilter = 'all';

  const Saved = window.VishFindSaved || null;

  const SOURCE_TEMPLATES = {
    ozon: 'https://www.ozon.ru/search/?text={q}',
    wildberries: 'https://www.wildberries.ru/catalog/0/search.aspx?search={q}',
    yandex_market: 'https://market.yandex.ru/search?text={q}',
    avito: 'https://www.avito.ru/all?q={q}',
    lamoda: 'https://www.lamoda.ru/catalogsearch/result/?q={q}',
    zara: 'https://www.zara.com/ru/ru/search?searchTerm={q}',
    ebay: 'https://www.ebay.com/sch/i.html?_nkw={q}',
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function isTechDebugOn() {
    try {
      if (new URLSearchParams(window.location.search).get('debug') === '1') return true;
      return localStorage.getItem('vishfind-tech-debug') === '1';
    } catch (_) {
      return false;
    }
  }

  function renderTechDebug(data, meta) {
    let box = document.getElementById('tech-debug');
    if (!isTechDebugOn()) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = el('aside', 'tech-debug glass');
      box.id = 'tech-debug';
      box.setAttribute('aria-label', 'Техническая диагностика');
      const results = document.getElementById('results');
      if (results) results.prepend(box);
      else document.body.appendChild(box);
    }
    const p = (data && data.parsed) || {};
    const sources = Array.isArray(data && data.sources) ? data.sources : [];
    const lines = [
      'seq=' + (meta && meta.seq) + ' · ' + (meta && meta.ms) + ' ms',
      'priority=' + !!(meta && meta.attributes_priority),
      'clear=' + ((((meta && meta.clear_attributes) || []).join(',')) || '—'),
      'budget_min=' + (p.budget_min == null ? '∅' : p.budget_min) + ' budget_max=' + (p.budget_max == null ? '∅' : p.budget_max),
      'colors=' + (Array.isArray(p.colors) ? p.colors.join('|') : p.color || '∅'),
      'sizes=' + (Array.isArray(p.sizes) ? p.sizes.join('|') : p.size || '∅'),
      'phrase=' + (p.search_phrase || '∅'),
    ];
    sources.slice(0, 8).forEach((s) => {
      const applied = (s.applied_filters || []).join(',') || '—';
      const manual = (s.unsupported_filters || []).join(',') || '—';
      lines.push(s.id + ': applied[' + applied + '] manual[' + manual + '] ' + (s.verification_level || ''));
    });
    box.replaceChildren();
    box.appendChild(el('h2', null, 'Диагностика'));
    box.appendChild(el('p', 'tech-debug-note', 'Включено ?debug=1 или localStorage vishfind-tech-debug=1. Секреты и фото не пишем.'));
    const pre = el('pre', 'tech-debug-pre', lines.join('\n'));
    box.appendChild(pre);
  }

  function setStatus(msg, kind) {
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.className = 'status';
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.className = 'status' + (kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : '');
  }

  function setBusy(v) {
    busy = v;
    submitBtn.disabled = v;
    input.disabled = v;
    if (photoBtn) photoBtn.disabled = v;
    // «Новый запрос» остаётся доступной, чтобы отменить текущий поиск.
    submitBtn.textContent = v ? 'Ищем…' : 'Искать';
    const analyzing = !!(v && imageDataUrl && aiEnabled);
    if (analyzing) setPhotoStatus('analyzing');
    else if (!v && imageDataUrl && preview && !preview.classList.contains('is-fail')) setPhotoStatus('ready');
  }

  function setNewQueryVisible(visible) {
    if (newQueryRow) newQueryRow.hidden = !visible;
  }

  function resetCurrentSearch() {
    // Отмена текущего запроса + инвалидация позднего ответа (searchSeq).
    searchSeq += 1;
    if (activeAbort) {
      try { activeAbort.abort('reset'); } catch (_) { /* ignore */ }
      activeAbort = null;
    }

    input.value = '';
    lastData = null;
    lastArgs = null;
    pickedOffers = [];
    renderCompare();

    if (criteriaApi && criteriaApi.destroy) {
      try { criteriaApi.destroy(); } catch (_) { /* ignore */ }
    }
    if (Criteria && userCriteriaHost) {
      criteriaApi = Criteria.mount(userCriteriaHost, Criteria.emptyState(), {});
    } else {
      criteriaApi = null;
    }

    if (previewImg && previewImg.src && String(previewImg.src).startsWith('blob:')) {
      try { URL.revokeObjectURL(previewImg.src); } catch (_) { /* ignore */ }
    }
    clearPhoto();

    resultsBody.replaceChildren();
    if (resultsSection) resultsSection.hidden = true;
    setNewQueryVisible(false);
    linkGroupFilter = 'all';
    const compareSlot = document.getElementById('compare-slot');
    if (compareSlot) compareSlot.replaceChildren();
    const tech = document.getElementById('tech-debug');
    if (tech) tech.remove();

    renderSmartHints(null, false, false);
    if (examplesEl) examplesEl.hidden = false;
    setStatus('');
    setBusy(false);
    closeSheet();
    document.querySelectorAll('.ad-slot.is-ad').forEach((row) => row.classList.remove('is-ad'));

    try {
      const u = new URL(window.location.href);
      ['q', 'query', 'brand', 'brands', 'color', 'size', 'budget', 'budget_min', 'budget_max'].forEach((k) => {
        u.searchParams.delete(k);
      });
      history.replaceState(null, '', u.pathname + (u.search || ''));
    } catch (_) { /* ignore */ }

    focusQuery();
  }

  function setPhotoStatus(kind) {
    if (!preview || !photoMeta) return;
    preview.classList.remove('is-ready', 'is-analyzing', 'is-fail');
    preview.hidden = false;
    if (kind === 'ready') {
      preview.classList.add('is-ready');
      photoMeta.textContent = 'Фото готово';
    } else if (kind === 'analyzing') {
      preview.classList.add('is-analyzing');
      photoMeta.textContent = 'Анализ';
    } else if (kind === 'fail') {
      preview.classList.add('is-fail');
      photoMeta.textContent = 'Фото не разобрано';
    }
  }

  function formatBudget(n) {
    return 'до ' + Number(n).toLocaleString('ru-RU') + ' ₽';
  }

  function formatPriceRange(p) {
    const min = p && p.budget_min != null ? Number(p.budget_min) : null;
    const max =
      p && p.budget_max != null
        ? Number(p.budget_max)
        : p && p.budget != null
          ? Number(p.budget)
          : null;
    const bits = [];
    if (Number.isFinite(min)) bits.push('от ' + min.toLocaleString('ru-RU'));
    if (Number.isFinite(max)) bits.push('до ' + max.toLocaleString('ru-RU'));
    if (!bits.length) return '';
    return bits.join(' ') + ' ₽';
  }

  function summaryLine(p) {
    const bits = [];
    if (p.category) bits.push(p.category);
    if (p.color) bits.push(p.color);
    if (p.brand) bits.push(p.brand);
    const price = formatPriceRange(p);
    if (price) bits.push(price);
    if (p.size) bits.push(String(p.size));
    if (p.movie && p.movie.title) bits.push(p.movie.title);
    return bits.length ? bits.join(' · ') : 'Параметры почти не распознаны';
  }

  function renderPhotoAttrs(photo) {
    if (!photo || typeof photo !== 'object') return null;
    const rows = [
      ['Тип', photo.garment_type],
      ['Подтип', photo.subtype],
      ['Цвет', [photo.color_primary].concat(photo.color_extra || []).filter(Boolean).join(', ')],
      ['Материал', photo.material],
      ['Узор', photo.pattern],
      ['Воротник', photo.collar],
      ['Застёжка', photo.closure],
      ['Карманы', photo.pockets],
      ['Длина', photo.length],
      ['Крой', photo.fit],
      ['Детали', photo.hardware_and_details],
      ['Эпоха / стиль', photo.era_or_style],
      ['Текст на фото', Array.isArray(photo.visible_text) ? photo.visible_text.join(' · ') : ''],
      ['Бренд (только если виден)', photo.brand],
      ['Модель (только если читается)', photo.model_name],
      ['Описание', photo.description],
    ];
    const dl = el('dl', 'photo-attrs');
    let any = false;
    rows.forEach(([label, val]) => {
      if (val == null || val === '') return;
      any = true;
      dl.appendChild(el('dt', null, label));
      dl.appendChild(el('dd', null, String(val)));
    });
    return any ? dl : null;
  }

  function criterionField(key, label, value, type) {
    const item = el('div', 'criterion');
    item.dataset.key = key;
    const top = el('div', 'criterion-top');
    top.appendChild(el('span', 'criteria-label', label));
    const remove = el('button', 'chip-remove', 'Убрать');
    remove.type = 'button';
    remove.addEventListener('click', () => item.remove());
    top.appendChild(remove);
    item.appendChild(top);
    const inp = document.createElement('input');
    inp.type = type || 'text';
    inp.value = value;
    inp.dataset.key = key;
    inp.setAttribute('aria-label', label);
    item.appendChild(inp);
    return item;
  }

  function renderRecognizedSummary(p) {
    const panel = el('div', 'criteria-panel glass recog-summary');
    panel.appendChild(el('h2', null, 'Распознанные признаки'));
    panel.appendChild(
      el(
        'p',
        'understood-phrase',
        'Технический разбор запроса. Менять фильтры удобнее чипсами над строкой поиска — этот блок сам не открывается после поиска.'
      )
    );
    const line = summaryLine(p);
    panel.appendChild(el('p', 'criterion-value', line));
    if (p.search_phrase) {
      const phraseRow = el('div', 'criteria-actions');
      phraseRow.appendChild(el('p', 'understood-phrase', 'Поисковая фраза: «' + p.search_phrase + '»'));
      const copyBtn = el('button', 'btn btn-ghost', 'Копировать фразу');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(p.search_phrase);
          setStatus('Фраза скопирована.', 'ok');
        } catch (_) {
          setStatus('Не удалось скопировать фразу.', 'error');
        }
      });
      phraseRow.appendChild(copyBtn);
      panel.appendChild(phraseRow);
    }
    const apply = el('button', 'btn btn-ghost', 'Подставить в критерии');
    apply.type = 'button';
    apply.addEventListener('click', () => {
      if (Criteria && userCriteriaHost) {
        if (criteriaApi && criteriaApi.destroy) criteriaApi.destroy();
        criteriaApi = Criteria.mount(userCriteriaHost, Criteria.stateFromParsed(p), {});
      }
      setStatus('Критерии обновлены из распознавания. Нажмите «Искать».', 'ok');
      if (userCriteriaHost) {
        userCriteriaHost.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }
    });
    panel.appendChild(apply);
    return panel;
  }

  const HISTORY_KEY = 'vishfind-history';

  function hintList(p, triedPhotoWithoutAi, success) {
    const hints = [];
    if (!p) return hints;
    if (triedPhotoWithoutAi) {
      hints.push({ text: 'Опишите вещь текстом, чтобы получить ссылки', insert: '' });
    }
    if (!p.color) hints.push({ text: 'Уточните цвет вещи', insert: '' });
    if (!p.category) hints.push({ text: 'Укажите тип одежды: куртка, джинсы, платье и т. д.', insert: '' });
    if (
      (p.budget == null || p.budget === '') &&
      (p.budget_max == null || p.budget_max === '') &&
      (p.budget_min == null || p.budget_min === '')
    ) {
      hints.push({ text: 'Укажите цену «от» / «до» в критериях', insert: '' });
    }
    if (!p.size) hints.push({ text: 'Укажите размер', insert: 'размер' });
    if (!p.brand) hints.push({ text: 'Добавьте бренд, если он важен', insert: '' });
    if (success) {
      const blob = [p.rest, p.category, p.color, p.brand, p.search_phrase].filter(Boolean).join(' ').toLowerCase();
      if (!/хлопок|кожа|шерст|деним|лён|лен|шёлк|шелк|джинс|материал/.test(blob)) {
        hints.push({ text: 'Уточните материал', insert: '' });
      }
      if (!/винтаж|стиль|oversize|90/.test(blob)) {
        hints.push({ text: 'Уточните стиль', insert: '' });
      }
      if (!/новое|новый|винтаж|состояние|б\/у/.test(blob)) {
        hints.push({ text: 'Укажите состояние: новое или винтаж', insert: '' });
      }
    }
    return hints.slice(0, 4);
  }

  function applyHint(hint) {
    const extra = String(hint.insert || '').trim();
    const cur = input.value.trim();
    if (extra && !cur.toLowerCase().includes(extra.toLowerCase())) {
      input.value = (cur ? cur + ' ' : '') + extra;
    }
    input.focus();
    const end = input.value.length;
    try { input.setSelectionRange(end, end); } catch (_) { /* поле может быть недоступно */ }
    const box = document.getElementById('search');
    if (box) box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }

  function renderSmartHints(p, triedPhotoWithoutAi, success) {
    const host = document.getElementById('smart-hints-body');
    if (!host) return;
    host.replaceChildren();
    if (!p) {
      if (examplesEl) examplesEl.hidden = false;
      return;
    }
    if (examplesEl) examplesEl.hidden = true;
    const hints = hintList(p, triedPhotoWithoutAi, success);
    if (!hints.length) {
      host.appendChild(
        el('p', 'hints-note', 'Можно уточнить запрос или открыть «Что распозналось?»')
      );
      return;
    }
    const row = el('div', 'hints hints-compact-row');
    const primary = hints.slice(0, 3);
    const extra = hints.slice(3);
    primary.forEach((hint) => {
      const btn = el('button', 'hint', hint.text);
      btn.type = 'button';
      btn.addEventListener('click', () => applyHint(hint));
      row.appendChild(btn);
    });
    if (extra.length) {
      const more = el('button', 'hint hint-more', 'Ещё');
      more.type = 'button';
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => {
        const open = more.getAttribute('aria-expanded') !== 'true';
        more.setAttribute('aria-expanded', open ? 'true' : 'false');
        more.hidden = open;
        extra.forEach((hint) => {
          const btn = el('button', 'hint', hint.text);
          btn.type = 'button';
          btn.addEventListener('click', () => applyHint(hint));
          row.appendChild(btn);
        });
      });
      row.appendChild(more);
    }
    host.appendChild(row);
    staggerIn(row.querySelectorAll('.hint'));
  }

  function safeUrl(u) {
    return /^https?:\/\//i.test(u || '') ? u : null;
  }

  function showSkeleton() {
    if (resultsSection) {
      resultsSection.hidden = false;
      resultsSection.classList.add('is-loading');
    }
    if (hero) hero.classList.add('is-compact');
    document.body.classList.add('has-results');
    const wave = el('div', 'search-wave');
    wave.setAttribute('role', 'status');
    wave.setAttribute('aria-label', 'Идёт поиск');
    for (let i = 0; i < 5; i += 1) wave.appendChild(document.createElement('span'));
    const box = el('div', 'skel skel-cards');
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i += 1) box.appendChild(el('div', 'skel-card'));
    resultsBody.replaceChildren(wave, box);
  }

  function markResultsReady() {
    if (resultsSection) {
      resultsSection.hidden = false;
      resultsSection.classList.remove('is-loading');
    }
    if (hero) hero.classList.add('is-compact');
    document.body.classList.add('has-results');
  }

  function waitAtLeast(started) {
    const elapsed = Date.now() - started;
    if (elapsed >= 1000) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, 1500 - elapsed));
  }

  function staggerIn(nodes) {
    nodes.forEach((node, i) => {
      node.classList.add('is-in');
      if (!reduceMotion) node.style.animationDelay = Math.min(i, 8) * 45 + 'ms';
    });
  }

  function buildSearchUrl(template, phrase, budget, sourceId) {
    let url = template.replace('{q}', encodeURIComponent(phrase));
    if (budget != null && sourceId === 'yandex_market') {
      url += (url.includes('?') ? '&' : '?') + 'priceto=' + encodeURIComponent(String(budget));
    }
    return url;
  }

  function phraseFromAttrs(p) {
    const parts = [p.brand, p.color, p.category, p.rest].filter(Boolean);
    if (p.size) parts.push('размер ' + p.size);
    return parts.join(' ').replace(/\s+/g, ' ').trim() || p.search_phrase;
  }

  async function resizeImage(file) {
    if (!ALLOWED.includes(file.type) && !/\.(jpe?g|png|webp|gif)$/i.test(file.name || '')) {
      throw new Error('Нужен JPG, PNG, WebP или GIF.');
    }
    if (file.size > MAX_FILE) throw new Error('Файл больше 8 МБ.');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const out = c.toDataURL('image/jpeg', 0.82);
          const approx = Math.floor((out.length * 3) / 4);
          if (approx > MAX_DATA) reject(new Error('После сжатия фото всё ещё слишком большое.'));
          else resolve(out);
        };
        img.onerror = () => reject(new Error('Не удалось обработать изображение.'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function clearPhoto() {
    imageDataUrl = null;
    if (fileInput) fileInput.value = '';
    if (preview) preview.hidden = true;
    if (previewImg) previewImg.removeAttribute('src');
    if (photoBtn) photoBtn.classList.remove('is-active');
    if (preview) preview.classList.remove('is-analyzing', 'is-ready', 'is-fail');
  }

  function setReady(state, label) {
    if (!ready || !readyLabel) return;
    ready.classList.remove('is-idle', 'is-down');
    if (state) ready.classList.add(state);
    readyLabel.textContent = label;
  }

  async function takePhoto(file) {
    if (!file || busy || !aiEnabled) return;
    try {
      if (photoMeta) photoMeta.textContent = 'Загрузка';
      setStatus('Загрузка фото…');
      imageDataUrl = await resizeImage(file);
      previewImg.src = imageDataUrl;
      preview.hidden = false;
      photoBtn.classList.add('is-active');
      setPhotoStatus('ready');
      setStatus('Фото готово. Нажмите «Искать».', 'ok');
    } catch (e) {
      clearPhoto();
      setStatus(e.message || 'Ошибка фото', 'error');
    }
  }

  const CURRENCY_SYMBOL = { RUB: '₽', USD: '$', EUR: '€' };

  function formatOfferPrice(offer) {
    const n = Number(offer && offer.price);
    if (!Number.isFinite(n)) return '';
    const code = String((offer && offer.currency) || '').toUpperCase();
    const sym = CURRENCY_SYMBOL[code] || code;
    return (n.toLocaleString('ru-RU') + ' ' + sym).trim();
  }

  function formatOfferDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  }

  function offerCurrency(offer) {
    return String((offer && offer.currency) || 'RUB').toUpperCase();
  }

  /** Сортировка без выдуманного курса: цена только внутри одной валюты. */
  function compareClientOffers(a, b, mode) {
    if (mode === 'source') return String(a.source || '').localeCompare(String(b.source || ''), 'ru');
    if (mode === 'score') {
      const sd = (Number(b.score) || 0) - (Number(a.score) || 0);
      if (sd) return sd;
    }
    const ca = offerCurrency(a);
    const cb = offerCurrency(b);
    if (ca === 'RUB' && cb !== 'RUB') return -1;
    if (cb === 'RUB' && ca !== 'RUB') return 1;
    if (ca !== cb) return ca.localeCompare(cb);
    const pa = Number(a && a.price);
    const pb = Number(b && b.price);
    const fa = Number.isFinite(pa) ? pa : Number.POSITIVE_INFINITY;
    const fb = Number.isFinite(pb) ? pb : Number.POSITIVE_INFINITY;
    return fa - fb;
  }

  let pickedOffers = [];

  function offerKey(o) {
    return [o && o.title, o && o.price, o && o.source, o && o.is_demo].join('|');
  }

  function loadSaved() {
    if (!Saved) return [];
    const res = Saved.loadSaved(window.localStorage);
    if (res.error && res.list.length === 0) {
      setStatus(res.error, 'error');
    } else if (res.migrated) {
      setStatus('Избранное обновлено: старые записи приведены к понятным названиям.', 'ok');
    }
    return res.list;
  }

  function writeSaved(list) {
    if (!Saved) {
      setStatus('Модуль избранного не загружен.', 'error');
      return false;
    }
    const res = Saved.writeSaved(window.localStorage, list);
    if (!res.ok) {
      setStatus(res.error || 'Не удалось сохранить избранное.', 'error');
      return false;
    }
    return true;
  }

  function thingName(parsed, query, photoUsed) {
    const q = String(query || '').replace(/\s+/g, ' ').trim();
    const p = parsed || {};
    const known = [p.color, p.category, p.brand].filter((part) => part && String(part).trim()).map((part) => String(part).trim());
    if (photoUsed && known.length) return capitalizeThing(known.join(' '));
    if (q) return capitalizeThing(Saved ? Saved.titleFromQuery(q) : titleFromQuery(q));
    if (known.length) return capitalizeThing(known.join(' '));
    if (p.search_phrase) return capitalizeThing(String(p.search_phrase).trim());
    return q;
  }

  function titleFromQuery(query) {
    if (Saved) return Saved.titleFromQuery(query);
    let text = String(query || '');
    text = text.replace(/\bдо\s+\d[\d\s\u00a0]*\s*(₽|руб\.?|р\b)?/gi, ' ');
    text = text.replace(/\bразмер\s+[a-zA-Zа-яА-ЯёЁ0-9]+/gi, ' ');
    text = text.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text || String(query || '').replace(/\s+/g, ' ').trim();
  }

  function capitalizeThing(text) {
    const value = String(text || '').trim();
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function savedSame(a, b) {
    if (Saved) return Saved.savedSame(a, b);
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'query') return a.query === b.query && a.search_type === b.search_type;
    if (a.type === 'link') return a.url === b.url;
    return (a.item || a.title) === (b.item || b.title) && a.price === b.price && a.url === b.url;
  }

  function updateSavedCount() {
    const badge = document.getElementById('saved-count');
    const n = loadSaved().length;
    if (badge) {
      if (n > 0) {
        badge.hidden = false;
        badge.textContent = String(n);
      } else {
        badge.hidden = true;
        badge.textContent = '';
      }
    }
    if (btnSaved) {
      btnSaved.setAttribute('aria-label', n ? 'Избранное, записей: ' + n : 'Избранное');
    }
  }

  function closeSheet() {
    if (!sheetEl || sheetEl.hidden) return;
    sheetEl.hidden = true;
    document.body.classList.remove('sheet-open');
    document.body.style.top = '';
    window.scrollTo(0, sheetScrollY || 0);
    if (btnSaved) btnSaved.setAttribute('aria-expanded', 'false');
    if (btnHistory) btnHistory.setAttribute('aria-expanded', 'false');
    const opener = sheetOpener;
    sheetOpener = null;
    sheetMode = null;
    if (opener && typeof opener.focus === 'function') {
      try { opener.focus(); } catch (_) { /* ignore */ }
    }
  }

  function openSheet(mode, opener) {
    if (!sheetEl || !sheetTitle || !sheetBody) return;
    if (!sheetEl.hidden && sheetMode === mode) {
      closeSheet();
      return;
    }
    sheetMode = mode;
    sheetOpener = opener || document.activeElement;
    sheetScrollY = window.scrollY || 0;
    document.body.style.top = '-' + sheetScrollY + 'px';
    document.body.classList.add('sheet-open');
    sheetEl.hidden = false;
    sheetTitle.textContent = mode === 'saved' ? 'Избранное' : 'История запросов';
    if (sheetToolbar) {
      sheetToolbar.replaceChildren();
      sheetToolbar.hidden = true;
      if (mode === 'history') {
        const clearBtn = el('button', 'btn btn-ghost', 'Очистить историю');
        clearBtn.type = 'button';
        clearBtn.hidden = loadHistory().length === 0;
        clearBtn.addEventListener('click', () => {
          saveHistory([]);
          renderHistory();
        });
        sheetToolbar.appendChild(clearBtn);
        sheetToolbar.hidden = false;
      }
    }
    if (btnSaved) btnSaved.setAttribute('aria-expanded', mode === 'saved' ? 'true' : 'false');
    if (btnHistory) btnHistory.setAttribute('aria-expanded', mode === 'history' ? 'true' : 'false');
    if (mode === 'saved') renderSaved();
    else renderHistory();
    const closeBtn = document.getElementById('sheet-close');
    try { (closeBtn || sheetEl.querySelector('.sheet-panel')).focus(); } catch (_) { /* ignore */ }
  }

  function addSaved(item) {
    const entry = Object.assign({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
    }, item);
    const normalized = Saved ? Saved.normalizeSavedItem(entry).item : entry;
    if (!normalized) {
      setStatus('Не удалось подготовить запись избранного.', 'error');
      return;
    }
    const list = loadSaved().filter((row) => !savedSame(row, normalized));
    list.unshift(normalized);
    if (!writeSaved(list)) return;
    renderSaved();
    setStatus('Сохранено в избранное.', 'ok');
  }

  function removeSaved(id) {
    if (!writeSaved(loadSaved().filter((row) => row.id !== id))) return;
    renderSaved();
  }

  function renameSaved(id) {
    const next = window.prompt('Новое название сохранённой записи');
    if (next == null) return;
    if (!Saved) return;
    const renamed = Saved.renameSavedItem(loadSaved(), id, next);
    if (renamed.error) {
      setStatus(renamed.error, 'error');
      return;
    }
    if (!writeSaved(renamed.list)) return;
    renderSaved();
    setStatus('Название обновлено.', 'ok');
  }

  function formatSavedDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderSaved() {
    updateSavedCount();
    if (sheetMode !== 'saved' || !sheetBody) return;
    const list = loadSaved();
    sheetBody.replaceChildren();
    if (!list.length) {
      sheetBody.appendChild(el('p', 'empty', 'Пока ничего не сохранено. Добавляйте ссылки и запросы кнопкой «В избранное».'));
      return;
    }
    const ul = el('ul', 'saved-list');
    list.forEach((item) => {
      const card = el('li', 'saved-card glass');
      const kind = item.type === 'link' ? 'Ссылка' : item.type === 'offer' ? 'Предложение' : 'Запрос';
      card.appendChild(el('p', 'saved-kind', kind));
      if (item.type === 'query') {
        card.appendChild(el('p', 'saved-title', item.item || item.query || 'Пустой запрос'));
        const meta = [(item.search_type === 'photo' ? 'Фото' : 'Текст'), formatSavedDate(item.at)].filter(Boolean);
        card.appendChild(el('p', 'saved-meta', meta.join(' · ')));
        if (item.query && item.item && item.query !== item.item) {
          card.appendChild(el('p', 'saved-query', item.query));
        }
        const again = el('button', 'btn btn-ghost', 'Повторить');
        again.type = 'button';
        again.addEventListener('click', () => {
          input.value = item.query || item.item || '';
          closeSheet();
          runSearch();
        });
        card.appendChild(again);
      } else if (item.type === 'link') {
        card.appendChild(el('p', 'saved-title', item.item || item.title || 'Сохранённый поиск'));
        const meta = [item.place, formatSavedDate(item.at)].filter(Boolean);
        card.appendChild(el('p', 'saved-meta', meta.join(' · ')));
        if (item.url) {
          const a = el('a', 'btn', 'Открыть');
          a.href = item.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          card.appendChild(a);
        }
      } else {
        card.appendChild(el('p', 'saved-title', item.item || item.title || 'Предложение'));
        const price = item.price == null ? 'Цена не указана' : formatOfferPrice(item);
        const bits = [price, item.place || item.source, item.is_demo ? 'Демо' : 'Реальное', formatSavedDate(item.at)].filter(Boolean);
        card.appendChild(el('p', 'saved-meta', bits.join(' · ')));
        if (item.needs_rename) {
          card.appendChild(el('p', 'saved-query', 'Название вещи неизвестно — можно переименовать.'));
        }
        if (item.url) {
          const a = el('a', 'btn', 'Открыть');
          a.href = item.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          card.appendChild(a);
        }
      }
      if (item.needs_rename || item.type === 'link' || item.type === 'query' || item.type === 'offer') {
        const rename = el('button', 'btn btn-ghost', 'Переименовать');
        rename.type = 'button';
        rename.addEventListener('click', () => renameSaved(item.id));
        card.appendChild(rename);
      }
      const del = el('button', 'btn btn-ghost', 'Удалить');
      del.type = 'button';
      del.addEventListener('click', () => removeSaved(item.id));
      card.appendChild(del);
      ul.appendChild(card);
    });
    sheetBody.appendChild(ul);
  }

  function togglePick(o) {
    if (!o || o.is_demo !== false) return;
    const key = offerKey(o);
    const idx = pickedOffers.findIndex((item) => item.key === key);
    if (idx >= 0) pickedOffers.splice(idx, 1);
    else {
      if (pickedOffers.length >= 2) pickedOffers.shift();
      pickedOffers.push({
        key,
        title: o.title || 'Без названия',
        price: Number.isFinite(Number(o.price)) ? Number(o.price) : null,
        currency: o.currency || '',
        source: o.source || '',
        is_demo: false,
        url: safeUrl(o.url) || '',
      });
    }
    renderCompare();
  }

  function renderCompare() {
    const host = document.getElementById('compare-slot');
    if (!host) return;
    host.replaceChildren();
    if (pickedOffers.length < 2) {
      if (pickedOffers.length === 1) host.appendChild(el('p', 'compare-hint', 'Выберите ещё одно предложение.'));
      return;
    }
    const box = el('div', 'compare glass');
    const head = el('div', 'compare-head');
    head.appendChild(el('h2', null, 'Сравнение'));
    const close = el('button', 'btn btn-ghost', 'Закрыть');
    close.type = 'button';
    close.addEventListener('click', () => {
      pickedOffers = [];
      renderCompare();
      document.querySelectorAll('.offers-row.is-picked').forEach((row) => row.classList.remove('is-picked'));
    });
    head.appendChild(close);
    box.appendChild(head);
    const grid = el('div', 'compare-grid');
    pickedOffers.forEach((item) => {
      const card = el('article', 'compare-card');
      card.appendChild(el('p', 'offers-name', item.title));
      const price = item.price == null ? 'Цена не указана' : formatOfferPrice(item);
      card.appendChild(el('p', 'offers-price', price));
      card.appendChild(el('p', 'offers-meta', item.source || 'Источник не указан'));
      card.appendChild(el('p', 'offers-meta', item.is_demo ? 'Демо' : 'Реальное предложение'));
      const url = safeUrl(item.url);
      let hostName = '';
      try { hostName = url ? new URL(url).hostname : ''; } catch (_) { hostName = ''; }
      const real = url && !item.is_demo && hostName !== 'demo.local' && !hostName.endsWith('.demo.local');
      if (real) {
        const a = el('a', 'btn', 'Открыть');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        card.appendChild(a);
      }
      grid.appendChild(card);
    });
    box.appendChild(grid);
    host.appendChild(box);
  }

  /** Реальные предложения провайдера (is_demo === false). Демо не показываем как выдачу. */
  function renderRealOffersBlock(offers) {
    if (!offers || typeof offers !== 'object' || !Array.isArray(offers.items)) return null;
    const realItems = offers.items.filter((o) => o && o.is_demo === false);
    if (!realItems.length) return null;

    const box = el('div', 'understood glass offers');
    box.appendChild(el('h2', null, 'Предложения'));
    box.appendChild(
      el(
        'p',
        'offers-note',
        'Карточки от подключённого провайдера. Цена и наличие проверяются на площадке.'
      )
    );

    let mode = 'score';
    const tools = el('div', 'offer-tools');
    const list = el('ul', 'offers-list');

    function paint() {
      const rows = realItems.slice().sort((a, b) => compareClientOffers(a, b, mode));
      list.replaceChildren();
      rows.forEach((o) => {
        const li = el('li', 'offers-row is-real');
        const main = document.createElement('div');
        main.className = 'offers-main';
        main.appendChild(el('p', 'offers-name', o.title || 'Без названия'));
        const metaBits = [o.source, o.brand, o.category, o.color, o.size ? 'размер ' + o.size : null].filter(Boolean);
        main.appendChild(el('p', 'offers-meta', metaBits.join(' · ')));
        const price = el('p', 'offers-price', formatOfferPrice(o));
        if (o.condition) price.appendChild(el('span', 'offers-cond', ' ' + o.condition));
        main.appendChild(price);
        const date = formatOfferDate(o.updated_at);
        if (date) main.appendChild(el('p', 'offers-updated', 'Обновлено: ' + date));
        li.appendChild(main);
        li.dataset.offerKey = offerKey(o);
        const url = safeUrl(o.url);
        let hostName = '';
        try { hostName = url ? new URL(url).hostname : ''; } catch (_) { hostName = ''; }
        const realLink = url && hostName !== 'demo.local' && !hostName.endsWith('.demo.local');
        if (realLink) {
          const a = el('a', 'btn offers-open', 'Открыть у продавца');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          li.appendChild(a);
        }
        const actions = el('div', 'source-actions');
        const pick = el('button', 'btn btn-ghost', pickedOffers.some((item) => item.key === offerKey(o)) ? 'В сравнении' : 'Сравнить');
        pick.type = 'button';
        if (pickedOffers.some((item) => item.key === offerKey(o))) li.classList.add('is-picked');
        pick.addEventListener('click', (e) => {
          e.stopPropagation();
          togglePick(o);
          paint();
        });
        actions.appendChild(pick);
        const saveOffer = el('button', 'btn btn-ghost', 'В избранное');
        saveOffer.type = 'button';
        saveOffer.addEventListener('click', (e) => {
          e.stopPropagation();
          const parsed = (lastData && lastData.parsed) || {};
          const queryText = (lastArgs && lastArgs.query) || input.value.trim();
          const fallback = thingName(parsed, queryText, !!(lastData && lastData.photo_used));
          addSaved({
            type: 'offer',
            item: o.title || fallback || 'Предложение',
            title: o.title || fallback || 'Предложение',
            price: Number.isFinite(Number(o.price)) ? Number(o.price) : null,
            currency: o.currency || '',
            is_demo: false,
            url: realLink ? url : '',
            source: o.source || '',
            place: o.source || '',
            query: queryText,
            search_type: lastData && lastData.photo_used ? 'photo' : 'text',
          });
        });
        actions.appendChild(saveOffer);
        li.appendChild(actions);
        list.appendChild(li);
      });
    }

    function tool(label, value) {
      const btn = el('button', 'btn btn-ghost', label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        mode = value;
        tools.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.value === mode));
        paint();
      });
      btn.dataset.value = value;
      if (value === mode) btn.classList.add('is-on');
      tools.appendChild(btn);
    }
    tool('По релевантности', 'score');
    tool('По цене', 'price');
    tool('По источнику', 'source');
    box.appendChild(tools);
    box.appendChild(list);
    paint();
    return box;
  }

  /** Статичные рекламные слоты у подвала — не результаты поиска и не фильтр по запросу. */
  function renderAdPlacement() {
    if (!adBody) return;
    adBody.replaceChildren();
    const list = el('ul', 'ad-slots');
    const slots = [
      { title: 'Рекламное место', note: 'Демонстрация размещения' },
      { title: 'Рекламное место', note: 'Демонстрация размещения' },
      { title: 'Рекламное место', note: 'Демонстрация размещения' },
    ];
    slots.forEach((slot, i) => {
      const li = el('li', 'ad-slot glass');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', slot.title + ' ' + (i + 1) + '. Подсказка о рекламе');
      li.appendChild(el('p', 'ad-slot-title', slot.title));
      li.appendChild(el('p', 'ad-slot-note', slot.note));
      const pop = el('div', 'ad-pop', 'Здесь могла бы быть ваша реклама');
      pop.setAttribute('role', 'tooltip');
      li.appendChild(pop);
      const toggleAd = () => {
        const open = !li.classList.contains('is-ad');
        list.querySelectorAll('.ad-slot.is-ad').forEach((row) => row.classList.remove('is-ad'));
        if (open) li.classList.add('is-ad');
      };
      li.addEventListener('click', () => toggleAd());
      li.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleAd();
      });
      list.appendChild(li);
    });
    adBody.appendChild(list);
  }

  const DISPLAY_GROUP_ORDER = [
    'Официальный магазин бренда',
    'Реселлеры и ресейл',
    'Другие места поиска',
    'Маркетплейсы',
  ];

  function sourceGroup(source) {
    if (source && source.display_group_label) return source.display_group_label;
    const g = source && source.display_group;
    if (g === 'official') return 'Официальный магазин бренда';
    if (g === 'reseller') return 'Реселлеры и ресейл';
    if (g === 'other') return 'Другие места поиска';
    if (g === 'marketplace_tail') return 'Маркетплейсы';
    if (source && (source.link_kind === 'official_store_entry' || source.type === 'official_store')) {
      return 'Официальный магазин бренда';
    }
    const id = String((source && source.id) || '');
    if (id === 'ozon' || id === 'wildberries' || id === 'yandex_market') return 'Маркетплейсы';
    if (id === 'avito' || id === 'lamoda' || id === 'lamoda_ru') return 'Другие места поиска';
    if (id === 'ebay' || id === 'vestiaire') return 'Реселлеры и ресейл';
    return 'Другие места поиска';
  }

  function openLinkLabel(source) {
    const kind = source && source.link_kind;
    if (kind === 'official_store_entry') return 'Официальный сайт';
    if (kind === 'store_entry') return 'Открыть каталог';
    if (source && source.phrase_accepts_query === false) return 'Открыть каталог';
    return 'Открыть поиск';
  }

  function sourceDisplayKey(source) {
    const g = source && source.display_group;
    if (g === 'official' || g === 'reseller' || g === 'other' || g === 'marketplace_tail') return g;
    const title = sourceGroup(source);
    if (title === 'Официальный магазин бренда') return 'official';
    if (title === 'Реселлеры и ресейл') return 'reseller';
    if (title === 'Маркетплейсы') return 'marketplace_tail';
    return 'other';
  }

  function phraseForCopy(source, parsed) {
    const prepared = source && source.search_phrase_used;
    if (prepared && String(prepared).trim()) {
      return { text: String(prepared).trim(), note: null };
    }
    const general =
      (parsed && parsed.search_phrase)
      || (lastArgs && lastArgs.query)
      || input.value.trim()
      || '';
    if (!general) return { text: '', note: 'Нет подготовленной фразы для копирования.' };
    return {
      text: String(general).trim(),
      note: 'Общий нормализованный запрос (отдельная адаптация для площадки не сформирована).',
    };
  }

  async function copyTextWithFeedback(text, okMsg) {
    const value = String(text || '').trim();
    if (!value) {
      setStatus('Нечего копировать.', 'error');
      return false;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        setStatus(okMsg || 'Скопировано.', 'ok');
        return true;
      }
      throw new Error('clipboard unavailable');
    } catch (_) {
      const box = el('div', 'understood glass copy-fallback');
      box.appendChild(el('p', 'understood-phrase', 'Скопируйте текст вручную:'));
      const pre = el('pre', 'copy-fallback-text', value);
      pre.setAttribute('tabindex', '0');
      box.appendChild(pre);
      try {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) { /* ignore */ }
      resultsBody.prepend(box);
      setStatus('Буфер обмена недоступен — текст выделен для ручного копирования.', 'error');
      return false;
    }
  }

  function renderPassedDetails(source) {
    const details = Array.isArray(source.filter_details) ? source.filter_details : [];
    const applied = details.filter((d) => d && d.kind === 'applied');
    const inQuery = details.filter((d) => d && d.kind === 'in_query');
    const manual = details.filter((d) => d && (d.kind === 'manual' || d.kind === 'error' || d.kind === 'info'));
    const isVitrine =
      source.link_kind === 'store_entry'
      || source.link_kind === 'official_store_entry'
      || source.phrase_accepts_query === false;

    const more = el('details', 'source-filters source-passed');
    more.appendChild(el('summary', null, 'Что передано'));
    const wrap = el('div', 'source-passed-body');

    if (isVitrine && !applied.length && !(source.phrase_accepts_query === true)) {
      wrap.appendChild(
        el(
          'p',
          'source-note',
          'Открывается каталог. Запрос и критерии автоматически не передаются.'
        )
      );
    }

    if (applied.length) {
      wrap.appendChild(el('p', 'source-passed-label', 'Передано фильтрами'));
      const ul = el('ul', 'source-filter-list');
      applied.forEach((d) => {
        if (d && d.text) ul.appendChild(el('li', 'is-applied', d.text));
      });
      wrap.appendChild(ul);
    }

    if (inQuery.length) {
      wrap.appendChild(el('p', 'source-passed-label', 'Добавлено в поисковую фразу'));
      const ul = el('ul', 'source-filter-list');
      inQuery.forEach((d) => {
        if (d && d.text) ul.appendChild(el('li', 'is-in_query', d.text));
      });
      wrap.appendChild(ul);
    }

    const needManual = manual.filter((d) => d && d.kind !== 'info');
    if (needManual.length) {
      wrap.appendChild(el('p', 'source-passed-label', 'Нужно уточнить на сайте'));
      const ul = el('ul', 'source-filter-list');
      needManual.forEach((d) => {
        if (d && d.text) ul.appendChild(el('li', 'is-manual', d.text));
      });
      wrap.appendChild(ul);
    }

    const infos = manual.filter((d) => d && d.kind === 'info');
    infos.forEach((d) => {
      if (d && d.text) wrap.appendChild(el('p', 'source-note', d.text));
    });

    if (!wrap.childNodes.length) {
      wrap.appendChild(el('p', 'source-note', 'Дополнительные критерии в ссылку не добавлялись.'));
    }

    const ver = source.verification_level;
    if (ver === 'price_url_verified') {
      wrap.appendChild(el('p', 'source-note', 'Фильтр цены в URL ранее подтверждён.'));
    } else if (ver === 'base_url_only') {
      wrap.appendChild(el('p', 'source-note', 'Базовый переход; штатные фильтры кроме указанных не подтверждены.'));
    }

    more.appendChild(wrap);
    return more;
  }

  function renderSourceCard(source, thing, parsed) {
    const card = el('li', 'source-card');
    card.dataset.group = sourceDisplayKey(source);
    const head = el('div', 'source-card-head');
    const name = source.name || 'Площадка';
    head.appendChild(el('span', 'source-mark', name.trim().charAt(0).toUpperCase() || '?'));
    const titles = document.createElement('div');
    titles.appendChild(el('p', 'source-name', name));
    const metaBits = [];
    if (source.type_label || source.type) metaBits.push(source.type_label || source.type);
    if (source.link_label) metaBits.push(source.link_label);
    else if (source.link_kind === 'store_entry') metaBits.push('витрина магазина');
    else if (source.link_kind === 'official_store_entry') metaBits.push('официальный сайт');
    titles.appendChild(el('p', 'source-meta', metaBits.join(' · ')));
    head.appendChild(titles);
    card.appendChild(head);
    const url = safeUrl(source.url);
    const actions = el('div', 'source-actions');
    if (url) {
      const a = el('a', 'btn', openLinkLabel(source));
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      actions.appendChild(a);

      const copyPhrase = el('button', 'btn btn-ghost', 'Скопировать запрос');
      copyPhrase.type = 'button';
      copyPhrase.addEventListener('click', async () => {
        const pack = phraseForCopy(source, parsed);
        if (pack.note && !source.search_phrase_used) {
          const ok = await copyTextWithFeedback(pack.text, 'Запрос скопирован.');
          if (ok) setStatus('Запрос скопирован. ' + pack.note, 'ok');
          return;
        }
        await copyTextWithFeedback(pack.text, 'Запрос скопирован.');
      });
      actions.appendChild(copyPhrase);

      const copy = el('button', 'btn btn-ghost', 'Копировать ссылку');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        await copyTextWithFeedback(url, 'Ссылка скопирована.');
      });
      actions.appendChild(copy);

      const saveLink = el('button', 'btn btn-ghost', 'В избранное');
      saveLink.type = 'button';
      saveLink.addEventListener('click', () => {
        const label = thing || name;
        addSaved({
          type: 'link',
          item: label,
          title: label,
          place: name,
          url: url,
          query: (lastArgs && lastArgs.query) || input.value.trim(),
          search_type: lastData && lastData.photo_used ? 'photo' : 'text',
        });
      });
      actions.appendChild(saveLink);
    }
    card.appendChild(actions);
    if (!url && source.error) {
      card.appendChild(el('p', 'source-note is-error', source.error));
      return card;
    }

    const details = Array.isArray(source.filter_details) ? source.filter_details : [];
    const applied = details.filter((d) => d && d.kind === 'applied');
    if (source.price_filter_applied || applied.length) {
      card.appendChild(
        el(
          'p',
          'source-note is-applied',
          applied.length
            ? applied.map((d) => d.text).join(' ')
            : 'В ссылку добавлен проверенный фильтр цены.'
        )
      );
    } else if (source.budget_in_query) {
      card.appendChild(
        el('p', 'source-note', 'Бюджет добавлен в поисковый запрос. Диапазон уточните на сайте.')
      );
    }

    card.appendChild(renderPassedDetails(source));
    return card;
  }

  function focusQuery() {
    input.focus();
    const box = document.getElementById('search');
    if (box) box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }

  function armScrollGuard() {
    userScrolledDuringSearch = false;
    if (scrollGuardBound) return;
    scrollGuardBound = true;
    const onScroll = () => {
      if (!busy) return;
      userScrolledDuringSearch = true;
    };
    window.addEventListener('wheel', onScroll, { passive: true });
    window.addEventListener('touchmove', onScroll, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!busy) return;
      if (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End' || e.key === ' ') {
        userScrolledDuringSearch = true;
      }
    });
  }

  function scrollToResults() {
    if (userScrolledDuringSearch) return;
    const target = document.getElementById('results');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    const header = document.querySelector('.site-header');
    const headerH = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
    const narrow = window.innerWidth <= 720;
    const safeTop = headerH + (narrow ? 28 : 16);
    const bandTop = Math.max(safeTop, Math.round(vh * 0.28));
    const bandBottom = Math.round(vh * 0.62);
    if (rect.top >= bandTop && rect.top <= bandBottom && rect.bottom > vh * 0.45) return;
    const desired = Math.round(vh * 0.42);
    const top = Math.max(0, window.scrollY + rect.top - desired);
    window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function renderMarkets(sources, p, data) {
    const markets = el('div', 'understood glass');
    markets.id = 'markets-block';
    markets.appendChild(el('h2', null, 'Подходящие сайты'));
    const n = Array.isArray(sources) ? sources.length : 0;
    markets.appendChild(
      el(
        'p',
        'understood-phrase',
        'Подготовлено переходов: '
          + n
          + '. Это ссылки на поиск или каталог, а не подтверждённые товары с ценой.'
          + (p.search_phrase ? ' Общая фраза: «' + p.search_phrase + '».' : '')
      )
    );
    if (data && data.web_search && data.web_search.user_requested) {
      const webCount = Array.isArray(data.web_results) ? data.web_results.length : 0;
      markets.appendChild(
        el(
          'p',
          'understood-phrase',
          webCount
            ? 'Дополнительных веб-ссылок: ' + webCount + ' (неподтверждённые страницы).'
            : 'Дополнительных веб-ссылок нет.'
        )
      );
    }

    const filterBar = el('div', 'link-group-filters');
    filterBar.setAttribute('role', 'toolbar');
    filterBar.setAttribute('aria-label', 'Фильтр групп ссылок');
    const filterDefs = [
      { id: 'all', label: 'Все' },
      { id: 'official', label: 'Официальные' },
      { id: 'reseller', label: 'Ресейл' },
      { id: 'other', label: 'Другие сайты' },
      { id: 'marketplace_tail', label: 'Маркетплейсы' },
    ];
    const groupsHost = el('div', 'link-groups-host');

    function paintGroups() {
      groupsHost.replaceChildren();
      const filtered =
        linkGroupFilter === 'all'
          ? sources
          : sources.filter((s) => sourceDisplayKey(s) === linkGroupFilter);
      if (!filtered.length) {
        groupsHost.appendChild(
          el('p', 'understood-phrase', 'В этой группе сейчас нет ссылок. Выберите «Все» или другую группу.')
        );
        return;
      }
      const groups = new Map();
      filtered.forEach((s) => {
        const title = sourceGroup(s);
        if (!groups.has(title)) groups.set(title, []);
        groups.get(title).push(s);
      });
      const titles = [];
      DISPLAY_GROUP_ORDER.forEach((t) => {
        if (groups.has(t)) titles.push(t);
      });
      groups.forEach((_, t) => {
        if (!titles.includes(t)) titles.push(t);
      });
      const thing = thingName(p, (lastArgs && lastArgs.query) || input.value.trim(), !!(lastData && lastData.photo_used));
      titles.forEach((title) => {
        const items = groups.get(title);
        if (!items || !items.length) return;
        const group = el('div', 'source-group');
        group.appendChild(el('h3', null, title));
        const list = el('ul', 'source-cards source-list');
        items.forEach((s) => list.appendChild(renderSourceCard(s, thing, p)));
        group.appendChild(list);
        groupsHost.appendChild(group);
      });
    }

    filterDefs.forEach((def) => {
      const btn = el('button', 'btn btn-ghost link-group-filter', def.label);
      btn.type = 'button';
      btn.dataset.filter = def.id;
      if (linkGroupFilter === def.id) {
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.setAttribute('aria-pressed', 'false');
      }
      btn.addEventListener('click', () => {
        linkGroupFilter = def.id;
        filterBar.querySelectorAll('.link-group-filter').forEach((b) => {
          const on = b.dataset.filter === linkGroupFilter;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        paintGroups();
      });
      filterBar.appendChild(btn);
    });

    markets.appendChild(filterBar);
    markets.appendChild(groupsHost);
    paintGroups();
    return markets;
  }

  function renderRecognition(p, data) {
    const wrap = el('div', 'recog-wrap');
    const btn = el('button', 'btn btn-ghost recog-toggle', 'Что распозналось?');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    const drawer = el('div', 'recog');
    drawer.hidden = true;
    if (aiEnabled && data.photo_used) {
      const photoWrap = el('div', 'understood glass');
      photoWrap.appendChild(el('h2', null, 'Что видно на фото'));
      const photoBlock = renderPhotoAttrs(data.photo);
      if (photoBlock) photoWrap.appendChild(photoBlock);
      drawer.appendChild(photoWrap);
    }
    drawer.appendChild(renderRecognizedSummary(p));
    btn.addEventListener('click', () => {
      const open = drawer.hidden;
      drawer.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? 'Скрыть распознанное' : 'Что распозналось?';
    });
    wrap.appendChild(btn);
    wrap.appendChild(drawer);
    return wrap;
  }

  function renderResultsDisclaimer() {
    const note = el('p', 'results-disclaimer');
    note.textContent =
      'VishFind подбирает ссылки на сторонние сайты. '
      + 'Наличие, актуальную цену, подлинность товара '
      + 'и условия покупки проверяйте у продавца. '
      + 'Критерии могут передаваться фильтрами или текстом — '
      + 'подробнее в разделе «Что передано».';
    return note;
  }

  function renderEmpty(p, data, triedPhotoWithoutAi) {
    markResultsReady();
    const box = el('div', 'understood glass result-empty');
    box.appendChild(el('h2', null, 'Ничего не нашлось'));
    box.appendChild(
      el('p', 'understood-phrase', 'По этому запросу нет проверенных ссылок. Измените формулировку или уберите лишнее.')
    );
    const change = el('button', 'btn btn-primary', 'Изменить запрос');
    change.type = 'button';
    change.addEventListener('click', focusQuery);
    box.appendChild(change);
    resultsBody.appendChild(box);
    if (newQueryRow) {
      resultsBody.appendChild(newQueryRow);
      setNewQueryVisible(true);
    }
    resultsBody.appendChild(renderResultsDisclaimer());
    resultsBody.appendChild(renderRecognition(p, data));
    renderSmartHints(p, triedPhotoWithoutAi, true);
  }

  function userWantsWebSearch() {
    return !!(webSearchOpt && !webSearchOpt.disabled && webSearchOpt.checked && webSearchServerEnabled);
  }

  function syncWebSearchOptUi() {
    if (!webSearchOpt) return;
    webSearchOpt.disabled = !webSearchServerEnabled;
    if (!webSearchServerEnabled) {
      webSearchOpt.checked = false;
      if (webSearchHint) {
        webSearchHint.textContent =
          'Сейчас на сервере внешний поиск ссылок выключен. Локальный разбор запроса и переходы работают без него.';
      }
    } else if (webSearchHint) {
      webSearchHint.textContent =
        'При включении поисковая фраза передаётся внешнему сервису Ollama для поиска ссылок.';
    }
  }

  function renderResults(data) {
    lastData = data;
    markResultsReady();
    resultsBody.replaceChildren();
    const p = data.parsed || {};
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const realOffers = data.offers && Array.isArray(data.offers.items)
      ? data.offers.items.filter((o) => o && o.is_demo === false)
      : [];
    const triedPhotoWithoutAi = !!(imageDataUrl && !aiEnabled);

    renderSmartHints(p, triedPhotoWithoutAi, true);

    if (!sources.length && !realOffers.length) {
      renderEmpty(p, data, triedPhotoWithoutAi);
      staggerIn(resultsBody.querySelectorAll('.understood'));
      return;
    }

    if (sources.length) resultsBody.appendChild(renderMarkets(sources, p, data));
    // «Новый запрос» сразу после списка переходов, до web / вторичных / рекламы.
    if (newQueryRow) {
      resultsBody.appendChild(newQueryRow);
      setNewQueryVisible(true);
    }
    if (Array.isArray(data.web_results) && data.web_results.length) {
      const webBox = el('div', 'understood glass');
      webBox.appendChild(el('h2', null, 'Уточнение из интернета'));
      webBox.appendChild(
        el('p', 'understood-phrase', 'Неподтверждённые страницы веб-поиска — не товары с ценой.')
      );
      const ul = el('ul', 'source-list');
      data.web_results.forEach((w) => {
        const li = el('li');
        const a = el('a', null, w.title || w.url);
        a.href = w.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
        ul.appendChild(li);
      });
      webBox.appendChild(ul);
      resultsBody.appendChild(webBox);
    }

    resultsBody.appendChild(renderResultsDisclaimer());

    const secondary = el('div', 'results-secondary');
    const saveQuery = el('button', 'btn btn-ghost save-query', 'Сохранить запрос');
    saveQuery.type = 'button';
    saveQuery.addEventListener('click', () => {
      const text = (lastArgs && lastArgs.query) || input.value.trim() || p.search_phrase || '';
      if (!text) {
        setStatus('Нечего сохранять: запрос пустой.', 'error');
        return;
      }
      addSaved({
        type: 'query',
        item: thingName(p, text, !!data.photo_used),
        title: thingName(p, text, !!data.photo_used),
        query: text,
        search_type: data.photo_used ? 'photo' : 'text',
      });
    });
    secondary.appendChild(saveQuery);
    secondary.appendChild(renderRecognition(p, data));
    resultsBody.appendChild(secondary);

    const offersBlock = renderRealOffersBlock(data.offers);
    if (offersBlock) resultsBody.appendChild(offersBlock);

    staggerIn(resultsBody.querySelectorAll('.understood, .source-card, .offers-row'));
  }

  function loadHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function saveHistory(list) {
    const slim = list.slice(0, 20);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(slim));
    } catch (_) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(slim.map((item) => ({ ...item, thumb: null }))));
      } catch (__) { /* квота браузера — историю в этот раз не пишем */ }
    }
  }

  function makeThumb(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const max = 160;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', 0.7);
        resolve(out.length > 40000 ? null : out);
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function formatWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderHistory() {
    if (sheetMode !== 'history' || !sheetBody) return;
    const list = loadHistory();
    sheetBody.replaceChildren();
    if (sheetToolbar) {
      const clearBtn = sheetToolbar.querySelector('button');
      if (clearBtn) clearBtn.hidden = list.length === 0;
    }
    if (!list.length) {
      sheetBody.appendChild(el('p', 'understood-phrase', 'История пока пуста. Она хранится только в этом браузере.'));
      return;
    }
    const grid = el('div', 'history-list');
    list.forEach((item) => {
      const card = el('article', 'history-card glass');
      if (item.thumb) {
        const img = document.createElement('img');
        img.src = item.thumb;
        img.alt = '';
        card.appendChild(img);
      }
      const main = document.createElement('div');
      const open = el('button', 'history-open', item.query || (item.type === 'photo' ? 'Поиск по фото' : 'Запрос'));
      open.type = 'button';
      open.addEventListener('click', () => repeatHistory(item));
      main.appendChild(open);
      const bits = [
        item.type === 'photo' ? 'фото' : 'текст',
        formatWhen(item.at),
        typeof item.links === 'number' ? item.links + ' ссылок' : '',
        typeof item.offers === 'number' && item.offers > 0 ? item.offers + ' предложений' : '',
      ].filter(Boolean);
      main.appendChild(el('p', 'history-meta', bits.join(' · ')));
      card.appendChild(main);
      const del = el('button', 'chip-remove', 'Удалить');
      del.type = 'button';
      del.addEventListener('click', () => {
        saveHistory(loadHistory().filter((row) => row.id !== item.id));
        renderHistory();
      });
      card.appendChild(del);
      grid.appendChild(card);
    });
    sheetBody.appendChild(grid);
  }

  function repeatHistory(item) {
    if (busy) return;
    closeSheet();
    input.value = item.query || '';
      if (item.criteria && Criteria && userCriteriaHost) {
      if (criteriaApi && criteriaApi.destroy) criteriaApi.destroy();
      const restored = Criteria.stateFromParsed(item.criteria);
      restored.cleared = {};
      if (!restored.category) restored.cleared.category = true;
      if (!restored.color) restored.cleared.color = true;
      if (!restored.size) restored.cleared.size = true;
      if (!restored.brand) restored.cleared.brand = true;
      if (!restored.rest) {
        restored.cleared.rest = true;
        restored.cleared.features = true;
      }
      if (!restored.budget_min && !restored.budget_max) restored.cleared.price = true;
      criteriaApi = Criteria.mount(userCriteriaHost, restored, {});
    }
    if (item.type === 'photo' && item.thumb && aiEnabled) {
      imageDataUrl = item.thumb;
      if (previewImg) previewImg.src = item.thumb;
      if (preview) preview.hidden = false;
      if (photoMeta) photoMeta.textContent = 'Превью из истории';
      if (photoBtn) photoBtn.classList.add('is-active');
    } else {
      clearPhoto();
      if (item.type === 'photo' && item.thumb && previewImg && preview) {
        previewImg.src = item.thumb;
        preview.hidden = false;
        if (photoMeta) photoMeta.textContent = 'Загрузите фото заново';
      }
    }
    if (item.type === 'photo' && !item.thumb && !item.query) {
      setStatus('Загрузите фото заново, чтобы повторить разбор.', 'error');
      if (photoBtn && aiEnabled) photoBtn.focus();
      return;
    }
    if (item.type === 'photo' && !aiEnabled && !item.query) {
      setStatus('AI по фото сейчас недоступен. Опишите вещь текстом, чтобы получить ссылки.', 'error');
      focusQuery();
      return;
    }
    const override = { query: item.query || '' };
    if (item.criteria) {
      override.attributes = {
        category: item.criteria.category || null,
        color: item.criteria.color || null,
        size: item.criteria.size || null,
        brand: item.criteria.brand || null,
        categories: item.criteria.categories || (item.criteria.category ? [item.criteria.category] : []),
        colors: item.criteria.colors || (item.criteria.color ? [item.criteria.color] : []),
        sizes: item.criteria.sizes || (item.criteria.size ? [item.criteria.size] : []),
        brands: item.criteria.brands || (item.criteria.brand ? [item.criteria.brand] : []),
        rest: item.criteria.rest || null,
        budget_min: item.criteria.budget_min != null ? item.criteria.budget_min : null,
        budget_max:
          item.criteria.budget_max != null
            ? item.criteria.budget_max
            : item.criteria.budget != null
              ? item.criteria.budget
              : null,
        budget:
          item.criteria.budget_max != null
            ? item.criteria.budget_max
            : item.criteria.budget != null
              ? item.criteria.budget
              : null,
      };
      override.attributes_priority = true;
      // Пустые поля в сохранённых критериях не должны снова подтягиваться из текста.
      const clear = [];
      if (!item.criteria.category) clear.push('category');
      if (!item.criteria.color) clear.push('color');
      if (!item.criteria.size) clear.push('size');
      if (!item.criteria.brand) clear.push('brand');
      if (!item.criteria.rest) clear.push('rest');
      if (
        item.criteria.budget_min == null
        && item.criteria.budget_max == null
        && item.criteria.budget == null
      ) {
        clear.push('budget', 'budget_min', 'budget_max');
      }
      override.clear_attributes = clear;
    }
    runSearch(null, override);
  }

  async function rememberSearch(query, data, sentPhoto) {
    const realCount = data.offers && Array.isArray(data.offers.items)
      ? data.offers.items.filter((o) => o && o.is_demo === false).length
      : 0;
    const p = data.parsed || {};
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: sentPhoto ? 'photo' : 'text',
      query: query || '',
      at: new Date().toISOString(),
      links: Array.isArray(data.sources) ? data.sources.length : 0,
      offers: realCount,
      category: p.category || '',
      color: p.color || '',
      size: p.size || '',
      budget: p.budget != null ? p.budget : null,
      criteria: {
        category: p.category || null,
        color: p.color || null,
        size: p.size || null,
        brand: p.brand || null,
        categories: Array.isArray(p.categories) ? p.categories : p.category ? [p.category] : [],
        colors: Array.isArray(p.colors) ? p.colors : p.color ? [p.color] : [],
        sizes: Array.isArray(p.sizes) ? p.sizes : p.size ? [p.size] : [],
        brands: Array.isArray(p.brands) ? p.brands : p.brand ? [p.brand] : [],
        rest: p.rest || null,
        budget: p.budget != null ? p.budget : null,
        budget_min: p.budget_min != null ? p.budget_min : null,
        budget_max: p.budget_max != null ? p.budget_max : p.budget != null ? p.budget : null,
      },
      criteria_version: 2,
      thumb: null,
    };
    if (sentPhoto && imageDataUrl) {
      try { entry.thumb = await makeThumb(imageDataUrl); } catch (_) { entry.thumb = null; }
    }
    let list = loadHistory();
    if (entry.type === 'text') list = list.filter((item) => !(item.type === 'text' && item.query === entry.query));
    list.unshift(entry);
    saveHistory(list);
    if (sheetMode === 'history') renderHistory();
  }

  function panelSearchOptions(override) {
    if (override && override.attributes) {
      return {
        attributes: override.attributes,
        attributes_priority: !!(override && override.attributes_priority),
        clear_attributes: Array.isArray(override.clear_attributes) ? override.clear_attributes : [],
      };
    }
    if (!criteriaApi) {
      return { attributes: undefined, attributes_priority: false, clear_attributes: [] };
    }
    const priceError = criteriaApi.priceError;
    if (priceError) {
      return { error: priceError };
    }
    const attributes = criteriaApi.attributes;
    const clear_attributes = criteriaApi.clear_attributes || [];
    // Пустые массивы [] не считаются выбором — иначе priority=true затирает текст на старых серверах.
    const hasAttr = !!(attributes && (
      (Array.isArray(attributes.categories) && attributes.categories.length)
      || (Array.isArray(attributes.colors) && attributes.colors.length)
      || (Array.isArray(attributes.sizes) && attributes.sizes.length)
      || (Array.isArray(attributes.brands) && attributes.brands.length)
      || (Array.isArray(attributes.features) && attributes.features.length)
      || (attributes.category != null && attributes.category !== '')
      || (attributes.color != null && attributes.color !== '')
      || (attributes.size != null && attributes.size !== '')
      || (attributes.brand != null && attributes.brand !== '')
      || (attributes.rest != null && attributes.rest !== '')
      || (attributes.budget_min != null && attributes.budget_min !== '')
      || (attributes.budget_max != null && attributes.budget_max !== '')
      || (attributes.budget != null && attributes.budget !== '')
    ));
    const hasClear = clear_attributes.length > 0;
    return {
      attributes: hasAttr || hasClear ? attributes : undefined,
      attributes_priority: hasAttr || hasClear,
      clear_attributes,
    };
  }

  async function runSearch(ev, override) {
    if (ev) ev.preventDefault();

    // Длина: .length после trim (UTF-16), как maxlength=300 и сервер MAX_QUERY_LEN.
    let query = '';
    if (override && Object.prototype.hasOwnProperty.call(override, 'query') && override.query != null) {
      if (typeof override.query !== 'string') {
        setStatus('Запрос должен быть текстом.', 'error');
        return;
      }
      query = override.query.trim();
    } else {
      query = input.value.trim();
    }
    const packed = panelSearchOptions(override);
    if (packed.error) {
      setStatus(packed.error, 'error');
      return;
    }
    const attributes = packed.attributes;
    const attributesPriority = packed.attributes_priority;
    const clearAttributes = packed.clear_attributes || [];

    if (!query && !imageDataUrl && !attributes) {
      setStatus('Введите описание вещи или заполните критерии.', 'error');
      return;
    }
    if (query.length > 300) {
      setStatus('Запрос слишком длинный (максимум 300 символов).', 'error');
      return;
    }

    if (activeAbort) {
      try { activeAbort.abort('superseded'); } catch (_) { /* ignore */ }
    }
    const mySeq = ++searchSeq;
    const controller = new AbortController();
    activeAbort = controller;
    const timeoutMs = imageDataUrl && aiEnabled ? 100_000 : 30_000;
    const timeoutId = setTimeout(() => {
      try { controller.abort('timeout'); } catch (_) { /* ignore */ }
    }, timeoutMs);

    setBusy(true);
    armScrollGuard();
    pickedOffers = [];
    renderCompare();
    const analyzingPhoto = !!(imageDataUrl && aiEnabled);
    const sentPhoto = analyzingPhoto;
    setStatus(analyzingPhoto ? 'Смотрим фото и готовим переходы' : 'Формируем переходы');
    showSkeleton();
    scrollToResults();

    lastArgs = {
      query,
      attributes,
      attributes_priority: attributesPriority,
      clear_attributes: clearAttributes,
    };
    const started = Date.now();
    try {
      const payload = { query };
      if (attributes) payload.attributes = attributes;
      if (attributesPriority) payload.attributes_priority = true;
      if (clearAttributes.length) payload.clear_attributes = clearAttributes;
      if (imageDataUrl && aiEnabled) payload.image = imageDataUrl;
      // Opt-in: без галочки сервер не вызывает Ollama web_search.
      if (userWantsWebSearch()) payload.web_search = true;

      const r = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (mySeq !== searchSeq) return;
      let data = {};
      try {
        data = await r.json();
      } catch (_) {
        if (mySeq !== searchSeq) return;
        const err = new Error('Сервер вернул некорректный ответ.');
        err.status = r.status || 500;
        throw err;
      }
      if (!r.ok) {
        const err = new Error(data.error || 'Поиск не удался.');
        err.status = r.status;
        throw err;
      }
      await waitAtLeast(started);
      if (mySeq !== searchSeq) return;
      renderResults(data);
      if (Criteria && userCriteriaHost && data.parsed) {
        if (criteriaApi && criteriaApi.destroy) criteriaApi.destroy();
        // Синхронизация с итогом сервера + «липкий» сброс, чтобы текст не вернул очищенные поля.
        const nextState = Criteria.stateFromParsed(data.parsed);
        nextState.cleared = {};
        const cleared = clearAttributes || [];
        if (cleared.some((k) => k === 'budget' || k === 'price')) {
          nextState.cleared.price = true;
          nextState.cleared.price_min = true;
          nextState.cleared.price_max = true;
        } else {
          if (cleared.includes('budget_min')) nextState.cleared.price_min = true;
          if (cleared.includes('budget_max')) nextState.cleared.price_max = true;
        }
        if (cleared.includes('category') || cleared.includes('categories')) nextState.cleared.category = true;
        if (cleared.includes('color') || cleared.includes('colors')) nextState.cleared.color = true;
        if (cleared.includes('size') || cleared.includes('sizes')) nextState.cleared.size = true;
        if (cleared.includes('brand') || cleared.includes('brands')) nextState.cleared.brand = true;
        if (cleared.includes('rest') || cleared.includes('features')) {
          nextState.cleared.rest = true;
          nextState.cleared.features = true;
        }
        criteriaApi = Criteria.mount(userCriteriaHost, nextState, {});
      }
      renderTechDebug(data, {
        query,
        attributes,
        attributes_priority: attributesPriority,
        clear_attributes: clearAttributes,
        ms: Date.now() - started,
        seq: mySeq,
      });
      rememberSearch(query, data, sentPhoto);
      try {
        if (query) {
          const u = new URL(window.location.href);
          u.searchParams.set('q', query);
          history.replaceState(null, '', u.pathname + u.search);
        }
      } catch (_) { /* ignore */ }
      const warnList = []
        .concat((data.parsed && data.parsed.warnings) || [])
        .concat(data.warnings || [])
        .filter(Boolean);
      const warn = warnList[0];
      const linkCount = Array.isArray(data.sources) ? data.sources.length : 0;
      const webCount = Array.isArray(data.web_results) ? data.web_results.length : 0;
      let doneMsg =
        linkCount > 0
          ? 'Подготовлено переходов: ' + linkCount + '.'
          : 'Подходящих переходов нет.';
      if (webCount > 0) doneMsg += ' Доп. веб-ссылок: ' + webCount + '.';
      else if (data.web_search && data.web_search.user_requested && data.web_search.used) {
        doneMsg += ' Дополнительных веб-ссылок нет.';
      }
      if (data.photo_used) {
        doneMsg = 'Фото разобрано. ' + doneMsg;
        setPhotoStatus('ready');
      } else if (sentPhoto) {
        // Сбой vision при текстовом fallback: не показывать фото как успешное.
        setPhotoStatus('fail');
      }
      setStatus(warn || doneMsg, warn ? 'error' : 'ok');
    } catch (err) {
      if (mySeq !== searchSeq) return;
      const aborted = err && (err.name === 'AbortError' || controller.signal.aborted);
      if (aborted && controller.signal.reason === 'superseded') return;
      const status = Number(err && err.status) || 0;
      const offline = err && err.message === 'Failed to fetch';
      const timeout = aborted && controller.signal.reason === 'timeout';
      let title = 'Поиск не удался';
      let text = (err && err.message) || 'Поиск не удался.';
      if (timeout) {
        title = analyzingPhoto ? 'Фото не разобрано' : 'Сервер не ответил';
        text = analyzingPhoto
          ? 'Сервер не ответил вовремя. Успешный разбор фото не подменяется.'
          : 'Сервер не ответил вовремя.';
        if (analyzingPhoto) setPhotoStatus('fail');
      } else if (aborted) {
        if (controller.signal.reason === 'reset') {
          setStatus('Запрос отменён.', 'ok');
        }
        return;
      } else if (offline) {
        title = 'Сервер недоступен';
        text = 'Сервер недоступен. Проверьте, что сайт запущен, и попробуйте снова.';
      } else if (status === 503) {
        if (analyzingPhoto) {
          title = 'AI по фото сейчас недоступен';
          text = /перегруз|слишком много/i.test(text)
            ? text
            : 'AI по фото сейчас недоступен. Опишите вещь текстом, чтобы получить ссылки.';
          setPhotoStatus('fail');
        } else {
          title = 'Сервис временно недоступен';
        }
      } else if (status === 502) {
        title = analyzingPhoto ? 'Фото не разобрано' : 'Ошибка сервиса';
        if (analyzingPhoto) {
          text = text + ' Успешный разбор не подменяется. Текстовый поиск без фото доступен.';
          setPhotoStatus('fail');
        }
      } else if (status === 422) {
        title = 'Запрос не распознан';
      } else if (status === 400) {
        title = 'Запрос не подошёл';
      } else if (status === 413) {
        title = 'Слишком большой запрос';
      } else if (status === 429) {
        title = 'Слишком много запросов';
      } else if (status === 500) {
        title = 'Поиск не удался';
        text = 'Внутренняя ошибка. Попробуйте ещё раз.';
      }
      const errBox = el('div', 'understood glass result-error');
      errBox.appendChild(el('h2', null, title));
      errBox.appendChild(el('p', 'understood-phrase', text));
      if (offline || timeout || status === 500 || status === 503) {
        const retry = el('button', 'btn btn-primary', 'Попробовать снова');
        retry.type = 'button';
        retry.addEventListener('click', () => runSearch(null, lastArgs || undefined));
        errBox.appendChild(retry);
      } else {
        const edit = el('button', 'btn btn-primary', 'Изменить запрос');
        edit.type = 'button';
        edit.addEventListener('click', focusQuery);
        errBox.appendChild(edit);
      }
      resultsBody.replaceChildren(errBox);
      if (newQueryRow) {
        resultsBody.appendChild(newQueryRow);
        setNewQueryVisible(true);
      }
      setStatus(text, 'error');
    } finally {
      clearTimeout(timeoutId);
      if (activeAbort === controller) activeAbort = null;
      if (mySeq === searchSeq) setBusy(false);
    }
  }

  async function loadHealth() {
    const lead = document.getElementById('hero-lead');
    const leadPhoto =
      'Опишите вещь текстом или приложите фото. Сервис выделит критерии и подготовит переходы к поиску на сторонних сайтах. Цену, наличие и подлинность проверяйте у продавца.';
    const leadText =
      'Опишите вещь текстом. Сервис выделит критерии и подготовит переходы к поиску на сторонних сайтах. Цену, наличие и подлинность проверяйте у продавца.';
    try {
      const d = await (await fetch('/api/health', { cache: 'no-store' })).json();
      aiEnabled = !!d.ai_enabled;
      ebayConfigured = !!(d.ebay && d.ebay.configured);
      webSearchServerEnabled = !!(d.web_search && d.web_search.enabled);
      syncWebSearchOptUi();
      if (photoBtn) {
        photoBtn.hidden = !aiEnabled;
        photoBtn.setAttribute('aria-hidden', aiEnabled ? 'false' : 'true');
      }
      if (dropzone) dropzone.hidden = !aiEnabled;
      if (lead) lead.textContent = aiEnabled ? leadPhoto : leadText;
      if (d && d.ok) {
        setReady(aiEnabled ? '' : 'is-idle', aiEnabled ? 'Поиск и фото готовы' : 'Поиск готов. Фото выключено');
      } else {
        setReady('is-down', 'Сервис ответил с ошибкой');
      }
      if (!aiEnabled) {
        clearPhoto();
        if (fileInput) fileInput.value = '';
      }
    } catch (_) {
      aiEnabled = false;
      webSearchServerEnabled = false;
      syncWebSearchOptUi();
      if (photoBtn) photoBtn.hidden = true;
      if (dropzone) dropzone.hidden = true;
      if (lead) lead.textContent = leadText;
      setReady('is-down', 'Сервис недоступен');
      clearPhoto();
    }
  }

  if (photoClear) {
    photoClear.addEventListener('click', () => {
      clearPhoto();
      setStatus('Фото убрано.', 'ok');
    });
  }
  if (photoBtn) {
    photoBtn.addEventListener('click', () => {
      if (busy || !aiEnabled) return;
      fileInput.click();
    });
  }
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) takePhoto(file);
    });
  }
  if (dropzone) {
    dropzone.addEventListener('click', () => {
      if (busy || !aiEnabled) return;
      fileInput.click();
    });
    ['dragenter', 'dragover'].forEach((name) => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        if (aiEnabled) dropzone.classList.add('is-drag');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-drag');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) takePhoto(file);
    });
  }

  document.querySelectorAll('.examples [data-query]').forEach((btn) => {
    btn.type = 'button';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      // Только заполняет текст. Чипсы/критерии не трогаем и поиск не запускаем.
      const sample = String(btn.getAttribute('data-query') || '').trim().slice(0, 300);
      input.value = sample;
      input.focus();
      try {
        const len = input.value.length;
        input.setSelectionRange(len, len);
      } catch (_) { /* ignore */ }
      setStatus('Пример подставлен в строку. Нажмите «Искать», когда будете готовы.', 'ok');
    });
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.ad-slot')) return;
    document.querySelectorAll('.ad-slot.is-ad').forEach((row) => row.classList.remove('is-ad'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (sheetEl && !sheetEl.hidden) {
      e.preventDefault();
      closeSheet();
      return;
    }
    document.querySelectorAll('.ad-slot.is-ad').forEach((row) => row.classList.remove('is-ad'));
  });

  if (sheetEl) {
    sheetEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet-close]')) closeSheet();
    });
    sheetEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || sheetEl.hidden) return;
      const focusables = sheetEl.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const list = Array.prototype.filter.call(focusables, (node) => !node.closest('[hidden]'));
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }
  if (btnSaved) {
    btnSaved.addEventListener('click', () => openSheet('saved', btnSaved));
  }
  if (btnHistory) {
    btnHistory.addEventListener('click', () => openSheet('history', btnHistory));
  }

  renderSmartHints(null, false, false);
  updateSavedCount();
  renderAdPlacement();
  if (Criteria && userCriteriaHost) {
    criteriaApi = Criteria.mount(userCriteriaHost, Criteria.emptyState(), {});
  }

  submitBtn.addEventListener('click', runSearch);
  if (newQueryBtn) {
    newQueryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetCurrentSearch();
    });
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch(e);
  });

  // Поле всегда стартует пустым. Не подставляем ?q=, историю или placeholder.
  // Восстановление — только явным кликом по истории/избранному.
  input.value = '';
  loadHealth();
})();

