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
const { createRateLimiter } = require('./lib/rate-limit');
const providers = require('./providers');
const offersApi = require('./lib/offers');
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
let BRANDS = loadJson('data/brands.json', []);
let SOURCES = loadJson('data/sources.json', []);

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
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
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
  if (out.budget == null) {
    const b = attrs.budget != null ? attrs.budget : attrs.max_price_rub;
    const n = Number(b);
    out.budget = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  if (out.rest == null && attrs.description) out.rest = cleanAttr(attrs.description);
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
    return send(res, e.status === 413 ? 413 : 400, {
      error: e.status === 413
        ? AI_ENABLED
          ? 'Фото или запрос слишком большие'
          : 'Запрос слишком большой'
        : 'Некорректный JSON',
    });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const image =
    typeof body.image === 'string' && body.image
      ? body.image.replace(/^data:image\/[\w+.-]+;base64,/, '')
      : '';
  const attrs = body.attributes && typeof body.attributes === 'object' ? body.attributes : null;
  const attrsOnly = !!(attrs && body.attributes_priority === true);

  if (!query && !image && !attrs) {
    return send(res, 400, {
      error: AI_ENABLED
        ? 'Введите текстовый запрос или приложите фото'
        : 'Введите текстовый запрос',
    });
  }
  if (query.length > 300) {
    return send(res, 400, { error: 'Запрос слишком длинный (максимум 300 символов)' });
  }

  let parsed = query && !attrsOnly ? parseQuery(query, { movies: MOVIES, brands: BRANDS }) : emptyParsed(query);
  // attributes: по умолчанию заполняют только пустые поля (текст важнее).
  // attributes_priority=true — ручная правка / «Искать снова» (поля из attributes главнее).
  if (attrsOnly) {
    parsed = {
      ...emptyParsed(query),
      category: cleanAttr(attrs.category),
      color: cleanAttr(attrs.color),
      brand: cleanAttr(attrs.brand || attrs.visible_brand),
      size: cleanAttr(attrs.size),
      budget: (() => {
        const n = Number(attrs.budget != null ? attrs.budget : attrs.max_price_rub);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
      })(),
      rest: cleanAttr(attrs.rest || attrs.description),
      movie: null,
    };
    parsed.search_phrase = buildSearchPhrase(parsed, null);
  } else {
    parsed = applyAttributes(parsed, attrs);
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
    const movieObj = parsed.movie
      ? MOVIES.find((m) => m.title === parsed.movie.title) || null
      : findMovieLegacy(query);
    try {
      const analysis = await analyze(query, image, movieObj);
      photo_attrs = publicPhotoAttrs(analysis);
      photo_pipeline = analysis.pipeline || null;
      parsed = mergeVisionIntoParsed(parsed, analysis);
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
      // Честно: не подменяем неудачный анализ «успехом»
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
  }

  if (!parsed.search_phrase) {
    return send(res, 422, {
      error:
        'Не удалось распознать признаки в запросе. Введите осмысленный поисковый запрос: категория, цвет, размер или бренд, например «чёрная куртка до 15 000, размер M».',
      parsed: {
        budget: parsed.budget,
        size: parsed.size,
        color: parsed.color,
        category: parsed.category,
        brand: parsed.brand,
        movie: parsed.movie,
        rest: parsed.rest,
        search_phrase: parsed.search_phrase,
      },
      keep_text_input: true,
      note: NOTE,
    });
  }

  const [linksResult] = await providers.runEnabled({ parsed, sources: SOURCES });
  const sources = (linksResult && linksResult.items) || [];

  // Предложения: реальные из eBay (если настроен) + локальные демо.
  // Ошибки eBay не ломают поиск: возвращаются демо-предложения и sources.
  const demoOffersItems = offersApi.findOffers({ parsed, budget: parsed.budget });
  let ebayItems = [];
  let ebayError = null;
  if (ebayProvider.isConfigured() && parsed.search_phrase) {
    const ebayRes = await ebayProvider.search(parsed.search_phrase);
    if (ebayRes.ok) {
      ebayItems = ebayRes.items;
    } else {
      // Техническая причина — только в лог; клиенту — дружелюбное сообщение.
      logger.warn('eBay search failed', {
        error: ebayRes.error,
        circuit_open: !!ebayRes.circuit_open,
      });
      ebayError = ebayRes.circuit_open
        ? 'eBay временно недоступен. Показаны демо-предложения.'
        : 'eBay не ответил. Показаны демо-предложения.';
    }
  }
  const offersItems = [...ebayItems, ...demoOffersItems].slice(0, 10);

  send(res, 200, {
    parsed: {
      budget: parsed.budget,
      size: parsed.size,
      color: parsed.color,
      category: parsed.category,
      brand: parsed.brand,
      movie: parsed.movie,
      rest: parsed.rest,
      search_phrase: parsed.search_phrase,
    },
    photo: photo_attrs,
    photo_pipeline,
    sources,
    offers: {
      // Демо-слой всегда подключён; реальные предложения eBay идут первыми (source: 'eBay').
      is_demo: true,
      note: 'Предложения: eBay (реальные) + демо-примеры из data/demo-offers.json.',
      ebay_error: ebayError,
      items: offersItems,
    },
    photo_used,
    prices: null,
    prices_note:
      'Цены товаров не показываем: мы не парсим площадки и не выдумываем цифры. Смотрите цену после перехода.',
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
    web_search: providers.websearch.enabled
      ? TAVILY_KEY
        ? 'tavily'
        : OLLAMA_KEY
          ? 'ollama'
          : null
      : null,
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
      ? 'AI включён (локальная разработка). Работает текстовый поиск /api/search.'
      : 'AI выключен. Работает текстовый поиск /api/search.',
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
