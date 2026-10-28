'use strict';
/**
 * VishFind — сервер без npm-зависимостей (нужен Node.js 18+).
 *  - отдаёт статику из этой папки
 *  - POST /api/search : разбор запроса правилами + ссылки на площадки (основной путь)
 *  - POST /api/find   : старый путь с Ollama/фото (выключен, пока AI_ENABLED=false)
 *  - GET  /api/health : статус без внешних вызовов и без секретов
 * Настройки: lib/config.js (NODE_ENV, dev/prod). Логи: lib/logger.js (санитизация).
 * Запуск:  npm start   →   http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const { createLogger } = require('./lib/logger');
const { parseQuery, buildSearchPhrase } = require('./lib/parse-query');
const {
  mergeCriteria,
  publicCriteria,
  normalizeCriteria,
} = require('./lib/criteria-model');
const { createRateLimiter } = require('./lib/rate-limit');
const providers = require('./providers');
const offersApi = require('./lib/offers');
const {
  selectSources,
  adaptersForSelection,
  registrySummary,
} = require('./lib/source-registry');
const ollamaWeb = require('./lib/ollama-web');
const fxRates = require('./lib/fx-rates');
// eBay Browse API (реальные предложения) — опционально, только если ключи есть в .env.
const { createEbayProvider } = require('./providers/ebay');
const ebayProvider = createEbayProvider({
  clientId: config.ebay.clientId || null,
  clientSecret: config.ebay.clientSecret || null,
  marketplace: config.ebay.marketplace,
  circuitThreshold: config.ebay.circuitThreshold,
  circuitCooldownMs: config.ebay.circuitCooldownMs,
});

const ROOT = __dirname;

// ---------- настройки: lib/config.js (NODE_ENV, dev/prod, безопасные дефолты) ----------
const PORT = config.port;
/** Для хостинга слушаем все интерфейсы; локально можно HOST=127.0.0.1 */
const HOST = config.host;
const AI_ENABLED = config.aiEnabled;
/** Лимит тела: без фото достаточно малого JSON; с AI — до ~9 МБ (base64). */
const BODY_LIMIT_SEARCH = config.bodyLimitSearch;
const OLLAMA_URL = config.ollama.url;
// Лучше *-instruct: иначе ответ может уйти в thinking при пустом content.
const MODEL = config.ollama.model;
const OLLAMA_TIMEOUT_MS = config.ollama.timeoutMs;
/** Таймаут одного вызова Ollama при разборе фото — 90 с. */
const PHOTO_TIMEOUT_MS = config.ollama.photoTimeoutMs;
/** schema = один проход JSON Schema; twopass = свободное описание → JSON; auto = schema, при скудном результате twopass */
const PHOTO_PIPELINE = config.ollama.pipeline;
/** Одновременные разборы фото (тяжёлая операция). */
const PHOTO_CONCURRENCY = Math.max(1, Number(config.ollama.photoConcurrency || 1) || 1);
let photoInFlight = 0;

/** JSON Schema для structured outputs Ollama */
const PHOTO_FORMAT = {
  type: 'object',
  properties: {
    garment_type: { type: ['string', 'null'] },
    subtype: { type: ['string', 'null'] },
    color_primary: { type: ['string', 'null'] },
    color_extra: { type: 'array', items: { type: 'string' } },
    material: { type: ['string', 'null'] },
    pattern: { type: ['string', 'null'] },
    collar: { type: ['string', 'null'] },
    closure: { type: ['string', 'null'] },
    pockets: { type: ['string', 'null'] },
    length: { type: ['string', 'null'] },
    fit: { type: ['string', 'null'] },
    hardware_and_details: { type: ['string', 'null'] },
    era_or_style: { type: ['string', 'null'] },
    visible_text: { type: 'array', items: { type: 'string' } },
    brand: { type: ['string', 'null'] },
    model_name: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
  },
  required: [
    'garment_type',
    'subtype',
    'color_primary',
    'color_extra',
    'material',
    'pattern',
    'collar',
    'closure',
    'pockets',
    'length',
    'fit',
    'hardware_and_details',
    'era_or_style',
    'visible_text',
    'brand',
    'model_name',
    'description',
  ],
};
const TAVILY_KEY = config.webSearch.tavilyKey;
const OLLAMA_KEY = config.webSearch.ollamaKey;

const logger = createLogger({ level: config.logLevel });

const searchLimiter = createRateLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
});

// ---------- данные ----------
function loadJson(rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch (e) {
    logger.warn(rel + ' не загружен', { error: e.message });
    return fallback;
  }
}

let MOVIES = loadJson('movies.json', []);
const brandsApi = require('./lib/brands');
let BRANDS = brandsApi.aliasList();
let SOURCES = loadJson('data/sources.json', []);
const productHtml = require('./lib/product-html');

const NOTE =
  'Это переходы на поиск площадок, цены и наличие не проверялись';

// ---------- вспомогательное ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // inline script темы в HTML — нужен 'unsafe-inline' для script
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
    "img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; font-src 'self'; object-src 'none'",
};

function send(res, status, data) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 9 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        // Не уничтожаем сокет сразу: ответ 413 должен дойти до клиента.
        // Пауза чтения + Connection: close в обработчике закроют соединение после ответа.
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.pause();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req) {
  // X-Forwarded-For доверяем только за платформенным прокси (TRUST_PROXY=true).
  // Иначе клиент мог бы обойти rate limit подделкой заголовка.
  if (config.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function enforceRateLimit(req, res) {
  const hit = searchLimiter.check(clientIp(req));
  if (!hit.ok) {
    logger.warn('rate limit exceeded', { retry_after_sec: hit.retrySec });
    res.setHeader('Retry-After', String(hit.retrySec));
    send(res, 429, {
      error: `Слишком много запросов. Подождите около ${hit.retrySec} с и попробуйте снова.`,
      retry_after_sec: hit.retrySec,
    });
    return false;
  }
  return true;
}

function emptyParsed(raw) {
  return {
    budget: null,
    budget_min: null,
    budget_max: null,
    size: null,
    color: null,
    category: null,
    brand: null,
    movie: null,
    rest: null,
    search_phrase: null,
    raw_query: raw || '',
  };
}

function parsePriceAttr(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function applyPriceAttributes(out, attrs, overwrite) {
  const hasMin = Object.prototype.hasOwnProperty.call(attrs, 'budget_min')
    || Object.prototype.hasOwnProperty.call(attrs, 'price_min')
    || Object.prototype.hasOwnProperty.call(attrs, 'min_price_rub');
  const hasMax = Object.prototype.hasOwnProperty.call(attrs, 'budget_max')
    || Object.prototype.hasOwnProperty.call(attrs, 'budget')
    || Object.prototype.hasOwnProperty.call(attrs, 'max_price_rub')
    || Object.prototype.hasOwnProperty.call(attrs, 'price_max');
  if (hasMin) {
    const raw = attrs.budget_min != null ? attrs.budget_min
      : attrs.price_min != null ? attrs.price_min
        : attrs.min_price_rub;
    // overwrite: только непустые значения; сброс — через clear_attributes
    if (overwrite) {
      if (raw != null && raw !== '') out.budget_min = parsePriceAttr(raw);
    } else if (out.budget_min == null) {
      out.budget_min = parsePriceAttr(raw);
    }
  }
  if (hasMax) {
    const raw = attrs.budget_max != null ? attrs.budget_max
      : attrs.budget != null ? attrs.budget
        : attrs.price_max != null ? attrs.price_max
          : attrs.max_price_rub;
    if (overwrite) {
      if (raw != null && raw !== '') {
        out.budget_max = parsePriceAttr(raw);
        out.budget = out.budget_max;
      }
    } else if (out.budget_max == null && out.budget == null) {
      out.budget_max = parsePriceAttr(raw);
      out.budget = out.budget_max;
    }
  } else if (overwrite || out.budget == null) {
    const b = attrs.budget != null ? attrs.budget : attrs.max_price_rub;
    if (b != null && b !== '') {
      out.budget = parsePriceAttr(b);
      if (out.budget_max == null) out.budget_max = out.budget;
    }
  }
  if (out.budget == null && out.budget_max != null) out.budget = out.budget_max;
  if (out.budget_max == null && out.budget != null) out.budget_max = out.budget;
}

function applyClearAttributes(parsed, clearList) {
  if (!Array.isArray(clearList) || !clearList.length) return parsed;
  const out = { ...parsed };
  for (const key of clearList) {
    const k = String(key || '');
    if (k === 'budget' || k === 'budget_min' || k === 'budget_max' || k === 'price') {
      out.budget = null;
      out.budget_min = null;
      out.budget_max = null;
    } else if (Object.prototype.hasOwnProperty.call(out, k)) {
      out[k] = null;
    }
  }
  out.search_phrase = buildSearchPhrase(out, out.movie) || out.search_phrase;
  return out;
}

function publicParsed(parsed) {
  const pub = publicCriteria(parsed) || {};
  return {
    budget: pub.budget,
    budget_min: pub.budget_min,
    budget_max: pub.budget_max,
    size: pub.size,
    color: pub.color,
    category: pub.category,
    brand: pub.brand,
    sizes: pub.sizes || [],
    colors: pub.colors || [],
    categories: pub.categories || [],
    brands: pub.brands || [],
    movie: pub.movie,
    rest: pub.rest,
    search_phrase: pub.search_phrase,
    warnings: pub.warnings || [],
  };
}

function cleanAttr(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = String(v).trim();
  if (!s) return null;
  // Ollama иногда отдаёт строку "null" вместо JSON null
  if (/^(null|none|undefined|n\/a|nil)$/i.test(s)) return null;
  // модель часто пишет «не указано» вместо null; \b с кириллицей ненадёжен
  s = s
    .replace(/(^|[\s,;:.]+)(не\s*указан[оаые]?|неизвестн\w*|unknown|n\/a|none|null)(?=$|[\s,;:.]+)/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.]+|[\s,;:.]+$/g, '')
    .trim();
  if (!s || /^(null|none|unknown|n\/a|неизвестно|нет)$/i.test(s)) return null;
  return s;
}

/** Честный отказ: на фото нет одежды. */
function isNoGarmentResult(fields) {
  if (!fields) return true;
  const hasType = !!(cleanAttr(fields.garment_type) || cleanAttr(fields.subtype));
  const d = String(fields.description || '').toLowerCase();
  const saysNo =
    /нет одежд|не\s*(видн\w+\s+)?одежд|одежд\w+\s+нет|no clothing|not (wearing|a garment)|электрон|смартфон|наушник|phone|headphones/i.test(
      d
    );
  if (saysNo && !hasType) return true;
  if (!hasType && !cleanAttr(fields.color_primary) && !cleanAttr(fields.material)) return true;
  return false;
}

/** attributes из фото/ручной правки: заполняют только пустые поля текста (текст важнее). */
function applyAttributes(parsed, attrs) {
  if (!attrs || typeof attrs !== 'object') return parsed;
  const out = { ...parsed };
  if (out.category == null) out.category = cleanAttr(attrs.category);
  if (out.color == null) out.color = cleanAttr(attrs.color);
  if (out.brand == null) out.brand = cleanAttr(attrs.brand || attrs.visible_brand || attrs.brand_guess);
  if (out.size == null) out.size = cleanAttr(attrs.size);
  applyPriceAttributes(out, attrs, false);
  if (out.rest == null && attrs.description) out.rest = cleanAttr(attrs.description);
  if (out.rest == null && attrs.rest) out.rest = cleanAttr(attrs.rest);
  const movie = out.movie;
  out.search_phrase = buildSearchPhrase(out, movie) || out.search_phrase;
  return out;
}

function mergeVisionIntoParsed(parsed, analysis) {
  // Явный текст пользователя важнее догадок модели
  const typeLabel =
    [analysis.garment_type, analysis.subtype].map(cleanAttr).filter(Boolean).join(' ') ||
    cleanAttr(analysis.category);
  const colorExtra = Array.isArray(analysis.color_extra)
    ? analysis.color_extra.map(cleanAttr).filter(Boolean)
    : [];
  const colorMain = cleanAttr(analysis.color_primary) || cleanAttr(analysis.color);
  const colorJoined = [colorMain, ...colorExtra].filter(Boolean).join(', ') || null;
  const descBits = [
    analysis.material,
    analysis.pattern,
    analysis.closure,
    analysis.hardware_and_details,
    analysis.era_or_style,
    analysis.description,
  ]
    .map(cleanAttr)
    .filter(Boolean);
  return applyAttributes(parsed, {
    category: typeLabel,
    color: colorJoined,
    brand: analysis.brand,
    size: analysis.size,
    budget: analysis.max_price_rub,
    description: descBits.join('; ') || cleanAttr(analysis.search_phrase),
  });
}

/** Насколько заполнен разбор (для auto → twopass). */
function photoDetailScore(fields) {
  if (!fields) return 0;
  const keys = [
    'garment_type',
    'subtype',
    'color_primary',
    'material',
    'pattern',
    'collar',
    'closure',
    'pockets',
    'length',
    'fit',
    'hardware_and_details',
    'era_or_style',
    'description',
  ];
  let n = 0;
  for (const k of keys) if (cleanAttr(fields[k])) n += 1;
  if (Array.isArray(fields.color_extra) && fields.color_extra.some((x) => cleanAttr(x))) n += 1;
  if (Array.isArray(fields.visible_text) && fields.visible_text.some((x) => cleanAttr(x))) n += 1;
  if (cleanAttr(fields.brand)) n += 1;
  if (cleanAttr(fields.model_name)) n += 1;
  return n;
}

// =====================================================================
// POST /api/search — текст по правилам; фото — через Ollama (если AI_ENABLED)
// Цены товаров НЕ возвращаем: нет парсинга и нет платных API «по умолчанию».
// =====================================================================
async function handleSearch(req, res) {
  if (!enforceRateLimit(req, res)) return;

  let body;
  try {
    body = JSON.parse(await readBody(req, BODY_LIMIT_SEARCH));
  } catch (e) {
    if (e.status === 413) res.setHeader('Connection', 'close');
    return send(res, e.status === 413 ? 413 : 400, {
      error: e.status === 413
        ? AI_ENABLED
          ? 'Фото или запрос слишком большие'
          : 'Запрос слишком большой'
        : 'Некорректный JSON',
      error_kind: e.status === 413 ? 'payload_too_large' : 'invalid_json',
    });
  }

  // Типы / длина / пустота — до parseQuery, Ollama и внешних API.
  const { validateSearchBody } = require('./lib/search-request');
  const checked = validateSearchBody(body, { aiEnabled: AI_ENABLED });
  if (!checked.ok) {
    return send(res, checked.status, {
      error: checked.error,
      error_kind: checked.error_kind,
    });
  }
  const query = checked.value.query;
  const image = checked.value.image;
  const attrs = checked.value.attrs;
  const attrsOnly = checked.value.attrsOnly;
  const clearAttributes = checked.value.clearAttributes;
  const userWantsWeb = checked.value.webSearch;

  // Единая модель: текст → merge с attributes / clear_attributes → publicCriteria.
  let parsed = query ? parseQuery(query, { movies: MOVIES, brands: BRANDS }) : emptyParsed(query);
  if (attrs || clearAttributes.length) {
    const merged = mergeCriteria(parsed, attrs || {}, {
      priority: attrsOnly,
      clear: clearAttributes,
    });
    parsed = {
      ...parsed,
      ...merged,
      category: merged.category,
      color: merged.color,
      size: merged.size,
      brand: merged.brand,
      categories: merged.categories,
      colors: merged.colors,
      sizes: merged.sizes,
      brands: merged.brands,
      budget: merged.budget,
      budget_min: merged.budget_min,
      budget_max: merged.budget_max,
      rest: merged.rest,
      search_phrase: merged.search_phrase,
      warnings: merged.warnings,
    };
  } else {
    const n = normalizeCriteria(parsed);
    const parseWarnings = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [];
    parsed = { ...parsed, ...n, warnings: parseWarnings };
  }
  let photo_used = false;
  let photo_attrs = null;
  let photo_pipeline = null;

  if (image) {
    if (!AI_ENABLED) {
      return send(res, 503, {
        error:
          'Разбор фото выключен (AI_ENABLED=false). Включите AI_ENABLED=true в .env, установите Ollama и модель qwen3-vl:4b-instruct, затем перезапустите сервер. Текстовый поиск без фото работает и так.',
        ai_enabled: false,
      });
    }
    if (photoInFlight >= PHOTO_CONCURRENCY) {
      return send(res, 503, {
        error:
          'Сейчас слишком много разборов фото. Подождите немного или выполните текстовый поиск без фото.',
        overloaded: true,
        retry_after_sec: 5,
      });
    }
    const movieObj = parsed.movie
      ? MOVIES.find((m) => m.title === parsed.movie.title) || null
      : findMovieLegacy(query);
    photoInFlight += 1;
    try {
      const analysis = await analyze(query, image, movieObj);
      photo_attrs = publicPhotoAttrs(analysis);
      photo_pipeline = analysis.pipeline || null;
      parsed = mergeVisionIntoParsed(parsed, analysis);
      const n = normalizeCriteria(parsed);
      parsed = { ...parsed, ...n };
      photo_used = true;
    } catch (e) {
      logger.warn('Фотоанализ не удался', { error: e.message });
      let msg = `Разбор фото не удался: ${e.message}`;
      if (e.name === 'TimeoutError') {
        msg = `Модель не ответила за ${Math.round(PHOTO_TIMEOUT_MS / 1000)} с. Попробуйте меньшее фото или проверьте Ollama.`;
      } else if (/fetch failed|ECONNREFUSED/i.test(e.message + (e.cause ? e.cause.message : ''))) {
        msg =
          'Ollama не запущена. Установите Ollama, выполните ollama pull qwen3-vl:4b-instruct, запустите Ollama и повторите.';
      }
      // Не подмешиваем частичный/чужой результат vision: photo_* остаются пустыми.
      photo_used = false;
      photo_attrs = null;
      photo_pipeline = null;

      // Самостоятельная основа (без NLP-эвристик): уже есть структурированные
      // критерии из текста/чипсов (категория|бренд|цвет|размер|бюджет) и phrase.
      // Один «хвост» rest вроде «такое» после «найди такое» — не основание.
      const hasStructured =
        !!(parsed.category || (parsed.categories && parsed.categories.length))
        || !!(parsed.brand || (parsed.brands && parsed.brands.length))
        || !!(parsed.color || (parsed.colors && parsed.colors.length))
        || !!(parsed.size || (parsed.sizes && parsed.sizes.length))
        || parsed.budget != null
        || parsed.budget_min != null
        || parsed.budget_max != null;
      const hasStandaloneBasis = hasStructured && !!(parsed && parsed.search_phrase);
      if (hasStandaloneBasis) {
        const warn =
          'Фото не удалось разобрать. Результаты сформированы только по тексту и выбранным критериям.';
        if (!Array.isArray(parsed.warnings)) parsed.warnings = [];
        if (!parsed.warnings.includes(warn)) parsed.warnings.push(warn);
        // Продолжаем выдачу links только по pre-photo parsed.
      } else {
        const friendly =
          /JSON|формат|разобрать|распозна|Failed to load image|400|нет одежд/i.test(msg) ||
          e.name === 'TimeoutError';
        return send(res, 502, {
          error: friendly
            ? /нет одежд/i.test(msg)
              ? 'На фото не видно одежды. Загрузите фото вещи или опишите словами.'
              : 'Не удалось разобрать фото. Опишите вещь словами.'
            : msg,
          detail: msg,
          photo_used: false,
          keep_text_input: true,
          note: NOTE,
        });
      }
    } finally {
      photoInFlight = Math.max(0, photoInFlight - 1);
    }
  }

  if (!parsed.search_phrase) {
    const hasText = !!(query && query.trim());
    return send(res, 422, {
      error: hasText
        ? 'В запросе нет распознаваемых признаков одежды (тип, цвет, размер, бренд). Пример: «куртка» или «чёрная куртка размер M». Цвет, размер и бюджет не обязательны.'
        : 'Введите текстовый запрос или заполните критерии над строкой поиска.',
      error_kind: hasText ? 'unrecognized_query' : 'empty_query',
      parsed: publicParsed(parsed),
      keep_text_input: true,
      note: NOTE,
    });
  }

  // Выбор источников под запрос (не все кандидаты сразу).
  // Без обхода через «все verified:true» — та же политика, что selectSources.
  const selection = selectSources(parsed, { maxSources: 8 });
  const adapterSources = adaptersForSelection(selection.selected, SOURCES);

  let sources = [];
  try {
    const linksResult = await providers.links.search({ parsed, sources: adapterSources });
    sources = (linksResult && linksResult.items) || [];
  } catch (e) {
    logger.warn('links provider failed', { error: e.message });
    sources = [];
  }

  // Официальный сайт бренда без найденного товара — отдельная пометка.
  const sourcePolicyEarly = require('./lib/source-policy');
  const seenSourceIds = new Set(sources.map((s) => s.id));
  const seenSourceDomains = new Set();
  for (const s of sources) {
    try {
      if (s.url) seenSourceDomains.add(new URL(s.url).hostname.replace(/^www\./, '').toLowerCase());
    } catch (_) { /* ignore */ }
  }
  for (const extra of selection.officialExtras || []) {
    if (!extra.domain) continue;
    if (sourcePolicyEarly.isOutboundRestrictedHost(extra.domain)) continue;
    if (
      extra.connection_status === 'temporarily_limited'
      || extra.connection_status === 'disabled'
    ) {
      continue;
    }
    if (seenSourceIds.has(extra.id)) continue;
    const extraHost = String(extra.domain).replace(/^www\./, '').toLowerCase();
    if (seenSourceDomains.has(extraHost)) continue;
    const url = 'https://' + String(extra.domain).replace(/^https?:\/\//, '');
    sources.push({
      id: extra.id,
      name: extra.name,
      type: 'official_store',
      type_label: 'официальный магазин',
      url,
      result_kind: 'search_link',
      link_kind: 'official_store_entry',
      trust_level: extra.trust_level || 'official_store',
      own_brand: !!extra.own_brand,
      display_group: extra.display_group || 'official',
      display_group_order: extra.display_group_order || 1,
      display_group_label: extra.display_group_label || 'Официальный магазин бренда',
      price: null,
      price_note: 'Цена на сайте',
      search_phrase_used: parsed.search_phrase || null,
      phrase_accepts_query: false,
      filter_details: [
        {
          kind: 'info',
          field: 'official',
          text: 'Ссылка на официальный сайт бренда — не найденный товар. Не партнёрство VishFind.',
        },
        {
          kind: 'info',
          field: 'transfer',
          text: 'Открывается каталог. Запрос и критерии автоматически не передаются.',
        },
      ],
      applied_filters: [],
      in_query_filters: [],
      unsupported_filters: [],
      verification_level: 'base_url_only',
    });
    seenSourceIds.add(extra.id);
    seenSourceDomains.add(extraHost);
  }

  // Единый порядок групп на сервере (клиент не переставляет маркетплейсы выше ресейла).
  const groupRank = (s) => {
    const o = Number(s.display_group_order);
    if (Number.isFinite(o) && o > 0) return o;
    if (s.display_group === 'official' || s.link_kind === 'official_store_entry') return 1;
    if (s.display_group === 'reseller') return 2;
    if (s.display_group === 'other') return 3;
    if (s.display_group === 'marketplace_tail' || ['ozon', 'wildberries', 'yandex_market'].includes(s.id)) return 4;
    return 3;
  };
  const tailOrder = { ozon: 0, wildberries: 1, yandex_market: 2 };
  sources.sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;
    if (ga === 4) return (tailOrder[a.id] ?? 9) - (tailOrder[b.id] ?? 9);
    return 0;
  });

  const responseWarnings = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [];

  // Веб-поиск Ollama: только серверное разрешение + явный opt-in (уже проверен тип).
  // Не включается из-за одного ключа; не обходит source-policy; не включает web_fetch.
  let webItems = [];
  let webMeta = { used: false, reason: null };
  if (!userWantsWeb) {
    webMeta = { used: false, reason: 'user_opt_out' };
  } else if (!ollamaWeb.isEnabled()) {
    webMeta = { used: false, reason: 'disabled' };
  } else if (!(parsed.brand || (parsed.brands && parsed.brands.length))) {
    webMeta = { used: false, reason: 'no_brand' };
  } else {
    try {
      const domains = selection.selected
        .filter((s) => s.type === 'brand_official' && s.domain)
        .filter((s) => {
          try {
            const sp = require('./lib/source-policy');
            return sp.cap(s, 'outbound_link') !== 'restricted';
          } catch (_) {
            return true;
          }
        })
        .map((s) => s.domain);
      // В Ollama — только поисковая фраза/бренд, без фото, истории и избранного.
      const enrich = await ollamaWeb.enrichBrandSearch(
        {
          brand: parsed.brand || null,
          brands: Array.isArray(parsed.brands) ? parsed.brands.slice(0, 3) : [],
          search_phrase: parsed.search_phrase || '',
        },
        domains
      );
      webMeta = { used: enrich.used, reason: enrich.reason || null };
      // Повторный фильтр перед выдачей (кэш / смена политики).
      const sp = require('./lib/source-policy');
      webItems = (enrich.items || []).filter((it) => {
        if (!it || !it.url) return false;
        if (sp.isOutboundRestrictedHost(sp.hostnameFromUrl(it.url))) return false;
        if (!sp.webSearchDisplayAllowedForUrl(it.url)) return false;
        // Не дублировать уже показанный официальный/выбранный домен в web-блоке.
        try {
          const host = new URL(it.url).hostname.replace(/^www\./, '').toLowerCase();
          if (seenSourceDomains.has(host)) return false;
        } catch (_) { /* keep */ }
        return true;
      });
      for (const w of enrich.warnings || []) responseWarnings.push(w);
    } catch (e) {
      logger.warn('ollama web enrich failed', { error: e.message });
      responseWarnings.push('Веб-поиск не удался — показаны обычные переходы.');
      webMeta = { used: false, reason: 'error' };
    }
  }

  // Предложения: eBay API + попытка публичных витрин (Peak/CULTT) + демо.
  const budgetForOffers =
    parsed.budget_max != null ? parsed.budget_max : parsed.budget;
  const demoOffersItems = offersApi.findOffers({ parsed, budget: budgetForOffers });
  let ebayItems = [];
  let ebayError = null;
  if (ebayProvider.isConfigured() && parsed.search_phrase) {
    try {
      const ebayRes = await ebayProvider.search(parsed.search_phrase);
      if (ebayRes.ok) {
        ebayItems = (ebayRes.items || []).map((o) => ({
          ...o,
          result_kind: 'product',
          trust_level: 'reseller_described',
          data_origin: 'ebay_browse_api',
        }));
      } else {
        logger.warn('eBay search failed', {
          error: ebayRes.error,
          circuit_open: !!ebayRes.circuit_open,
        });
        ebayError = ebayRes.circuit_open
          ? 'eBay временно недоступен. Показаны демо-предложения.'
          : 'eBay не ответил. Показаны демо-предложения.';
      }
    } catch (e) {
      logger.warn('eBay search exception', { error: e.message });
      ebayError = 'eBay не ответил. Показаны демо-предложения.';
    }
  }

  // Точечные product-попытки только при usage_policy.html_product_fetch=documented_allowed.
  // Ограниченные источники (CULTT/TSUM и др.) не вызываются и не обходятся через Ollama.
  const sourcePolicy = require('./lib/source-policy');
  const htmlProducts = [];
  const productNotes = [];
  const productTargets = selection.selected
    .filter((s) => s.product_search_url && s.product_parse)
    .filter((s) => sourcePolicy.htmlProductFetchAllowed(s))
    .slice(0, 2);
  await Promise.all(
    productTargets.map(async (s) => {
      try {
        const res = await productHtml.searchProducts(
          {
            id: s.id,
            name: s.name,
            search_url_template: s.product_search_url,
            parse: s.product_parse,
            trust_level: s.trust_level,
            allow_ollama_fetch: sourcePolicy.ollamaFetchAllowedForSource(s),
          },
          parsed.search_phrase
        );
        if (res.ok && res.items && res.items.length) {
          const wanted = (selection.wantedBrands || []).map((b) =>
            String(b).toLowerCase()
          );
          const filtered = wanted.length
            ? res.items.filter((it) => {
                const hay = `${it.brand || ''} ${it.title || ''}`.toLowerCase();
                return wanted.some((w) => hay.includes(w));
              })
            : res.items;
          if (filtered.length) {
            htmlProducts.push(...filtered.slice(0, 4));
          } else {
            productNotes.push({
              id: s.id,
              note: 'Карточки источника без совпадения бренда запроса — не показаны.',
            });
          }
        } else if (res.error || res.note) {
          productNotes.push({
            id: s.id,
            error: res.error || null,
            note: res.note || null,
          });
        }
      } catch (e) {
        productNotes.push({ id: s.id, error: 'exception' });
        logger.warn('product html failed', { id: s.id, error: e.message });
      }
    })
  );

  const realProductItems = [...htmlProducts, ...ebayItems].slice(0, 12);
  // Демо не смешиваем с реальными offers (отдельное поле для возможной рекламы).

  // FX: без live-источника — только статус; исходный бюджет не меняем.
  const fx = fxRates.publicStatus();
  const budget_display = {
    original: {
      min: parsed.budget_min != null ? parsed.budget_min : null,
      max: parsed.budget_max != null ? parsed.budget_max : parsed.budget,
      currency: 'RUB',
    },
    conversion: null,
    fx,
  };

  send(res, 200, {
    parsed: publicParsed(parsed),
    photo: photo_attrs,
    photo_pipeline,
    sources,
    web_results: webItems,
    web_search: {
      ...ollamaWeb.publicStatus(),
      ...webMeta,
      user_requested: userWantsWeb,
    },
    offers: {
      is_demo: false,
      has_live_products: realProductItems.length > 0,
      note: realProductItems.length
        ? 'Карточки с подтверждённым происхождением данных. Search_link — отдельно.'
        : 'Живых карточек товара нет — показаны поисковые переходы. Цену смотрите на сайте.',
      ebay_error: ebayError,
      product_fetch_notes: productNotes,
      items: realProductItems,
      demo_items: demoOffersItems.slice(0, 8),
    },
    source_selection: {
      wanted_brands: selection.wantedBrands,
      selected_ids: selection.selected.map((s) => s.id),
      registry: selection.registry_stats,
      brands_registry: brandsApi.summary(),
    },
    budget_display,
    warnings: responseWarnings,
    photo_used,
    prices: null,
    prices_note:
      'Отсутствующая цена не выдумывается. У поисковых переходов — «Цена на сайте».',
    note: NOTE,
    providers: providers.listProviders(),
  });
}

// =====================================================================
// Старый путь /api/find (Ollama + фото) — код сохранён, по умолчанию выключен
// Вернём позже, когда AI_ENABLED=true и локальная модель реально нужна.
// =====================================================================

function parseJsonLoose(text) {
  let s = String(text || '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(s);
  } catch (_) { /* продолжаем */ }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch (_) { /* ничего */ }
  }
  return null;
}

const str = (v) =>
  typeof v === 'string' && v.trim() && !/^(null|none|unknown|n\/a|неизвестно|нет)$/i.test(v.trim())
    ? v.trim().slice(0, 120)
    : null;

function heuristics(query) {
  const s = String(query || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  const out = {};
  const p = s.match(/до\s*(\d[\d\s.]*\d|\d)\s*(тыс|т\.?\s?р|к(?![а-я])|k(?![a-z]))?/);
  if (p) {
    let n = Number(p[1].replace(/[\s.]/g, ''));
    if (p[2]) n *= 1000;
    if (n >= 100 && n <= 5000000) out.max_price_rub = n;
  }
  const z = String(query || '').match(/(?:размер|р-р|size)\s*[:\-]?\s*([a-zA-Zа-яА-Я]{1,3}|\d{2,3})(?![a-zа-я])/i);
  if (z) out.size = z[1].toUpperCase();
  return out;
}

function extractPrice(text) {
  const m = String(text || '').match(/(\d[\d \u00a0\u202f]{2,9}\d)\s*(?:₽|руб|р\.)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\D/g, ''));
  return n >= 100 && n <= 5000000 ? n : null;
}

const enc = encodeURIComponent;
const SITES = [
  // Форматы URL — те же, что в data/sources.json / providers/links.js
  { id: 'ozon', name: 'Ozon', domain: 'ozon.ru', url: (q) => `https://www.ozon.ru/search/?text=${enc(q)}` },
  {
    id: 'wb',
    name: 'Wildberries',
    domain: 'wildberries.ru',
    url: (q) => `https://www.wildberries.ru/catalog/0/search.aspx?search=${enc(q)}`,
  },
  { id: 'ym', name: 'Яндекс Маркет', domain: 'market.yandex.ru', url: (q) => `https://market.yandex.ru/search?text=${enc(q)}` },
  { id: 'avito', name: 'Авито', domain: 'avito.ru', url: (q) => `https://www.avito.ru/all?q=${enc(q)}` },
];

function buildPhotoPrompt(query, movie, strict) {
  const lines = [
    strict
      ? 'Ответь ТОЛЬКО валидным JSON по схеме. Никакого текста вокруг, никаких markdown.'
      : 'Разбери одежду на фото максимально детально для поиска похожих вещей.',
    'Все текстовые значения — на русском (кроме дословного visible_text). JSON null, не строка "null".',
    'Поля: garment_type, subtype, color_primary, color_extra[], material, pattern, collar, closure, pockets, length, fit, hardware_and_details, era_or_style, visible_text[], brand, model_name, description.',
    'subtype — узкий фасон (бомбер, косуха, авиатор, тракер и т.п.), если видно; иначе null.',
    'era_or_style — только если явно видно (90-е, workwear, авангард); иначе null.',
    'brand и model_name: ТОЛЬКО если логотип или название читаются на фото. Иначе строго null. Не угадывай по силуэту.',
    'visible_text — читаемый текст/логотипы/бирки дословно; если нечитаемо — [].',
    'Если на фото нет одежды — garment_type=null и description честно скажи, что одежды нет.',
    'Не выдумывай размер и цену. Неуверенные поля — null или [].',
    'description — одно предложение по-русски.',
    query ? `Дополнительный текст покупателя: """${query}"""` : '',
    movie ? `Возможный образ из фильма «${movie.title}»: ${movie.description}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function buildFreeDescribePrompt(query, movie) {
  const lines = [
    'Опиши одежду на фото подробно по-русски одним связным текстом (8–15 предложений максимум).',
    'Укажи тип и подтип, цвета, материал, крой, воротник, застёжку, карманы, длину, фурнитуру, принты, потёртости, эпоху/стиль если видно.',
    'Любой читаемый текст/логотип/бирку процитируй дословно. Бренд и модель называй ТОЛЬКО если они читаются на фото — иначе напиши, что бренд не виден.',
    'Не выдумывай точную модель каталога и не угадывай бренд по фасону.',
    query ? `Текст покупателя: """${query}"""` : '',
    movie ? `Контекст фильма «${movie.title}»: ${movie.description}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function buildStructFromTextPrompt(freeText, strict) {
  const lines = [
    strict
      ? 'Преобразуй описание в ТОЛЬКО валидный JSON по схеме. Без markdown.'
      : 'Преобразуй описание одежды в JSON по схеме.',
    'Правила: brand и model_name только если в тексте явно сказано, что они видны/прочитаны; иначе null.',
    'Не добавляй признаков, которых нет в описании.',
    'Описание:',
    freeText,
  ];
  return lines.filter(Boolean).join('\n');
}

function asStringList(v) {
  if (Array.isArray(v)) return v.map(cleanAttr).filter(Boolean);
  const one = cleanAttr(v);
  return one ? [one] : [];
}

/** brand/model только при явной видимости; отбрасываем формулировки-догадки. */
function cleanVisibleIdentity(v) {
  const s = cleanAttr(v);
  if (!s) return null;
  if (/^(не\s*виден|не\s*видно|отсутствует|нет)$/i.test(s)) return null;
  if (/угад|похож|вероятн|возможн|скорее всего|looks?\s*like|guess|предполож/i.test(s)) return null;
  return s;
}

/** Лёгкий перевод частых английских ярлыков модели → русский (без новых фактов). */
const EN_TYPE_RU = {
  jacket: 'куртка',
  coat: 'пальто',
  hoodie: 'худи',
  sweatshirt: 'свитшот',
  jeans: 'джинсы',
  pants: 'брюки',
  trousers: 'брюки',
  shirt: 'рубашка',
  tshirt: 'футболка',
  't-shirt': 'футболка',
  sweater: 'свитер',
  dress: 'платье',
  skirt: 'юбка',
  sneakers: 'кроссовки',
  boots: 'ботинки',
  bomber: 'бомбер',
  blazer: 'пиджак',
};
const EN_COLOR_RU = {
  red: 'красный',
  blue: 'синий',
  black: 'чёрный',
  white: 'белый',
  green: 'зелёный',
  yellow: 'жёлтый',
  brown: 'коричневый',
  gray: 'серый',
  grey: 'серый',
  beige: 'бежевый',
  pink: 'розовый',
  orange: 'оранжевый',
  purple: 'фиолетовый',
};

function toRuLabel(s, map) {
  const v = cleanAttr(s);
  if (!v) return null;
  const key = v.toLowerCase().replace(/\s+/g, ' ');
  return map[key] || v;
}

function publicPhotoAttrs(analysis) {
  if (!analysis) return null;
  return {
    garment_type: analysis.garment_type || null,
    subtype: analysis.subtype || null,
    color_primary: analysis.color_primary || null,
    color_extra: Array.isArray(analysis.color_extra) ? analysis.color_extra : [],
    material: analysis.material || null,
    pattern: analysis.pattern || null,
    collar: analysis.collar || null,
    closure: analysis.closure || null,
    pockets: analysis.pockets || null,
    length: analysis.length || null,
    fit: analysis.fit || null,
    hardware_and_details: analysis.hardware_and_details || null,
    era_or_style: analysis.era_or_style || null,
    visible_text: Array.isArray(analysis.visible_text) ? analysis.visible_text : [],
    brand: analysis.brand || null,
    model_name: analysis.model_name || null,
    description: analysis.description || null,
  };
}

async function ollamaChat(body, timeoutMs) {
  const ms = timeoutMs || OLLAMA_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`Ollama ${r.status}: ${text.slice(0, 200)}`), { status: r.status });
    return JSON.parse(text);
  } catch (e) {
    if (e.name === 'AbortError') {
      throw Object.assign(new Error(`Модель не ответила за ${Math.round(ms / 1000)} с`), {
        name: 'TimeoutError',
      });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parsePhotoFields(raw) {
  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  // совместимость со старой схемой (category / color / brand_guess)
  const garmentType =
    toRuLabel(parsed.garment_type, EN_TYPE_RU) || toRuLabel(parsed.category, EN_TYPE_RU);
  const colorPrimary =
    toRuLabel(parsed.color_primary, EN_COLOR_RU) || toRuLabel(parsed.color, EN_COLOR_RU);
  const brand = cleanVisibleIdentity(parsed.brand) || cleanVisibleIdentity(parsed.brand_guess);

  const fields = {
    garment_type: garmentType,
    subtype: toRuLabel(parsed.subtype, EN_TYPE_RU) || cleanAttr(parsed.subtype),
    color_primary: colorPrimary,
    color_extra: asStringList(parsed.color_extra),
    material: cleanAttr(parsed.material),
    pattern: cleanAttr(parsed.pattern),
    collar: cleanAttr(parsed.collar),
    closure: cleanAttr(parsed.closure),
    pockets: cleanAttr(parsed.pockets),
    length: cleanAttr(parsed.length),
    fit: cleanAttr(parsed.fit),
    hardware_and_details: cleanAttr(parsed.hardware_and_details),
    era_or_style: cleanAttr(parsed.era_or_style) || cleanAttr(parsed.style),
    visible_text: asStringList(parsed.visible_text),
    brand,
    model_name: cleanVisibleIdentity(parsed.model_name),
    description: cleanAttr(parsed.description),
    // для mergeVisionIntoParsed / старого кода
    category: garmentType,
    color: colorPrimary,
    visible_brand: brand,
    brand_guess: brand,
    size: null,
    max_price_rub: null,
    search_phrase: null,
  };

  const phraseBits = [
    fields.color_primary,
    ...(fields.color_extra || []),
    fields.material,
    fields.garment_type,
    fields.subtype,
    fields.pattern,
    fields.closure,
    fields.hardware_and_details,
    fields.brand,
  ].filter(Boolean);
  fields.search_phrase = phraseBits.join(' ') || fields.description;
  return fields;
}

/** content иногда пустой у thinking-моделей — берём thinking как запасной текст. */
function extractModelText(message) {
  if (!message || typeof message !== 'object') return '';
  const content = String(message.content || '').trim();
  if (content) return content;
  const thinking = String(message.thinking || '')
    .replace(/<\/?think>/gi, ' ')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .trim();
  return thinking;
}

async function ollamaVisionJson(imageB64, prompt, strictFallbackPrompt) {
  const tryChat = async (content, useSchema) => {
    const message = { role: 'user', content };
    if (imageB64) message.images = [imageB64];
    const base = {
      model: MODEL,
      messages: [message],
      stream: false,
      keep_alive: '30m',
      options: { temperature: 0, num_predict: 900 },
    };
    if (useSchema) base.format = PHOTO_FORMAT;
    else base.format = 'json';
    try {
      return await ollamaChat({ ...base, think: false }, PHOTO_TIMEOUT_MS);
    } catch (e) {
      if (e.status === 400 && useSchema) {
        return ollamaChat({ ...base, format: 'json', think: false }, PHOTO_TIMEOUT_MS);
      }
      throw e;
    }
  };

  let data = await tryChat(prompt, true);
  let raw = extractModelText(data && data.message);
  let fields = parsePhotoFields(raw);
  if (fields) return fields;

  if (strictFallbackPrompt) {
    data = await tryChat(strictFallbackPrompt, true);
    raw = extractModelText(data && data.message);
    fields = parsePhotoFields(raw);
    if (fields) return fields;
  }

  const err = new Error('Модель вернула ответ не в формате JSON');
  err.raw = raw;
  throw err;
}

async function analyzeSchema(query, imageB64, movie) {
  const fields = await ollamaVisionJson(
    imageB64,
    buildPhotoPrompt(query, movie, false),
    buildPhotoPrompt(query, movie, true)
  );
  if (isNoGarmentResult(fields)) {
    throw new Error('На фото не удалось распознать одежду');
  }
  fields.pipeline = 'schema';
  return fields;
}

/** Двухпроходный: свободное описание по фото → JSON без картинки (только текст). */
async function analyzeTwoPass(query, imageB64, movie) {
  const freeMsg = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: buildFreeDescribePrompt(query, movie),
        images: [imageB64],
      },
    ],
    stream: false,
    keep_alive: '30m',
    options: { temperature: 0, num_predict: 700 },
  };
  let freeData;
  try {
    freeData = await ollamaChat({ ...freeMsg, think: false }, PHOTO_TIMEOUT_MS);
  } catch (e) {
    if (e.status === 400) freeData = await ollamaChat(freeMsg, PHOTO_TIMEOUT_MS);
    else throw e;
  }
  const freeText = extractModelText(freeData && freeData.message);
  if (!freeText || freeText.length < 20) {
    throw new Error('Модель не дала свободное описание одежды');
  }

  // второй проход — без изображения: структурируем уже сказанное
  const fields = await ollamaVisionJson(
    null,
    buildStructFromTextPrompt(freeText, false),
    buildStructFromTextPrompt(freeText, true)
  );
  if (isNoGarmentResult(fields)) {
    throw new Error('На фото не удалось распознать одежду');
  }
  fields.pipeline = 'twopass';
  fields._free_text = freeText;
  return fields;
}

/**
 * Разбор фото через Ollama vision.
 * Один повтор при невалидном JSON; при неудаче — честная ошибка (без фиктивного успеха).
 */
async function analyze(query, imageB64, movie) {
  if (!imageB64) throw new Error('Нет изображения для анализа');

  const mode = PHOTO_PIPELINE;
  if (mode === 'twopass') return analyzeTwoPass(query, imageB64, movie);
  if (mode === 'schema') return analyzeSchema(query, imageB64, movie);

  // auto: schema, при скудном результате — twopass
  let schemaResult = null;
  let schemaErr = null;
  try {
    schemaResult = await analyzeSchema(query, imageB64, movie);
  } catch (e) {
    schemaErr = e;
    logger.warn('Фотоанализ schema не удался', { error: e.message });
  }

  if (schemaResult && photoDetailScore(schemaResult) >= 5) {
    return schemaResult;
  }

  try {
    const two = await analyzeTwoPass(query, imageB64, movie);
    if (!schemaResult) return two;
    // берём более детальный
    if (photoDetailScore(two) > photoDetailScore(schemaResult)) return two;
    schemaResult.pipeline = 'schema';
    return schemaResult;
  } catch (e) {
    logger.warn('Фотоанализ twopass не удался', { error: e.message });
    if (schemaResult) return schemaResult;
    throw schemaErr || e;
  }
}

async function tavilySearch(site, phrase) {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TAVILY_KEY}` },
    body: JSON.stringify({
      query: `купить ${phrase}`,
      include_domains: [site.domain],
      max_results: 4,
      search_depth: 'basic',
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}`);
  const j = await r.json();
  return j.results || [];
}

async function ollamaWebSearch(site, phrase) {
  const r = await fetch('https://ollama.com/api/web_search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OLLAMA_KEY}` },
    body: JSON.stringify({ query: `${phrase} купить site:${site.domain}`, max_results: 4 }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Ollama web search ${r.status}`);
  const j = await r.json();
  return (j.results || []).filter((x) => (x.url || '').includes(site.domain));
}

async function webSearch(phrase) {
  const provider = TAVILY_KEY ? 'tavily' : OLLAMA_KEY ? 'ollama' : null;
  if (!provider) return { provider, results: [], errors: [] };
  const fn = provider === 'tavily' ? tavilySearch : ollamaWebSearch;
  const settled = await Promise.allSettled(SITES.map((s) => fn(s, phrase)));
  const results = [];
  const errors = [];
  const seen = new Set();
  settled.forEach((st, i) => {
    if (st.status === 'rejected') {
      errors.push(`${SITES[i].name}: ${st.reason && st.reason.message}`);
      return;
    }
    for (const x of st.value) {
      const url = String(x.url || '');
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      const text = `${x.title || ''} ${x.content || ''}`;
      results.push({
        title: String(x.title || url).slice(0, 160),
        url,
        source: SITES[i].name,
        price: extractPrice(text),
        snippet: String(x.content || '')
          .replace(/\s+/g, ' ')
          .slice(0, 220),
      });
    }
  });
  results.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return { provider, results, errors };
}

function findMovieLegacy(query) {
  const s = String(query || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!s) return null;
  return (
    MOVIES.find((m) =>
      (m.triggers || []).some((t) => {
        const nt = String(t || '')
          .toLowerCase()
          .replace(/ё/g, 'е');
        const i = s.indexOf(nt);
        return i === 0 || (i > 0 && !/[a-zа-я0-9]/.test(s[i - 1]));
      })
    ) || null
  );
}

async function handleFind(req, res) {
  if (!enforceRateLimit(req, res)) return;

  // AI выключен — не ходим в Ollama; честно говорим об этом
  if (!AI_ENABLED) {
    return send(res, 503, {
      error:
        'Анализ через AI сейчас выключен (AI_ENABLED=false). Используйте POST /api/search — текстовый поиск по правилам.',
      ai_enabled: false,
    });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    if (e.status === 413) res.setHeader('Connection', 'close');
    return send(res, e.status === 413 ? 413 : 400, {
      error: e.status === 413 ? 'Фото слишком большое' : 'Некорректный запрос',
    });
  }
  const query = String(body.query || '')
    .trim()
    .slice(0, 1000);
  const image = typeof body.image === 'string' ? body.image.replace(/^data:image\/[\w+.-]+;base64,/, '') : '';
  if (!query && !image) return send(res, 400, { error: 'Введите запрос или загрузите фото' });

  const movie = findMovieLegacy(query);
  const warnings = [];
  const t0 = Date.now();
  let analysis = null;

  try {
    analysis = await analyze(query, image, movie);
  } catch (e) {
    logger.warn('Анализ не удался', { error: e.message });
    if (e.name === 'TimeoutError') {
      warnings.push(`Модель не ответила за ${Math.round(OLLAMA_TIMEOUT_MS / 1000)} с.`);
    } else if (/fetch failed|ECONNREFUSED/i.test(e.message + (e.cause ? e.cause.message : ''))) {
      warnings.push('Ollama не запущена. Запустите программу Ollama и повторите.');
    } else {
      warnings.push(`Анализ ИИ не удался: ${e.message}`);
    }
    // Честно: не подменяем неудачный анализ фиктивным «успехом»
    return send(res, 502, {
      error: 'Анализ не удался',
      warnings,
      movie: movie ? movie.title : null,
      took_sec: Math.round((Date.now() - t0) / 100) / 10,
    });
  }

  const h = heuristics(query);
  if (h.max_price_rub) analysis.max_price_rub = h.max_price_rub;
  if (h.size) analysis.size = h.size;
  if (!analysis.search_phrase) {
    analysis.search_phrase =
      (movie && movie.search_phrase) || query || [analysis.color, analysis.category].filter(Boolean).join(' ');
  }
  const phrase = analysis.search_phrase;
  if (!phrase) return send(res, 502, { error: 'Не удалось составить поисковый запрос', warnings });

  const links = SITES.map((s) => ({ name: s.name, url: s.url(phrase) }));
  let web = { provider: null, results: [], errors: [] };
  try {
    web = await webSearch(phrase);
  } catch (e) {
    warnings.push(`Поиск по интернету не удался: ${e.message}`);
  }
  if (!web.provider) warnings.push('Поиск по интернету выключен (нет ключа). Показаны ссылки на площадки.');
  else if (web.errors.length) warnings.push(`Часть площадок не ответила: ${web.errors.join('; ')}`);

  send(res, 200, {
    analysis,
    movie: movie ? movie.title : null,
    links,
    results: web.results,
    search_provider: web.provider,
    warnings,
    note: NOTE,
    took_sec: Math.round((Date.now() - t0) / 100) / 10,
  });
}

async function handleHealth(res) {
  // Health не дёргает внешние сервисы (Ollama/eBay): состояние берётся
  // из кэша/счётчиков. Секреты и детали ошибок наружу не попадают.
  const ebayStatus = ebayProvider.status();
  const payload = {
    ok: true,
    name: 'vishfind',
    version: config.version,
    env: config.env,
    uptime_sec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    ai_enabled: AI_ENABLED,
    text_search_ok: true,
    recognition_configured: AI_ENABLED,
    photo_busy: photoInFlight > 0,
    web_search: ollamaWeb.publicStatus(),
    fx: fxRates.publicStatus(),
    source_registry: registrySummary(),
    brands_registry: brandsApi.summary(),
    ollama_api_key_configured: ollamaWeb.isConfigured(),
    providers: providers.listProviders(),
    ebay: {
      configured: ebayStatus.configured,
      circuit_open: ebayStatus.circuit_open,
      fails: ebayStatus.fails,
      threshold: ebayStatus.threshold,
      last_success_at: ebayStatus.last_success_at,
      last_error_at: ebayStatus.last_error_at,
      last_check_at: ebayStatus.last_check_at,
    },
    message: AI_ENABLED
      ? 'AI включён (локальная разработка). Текстовый поиск /api/search работает независимо от Ollama.'
      : 'AI выключен. Текстовый поиск /api/search работает.',
  };
  send(res, 200, payload);
}

// ---------- статические файлы ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const PRIVATE_TOP = new Set([
  'server.js',
  'ai-search.js',
  'env.txt',
  'package.json',
  'package-lock.json',
  'movies.json',
  'node_modules',
  'data',
  'lib',
  'providers',
  'scripts',
  'test',
  'README.md',
  '.gitignore',
]);

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (_) {
    return send(res, 400, 'Bad request');
  }
  if (pathname === '/') pathname = '/index.html';
  const full = path.normalize(path.join(ROOT, pathname));
  if (!full.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  const parts = path.relative(ROOT, full).split(path.sep);
  if (parts.some((p) => p.startsWith('.')) || PRIVATE_TOP.has(parts[0])) return send(res, 403, 'Forbidden');
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Не найдено');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(full).pipe(res);
  });
}

// Запуск HTTP-сервера — только при прямом запуске (npm start / node server.js).
// При require('./server.js') из тестов сервер не поднимается, а экспортируются функции.
if (require.main === module) {
  // Непойманные ошибки: логируем санитизированно и завершаем процесс,
  // чтобы платформа перезапустила сервис (без «полуживого» состояния).
  process.on('uncaughtException', (e) => {
    logger.error('uncaughtException', logger.errorToMeta(e));
    process.exit(1);
  });
  process.on('unhandledRejection', (e) => {
    logger.error('unhandledRejection', logger.errorToMeta(e));
    process.exit(1);
  });

  http
    .createServer(async (req, res) => {
      try {
        const p = (req.url || '').split('?')[0];
        if (req.method === 'POST' && p === '/api/search') return await handleSearch(req, res);
        if (req.method === 'POST' && p === '/api/find') return await handleFind(req, res);
        if (req.method === 'GET' && p === '/api/health') return await handleHealth(res);
        if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
        send(res, 405, 'Method not allowed');
      } catch (e) {
        logger.error('unhandled request error', logger.errorToMeta(e));
        if (!res.headersSent) send(res, 500, { error: 'Внутренняя ошибка сервера' });
      }
    })
    .listen(PORT, HOST, () => {
      const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
      logger.info(`VishFind запущен: http://${shown}:${PORT} (bind ${HOST})`, {
        env: config.env,
        ai_enabled: AI_ENABLED,
        ebay_configured: ebayProvider.isConfigured(),
      });
      logger.info(`Провайдеры: ${providers.listProviders().map((p) => `${p.id}:${p.enabled ? 'on' : 'off'}`).join(', ')}`);
    });
}

// Экспорт только для юнит-тестов (приоритет текста над фото). Поведение HTTP не меняется.
module.exports = {
  mergeVisionIntoParsed,
  applyAttributes,
};
