(() => {
  'use strict';

  const input = document.getElementById('q');
  const submitBtn = document.getElementById('btn-submit');
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

  if (!input || !submitBtn || !resultsBody) return;

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_FILE = 8 * 1024 * 1024;
  const MAX_DATA = 6 * 1024 * 1024;
  const MAX_SIDE = 1024; // ТЗ: длинная сторона ≤ 1024 px
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let imageDataUrl = null;
  let busy = false;
  let aiEnabled = false;
  let ebayConfigured = false;
  let lastData = null;
  let lastArgs = null;

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
    submitBtn.textContent = v ? 'Ищем…' : 'Искать';
    const analyzing = !!(v && imageDataUrl && aiEnabled);
    if (analyzing) setPhotoStatus('analyzing');
    else if (!v && imageDataUrl && preview && !preview.classList.contains('is-fail')) setPhotoStatus('ready');
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

  function summaryLine(p) {
    const bits = [];
    if (p.category) bits.push(p.category);
    if (p.color) bits.push(p.color);
    if (p.brand) bits.push(p.brand);
    if (p.budget != null) bits.push(formatBudget(p.budget));
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

  function collectCriteria(root) {
    const attrs = {};
    root.querySelectorAll('.criterion').forEach((item) => {
      const inp = item.querySelector('input[data-key]');
      if (!inp) return;
      const k = inp.dataset.key;
      const v = inp.value.trim();
      if (k === 'budget') {
        const n = Number(v);
        attrs.budget = v && Number.isFinite(n) ? n : null;
      } else {
        attrs[k] = v || null;
      }
    });
    return attrs;
  }

  function renderCriteriaPanel(p) {
    const panel = el('div', 'criteria-panel glass');
    panel.appendChild(el('h2', null, 'Критерии запроса'));
    panel.appendChild(
      el('p', 'understood-phrase', 'Пустые признаки не показываем. Уберите или поправьте поле и нажмите кнопку ниже.')
    );
    const grid = el('div', 'criteria-chips');
    const fields = [
      ['category', 'Тип одежды', p.category || '', 'text'],
      ['color', 'Цвет', p.color || '', 'text'],
      ['size', 'Размер', p.size || '', 'text'],
      ['budget', 'Бюджет ₽', p.budget != null ? String(p.budget) : '', 'number'],
      ['brand', 'Бренд', p.brand || '', 'text'],
      ['rest', 'Дополнительно', p.rest || '', 'text'],
    ];
    fields.forEach(([key, label, val, type]) => {
      if (!val) return;
      grid.appendChild(criterionField(key, label, val, type));
    });
    if (p.movie && p.movie.title) {
      const movie = el('div', 'criterion criterion-static');
      movie.appendChild(el('span', 'criteria-label', 'Фильм'));
      movie.appendChild(el('p', 'criterion-value', p.movie.title));
      grid.appendChild(movie);
    }
    if (!grid.childElementCount) {
      panel.appendChild(el('p', 'understood-phrase', 'Критерии почти не распознаны. Опишите вещь точнее.'));
    }
    panel.appendChild(grid);
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
    const again = el('button', 'btn btn-primary', 'Искать с этими критериями');
    again.type = 'button';
    again.addEventListener('click', () => {
      runSearch(null, { query: '', attributes: collectCriteria(panel), attributes_priority: true });
    });
    const actions = el('div', 'criteria-actions');
    actions.appendChild(again);
    panel.appendChild(actions);
    return panel;
  }

  const HINT_EXAMPLES = [
    'чёрная винтажная куртка до 15 000',
    'красное платье в стиле 90-х',
    'дизайнерская футболка oversize',
  ];
  const HISTORY_KEY = 'vishfind-history';

  function hintList(p, triedPhotoWithoutAi, success) {
    const hints = [];
    if (!p) return hints;
    if (triedPhotoWithoutAi) {
      hints.push({ text: 'Опишите вещь текстом, чтобы получить ссылки', insert: '' });
    }
    if (!p.color) hints.push({ text: 'Уточните цвет вещи', insert: '' });
    if (!p.category) hints.push({ text: 'Укажите тип одежды: куртка, джинсы, платье и т. д.', insert: '' });
    if (p.budget == null || p.budget === '') hints.push({ text: 'Добавьте бюджет, например «до 15 000»', insert: 'до 15 000' });
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
      host.appendChild(el('p', 'understood-phrase', 'Пока поиска не было. Можно начать с примера.'));
      const row = el('div', 'hints');
      HINT_EXAMPLES.forEach((text) => {
        const btn = el('button', 'hint hint-card', text);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          if (busy) return;
          input.value = text;
          runSearch(null, { query: text });
        });
        row.appendChild(btn);
      });
      host.appendChild(row);
      return;
    }
    const hints = hintList(p, triedPhotoWithoutAi, success);
    const row = el('div', 'hints');
    if (!hints.length) {
      host.appendChild(el('p', 'understood-phrase', 'Основных признаков достаточно. Критерии можно открыть кнопкой «Что распозналось?».'));
      return;
    }
    hints.forEach((hint) => {
      const btn = el('button', 'hint hint-card', hint.text);
      btn.type = 'button';
      btn.addEventListener('click', () => applyHint(hint));
      row.appendChild(btn);
    });
    host.appendChild(row);
    staggerIn(row.querySelectorAll('.hint'));
  }

  function safeUrl(u) {
    return /^https?:\/\//i.test(u || '') ? u : null;
  }

  function showSkeleton() {
    const wave = el('div', 'search-wave');
    wave.setAttribute('role', 'status');
    wave.setAttribute('aria-label', 'Идёт поиск');
    for (let i = 0; i < 5; i += 1) wave.appendChild(document.createElement('span'));
    const box = el('div', 'skel skel-cards');
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i += 1) box.appendChild(el('div', 'skel-card'));
    resultsBody.replaceChildren(wave, box);
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

  const PRICE_TO_RUB = { RUB: 1, USD: 90, EUR: 100 };

  function offerSortValue(offer) {
    const n = Number(offer && offer.price);
    if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
    const code = String((offer && offer.currency) || 'RUB').toUpperCase();
    const rate = PRICE_TO_RUB[code] || 1;
    return n * rate;
  }

  const SAVED_KEY = 'vishfind-saved';
  let pickedOffers = [];

  function offerKey(o) {
    return [o && o.title, o && o.price, o && o.source, o && o.is_demo].join('|');
  }

  function loadSaved() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function writeSaved(list) {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch (_) {
      setStatus('Не удалось сохранить избранное в этом браузере.', 'error');
    }
  }

  function savedSame(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'query') return a.query === b.query && a.search_type === b.search_type;
    if (a.type === 'link') return a.url === b.url;
    return a.title === b.title && a.price === b.price && a.url === b.url;
  }

  function addSaved(item) {
    const entry = Object.assign({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
    }, item);
    const list = loadSaved().filter((row) => !savedSame(row, entry));
    list.unshift(entry);
    writeSaved(list);
    renderSaved();
    renderRecommendations();
    setStatus('Сохранено в избранное.', 'ok');
  }

  function removeSaved(id) {
    writeSaved(loadSaved().filter((row) => row.id !== id));
    renderSaved();
    renderRecommendations();
  }

  function formatSavedDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderSaved() {
    const host = document.getElementById('saved-body');
    if (!host) return;
    const list = loadSaved();
    host.replaceChildren();
    if (!list.length) {
      host.appendChild(el('p', 'empty', 'Пока ничего не сохранено'));
      return;
    }
    const ul = el('ul', 'saved-list');
    list.forEach((item) => {
      const card = el('li', 'saved-card glass');
      const kind = item.type === 'link' ? 'Ссылка' : item.type === 'offer' ? 'Предложение' : 'Запрос';
      card.appendChild(el('p', 'saved-kind', kind));
      if (item.type === 'query') {
        card.appendChild(el('p', 'saved-title', item.query || 'Пустой запрос'));
        card.appendChild(el('p', 'saved-meta', (item.search_type === 'photo' ? 'Фото' : 'Текст') + (formatSavedDate(item.at) ? ' · ' + formatSavedDate(item.at) : '')));
        const again = el('button', 'btn btn-ghost', 'Повторить');
        again.type = 'button';
        again.addEventListener('click', () => {
          input.value = item.query || '';
          input.focus();
          runSearch();
        });
        card.appendChild(again);
      } else if (item.type === 'link') {
        card.appendChild(el('p', 'saved-title', item.title || 'Площадка'));
        card.appendChild(el('p', 'saved-meta', formatSavedDate(item.at)));
        if (item.url) {
          const a = el('a', 'btn', 'Открыть');
          a.href = item.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          card.appendChild(a);
        }
      } else {
        card.appendChild(el('p', 'saved-title', item.title || 'Предложение'));
        const price = item.price == null ? 'Цена не указана' : formatOfferPrice(item);
        const bits = [price, item.is_demo ? 'Демо' : 'Реальное', formatSavedDate(item.at)].filter(Boolean);
        card.appendChild(el('p', 'saved-meta', bits.join(' · ')));
        if (item.url) {
          const a = el('a', 'btn', 'Открыть');
          a.href = item.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          card.appendChild(a);
        }
      }
      const del = el('button', 'btn btn-ghost', 'Удалить');
      del.type = 'button';
      del.addEventListener('click', () => removeSaved(item.id));
      card.appendChild(del);
      ul.appendChild(card);
    });
    host.appendChild(ul);
  }

  function renderRecommendations() {
    const host = document.getElementById('reco-body');
    if (!host) return;
    const hist = loadHistory();
    const savedQueries = loadSaved().filter((item) => item.type === 'query' && item.query);
    host.replaceChildren();
    if (!hist.length && !savedQueries.length) {
      host.appendChild(el('p', 'empty', 'Пока нет рекомендаций. Они появятся из ваших запросов.'));
      return;
    }
    const row = el('div', 'reco-row');
    const last = hist[0];
    if (last && last.query) {
      const btn = el('button', 'btn btn-ghost', 'Повторить запрос');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        input.value = last.query;
        runSearch();
      });
      row.appendChild(btn);
    }
    if (last && last.category) {
      const btn = el('button', 'btn btn-ghost', 'Тип: ' + last.category);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        input.value = last.category;
        input.focus();
        setStatus('В запрос поставлен тип из прошлого поиска.', 'ok');
      });
      row.appendChild(btn);
    }
    if (last && last.budget != null) {
      const phrase = 'до ' + Number(last.budget).toLocaleString('ru-RU');
      const btn = el('button', 'btn btn-ghost', 'Бюджет: ' + phrase);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        const cur = input.value.trim();
        if (!cur.toLowerCase().includes(phrase.toLowerCase())) input.value = (cur ? cur + ' ' : '') + phrase;
        input.focus();
        setStatus('В запрос добавлен бюджет из прошлого поиска.', 'ok');
      });
      row.appendChild(btn);
    }
    if (last && last.type) {
      const btn = el('button', 'btn btn-ghost', last.type === 'photo' ? 'Прошлый поиск был по фото' : 'Прошлый поиск был текстом');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        if (last.query) input.value = last.query;
        input.focus();
        setStatus(last.type === 'photo' ? 'Последний успешный поиск был с фото.' : 'Последний успешный поиск был текстовым.', 'ok');
      });
      row.appendChild(btn);
    }
    if (savedQueries[0]) {
      const btn = el('button', 'btn btn-ghost', 'К сохранённому запросу');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        input.value = savedQueries[0].query;
        input.focus();
        setStatus('Открыт последний сохранённый запрос.', 'ok');
      });
      row.appendChild(btn);
    }
    host.appendChild(row);
  }

  function togglePick(o) {
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
        is_demo: o.is_demo !== false,
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

  function appendQueryBit(fragment) {
    const cur = input.value.trim();
    const frag = String(fragment || '').trim();
    if (!frag) return;
    if (cur.toLowerCase().includes(frag.toLowerCase())) {
      input.focus();
      setStatus('Это уже есть в запросе.', 'ok');
      return;
    }
    input.value = (cur ? cur + ' ' : '') + frag;
    input.focus();
    setStatus('Запрос обновлён: ' + input.value, 'ok');
  }

  function buildQuickChips() {
    const host = document.getElementById('quick-chips');
    if (!host) return;
    const groups = [
      { id: 'color', label: 'Цвет', values: ['чёрный', 'белый', 'серый', 'красный', 'синий', 'бежевый'] },
      { id: 'type', label: 'Тип одежды', values: ['куртка', 'джинсы', 'платье', 'худи', 'пальто'] },
      { id: 'budget', label: 'до 15 000', values: ['до 15 000'] },
      { id: 'size', label: 'Размер', values: ['размер S', 'размер M', 'размер L', 'размер 48'] },
    ];
    groups.forEach((group) => {
      const wrap = el('div', 'chip-group');
      if (group.values.length === 1) {
        const direct = el('button', 'btn btn-ghost quick-chip', group.label);
        direct.type = 'button';
        direct.addEventListener('click', () => appendQueryBit(group.values[0]));
        wrap.appendChild(direct);
        host.appendChild(wrap);
        return;
      }
      const btn = el('button', 'btn btn-ghost quick-chip', group.label);
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      const menu = el('div', 'chip-menu');
      menu.hidden = true;
      group.values.forEach((value) => {
        const opt = el('button', 'btn btn-ghost chip-opt', value);
        opt.type = 'button';
        opt.addEventListener('click', () => {
          appendQueryBit(value);
          menu.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
        });
        menu.appendChild(opt);
      });
      btn.addEventListener('click', () => {
        const open = menu.hidden;
        host.querySelectorAll('.chip-menu').forEach((node) => { node.hidden = true; });
        host.querySelectorAll('.quick-chip').forEach((node) => node.setAttribute('aria-expanded', 'false'));
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      wrap.appendChild(btn);
      wrap.appendChild(menu);
      host.appendChild(wrap);
    });
    const brand = el('button', 'btn btn-ghost quick-chip', 'Бренд');
    brand.type = 'button';
    brand.addEventListener('click', () => {
      host.querySelectorAll('.chip-menu').forEach((node) => { node.hidden = true; });
      input.focus();
      setStatus('Впишите бренд в строку поиска.', 'ok');
    });
    host.appendChild(brand);
  }

  /** Предложения внизу выдачи: демо и eBay разделены визуально. */
  function renderOffersBlock(offers) {
    if (!offers || typeof offers !== 'object' || !Array.isArray(offers.items)) return null;
    const box = el('div', 'understood glass offers');
    const h2 = el('h2', null, 'Предложения ');
    if (offers.is_demo === true) h2.appendChild(el('span', 'offers-demo-chip', 'Демо'));
    box.appendChild(h2);
    box.appendChild(
      el(
        'p',
        'offers-note',
        'Карточки с меткой «Демо» — учебные примеры, не товары магазинов. Реальная цена и наличие проверяются только на площадке.'
      )
    );
    const hasReal = offers.items.some((o) => o && o.is_demo === false);
    if (!ebayConfigured && !hasReal) {
      box.appendChild(
        el('p', 'offers-empty', 'Реальные предложения eBay появятся после подключения API.')
      );
    }
    if (!offers.items.length) return null;

    let mode = 'score';
    let only = 'all';
    const tools = el('div', 'offer-tools');
    const list = el('ul', 'offers-list');

    function paint() {
      const rows = offers.items
        .filter((o) => {
          if (only === 'demo') return o && o.is_demo !== false;
          if (only === 'ebay') return o && o.is_demo === false;
          return true;
        })
        .slice()
        .sort((a, b) => {
          if (mode === 'price') return offerSortValue(a) - offerSortValue(b);
          if (mode === 'source') return String(a.source || '').localeCompare(String(b.source || ''), 'ru');
          return (Number(b.score) || 0) - (Number(a.score) || 0);
        });
      list.replaceChildren();
      if (!rows.length) {
        list.appendChild(el('li', 'offers-empty', 'В этом фильтре карточек нет.'));
        return;
      }
      rows.forEach((o) => {
        const demo = o.is_demo !== false;
        const li = el('li', 'offers-row ' + (demo ? 'is-demo' : 'is-real'));
        const main = document.createElement('div');
        main.className = 'offers-main';
        const title = el('p', 'offers-name', o.title || 'Без названия');
        if (demo) title.appendChild(el('span', 'offers-demo-chip', ' Демо'));
        main.appendChild(title);
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
        let host = '';
        try { host = url ? new URL(url).hostname : ''; } catch (_) { host = ''; }
        const realLink = !demo && url && host !== 'demo.local' && !host.endsWith('.demo.local');
        if (realLink) {
          const a = el('a', 'btn offers-open', 'Открыть у продавца');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          li.appendChild(a);
        } else if (demo) {
          li.tabIndex = 0;
          li.setAttribute('role', 'button');
          li.setAttribute('aria-label', (o.title || 'Демо-предложение') + '. Подсказка');
          const pop = el('div', 'ad-pop', 'Здесь могла бы быть ваша реклама');
          pop.setAttribute('role', 'tooltip');
          li.appendChild(pop);
          const toggleAd = () => {
            const open = !li.classList.contains('is-ad');
            list.querySelectorAll('.offers-row.is-ad').forEach((row) => row.classList.remove('is-ad'));
            if (open) li.classList.add('is-ad');
          };
          li.addEventListener('click', (e) => {
            if (e.target.closest('a, button')) return;
            toggleAd();
          });
          li.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            toggleAd();
          });
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
          addSaved({
            type: 'offer',
            title: o.title || 'Без названия',
            price: Number.isFinite(Number(o.price)) ? Number(o.price) : null,
            currency: o.currency || '',
            is_demo: o.is_demo !== false,
            url: realLink ? url : '',
            source: o.source || '',
          });
        });
        actions.appendChild(saveOffer);
        li.appendChild(actions);
        list.appendChild(li);
      });
    }

    function tool(label, group, value) {
      const btn = el('button', 'btn btn-ghost', label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        if (group === 'sort') mode = value;
        else only = value;
        tools.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === btn || (b.dataset.group === 'sort' && mode === b.dataset.value) || (b.dataset.group === 'filter' && only === b.dataset.value)));
        paint();
      });
      btn.dataset.group = group;
      btn.dataset.value = value;
      if ((group === 'sort' && value === mode) || (group === 'filter' && value === only)) btn.classList.add('is-on');
      tools.appendChild(btn);
    }
    tool('По релевантности', 'sort', 'score');
    tool('По цене', 'sort', 'price');
    tool('По источнику', 'sort', 'source');
    tool('Все', 'filter', 'all');
    tool('Только демо', 'filter', 'demo');
    tool('Только eBay', 'filter', 'ebay');
    box.appendChild(tools);
    box.appendChild(list);
    paint();
    return box;
  }

  const RU_SOURCES = new Set(['ozon', 'wildberries', 'yandex_market', 'avito', 'lamoda']);
  const WORLD_SOURCES = new Set(['zara', 'ebay', 'vestiaire']);

  function sourceGroup(source) {
    const id = String(source && source.id || '');
    if (RU_SOURCES.has(id)) return 'Российские маркетплейсы';
    if (WORLD_SOURCES.has(id)) return 'Международные площадки';
    return 'Остальные источники';
  }

  function renderSourceCard(source) {
    const card = el('li', 'source-card');
    const head = el('div', 'source-card-head');
    const name = source.name || 'Площадка';
    head.appendChild(el('span', 'source-mark', name.trim().charAt(0).toUpperCase() || '?'));
    const titles = document.createElement('div');
    titles.appendChild(el('p', 'source-name', name));
    titles.appendChild(el('p', 'source-meta', source.type_label || source.type || ''));
    head.appendChild(titles);
    card.appendChild(head);
    const url = safeUrl(source.url);
    const actions = el('div', 'source-actions');
    if (url) {
      const a = el('a', 'btn', 'Открыть');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      actions.appendChild(a);
      const copy = el('button', 'btn btn-ghost', 'Копировать ссылку');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
          setStatus('Ссылка скопирована.', 'ok');
        } catch (_) {
          setStatus('Не удалось скопировать ссылку.', 'error');
        }
      });
      actions.appendChild(copy);
      const saveLink = el('button', 'btn btn-ghost', 'В избранное');
      saveLink.type = 'button';
      saveLink.addEventListener('click', () => {
        addSaved({ type: 'link', title: name, url: url });
      });
      actions.appendChild(saveLink);
    }
    card.appendChild(actions);
    if (source.price_filter_applied) {
      card.appendChild(el('p', 'source-note', 'В ссылку добавлен фильтр цены.'));
    } else if (source.price_filter_note) {
      card.appendChild(el('p', 'source-note', source.price_filter_note));
    }
    return card;
  }

  function focusQuery() {
    input.focus();
    const box = document.getElementById('search');
    if (box) box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }

  function renderMarkets(sources, p) {
    const markets = el('div', 'understood glass');
    markets.appendChild(el('h2', null, 'Ссылки для поиска'));
    markets.appendChild(
      el(
        'p',
        'understood-phrase',
        'Это переход к поиску на площадке, а не подтверждённое наличие товара.' +
          (p.search_phrase ? ' Фраза: «' + p.search_phrase + '».' : '')
      )
    );
    const groups = new Map();
    sources.forEach((s) => {
      const title = sourceGroup(s);
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(s);
    });
    ['Российские маркетплейсы', 'Международные площадки', 'Остальные источники'].forEach((title) => {
      const items = groups.get(title);
      if (!items || !items.length) return;
      const group = el('div', 'source-group');
      group.appendChild(el('h3', null, title));
      const list = el('ul', 'source-cards source-list');
      items.forEach((s) => list.appendChild(renderSourceCard(s)));
      group.appendChild(list);
      markets.appendChild(group);
    });
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
    drawer.appendChild(renderCriteriaPanel(p));
    btn.addEventListener('click', () => {
      const open = drawer.hidden;
      drawer.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? 'Скрыть критерии' : 'Что распозналось?';
    });
    wrap.appendChild(btn);
    wrap.appendChild(drawer);
    return wrap;
  }

  function renderEmpty(p, data, triedPhotoWithoutAi) {
    const box = el('div', 'understood glass result-empty');
    box.appendChild(el('h2', null, 'Ничего не нашлось'));
    box.appendChild(
      el('p', 'understood-phrase', 'По этому запросу нет проверенных ссылок и предложений. Измените формулировку или уберите лишнее.')
    );
    const change = el('button', 'btn btn-primary', 'Изменить запрос');
    change.type = 'button';
    change.addEventListener('click', focusQuery);
    box.appendChild(change);
    resultsBody.appendChild(box);
    resultsBody.appendChild(renderRecognition(p, data));
    renderSmartHints(p, triedPhotoWithoutAi, true);
  }

  function renderResults(data) {
    lastData = data;
    resultsBody.replaceChildren();
    const p = data.parsed || {};
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const offerItems = data.offers && Array.isArray(data.offers.items) ? data.offers.items : [];
    const triedPhotoWithoutAi = !!(imageDataUrl && !aiEnabled);

    if (!sources.length && !offerItems.length) {
      renderEmpty(p, data, triedPhotoWithoutAi);
      staggerIn(resultsBody.querySelectorAll('.understood, .hints-block'));
      return;
    }

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
        query: text,
        search_type: data.photo_used ? 'photo' : 'text',
      });
    });
    resultsBody.appendChild(saveQuery);
    if (sources.length) resultsBody.appendChild(renderMarkets(sources, p));
    const offersBlock = offerItems.length ? renderOffersBlock(data.offers) : null;
    if (offersBlock) resultsBody.appendChild(offersBlock);
    resultsBody.appendChild(renderRecognition(p, data));
    renderSmartHints(p, triedPhotoWithoutAi, true);
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
    const host = document.getElementById('search-history-body');
    const clearBtn = document.getElementById('history-clear');
    if (!host) return;
    const list = loadHistory();
    host.replaceChildren();
    if (clearBtn) clearBtn.hidden = list.length === 0;
    if (!list.length) {
      host.appendChild(el('p', 'understood-phrase', 'История пока пуста. Она хранится только в этом браузере.'));
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
        typeof item.offers === 'number' ? item.offers + ' предложений' : '',
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
    host.appendChild(grid);
  }

  function repeatHistory(item) {
    if (busy) return;
    input.value = item.query || '';
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
    runSearch(null, { query: item.query || '' });
  }

  async function rememberSearch(query, data, sentPhoto) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: sentPhoto ? 'photo' : 'text',
      query: query || '',
      at: new Date().toISOString(),
      links: Array.isArray(data.sources) ? data.sources.length : 0,
      offers: data.offers && Array.isArray(data.offers.items) ? data.offers.items.length : 0,
      category: (data.parsed && data.parsed.category) || '',
      color: (data.parsed && data.parsed.color) || '',
      size: (data.parsed && data.parsed.size) || '',
      budget: data.parsed && data.parsed.budget != null ? data.parsed.budget : null,
      thumb: null,
    };
    if (sentPhoto && imageDataUrl) {
      try { entry.thumb = await makeThumb(imageDataUrl); } catch (_) { entry.thumb = null; }
    }
    let list = loadHistory();
    if (entry.type === 'text') list = list.filter((item) => !(item.type === 'text' && item.query === entry.query));
    list.unshift(entry);
    saveHistory(list);
    renderHistory();
    renderRecommendations();
  }

  async function runSearch(ev, override) {
    if (ev) ev.preventDefault();
    if (busy) return;

    const query = override && override.query != null ? String(override.query).trim() : input.value.trim();
    const attributes = override && override.attributes ? override.attributes : undefined;
    const attributesPriority = !!(override && override.attributes_priority);

    if (!query && !imageDataUrl && !attributes) {
      setStatus('Введите описание вещи.', 'error');
      return;
    }
    if (query.length > 300) {
      setStatus('Запрос длиннее 300 символов.', 'error');
      return;
    }

    setBusy(true);
    pickedOffers = [];
    renderCompare();
    const analyzingPhoto = !!(imageDataUrl && aiEnabled);
    const sentPhoto = analyzingPhoto;
    setStatus(analyzingPhoto ? 'Смотрим фото и ищем предложения' : 'Формируем ссылки');
    showSkeleton();
    resultsSection.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });

    lastArgs = { query, attributes, attributes_priority: attributesPriority };
    const started = Date.now();
    try {
      const payload = { query };
      if (attributes) payload.attributes = attributes;
      if (attributesPriority) payload.attributes_priority = true;
      if (imageDataUrl && aiEnabled) payload.image = imageDataUrl;

      const r = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(payload.image ? 100_000 : 30_000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(data.error || 'Поиск не удался.');
        err.status = r.status;
        throw err;
      }
      await waitAtLeast(started);
      renderResults(data);
      rememberSearch(query, data, sentPhoto);
      try {
        if (query) {
          const u = new URL(window.location.href);
          u.searchParams.set('q', query);
          history.replaceState(null, '', u.pathname + u.search);
        }
      } catch (_) { /* ignore */ }
      setStatus(
        data.photo_used ? 'Фото разобрано. Цены смотрите на площадке.' : 'Готово. Цены смотрите на площадке.',
        'ok'
      );
    } catch (err) {
      const status = Number(err.status) || 0;
      const offline = err.message === 'Failed to fetch';
      const timeout = err.name === 'TimeoutError';
      let title = 'Поиск не удался';
      let text = err.message || 'Поиск не удался.';
      if (timeout) {
        title = analyzingPhoto ? 'Фото не разобрано' : 'Сервер не ответил';
        text = analyzingPhoto
          ? 'Сервер не ответил вовремя. Успешный разбор фото не подменяется.'
          : 'Сервер не ответил вовремя.';
        if (analyzingPhoto) setPhotoStatus('fail');
      } else if (offline) {
        title = 'Сервер недоступен';
        text = 'Сервер недоступен. Проверьте, что сайт запущен, и попробуйте снова.';
      } else if (status === 503) {
        title = 'AI по фото сейчас недоступен';
        text = 'AI по фото сейчас недоступен. Опишите вещь текстом, чтобы получить ссылки.';
        if (analyzingPhoto) setPhotoStatus('fail');
      } else if (status === 502) {
        title = 'Фото не разобрано';
        text = text + ' Успешный разбор не подменяется.';
        if (analyzingPhoto) setPhotoStatus('fail');
      } else if (status === 400 || status === 422) {
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
      await waitAtLeast(started);
      resultsBody.replaceChildren(errBox);
      setStatus(text, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function loadHealth() {
    const lead = document.getElementById('hero-lead');
    const leadPhoto =
      'Опишите вещь текстом или приложите фото. Сервис выделит критерии (тип, цвет, размер, бюджет и др.) и откроет поиск на площадках. Цены и наличие не проверяются — их видно только на сайте магазина.';
    const leadText =
      'Опишите вещь текстом. Сервис выделит критерии (тип, цвет, размер, бюджет и др.) и откроет поиск на площадках. Цены и наличие не проверяются — их видно только на сайте магазина.';
    try {
      const d = await (await fetch('/api/health', { cache: 'no-store' })).json();
      aiEnabled = !!d.ai_enabled;
      ebayConfigured = !!(d.ebay && d.ebay.configured);
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
    btn.addEventListener('click', () => {
      if (busy) return;
      input.value = btn.getAttribute('data-query') || '';
      input.focus();
    });
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.offers-row.is-demo')) return;
    resultsBody.querySelectorAll('.offers-row.is-ad').forEach((row) => row.classList.remove('is-ad'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    resultsBody.querySelectorAll('.offers-row.is-ad').forEach((row) => row.classList.remove('is-ad'));
  });

  const historyClear = document.getElementById('history-clear');
  if (historyClear) {
    historyClear.addEventListener('click', () => {
      saveHistory([]);
      renderHistory();
      renderRecommendations();
    });
  }
  renderSmartHints(null, false, false);
  renderHistory();
  renderSaved();
  renderRecommendations();
  buildQuickChips();

  submitBtn.addEventListener('click', runSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch(e);
  });

  loadHealth().then(() => {
    try {
      const q0 = new URLSearchParams(window.location.search).get('q');
      if (q0 && !input.value) {
        input.value = q0.slice(0, 300);
      }
    } catch (_) { /* ignore */ }
  });
})();

