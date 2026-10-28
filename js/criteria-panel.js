(() => {
  'use strict';

  const MAX_MULTI = 8;

  const COLOR_OPTIONS = [
    { id: 'чёрный', label: 'Чёрный', swatch: '#1a1a1a' },
    { id: 'белый', label: 'Белый', swatch: '#ffffff' },
    { id: 'серый', label: 'Серый', swatch: '#8a8f8c' },
    { id: 'бежевый', label: 'Бежевый', swatch: '#d4c4a8' },
    { id: 'коричневый', label: 'Коричневый', swatch: '#6b3f2a' },
    { id: 'красный', label: 'Красный', swatch: '#c62828' },
    { id: 'бордовый', label: 'Бордовый', swatch: '#7a1f2b' },
    { id: 'розовый', label: 'Розовый', swatch: '#e89ab5' },
    { id: 'оранжевый', label: 'Оранжевый', swatch: '#e67a2e' },
    { id: 'жёлтый', label: 'Жёлтый', swatch: '#e6c84a' },
    { id: 'зелёный', label: 'Зелёный', swatch: '#2e8b57' },
    { id: 'оливковый', label: 'Оливковый', swatch: '#6b7c3a' },
    { id: 'хаки', label: 'Хаки', swatch: '#6b6b3a' },
    { id: 'голубой', label: 'Голубой', swatch: '#6eb6d9' },
    { id: 'синий', label: 'Синий', swatch: '#1e4d8c' },
    { id: 'фиолетовый', label: 'Фиолетовый', swatch: '#6a3d9a' },
    { id: 'многоцветный', label: 'Многоцветный', swatch: 'multi' },
  ];

  const CATEGORY_GROUPS = [
    {
      id: 'outer',
      label: 'Верхняя одежда',
      items: [
        'куртка', 'кожаная куртка', 'бомбер', 'косуха', 'пуховик', 'пальто',
        'тренч', 'плащ', 'парка', 'ветровка', 'дублёнка',
      ],
    },
    {
      id: 'tops',
      label: 'Верх',
      items: [
        'футболка', 'лонгслив', 'рубашка', 'поло', 'худи', 'свитшот',
        'свитер', 'джемпер', 'кардиган', 'жилет', 'топ',
      ],
    },
    {
      id: 'bottoms',
      label: 'Низ',
      items: ['джинсы', 'брюки', 'карго', 'чиносы', 'шорты', 'юбка', 'спортивные брюки'],
    },
    {
      id: 'onesie',
      label: 'Цельные вещи',
      items: ['платье', 'комбинезон', 'костюм'],
    },
    {
      id: 'shoes',
      label: 'Обувь',
      items: ['кроссовки', 'кеды', 'ботинки', 'сапоги', 'туфли', 'лоферы', 'сандалии'],
    },
    {
      id: 'acc',
      label: 'Аксессуары',
      items: ['сумка', 'рюкзак', 'ремень', 'шапка', 'кепка', 'шарф', 'перчатки', 'украшения'],
    },
  ];

  const SIZE_LETTER_OPTIONS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
  const SIZE_NUMERIC_OPTIONS = {
    general: ['40', '42', '44', '46', '48', '50', '52', '54'],
    shoes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
    jeans: ['28', '29', '30', '31', '32', '33', '34', '36', '38'],
  };
  const SIZE_OPTIONS = SIZE_LETTER_OPTIONS.concat(SIZE_NUMERIC_OPTIONS.general);

  function numericSizesForState(state) {
    const cats = asList(state.categories != null ? state.categories : state.category);
    const joined = cats.join(' ').toLowerCase();
    if (/кроссов|кед|ботин|сапог|туфл|лофер|сандал|обув/.test(joined)) {
      return SIZE_NUMERIC_OPTIONS.shoes;
    }
    if (/джинс/.test(joined)) return SIZE_NUMERIC_OPTIONS.jeans;
    return SIZE_NUMERIC_OPTIONS.general;
  }

  const FEATURE_OPTIONS = {
    material: { label: 'Материал', values: ['кожа', 'замша', 'деним', 'хлопок', 'шерсть', 'лён', 'шёлк', 'синтетика', 'пух'] },
    style: { label: 'Стиль', values: ['винтаж', 'классика', 'спортивный', 'oversize', 'минимализм', 'уличный'] },
    fit: { label: 'Посадка', values: ['slim', 'regular', 'oversize', 'свободный', 'приталенный'] },
    condition: { label: 'Состояние', values: ['новое', 'как новое', 'хорошее', 'винтаж', 'б/у'] },
  };

  const CHIP_DEFS = [
    { id: 'category', label: 'Тип одежды' },
    { id: 'color', label: 'Цвет' },
    { id: 'size', label: 'Размер' },
    { id: 'price', label: 'Цена' },
    { id: 'brand', label: 'Бренд' },
    { id: 'features', label: 'Особенности' },
  ];

  const KNOWN_BRANDS = (typeof window !== 'undefined' && Array.isArray(window.VISHFIND_BRANDS))
    ? window.VISHFIND_BRANDS.slice()
    : ['Nike', 'Adidas', 'Puma', 'Reebok', 'New Balance', 'Converse', 'Vans', "Levi's", 'Zara', 'H&M', 'Uniqlo', 'The North Face', 'Carhartt', 'Stone Island', 'Calvin Klein', 'Tommy Hilfiger'];

  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function swatchNode(swatch) {
    const s = el('span', 'color-swatch');
    s.setAttribute('aria-hidden', 'true');
    if (swatch === 'multi') s.classList.add('is-multi');
    else s.style.background = swatch;
    if (swatch === '#ffffff' || swatch === '#fff') s.classList.add('is-light');
    if (swatch === '#1a1a1a') s.classList.add('is-dark');
    return s;
  }

  function asList(value) {
    if (value == null || value === '') return [];
    const raw = Array.isArray(value) ? value : [value];
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const s = String(item == null ? '' : item).trim();
      if (!s) continue;
      const key = s.toLowerCase().replace(/ё/g, 'е');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= MAX_MULTI) break;
    }
    return out;
  }

  function toggleInList(list, value) {
    const v = String(value || '').trim();
    if (!v) return list.slice();
    const key = v.toLowerCase().replace(/ё/g, 'е');
    const next = [];
    let found = false;
    for (const item of list) {
      if (item.toLowerCase().replace(/ё/g, 'е') === key) {
        found = true;
        continue;
      }
      next.push(item);
    }
    if (!found) {
      if (next.length >= MAX_MULTI) return list.slice();
      next.push(v);
    }
    return next;
  }

  function formatThousands(raw) {
    const digits = String(raw == null ? '' : raw).replace(/[^\d]/g, '');
    if (!digits) return '';
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function parseMoneyInput(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t) return null;
    const n = Number(t.replace(/[\s\u00a0]/g, ''));
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.round(n);
  }

  function isMoneySet(raw) {
    return Number.isFinite(parseMoneyInput(raw));
  }

  function emptyState() {
    return {
      categories: [],
      colors: [],
      sizes: [],
      brands: [],
      materials: [],
      styles: [],
      fits: [],
      conditions: [],
      budget_min: '',
      budget_max: '',
      rest: '',
      cleared: {},
    };
  }

  function stateFromParsed(p) {
    const s = emptyState();
    if (!p) return s;
    s.categories = asList(p.categories != null ? p.categories : p.category);
    s.colors = asList(p.colors != null ? p.colors : p.color);
    s.sizes = asList(p.sizes != null ? p.sizes : p.size);
    s.brands = asList(p.brands != null ? p.brands : p.brand);
    s.rest = p.rest || '';
    if (p.budget_min != null && p.budget_min !== '') s.budget_min = String(p.budget_min);
    const max = p.budget_max != null ? p.budget_max : p.budget;
    if (max != null && max !== '') s.budget_max = String(max);
    return s;
  }

  function collectAttributes(state) {
    const materials = asList(state.materials);
    const styles = asList(state.styles);
    const fits = asList(state.fits);
    const conditions = asList(state.conditions);
    const featureBits = [...materials, ...styles, ...fits, ...conditions, state.rest]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const min = parseMoneyInput(state.budget_min);
    const max = parseMoneyInput(state.budget_max);
    const categories = asList(state.categories);
    const colors = asList(state.colors);
    const sizes = asList(state.sizes);
    const brands = asList(state.brands);
    return {
      categories,
      colors,
      sizes,
      brands,
      category: categories[0] || null,
      color: colors[0] || null,
      size: sizes[0] || null,
      brand: brands[0] || null,
      budget_min: Number.isFinite(min) ? min : null,
      budget_max: Number.isFinite(max) ? max : null,
      budget: Number.isFinite(max) ? max : null,
      rest: featureBits.length ? featureBits.join(' ') : null,
      features: featureBits,
    };
  }

  function validatePrice(state) {
    const min = parseMoneyInput(state.budget_min);
    const max = parseMoneyInput(state.budget_max);
    if (String(state.budget_min || '').trim() && !Number.isFinite(min)) {
      return 'Цена «от» должна быть неотрицательным числом.';
    }
    if (String(state.budget_max || '').trim() && !Number.isFinite(max)) {
      return 'Цена «до» должна быть неотрицательным числом.';
    }
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
      return 'Цена «от» не может быть больше цены «до». Исправьте диапазон.';
    }
    return null;
  }

  function sizeMixNote(sizes) {
    if (!sizes || sizes.length < 2) return null;
    const letter = sizes.some((s) => /^[A-Z]{1,4}$/i.test(s));
    const numeric = sizes.some((s) => /^\d{2,3}$/.test(s));
    if (letter && numeric) {
      return 'Выбраны буквенные и числовые размеры. Системы не переводим — проверьте оба варианта на площадке.';
    }
    return null;
  }

  function clearList(state) {
    const list = [];
    if (state.cleared.price) list.push('budget', 'budget_min', 'budget_max');
    else {
      if (state.cleared.price_min) list.push('budget_min');
      if (state.cleared.price_max) list.push('budget_max', 'budget');
    }
    if (state.cleared.category) list.push('category', 'categories');
    if (state.cleared.color) list.push('color', 'colors');
    if (state.cleared.size) list.push('size', 'sizes');
    if (state.cleared.brand) list.push('brand', 'brands');
    if (state.cleared.rest || state.cleared.features) list.push('rest', 'features');
    return list;
  }

  function hasAnyFilter(state) {
    return !!(
      asList(state.categories).length
      || asList(state.colors).length
      || asList(state.sizes).length
      || asList(state.brands).length
      || isMoneySet(state.budget_min)
      || isMoneySet(state.budget_max)
      || asList(state.materials).length
      || asList(state.styles).length
      || asList(state.fits).length
      || asList(state.conditions).length
      || String(state.rest || '').trim()
    );
  }

  function truncate(text, max) {
    const t = String(text || '');
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + '…';
  }

  function multiChipLabel(prefix, values, emptyLabel) {
    const list = asList(values);
    if (!list.length) return emptyLabel;
    if (list.length === 1) return prefix + ': ' + truncate(list[0], 18);
    return prefix + ': ' + truncate(list[0], 12) + ' +' + (list.length - 1);
  }

  function chipLabel(id, state) {
    if (id === 'category') return multiChipLabel('Тип', state.categories, 'Тип одежды');
    if (id === 'color') return multiChipLabel('Цвет', state.colors, 'Цвет');
    if (id === 'size') return multiChipLabel('Размер', state.sizes, 'Размер');
    if (id === 'brand') return multiChipLabel('Бренд', state.brands, 'Бренд');
    if (id === 'price') {
      const min = parseMoneyInput(state.budget_min);
      const max = parseMoneyInput(state.budget_max);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        return 'Цена: ' + min.toLocaleString('ru-RU') + '–' + max.toLocaleString('ru-RU') + ' ₽';
      }
      if (Number.isFinite(max)) return 'Цена: до ' + max.toLocaleString('ru-RU') + ' ₽';
      if (Number.isFinite(min)) return 'Цена: от ' + min.toLocaleString('ru-RU') + ' ₽';
      return 'Цена';
    }
    if (id === 'features') {
      const bits = [
        ...asList(state.materials),
        ...asList(state.styles),
        ...asList(state.fits),
        ...asList(state.conditions),
        state.rest,
      ].filter(Boolean);
      return bits.length ? multiChipLabel('Особенности', bits, 'Особенности') : 'Особенности';
    }
    return id;
  }

  function chipActive(id, state) {
    if (id === 'category') return asList(state.categories).length > 0;
    if (id === 'color') return asList(state.colors).length > 0;
    if (id === 'size') return asList(state.sizes).length > 0;
    if (id === 'brand') return asList(state.brands).length > 0;
    if (id === 'price') return isMoneySet(state.budget_min) || isMoneySet(state.budget_max);
    if (id === 'features') {
      return !!(
        asList(state.materials).length
        || asList(state.styles).length
        || asList(state.fits).length
        || asList(state.conditions).length
        || String(state.rest || '').trim()
      );
    }
    return false;
  }

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
  }

  function mount(host, initial, handlers) {
    if (!host) return null;
    const state = Object.assign(emptyState(), initial || {});
    state.categories = asList(state.categories != null ? state.categories : state.category);
    state.colors = asList(state.colors != null ? state.colors : state.color);
    state.sizes = asList(state.sizes != null ? state.sizes : state.size);
    state.brands = asList(state.brands != null ? state.brands : state.brand);
    state.materials = asList(state.materials);
    state.styles = asList(state.styles);
    state.fits = asList(state.fits);
    state.conditions = asList(state.conditions);
    if (!state.cleared || typeof state.cleared !== 'object') state.cleared = {};
    const onChange = handlers && handlers.onChange ? handlers.onChange : () => {};

    let openId = null;
    let openerBtn = null;
    let panelEl = null;
    let backdropEl = null;
    const chipButtons = {};

    document.querySelectorAll('.criteria-backdrop, #criteria-popover').forEach((node) => {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    host.replaceChildren();
    host.classList.add('criteria-chips');
    host.setAttribute('aria-label', 'Критерии поиска');

    const row = el('div', 'criteria-chip-row');
    const resetAllBtn = el('button', 'btn btn-ghost criteria-reset-all', 'Сбросить фильтры');
    resetAllBtn.type = 'button';
    resetAllBtn.hidden = true;

    function notify() {
      paintChips();
      onChange(getApi());
    }

    function paintChips() {
      CHIP_DEFS.forEach((def) => {
        const btn = chipButtons[def.id];
        if (!btn) return;
        btn.replaceChildren();
        if (def.id === 'color' && state.colors.length) {
          const found = COLOR_OPTIONS.find((c) => c.id === state.colors[0]);
          if (found) btn.appendChild(swatchNode(found.swatch));
        }
        const label = chipLabel(def.id, state);
        btn.appendChild(document.createTextNode(label));
        btn.title = asList(
          def.id === 'category' ? state.categories
            : def.id === 'color' ? state.colors
              : def.id === 'size' ? state.sizes
                : def.id === 'brand' ? state.brands
                  : def.id === 'features'
                    ? [...state.materials, ...state.styles, ...state.fits, ...state.conditions, state.rest]
                    : []
        ).join(', ') || label;
        btn.setAttribute('aria-label', btn.title);
        const active = chipActive(def.id, state);
        btn.classList.toggle('is-active', active);
        btn.classList.toggle('is-open', openId === def.id);
        btn.setAttribute('aria-expanded', openId === def.id ? 'true' : 'false');
      });
      resetAllBtn.hidden = !hasAnyFilter(state);
    }

    function lockBody(on) {
      if (!isMobile()) return;
      if (on) {
        document.body.dataset.criteriaScrollY = String(window.scrollY || 0);
        document.body.classList.add('criteria-sheet-open');
        document.body.style.top = '-' + (window.scrollY || 0) + 'px';
      } else {
        document.body.classList.remove('criteria-sheet-open');
        const y = Number(document.body.dataset.criteriaScrollY || 0);
        document.body.style.top = '';
        window.scrollTo(0, y);
      }
    }

    function closePanel() {
      if (!openId) return;
      const was = openId;
      openId = null;
      if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
      panelEl = null;
      if (backdropEl && backdropEl.parentNode) backdropEl.parentNode.removeChild(backdropEl);
      backdropEl = null;
      lockBody(false);
      paintChips();
      const btn = chipButtons[was];
      if (btn) {
        try { btn.focus(); } catch (_) { /* ignore */ }
      }
      openerBtn = null;
    }

    function positionPanel(btn) {
      if (!panelEl || isMobile()) {
        if (panelEl) {
          panelEl.style.left = '';
          panelEl.style.top = '';
          panelEl.style.right = '';
          panelEl.style.bottom = '';
        }
        return;
      }
      const rect = btn.getBoundingClientRect();
      const pad = 8;
      const width = Math.min(380, window.innerWidth - pad * 2);
      let left = rect.left;
      if (left + width > window.innerWidth - pad) left = window.innerWidth - pad - width;
      if (left < pad) left = pad;
      let top = rect.bottom + 8;
      panelEl.style.width = width + 'px';
      panelEl.style.left = left + 'px';
      panelEl.style.top = top + 'px';
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
      requestAnimationFrame(() => {
        if (!panelEl || !panelEl.isConnected) return;
        const pr = panelEl.getBoundingClientRect();
        if (pr.bottom > window.innerHeight - pad) {
          const up = rect.top - pr.height - 8;
          if (up >= pad) panelEl.style.top = up + 'px';
        }
      });
    }

    function buildPanelBody(id, body) {
      body.replaceChildren();
      const err = el('p', 'criteria-error');
      err.hidden = true;
      err.setAttribute('role', 'alert');
      function showErr(msg) {
        err.hidden = !msg;
        err.textContent = msg || '';
      }

      const clearBtn = el('button', 'btn btn-ghost criteria-panel-clear', 'Сбросить');
      clearBtn.type = 'button';

      if (id === 'category') {
        const search = el('input', 'criteria-input');
        search.type = 'text';
        search.placeholder = 'Найти тип…';
        search.setAttribute('aria-label', 'Поиск типа одежды');
        const list = el('div', 'criteria-options');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-multiselectable', 'true');
        function renderTypes(filter) {
          list.replaceChildren();
          const q = String(filter || '').trim().toLowerCase();
          CATEGORY_GROUPS.forEach((group) => {
            const items = group.items.filter((name) => !q || name.toLowerCase().includes(q));
            if (!items.length) return;
            list.appendChild(el('p', 'criteria-group-label', group.label));
            items.forEach((name) => {
              const on = state.categories.some((c) => c.toLowerCase() === name.toLowerCase());
              const btn = el('button', 'criteria-option' + (on ? ' is-on' : ''), name);
              btn.type = 'button';
              btn.setAttribute('role', 'option');
              btn.setAttribute('aria-selected', on ? 'true' : 'false');
              btn.addEventListener('click', () => {
                state.categories = toggleInList(state.categories, name);
                if (state.categories.length) delete state.cleared.category;
                else state.cleared.category = true;
                renderTypes(search.value);
                notify();
              });
              list.appendChild(btn);
            });
          });
          if (q && !CATEGORY_GROUPS.some((g) => g.items.some((n) => n.toLowerCase().includes(q)))) {
            const custom = el('button', 'criteria-option', 'Добавить «' + filter.trim() + '»');
            custom.type = 'button';
            custom.addEventListener('click', () => {
              state.categories = toggleInList(state.categories, filter.trim());
              delete state.cleared.category;
              renderTypes(search.value);
              notify();
            });
            list.appendChild(custom);
          }
        }
        search.addEventListener('input', () => renderTypes(search.value));
        search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        clearBtn.addEventListener('click', () => {
          state.categories = [];
          state.cleared.category = true;
          renderTypes(search.value);
          notify();
        });
        body.appendChild(search);
        body.appendChild(list);
        renderTypes('');
      } else if (id === 'color') {
        const list = el('div', 'criteria-options color-options');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-multiselectable', 'true');
        function paintColors() {
          list.replaceChildren();
          COLOR_OPTIONS.forEach((opt) => {
            const on = state.colors.includes(opt.id);
            const btn = el('button', 'criteria-option color-option' + (on ? ' is-on' : ''));
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.setAttribute('aria-label', opt.label);
            btn.appendChild(swatchNode(opt.swatch));
            btn.appendChild(document.createTextNode(opt.label));
            btn.addEventListener('click', () => {
              state.colors = toggleInList(state.colors, opt.id);
              if (state.colors.length) delete state.cleared.color;
              else state.cleared.color = true;
              paintColors();
              notify();
            });
            list.appendChild(btn);
          });
        }
        clearBtn.addEventListener('click', () => {
          state.colors = [];
          state.cleared.color = true;
          paintColors();
          notify();
        });
        body.appendChild(list);
        paintColors();
      } else if (id === 'size') {
        if (!state.sizeTab) state.sizeTab = 'letter';
        const tabs = el('div', 'criteria-size-tabs');
        const tabLetter = el('button', 'btn btn-ghost criteria-size-tab', 'Буквенные');
        tabLetter.type = 'button';
        tabLetter.setAttribute('aria-pressed', state.sizeTab === 'letter' ? 'true' : 'false');
        const tabNum = el('button', 'btn btn-ghost criteria-size-tab', 'Числовые');
        tabNum.type = 'button';
        tabNum.setAttribute('aria-pressed', state.sizeTab === 'numeric' ? 'true' : 'false');
        tabs.appendChild(tabLetter);
        tabs.appendChild(tabNum);
        const list = el('div', 'criteria-options size-options');
        const note = el('p', 'criteria-hint');
        const orphan = el('p', 'criteria-hint');
        function paintSizes() {
          tabLetter.classList.toggle('is-on', state.sizeTab === 'letter');
          tabNum.classList.toggle('is-on', state.sizeTab === 'numeric');
          tabLetter.setAttribute('aria-pressed', state.sizeTab === 'letter' ? 'true' : 'false');
          tabNum.setAttribute('aria-pressed', state.sizeTab === 'numeric' ? 'true' : 'false');
          list.replaceChildren();
          const options =
            state.sizeTab === 'letter' ? SIZE_LETTER_OPTIONS : numericSizesForState(state);
          options.forEach((sz) => {
            const on = state.sizes.includes(sz);
            const btn = el('button', 'criteria-option' + (on ? ' is-on' : ''), sz);
            btn.type = 'button';
            btn.addEventListener('click', () => {
              state.sizes = toggleInList(state.sizes, sz);
              if (state.sizes.length) delete state.cleared.size;
              else state.cleared.size = true;
              paintSizes();
              notify();
            });
            list.appendChild(btn);
          });
          // Выбранные значения с другой вкладки не теряем — показываем кратко.
          const other = state.sizes.filter((sz) => !options.includes(sz));
          if (other.length) {
            orphan.hidden = false;
            orphan.textContent = 'Также выбрано: ' + other.join(', ');
          } else {
            orphan.hidden = true;
            orphan.textContent = '';
          }
          const mix = sizeMixNote(state.sizes);
          note.hidden = !mix;
          note.textContent = mix || '';
        }
        tabLetter.addEventListener('click', () => {
          state.sizeTab = 'letter';
          paintSizes();
        });
        tabNum.addEventListener('click', () => {
          state.sizeTab = 'numeric';
          paintSizes();
        });
        clearBtn.addEventListener('click', () => {
          state.sizes = [];
          state.cleared.size = true;
          paintSizes();
          notify();
        });
        body.appendChild(tabs);
        body.appendChild(list);
        body.appendChild(orphan);
        body.appendChild(note);
        paintSizes();
      } else if (id === 'price') {
        const priceRow = el('div', 'price-row');
        const minInput = el('input', 'criteria-input');
        minInput.type = 'text';
        minInput.inputMode = 'numeric';
        minInput.placeholder = 'От';
        minInput.setAttribute('aria-label', 'Цена от');
        minInput.value = formatThousands(state.budget_min);
        const maxInput = el('input', 'criteria-input');
        maxInput.type = 'text';
        maxInput.inputMode = 'numeric';
        maxInput.placeholder = 'До';
        maxInput.setAttribute('aria-label', 'Цена до');
        maxInput.value = formatThousands(state.budget_max);
        function onPrice(which, input) {
          input.value = formatThousands(input.value);
          const digits = input.value.replace(/\s/g, '');
          state[which] = digits;
          if (which === 'budget_min') {
            if (digits) {
              delete state.cleared.price_min;
              delete state.cleared.price;
            } else state.cleared.price_min = true;
          }
          if (which === 'budget_max') {
            if (digits) {
              delete state.cleared.price_max;
              delete state.cleared.price;
            } else state.cleared.price_max = true;
          }
          if (!isMoneySet(state.budget_min) && !isMoneySet(state.budget_max)) {
            state.cleared.price = true;
          }
          showErr(validatePrice(state));
          notify();
        }
        minInput.addEventListener('input', () => onPrice('budget_min', minInput));
        maxInput.addEventListener('input', () => onPrice('budget_max', maxInput));
        [minInput, maxInput].forEach((inp) => {
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        });
        clearBtn.addEventListener('click', () => {
          state.budget_min = '';
          state.budget_max = '';
          state.cleared.price = true;
          state.cleared.price_min = true;
          state.cleared.price_max = true;
          minInput.value = '';
          maxInput.value = '';
          showErr(null);
          notify();
        });
        priceRow.appendChild(minInput);
        priceRow.appendChild(maxInput);
        body.appendChild(priceRow);
        body.appendChild(el('p', 'criteria-hint', 'Пустое поле — без ограничения. Валюта: RUB.'));
        showErr(validatePrice(state));
      } else if (id === 'brand') {
        const search = el('input', 'criteria-input');
        search.type = 'text';
        search.placeholder = 'Найти или добавить бренд';
        search.setAttribute('aria-label', 'Бренд');
        const selected = el('div', 'criteria-options');
        const list = el('div', 'criteria-options');
        function paintBrands(filter) {
          selected.replaceChildren();
          state.brands.forEach((b) => {
            const chip = el('button', 'criteria-option is-on', b + ' ×');
            chip.type = 'button';
            chip.setAttribute('aria-label', 'Убрать ' + b);
            chip.addEventListener('click', () => {
              state.brands = toggleInList(state.brands, b);
              if (!state.brands.length) state.cleared.brand = true;
              paintBrands(search.value);
              notify();
            });
            selected.appendChild(chip);
          });
          list.replaceChildren();
          const q = String(filter || '').trim().toLowerCase();
          const opts = KNOWN_BRANDS.filter((b) => !q || b.toLowerCase().includes(q));
          opts.forEach((b) => {
            if (state.brands.some((x) => x.toLowerCase() === b.toLowerCase())) return;
            const btn = el('button', 'criteria-option', b);
            btn.type = 'button';
            btn.addEventListener('click', () => {
              state.brands = toggleInList(state.brands, b);
              delete state.cleared.brand;
              paintBrands(search.value);
              notify();
            });
            list.appendChild(btn);
          });
          if (q && !KNOWN_BRANDS.some((b) => b.toLowerCase() === q)
            && !state.brands.some((b) => b.toLowerCase() === q)) {
            const add = el('button', 'criteria-option', 'Добавить «' + filter.trim() + '»');
            add.type = 'button';
            add.addEventListener('click', () => {
              state.brands = toggleInList(state.brands, filter.trim());
              delete state.cleared.brand;
              search.value = '';
              paintBrands('');
              notify();
            });
            list.appendChild(add);
          }
        }
        search.addEventListener('input', () => paintBrands(search.value));
        search.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const v = search.value.trim();
            if (!v) return;
            state.brands = toggleInList(state.brands, v);
            delete state.cleared.brand;
            search.value = '';
            paintBrands('');
            notify();
          }
        });
        clearBtn.addEventListener('click', () => {
          state.brands = [];
          state.cleared.brand = true;
          paintBrands(search.value);
          notify();
        });
        body.appendChild(search);
        body.appendChild(selected);
        body.appendChild(list);
        paintBrands('');
      } else if (id === 'features') {
        const keyMap = { material: 'materials', style: 'styles', fit: 'fits', condition: 'conditions' };
        Object.keys(FEATURE_OPTIONS).forEach((key) => {
          const meta = FEATURE_OPTIONS[key];
          const stateKey = keyMap[key];
          const featRow = el('div', 'feature-row');
          featRow.appendChild(el('span', 'feature-label', meta.label));
          const wrap = el('div', 'criteria-options');
          meta.values.forEach((val) => {
            const on = state[stateKey].includes(val);
            const btn = el('button', 'criteria-option' + (on ? ' is-on' : ''), val);
            btn.type = 'button';
            btn.addEventListener('click', () => {
              state[stateKey] = toggleInList(state[stateKey], val);
              if (hasAnyFilter({
                ...emptyState(),
                materials: state.materials,
                styles: state.styles,
                fits: state.fits,
                conditions: state.conditions,
                rest: state.rest,
              })) delete state.cleared.features;
              else state.cleared.features = true;
              buildPanelBody(id, body);
              notify();
            });
            wrap.appendChild(btn);
          });
          featRow.appendChild(wrap);
          body.appendChild(featRow);
        });
        const restInput = el('input', 'criteria-input');
        restInput.type = 'text';
        restInput.placeholder = 'Свободное уточнение';
        restInput.setAttribute('aria-label', 'Свободное уточнение');
        restInput.value = state.rest || '';
        restInput.addEventListener('input', () => {
          state.rest = restInput.value.trim();
          if (state.rest) delete state.cleared.rest;
          else state.cleared.rest = true;
          notify();
        });
        restInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        clearBtn.addEventListener('click', () => {
          state.materials = [];
          state.styles = [];
          state.fits = [];
          state.conditions = [];
          state.rest = '';
          state.cleared.features = true;
          state.cleared.rest = true;
          buildPanelBody(id, body);
          notify();
        });
        body.appendChild(restInput);
      }

      body.appendChild(err);
      const foot = el('div', 'criteria-panel-foot');
      foot.appendChild(clearBtn);
      const done = el('button', 'btn btn-primary', 'Готово');
      done.type = 'button';
      done.addEventListener('click', () => closePanel());
      foot.appendChild(done);
      body.appendChild(foot);
    }

    function scrubOrphans() {
      document.querySelectorAll('.criteria-backdrop, #criteria-popover').forEach((node) => {
        if (node === panelEl || node === backdropEl) return;
        if (node.parentNode) node.parentNode.removeChild(node);
      });
      if (!openId) {
        document.body.classList.remove('criteria-sheet-open');
        document.body.style.top = '';
      }
    }

    function openPanel(id, btn) {
      if (openId === id) {
        closePanel();
        return;
      }
      // Смена чипа: сначала снять предыдущую панель/backdrop (иначе «залипают» слои).
      if (openId) closePanel();
      scrubOrphans();
      openId = id;
      openerBtn = btn;
      const mobile = isMobile();
      // Backdrop только на мобильной sheet — на desktop не держим невидимый слой в DOM.
      backdropEl = null;
      if (mobile) {
        backdropEl = el('div', 'criteria-backdrop');
        backdropEl.addEventListener('click', () => closePanel());
        document.body.appendChild(backdropEl);
      }
      panelEl = el('div', 'criteria-popover glass');
      panelEl.id = 'criteria-popover';
      panelEl.setAttribute('role', 'dialog');
      panelEl.setAttribute('aria-modal', mobile ? 'true' : 'false');
      document.body.appendChild(panelEl);
      const head = el('div', 'criteria-popover-head');
      const title = CHIP_DEFS.find((d) => d.id === id);
      const titleEl = el('h3', null, title ? title.label : id);
      titleEl.id = 'criteria-popover-title';
      head.appendChild(titleEl);
      const closeX = el('button', 'btn btn-ghost', 'Закрыть');
      closeX.type = 'button';
      closeX.addEventListener('click', () => closePanel());
      head.appendChild(closeX);
      panelEl.appendChild(head);
      const body = el('div', 'criteria-popover-body');
      panelEl.appendChild(body);
      buildPanelBody(id, body);
      panelEl.setAttribute('aria-labelledby', 'criteria-popover-title');
      lockBody(mobile);
      positionPanel(btn);
      paintChips();
      const focusable = panelEl.querySelector('input, button.criteria-option, button.btn-primary');
      try { (focusable || panelEl).focus(); } catch (_) { /* ignore */ }
    }

    CHIP_DEFS.forEach((def) => {
      const wrap = el('div', 'criteria-chip-wrap');
      const btn = el('button', 'btn btn-ghost criteria-chip');
      btn.type = 'button';
      btn.id = 'criteria-chip-' + def.id;
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-controls', 'criteria-popover');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => openPanel(def.id, btn));
      chipButtons[def.id] = btn;
      wrap.appendChild(btn);
      row.appendChild(wrap);
    });

    resetAllBtn.addEventListener('click', () => {
      Object.assign(state, emptyState());
      state.cleared = {
        price: true,
        price_min: true,
        price_max: true,
        category: true,
        color: true,
        size: true,
        brand: true,
        rest: true,
        features: true,
      };
      closePanel();
      notify();
    });
    row.appendChild(resetAllBtn);
    host.appendChild(row);
    paintChips();

    function onDocKey(e) {
      if (!openId) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
        return;
      }
      if (e.key !== 'Tab' || !panelEl || !isMobile()) return;
      const nodes = [...panelEl.querySelectorAll('button, input')].filter((n) => !n.disabled);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    function onDocClick(e) {
      if (!openId || !panelEl) return;
      if (isMobile()) return;
      if (panelEl.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.criteria-chip')) return;
      closePanel();
    }
    function onResize() {
      if (openId && openerBtn) positionPanel(openerBtn);
    }
    document.addEventListener('keydown', onDocKey);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('resize', onResize);

    function getApi() {
      return {
        get state() { return state; },
        get attributes() { return collectAttributes(state); },
        get clear_attributes() { return clearList(state); },
        get priceError() { return validatePrice(state); },
        closePanel,
        syncFromParsed(p) {
          document.removeEventListener('keydown', onDocKey);
          document.removeEventListener('mousedown', onDocClick);
          window.removeEventListener('resize', onResize);
          closePanel();
          return mount(host, stateFromParsed(p), handlers);
        },
        destroy() {
          document.removeEventListener('keydown', onDocKey);
          document.removeEventListener('mousedown', onDocClick);
          window.removeEventListener('resize', onResize);
          closePanel();
          document.querySelectorAll('.criteria-backdrop, #criteria-popover').forEach((node) => {
            if (node.parentNode) node.parentNode.removeChild(node);
          });
        },
      };
    }

    return getApi();
  }

  window.VishFindCriteria = {
    COLOR_OPTIONS,
    CATEGORY_GROUPS,
    SIZE_OPTIONS,
    SIZE_LETTER_OPTIONS,
    SIZE_NUMERIC_OPTIONS,
    FEATURE_OPTIONS,
    CHIP_DEFS,
    MAX_MULTI,
    emptyState,
    stateFromParsed,
    collectAttributes,
    validatePrice,
    mount,
    formatThousands,
    parseMoneyInput,
    asList,
  };
})();
