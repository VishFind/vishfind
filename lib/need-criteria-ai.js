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

module.exports = {
  fallbackNeedCriteria,
  suggestNeedCriteria,
  rankingExtraScore,
  sanitizeAiCriteria,
  resolveNeedCriteriaMode,
};
