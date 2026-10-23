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

  if (!input || !submitBtn || !resultsBody) return;

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_FILE = 8 * 1024 * 1024;
  const MAX_DATA = 6 * 1024 * 1024;
  const MAX_SIDE = 1024; // ТЗ: длинная сторона ≤ 1024 px
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let imageDataUrl = null;
  let busy = false;
  let aiEnabled = false;
  let lastData = null;

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

  function criteriaItem(label, value) {
    const item = el('div', 'criteria-item' + (value ? '' : ' is-empty'));
    item.appendChild(el('span', 'criteria-label', label));
    item.appendChild(el('span', 'criteria-value', value || '—'));
    return item;
  }

  function renderCriteriaPanel(p) {
    const panel = el('div', 'criteria-panel glass');
    panel.appendChild(el('h2', null, 'Критерии запроса'));
    const grid = el('div', 'criteria-grid');
    const budget =
      p.budget != null && p.budget !== ''
        ? 'до ' + Number(p.budget).toLocaleString('ru-RU') + ' ₽'
        : '';
    [
      ['Категория', p.category],
      ['Цвет', p.color],
      ['Размер', p.size],
      ['Бюджет', budget],
      ['Бренд', p.brand],
      ['Фильм / образ', p.movie && p.movie.title ? p.movie.title : ''],
    ].forEach(([label, val]) => grid.appendChild(criteriaItem(label, val || '')));
    panel.appendChild(grid);

    if (p.rest) {
      panel.appendChild(el('p', 'understood-phrase', 'Дополнительно: ' + p.rest));
    }
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
    return panel;
  }

  function safeUrl(u) {
    return /^https?:\/\//i.test(u || '') ? u : null;
  }

  function showSkeleton() {
    const box = el('div', 'skel');
    box.setAttribute('aria-hidden', 'true');
    [null, null, 'lg', null, 'lg', null].forEach((mod) => {
      box.appendChild(el('div', 'skel-line' + (mod ? ' ' + mod : '')));
    });
    resultsBody.replaceChildren(box);
  }

  function staggerIn(nodes) {
    nodes.forEach((node, i) => {
      if (reduceMotion) {
        node.classList.add('is-in');
        return;
      }
      window.setTimeout(() => node.classList.add('is-in'), 50 + i * 50);
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

  /** Блок «Лучшие предложения»: рисуется независимо от sources (до раннего return). */
  function renderOffersBlock(offers) {
    if (!offers || typeof offers !== 'object' || !Array.isArray(offers.items)) return null;
    const box = el('div', 'understood glass offers');
    const h2 = el('h2', null, 'Лучшие предложения ');
    if (offers.is_demo === true) h2.appendChild(el('span', 'offers-demo-chip', 'Демо'));
    box.appendChild(h2);
    box.appendChild(
      el(
        'p',
        'offers-note',
        'Демо-предложения — примеры, не реальный каталог. Цены и наличие не проверялись.'
      )
    );
    if (!offers.items.length) {
      box.appendChild(el('p', 'offers-empty', 'Пока нет подходящих демо-предложений по этому запросу.'));
      return box;
    }
    const list = el('ul', 'offers-list');
    offers.items.forEach((o) => {
      const li = el('li', 'offers-row');
      const main = document.createElement('div');
      main.className = 'offers-main';
      main.appendChild(el('p', 'offers-name', o.title || 'Без названия'));
      const metaBits = [o.brand, o.category, o.color, o.size ? 'размер ' + o.size : null].filter(Boolean);
      main.appendChild(el('p', 'offers-meta', metaBits.join(' · ')));
      const price = el('p', 'offers-price', formatOfferPrice(o));
      if (o.condition) price.appendChild(el('span', 'offers-cond', ' ' + o.condition));
      main.appendChild(price);
      const date = formatOfferDate(o.updated_at);
      if (date) main.appendChild(el('p', 'offers-updated', 'Обновлено: ' + date));
      li.appendChild(main);
      const url = safeUrl(o.url);
      if (url) {
        const a = el('a', 'btn offers-open', 'Открыть у продавца');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
      }
      list.appendChild(li);
    });
    box.appendChild(list);
    return box;
  }

  function renderResults(data) {
    lastData = data;
    resultsBody.replaceChildren();
    const p = data.parsed || {};

    const note = el('p', 'honest-note glass');
    note.textContent =
      'Ниже — критерии из вашего запроса и ссылки на поиск площадок. Цены и наличие смотрите на месте.';
    resultsBody.appendChild(note);

    // Сразу в выдаче: размер, бюджет, цвет и др.
    resultsBody.appendChild(renderCriteriaPanel(p));

    const block = el('div', 'understood glass');
    block.appendChild(el('h2', null, 'Правка и повторный поиск'));
    block.appendChild(el('p', 'understood-line', summaryLine(p)));

    if (data.photo_used) {
      block.appendChild(el('p', 'understood-phrase', 'Распознано по фото — детали ниже, их можно учесть при правке.'));
      const photoBlock = renderPhotoAttrs(data.photo);
      if (photoBlock) block.appendChild(photoBlock);
    }

    const edit = el('div', 'understood-edit');
    [
      ['category', 'Категория', p.category || ''],
      ['color', 'Цвет', p.color || ''],
      ['size', 'Размер', p.size || ''],
      ['budget', 'Бюджет ₽', p.budget != null ? String(p.budget) : ''],
      ['brand', 'Бренд', p.brand || ''],
    ].forEach(([key, label, val]) => {
      const lab = el('label', null, label);
      const inp = document.createElement('input');
      inp.type = key === 'budget' ? 'number' : 'text';
      inp.value = val;
      inp.dataset.key = key;
      inp.setAttribute('aria-label', label);
      lab.appendChild(inp);
      edit.appendChild(lab);
    });

    const again = el('button', 'btn', 'Искать снова');
    again.type = 'button';
    again.addEventListener('click', () => {
      const attrs = {};
      edit.querySelectorAll('input[data-key]').forEach((inp) => {
        const k = inp.dataset.key;
        const v = inp.value.trim();
        if (k === 'budget') {
          const n = Number(v);
          attrs.budget = v && Number.isFinite(n) ? n : null;
        } else {
          attrs[k] = v || null;
        }
      });
      runSearch(null, { query: '', attributes: attrs, attributes_priority: true });
    });
    edit.appendChild(again);
    block.appendChild(edit);
    resultsBody.appendChild(block);

    // Демо-предложения: блок показывается независимо от sources (до раннего return).
    const offersBlock = renderOffersBlock(data.offers);
    if (offersBlock) resultsBody.appendChild(offersBlock);

    const sources = Array.isArray(data.sources) ? data.sources : [];
    if (!sources.length) {
      resultsBody.appendChild(el('p', 'empty', 'Нет проверенных источников.'));
      return;
    }

    const markets = el('div', 'understood glass');
    markets.appendChild(el('h2', null, 'Площадки'));
    const list = el('ul', 'source-list');
    const rows = [];
    sources.forEach((s) => {
      const li = el('li', 'source-row');
      const left = document.createElement('div');
      left.appendChild(el('p', 'source-name', s.name || 'Площадка'));
      left.appendChild(el('p', 'source-meta', s.type_label || s.type || ''));
      li.appendChild(left);
      const url = safeUrl(s.url);
      if (url) {
        const a = el('a', 'btn', 'Открыть поиск');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
      }
      if (s.price_filter_applied) {
        li.appendChild(el('p', 'source-note', 'В ссылку добавлен фильтр цены.'));
      } else if (s.price_filter_note) {
        li.appendChild(el('p', 'source-note', s.price_filter_note));
      }
      list.appendChild(li);
      rows.push(li);
    });
    markets.appendChild(list);
    resultsBody.appendChild(markets);
    staggerIn(rows);
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
    setStatus('Разбираем запрос…');
    showSkeleton();
    resultsSection.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });

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
        throw new Error(data.error || 'Поиск не удался.');
      }
      renderResults(data);
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
      const msg =
        err.name === 'TimeoutError'
          ? 'Сервер не ответил вовремя. Для фото проверьте Ollama.'
          : err.message === 'Failed to fetch'
            ? 'Сервер недоступен. Запустите: npm.cmd start'
            : err.message || 'Ошибка';
      setStatus(msg, 'error');
      resultsBody.replaceChildren(el('p', 'empty', msg));
      // текстовое поле остаётся — можно описать вещь словами
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
      if (photoBtn) {
        photoBtn.hidden = !aiEnabled;
        photoBtn.setAttribute('aria-hidden', aiEnabled ? 'false' : 'true');
      }
      if (lead) lead.textContent = aiEnabled ? leadPhoto : leadText;
      if (!aiEnabled) {
        clearPhoto();
        if (fileInput) fileInput.value = '';
      }
    } catch (_) {
      aiEnabled = false;
      if (photoBtn) photoBtn.hidden = true;
      if (lead) lead.textContent = leadText;
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
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        setStatus('Готовим фото…');
        imageDataUrl = await resizeImage(file);
        previewImg.src = imageDataUrl;
        preview.hidden = false;
        photoMeta.textContent = 'Фото приложено — нажмите «Найти», чтобы разобрать.';
        photoBtn.classList.add('is-active');
        setStatus('Фото готово. Нажмите «Найти».', 'ok');
      } catch (e) {
        clearPhoto();
        setStatus(e.message || 'Ошибка фото', 'error');
      }
    });
  }

  document.querySelectorAll('.examples [data-query]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (busy) return;
      input.value = btn.getAttribute('data-query') || '';
      input.focus();
    });
  });

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

