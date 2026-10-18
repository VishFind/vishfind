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
  const MAX_SIDE = 1280;

  let imageDataUrl = null;
  let busy = false;
  let lastParsed = null;

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

  function safeUrl(u) {
    return /^https?:\/\//i.test(u || '') ? u : null;
  }

  async function resizeImage(file) {
    if (!ALLOWED.includes(file.type) && !/\.(jpe?g|png|webp|gif)$/i.test(file.name || '')) {
      throw new Error('Нужен JPG, PNG, WebP или GIF.');
    }
    if (file.size > MAX_FILE) throw new Error('Файл больше 8 МБ — выберите другое фото.');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
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
    return dataUrl;
  }

  function clearPhoto() {
    imageDataUrl = null;
    fileInput.value = '';
    preview.hidden = true;
    previewImg.removeAttribute('src');
    photoBtn.classList.remove('is-active');
  }

  photoClear.addEventListener('click', () => {
    clearPhoto();
    setStatus('Фото убрано.', 'ok');
  });

  photoBtn.addEventListener('click', () => {
    if (busy) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      setStatus('Готовим фото…');
      imageDataUrl = await resizeImage(file);
      previewImg.src = imageDataUrl;
      preview.hidden = false;
      photoMeta.textContent = 'Фото приложено. Можно добавить текст и нажать «Искать».';
      photoBtn.classList.add('is-active');
      setStatus('Фото готово.', 'ok');
    } catch (e) {
      clearPhoto();
      setStatus(e.message || 'Ошибка фото', 'error');
    }
  });

  document.querySelectorAll('.examples [data-query]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (busy) return;
      input.value = btn.getAttribute('data-query') || '';
      input.focus();
    });
  });

  function buildSearchUrl(template, phrase, budget, sourceId, priceVerified) {
    const enc = encodeURIComponent(phrase);
    let url = template.replace('{q}', enc);
    if (budget != null && priceVerified && sourceId === 'yandex_market') {
      url += (url.includes('?') ? '&' : '?') + 'priceto=' + encodeURIComponent(String(budget));
    }
    return url;
  }

  // шаблоны совпадают с data/sources.json (проверенные)
  const SOURCE_TEMPLATES = {
    ozon: 'https://www.ozon.ru/search/?text={q}',
    wildberries: 'https://www.wildberries.ru/catalog/0/search.aspx?search={q}',
    yandex_market: 'https://market.yandex.ru/search?text={q}',
    avito: 'https://www.avito.ru/all?q={q}',
    lamoda: 'https://www.lamoda.ru/catalogsearch/result/?q={q}',
    zara: 'https://www.zara.com/ru/ru/search?searchTerm={q}',
    ebay: 'https://www.ebay.com/sch/i.html?_nkw={q}',
  };

  function renderResults(data) {
    resultsBody.replaceChildren();
    const p = data.parsed || {};
    lastParsed = { ...p, _sourcesMeta: data.sources };

    const note = el('p', 'honest-note');
    note.textContent =
      data.note ||
      'Мы ведём на поиск площадок. Цены и наличие смотрите на месте — мы их не проверяли и не выдумываем.';
    resultsBody.appendChild(note);

    const block = el('div', 'understood');
    block.appendChild(el('h2', null, 'Как поняли запрос'));
    const line = el('p', 'understood-line', summaryLine(p));
    line.id = 'understood-line';
    block.appendChild(line);
    if (p.search_phrase) {
      block.appendChild(el('p', 'understood-phrase', 'Фраза для площадок: «' + p.search_phrase + '»'));
    }
    if (data.photo_used) {
      block.appendChild(el('p', 'understood-phrase', 'Учтено фото (локальный разбор).'));
    }
    if (p.movie && p.movie.description) {
      block.appendChild(el('p', 'understood-phrase', 'Образ: ' + p.movie.description));
    }

    const edit = el('div', 'understood-edit');
    const fields = [
      ['category', 'Категория', p.category || ''],
      ['color', 'Цвет', p.color || ''],
      ['size', 'Размер', p.size || ''],
      ['budget', 'Бюджет ₽', p.budget != null ? String(p.budget) : ''],
    ];
    fields.forEach(([key, label, val]) => {
      const lab = el('label', null, label);
      const inp = document.createElement('input');
      inp.type = key === 'budget' ? 'number' : 'text';
      inp.value = val;
      inp.dataset.key = key;
      inp.setAttribute('aria-label', label);
      lab.appendChild(inp);
      edit.appendChild(lab);
    });
    const applyBtn = el('button', 'btn', 'Обновить ссылки');
    applyBtn.type = 'button';
    applyBtn.addEventListener('click', () => {
      const next = { ...p };
      edit.querySelectorAll('input[data-key]').forEach((inp) => {
        const k = inp.dataset.key;
        let v = inp.value.trim();
        if (k === 'budget') {
          next.budget = v ? Number(v) : null;
          if (next.budget != null && !Number.isFinite(next.budget)) next.budget = null;
        } else {
          next[k] = v || null;
        }
      });
      const parts = [next.brand, next.color, next.category, next.rest].filter(Boolean);
      if (next.size) parts.push('размер ' + next.size);
      next.search_phrase = parts.join(' ').replace(/\s+/g, ' ').trim() || p.search_phrase;
      const sources = (data.sources || []).map((s) => {
        const tpl = SOURCE_TEMPLATES[s.id];
        if (!tpl || !next.search_phrase) return s;
        const url = buildSearchUrl(
          tpl,
          next.search_phrase,
          next.budget,
          s.id,
          s.id === 'yandex_market'
        );
        return {
          ...s,
          url,
          price_filter_applied: s.id === 'yandex_market' && next.budget != null,
          price_filter_note:
            next.budget != null && s.id !== 'yandex_market'
              ? s.price_filter_note ||
                'Фильтр цены в ссылку не подставлен — ограничьте цену на сайте.'
              : s.id === 'yandex_market'
                ? null
                : s.price_filter_note,
        };
      });
      renderResults({ ...data, parsed: next, sources });
      setStatus('Ссылки обновлены по вашим правкам.', 'ok');
    });
    edit.appendChild(applyBtn);
    block.appendChild(edit);
    resultsBody.appendChild(block);

    const sources = Array.isArray(data.sources) ? data.sources : [];
    if (!sources.length) {
      resultsBody.appendChild(el('p', 'empty', 'Нет проверенных источников.'));
      return;
    }

    const list = el('ul', 'source-list');
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
      // Цены товаров намеренно не показываем — мы их не проверяли
      li.appendChild(
        el('p', 'source-note', 'Цена: смотрите на площадке (у нас нет проверенных цен).')
      );
      list.appendChild(li);
    });
    resultsBody.appendChild(list);
  }

  async function runSearch(ev) {
    if (ev) ev.preventDefault();
    if (busy) return;

    const query = input.value.trim();
    if (!query && !imageDataUrl) {
      setStatus('Введите описание или приложите фото.', 'error');
      return;
    }
    if (query.length > 300) {
      setStatus('Запрос длиннее 300 символов.', 'error');
      return;
    }

    setBusy(true);
    setStatus(imageDataUrl ? 'Разбираем фото и запрос… Это может занять время.' : 'Разбираем запрос…');
    resultsBody.replaceChildren(el('p', 'empty', 'Ищем…'));
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const payload = { query, image: imageDataUrl || '' };
      const r = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(imageDataUrl ? 7 * 60 * 1000 : 30_000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Поиск не удался.');
      renderResults(data);
      setStatus('Готово. Откройте площадку и смотрите цены там.', 'ok');
    } catch (err) {
      const msg =
        err.name === 'TimeoutError'
          ? 'Сервер не ответил вовремя. Для фото проверьте, что Ollama запущена.'
          : err.message === 'Failed to fetch'
            ? 'Сервер недоступен. В папке проекта: npm start'
            : err.message || 'Ошибка';
      setStatus(msg, 'error');
      resultsBody.replaceChildren(el('p', 'empty', msg));
    } finally {
      setBusy(false);
    }
  }

  submitBtn.addEventListener('click', runSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch(e);
  });
})();
