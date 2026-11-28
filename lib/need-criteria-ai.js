'use strict';

/**
 * Критерии «лучших» вариантов под запрос.
 * Сначала правила по типу вещи; при наличии Ollama/Qwen — уточнение без выдуманных полей товара.
 */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function uniqueTerms(list, max) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    const s = String(item == null ? '' : item).trim();
    if (!s || s.length > 40) continue;
    const key = norm(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= (max || 12)) break;
  }
  return out;
}

function baseTrio() {
  return [
    { id: 'relevance', label: 'Соответствие запросу', weight: 2 },
    { id: 'price', label: 'Цена', weight: 1 },
    { id: 'quality_signals', label: 'Признаки качества в названии', weight: 1 },
  ];
}

/**
 * Эвристика без нейросети: 3 общих + 2 под тип вещи.
 */
function fallbackNeedCriteria(query, parsed) {
  const q = norm(query) + ' ' + norm(parsed && parsed.category) + ' ' + norm(parsed && parsed.rest);
  const criteria = baseTrio();
  let boost_terms = [];
  let penalize_terms = [];
  let focus = parsed && parsed.category ? String(parsed.category) : null;

  if (/зимн|тёпл|тепл|морозо|пуховик|парк/.test(q) || /пуховик|парка|дублёнка/.test(q)) {
    criteria.push(
      { id: 'warmth', label: 'Теплота', weight: 1.6 },
      { id: 'weather', label: 'Защита от погоды', weight: 1.2 }
    );
    boost_terms = ['тёпл', 'тепл', 'пуховик', 'утепл', 'зимн', 'мембран', 'водооттал'];
    penalize_terms = ['летн', 'тонк', 'лёгк', 'легк', 'сетк'];
    focus = focus || 'куртка';
  } else if (/летн|дышащ|лёгк|легк|жарк/.test(q)) {
    criteria.push(
      { id: 'breathable', label: 'Лёгкость / дышащие свойства', weight: 1.5 },
      { id: 'comfort', label: 'Комфорт', weight: 1.1 }
    );
    boost_terms = ['летн', 'лёгк', 'легк', 'дышащ', 'хлопок', 'лен', 'тонк'];
    penalize_terms = ['зимн', 'утепл', 'пуховик', 'толст'];
  } else if (/джин|брюк|штан|карго|чинос/.test(q)) {
    criteria.push(
      { id: 'fit', label: 'Посадка', weight: 1.3 },
      { id: 'comfort', label: 'Комфорт в носке', weight: 1.2 }
    );
    boost_terms = ['slim', 'regular', 'straight', 'stretch', 'стрейч', 'хлопок'];
    penalize_terms = ['куртк', 'jacket', 'бомбер'];
    focus = focus || 'джинсы';
  } else if (/куртк|бомбер|ветровк|косух|тренч|плащ/.test(q)) {
    criteria.push(
      { id: 'weather', label: 'Практичность', weight: 1.3 },
      { id: 'material', label: 'Материал', weight: 1.2 }
    );
    boost_terms = ['кож', 'мембран', 'водооттал', 'утепл'];
    penalize_terms = ['шорт', 'футболк', 'брюк'];
    focus = focus || 'куртка';
  } else if (/сумк|рюкзак|клатч|портфел/.test(q)) {
    criteria.push(
      { id: 'material', label: 'Материал', weight: 1.4 },
      { id: 'capacity', label: 'Вместимость / формат', weight: 1.2 }
    );
    boost_terms = ['кож', 'натуральн', 'вмест', 'через плечо', 'кроссбоди'];
    penalize_terms = ['игруш', 'чехол для'];
    focus = focus || 'сумка';
  } else if (/обув|кроссов|ботин|сапог|туфл|кед|лофер/.test(q)) {
    criteria.push(
      { id: 'comfort', label: 'Комфорт', weight: 1.3 },
      { id: 'material', label: 'Материал', weight: 1.2 }
    );
    boost_terms = ['кож', 'удобн', 'амортиз', 'мембран'];
    penalize_terms = ['игруш'];
  } else {
    criteria.push(
      { id: 'material', label: 'Материал', weight: 1.1 },
      { id: 'style', label: 'Стиль под запрос', weight: 1.1 }
    );
    boost_terms = uniqueTerms([parsed && parsed.color, parsed && parsed.rest].filter(Boolean), 6);
  }

  if (parsed && parsed.color) boost_terms.push(String(parsed.color));
  return {
    source: 'rules',
    external: false,
    focus_category: focus,
    criteria: criteria.slice(0, 5),
    boost_terms: uniqueTerms(boost_terms, 10),
    penalize_terms: uniqueTerms(penalize_terms, 10),
  };
}

function sanitizeAiCriteria(raw, fallback) {
  const fb = fallback || fallbackNeedCriteria('', {});
  if (!raw || typeof raw !== 'object') return fb;
  const criteria = [];
  for (const row of Array.isArray(raw.criteria) ? raw.criteria : []) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || row.label || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .slice(0, 40);
    const label = String(row.label || row.id || '').trim().slice(0, 80);
    const weight = Number(row.weight);
    if (!id || !label) continue;
    criteria.push({
      id,
      label,
      weight: Number.isFinite(weight) && weight > 0 ? Math.min(weight, 3) : 1,
    });
    if (criteria.length >= 5) break;
  }
  while (criteria.length < 5 && fb.criteria[criteria.length]) {
    criteria.push(fb.criteria[criteria.length]);
  }
  return {
    source: String(raw.source || 'ai').slice(0, 20),
    external: !!raw.external,
    focus_category: raw.focus_category
      ? String(raw.focus_category).trim().slice(0, 60)
      : fb.focus_category,
    criteria: criteria.slice(0, 5),
    boost_terms: uniqueTerms([].concat(raw.boost_terms || [], fb.boost_terms || []), 12),
    penalize_terms: uniqueTerms([].concat(raw.penalize_terms || [], fb.penalize_terms || []), 12),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.query
 * @param {object} opts.parsed
 * @param {Function} [opts.ollamaChat] async ({model, messages, format, think}) => data
 * @param {string} [opts.model]
 * @param {number} [opts.timeoutMs]
 */
async function suggestNeedCriteria(opts) {
  const options = opts || {};
  const query = String(options.query || '');
  const parsed = options.parsed || {};
  const fallback = fallbackNeedCriteria(query, parsed);
  if (typeof options.ollamaChat !== 'function' || !options.model) {
    return fallback;
  }

  const system =
    'Ты помощник сервиса подбора одежды VishFind. Отвечай только JSON без markdown. ' +
    'Нужно предложить ровно 5 критериев выбора лучших товаров под запрос пользователя: ' +
    '3 универсальных и 2 специфичных для типа вещи. ' +
    'Не выдумывай наличие атрибутов у конкретных товаров. ' +
    'boost_terms / penalize_terms — короткие русские/латинские куски для поиска в названии.';

  const user =
    'Запрос: ' +
    JSON.stringify(query) +
    '\nРазобранные поля: ' +
    JSON.stringify({
      category: parsed.category || null,
      color: parsed.color || null,
      brand: parsed.brand || null,
      rest: parsed.rest || null,
    }) +
    '\nВерни JSON вида: {"focus_category":"строка|null","criteria":[{"id":"...","label":"...","weight":1.2}],' +
    '"boost_terms":["..."],"penalize_terms":["..."]}. Ровно 5 criteria.';

  try {
    const data = await options.ollamaChat(
      {
        model: options.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        format: 'json',
        think: false,
        stream: false,
      },
      options.timeoutMs || 6000
    );
    const content =
      data &&
      data.message &&
      (typeof data.message.content === 'string'
        ? data.message.content
        : JSON.stringify(data.message.content || {}));
    let parsedJson = null;
    try {
      parsedJson = JSON.parse(content || '{}');
    } catch (_) {
      const m = String(content || '').match(/\{[\s\S]*\}/);
      if (m) parsedJson = JSON.parse(m[0]);
    }
    const out = sanitizeAiCriteria(
      Object.assign({}, parsedJson, {
        source: options.provider || 'ollama',
        external: !!options.external,
      }),
      fallback
    );
    return out;
  } catch (_) {
    return fallback;
  }
}

/** Режим для сайта: rules = бесплатно на сервере, без внешних вызовов. */
function resolveNeedCriteriaMode(cfg) {
  const c = cfg || {};
  const p = String(c.needCriteriaProvider || 'auto').toLowerCase();
  if (p === 'rules') return 'rules';
  if (p === 'timeweb') return c.timewebConfigured ? 'timeweb' : 'rules';
  if (p === 'ollama') return c.aiEnabled ? 'ollama' : 'rules';
  // auto: на проде всегда rules (бесплатно, на сайте, ничего не уходит наружу)
  if (c.isProd) return 'rules';
  if (c.aiEnabled && c.photoProvider === 'ollama') return 'ollama';
  return 'rules';
}

/**
 * Доп. баллы только по явным словам в названии.
 */
function rankingExtraScore(title, ranking) {
  if (!ranking) return 0;
  const hay = norm(title);
  let extra = 0;
  for (const t of ranking.boost_terms || []) {
    const n = norm(t);
    if (n && hay.includes(n)) extra += 3;
  }
  for (const t of ranking.penalize_terms || []) {
    const n = norm(t);
    if (n && hay.includes(n)) extra -= 5;
  }
  for (const c of ranking.criteria || []) {
    if (c.id === 'warmth' && /тёпл|тепл|утепл|пуховик|зимн/.test(hay)) extra += 2 * (c.weight || 1);
    if (c.id === 'breathable' && /лёгк|легк|дышащ|летн|тонк|хлопок/.test(hay)) {
      extra += 2 * (c.weight || 1);
    }
    if (c.id === 'material' && /кож|замш|нубук|хлопок|шерст|лён|лен/.test(hay)) {
      extra += 1.5 * (c.weight || 1);
    }
    if (c.id === 'quality_signals' && /премиум|натуральн|оригинал|качество/.test(hay)) {
      extra += 1.2 * (c.weight || 1);
    }
  }
  return extra;
}

const BADGE_BY_ID = {
  relevance: 'Лучше всего подходит',
  price: 'Выгоднее по цене',
  quality_signals: 'Лучше по качеству',
  warmth: 'Теплее',
  breathable: 'Легче / дышащие',
  material: 'Лучше по материалу',
  fit: 'Лучше по посадке',
  comfort: 'Комфортнее',
  weather: 'Практичнее',
  capacity: 'Удобнее по формату',
  style: 'Ближе по стилю',
};

function badgeForCriterion(criterion) {
  const id = criterion && criterion.id ? String(criterion.id) : '';
  if (BADGE_BY_ID[id]) return BADGE_BY_ID[id];
  const label = criterion && criterion.label ? String(criterion.label).trim() : '';
  return label ? 'Лучше: ' + label : 'Лучший вариант';
}

/**
 * Оценка карточки по одному критерию — только цена/название, без выдуманных полей.
 */
function scoreOfferForCriterion(offer, criterion) {
  if (!offer || !criterion) return 0;
  const id = String(criterion.id || '');
  const weight = Number(criterion.weight) > 0 ? Number(criterion.weight) : 1;
  const hay = norm(offer.title);
  const price = Number(offer.price);
  const hasPrice = Number.isFinite(price) && offer.currency;
  const needBase = Number(offer.need_score) || Number(offer.score) || 0;
  let raw = 0;

  if (id === 'price') {
    raw = hasPrice ? 1000000 / (price + 1) : needBase * 0.05;
  } else if (id === 'relevance' || id === 'style') {
    raw = needBase;
  } else if (id === 'quality_signals') {
    if (/премиум|натуральн|оригинал|качество|мерсериз/.test(hay)) raw += 8;
    if (/кож|хлопок|шерст|лён|лен|замш/.test(hay)) raw += 3;
    raw += needBase * 0.05;
  } else if (id === 'warmth') {
    if (/утепл|пуховик|зимн|тёпл|тепл|водооттал|футер/.test(hay)) raw += 10;
    if (/летн|тонк|лёгк|легк|сетк/.test(hay)) raw -= 6;
    raw += needBase * 0.05;
  } else if (id === 'breathable') {
    if (/лёгк|легк|дышащ|летн|тонк|хлопок|лён|лен|сетк/.test(hay)) raw += 10;
    if (/утепл|пуховик|зимн|толст/.test(hay)) raw -= 6;
    raw += needBase * 0.05;
  } else if (id === 'material') {
    if (/кож|замш|нубук|хлопок|шерст|лён|лен|вельвет|трикотаж/.test(hay)) raw += 9;
    raw += needBase * 0.05;
  } else if (id === 'fit') {
    if (/slim|regular|straight|клеш|прям|посадк|оверсайз|oversize|стрейч|stretch/.test(hay)) {
      raw += 8;
    }
    raw += needBase * 0.05;
  } else if (id === 'comfort') {
    if (/комфорт|мягк|эластич|стрейч|stretch|удобн/.test(hay)) raw += 8;
    raw += needBase * 0.05;
  } else if (id === 'weather') {
    if (/водооттал|мембран|ветро|дожде|непромока/.test(hay)) raw += 10;
    raw += needBase * 0.05;
  } else if (id === 'capacity') {
    if (/вмест|через плечо|кроссбоди|поуч|дорожн|квадратн/.test(hay)) raw += 8;
    raw += needBase * 0.05;
  } else {
    raw = needBase;
  }

  return raw * weight;
}

function brandKeyOf(offer) {
  return (
    norm(offer && (offer.brand || offer.marketplace || offer.store_title || offer.source)) ||
    'unknown'
  );
}

function stripNeedScore(row) {
  if (!row || typeof row !== 'object') return row;
  const { need_score, ...rest } = row;
  return rest;
}

const FILL_BADGES = [
  'Сильный вариант',
  'Ещё один топ',
  'Достойная альтернатива',
  'Близко к запросу',
  'Стоит рассмотреть',
];

/**
 * По каждому критерию — лучшая ещё не взятая карточка.
 * Так 5 карточек = 5 разных «в чём лучше», а не случайный микс.
 */
function pickBestByCriteria(rows, criteria, max) {
  const limit = Math.max(1, Math.min(Number(max) || 5, 5));
  const list = Array.isArray(criteria) && criteria.length ? criteria.slice(0, limit) : [];
  const pool = Array.isArray(rows) ? rows.slice() : [];
  const picked = [];
  const usedIds = new Set();
  const usedBrands = new Set();
  const usedBadges = new Set();

  function brandCount(brand) {
    let n = 0;
    for (const row of picked) {
      if (brandKeyOf(row) === brand) n += 1;
    }
    return n;
  }

  function bestForCriterion(crit, maxPerBrand) {
    let best = null;
    let bestScore = -Infinity;
    for (const row of pool) {
      const id = String(row.id);
      if (usedIds.has(id)) continue;
      if (brandCount(brandKeyOf(row)) >= maxPerBrand) continue;
      const sc = scoreOfferForCriterion(row, crit);
      if (sc > bestScore) {
        bestScore = sc;
        best = row;
      }
    }
    return best ? { row: best, score: bestScore } : null;
  }

  function pushPicked(row, crit, score) {
    const badge = crit ? badgeForCriterion(crit) : null;
    let label = badge;
    if (!label || usedBadges.has(label)) {
      for (const fb of FILL_BADGES) {
        if (!usedBadges.has(fb)) {
          label = fb;
          break;
        }
      }
      if (!label) label = badge || FILL_BADGES[0];
    }
    picked.push({
      ...stripNeedScore(row),
      need_score: row.need_score,
      best_for: {
        id: String((crit && crit.id) || 'relevance'),
        label,
        criterion_label: (crit && crit.label) || label,
        score: Math.round(Number(score) * 100) / 100,
      },
    });
    usedIds.add(String(row.id));
    usedBrands.add(brandKeyOf(row));
    usedBadges.add(label);
  }

  // Сначала по 1 магазину на критерий; если магазинов мало — добор с max 2 на бренд.
  for (const maxPerBrand of [1, 2]) {
    for (const crit of list) {
      if (picked.length >= limit) break;
      if (picked.some((p) => p.best_for && p.best_for.id === String(crit.id || ''))) continue;
      const hit = bestForCriterion(crit, maxPerBrand);
      if (!hit) continue;
      pushPicked(hit.row, crit, hit.score);
    }
    if (picked.length >= limit) break;
  }

  if (picked.length < limit) {
    const restSorted = pool
      .filter((row) => !usedIds.has(String(row.id)))
      .slice()
      .sort(
        (a, b) =>
          (Number(b.need_score) || Number(b.score) || 0) -
          (Number(a.need_score) || Number(a.score) || 0)
      );
    for (const maxPerBrand of [1, 2]) {
      for (const row of restSorted) {
        if (picked.length >= limit) break;
        if (usedIds.has(String(row.id))) continue;
        if (brandCount(brandKeyOf(row)) >= maxPerBrand) continue;
        pushPicked(row, null, Number(row.need_score) || Number(row.score) || 0);
      }
      if (picked.length >= limit) break;
    }
  }

  return picked.slice(0, limit);
}

/**
 * Для уже отобранных карточек (например 3+2 по бренду) — подписать «в чём лучше».
 */
function annotateBestFor(rows, criteria) {
  const list = Array.isArray(rows) ? rows : [];
  const crits = Array.isArray(criteria) && criteria.length ? criteria.slice() : [];
  const usedCrit = new Set();
  return list.map((row, idx) => {
    let bestCrit = null;
    let bestScore = -Infinity;
    for (const crit of crits) {
      const key = String(crit.id || crit.label || '');
      if (usedCrit.has(key)) continue;
      const sc = scoreOfferForCriterion(row, crit);
      if (sc > bestScore) {
        bestScore = sc;
        bestCrit = crit;
      }
    }
    if (!bestCrit && crits[idx]) bestCrit = crits[idx];
    if (!bestCrit) {
      return {
        ...row,
        best_for: {
          id: 'relevance',
          label: FILL_BADGES[idx % FILL_BADGES.length],
          criterion_label: 'Соответствие запросу',
          score: Number(row.need_score) || Number(row.score) || 0,
        },
      };
    }
    usedCrit.add(String(bestCrit.id || bestCrit.label || ''));
    const badge = badgeForCriterion(bestCrit);
    return {
      ...row,
      best_for: {
        id: String(bestCrit.id || ''),
        label: badge,
        criterion_label: bestCrit.label || badge,
        score: Math.round(bestScore * 100) / 100,
      },
    };
  });
}

module.exports = {
  fallbackNeedCriteria,
  suggestNeedCriteria,
  rankingExtraScore,
  sanitizeAiCriteria,
  resolveNeedCriteriaMode,
  scoreOfferForCriterion,
  pickBestByCriteria,
  annotateBestFor,
  badgeForCriterion,
};
