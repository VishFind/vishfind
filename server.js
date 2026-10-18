'use strict';
/**
 * iSearch — локальный сервер без npm-зависимостей (нужен Node.js 18+).
 *  - отдаёт статику из этой папки
 *  - POST /api/search : разбор запроса правилами + ссылки на площадки (основной путь)
 *  - POST /api/find   : старый путь с Ollama/фото (выключен, пока AI_ENABLED=false)
 *  - GET  /api/health : статус без падений, если AI выключен
 * Запуск:  npm start   →   http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseQuery } = require('./lib/parse-query');
const { createRateLimiter } = require('./lib/rate-limit');
const providers = require('./providers');

const ROOT = __dirname;

// ---------- настройки из .env или env.txt ----------
for (const name of ['.env', 'env.txt']) {
  try {
    const text = fs.readFileSync(path.join(ROOT, name), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) { /* файла нет — нормально */ }
}

const PORT = Number(process.env.PORT || 3000);
const AI_ENABLED = String(process.env.AI_ENABLED || 'false').toLowerCase() === 'true';
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'qwen3-vl:2b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_SEC || 300) * 1000;
const TAVILY_KEY = process.env.TAVILY_API_KEY || '';
const OLLAMA_KEY = process.env.OLLAMA_API_KEY || '';

const searchLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

// ---------- данные ----------
function loadJson(rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch (e) {
    console.warn(rel, 'не загружен:', e.message);
    return fallback;
  }
}

let MOVIES = loadJson('movies.json', []);
let BRANDS = loadJson('data/brands.json', []);
let SOURCES = loadJson('data/sources.json', []);

const NOTE =
  'Это переходы на поиск площадок, цены и наличие не проверялись';

// ---------- вспомогательное ----------
function send(res, status, data) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
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
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function enforceRateLimit(req, res) {
  const hit = searchLimiter.check(clientIp(req));
  if (!hit.ok) {
    send(res, 429, {
      error: `Слишком много запросов. Подождите около ${hit.retrySec} с и попробуйте снова.`,
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

function mergeVisionIntoParsed(parsed, analysis) {
  // Явный текст пользователя важнее догадок модели
  const out = { ...parsed };
  if (out.category == null && analysis.category) out.category = analysis.category;
  if (out.color == null && analysis.color) out.color = analysis.color;
  if (out.brand == null && analysis.visible_brand) out.brand = analysis.visible_brand;
  if (out.size == null && analysis.size) out.size = analysis.size;
  if (out.budget == null && analysis.max_price_rub) out.budget = analysis.max_price_rub;

  const bits = [];
  if (out.brand) bits.push(out.brand);
  if (out.color) bits.push(out.color);
  if (out.category) bits.push(out.category);
  if (analysis.material) bits.push(analysis.material);
  if (analysis.style) bits.push(analysis.style);
  if (out.rest) bits.push(out.rest);
  if (analysis.search_phrase) {
    for (const w of String(analysis.search_phrase).split(/\s+/)) {
      if (w && !bits.some((b) => String(b).toLowerCase() === w.toLowerCase())) bits.push(w);
    }
  }
  if (out.size) bits.push(`размер ${out.size}`);
  out.search_phrase = bits.join(' ').replace(/\s+/g, ' ').trim() || analysis.search_phrase || out.search_phrase;
  return out;
}

// =====================================================================
// POST /api/search — текст по правилам; фото — через Ollama (если AI_ENABLED)
// Цены товаров НЕ возвращаем: нет парсинга и нет платных API «по умолчанию».
// =====================================================================
async function handleSearch(req, res) {
  if (!enforceRateLimit(req, res)) return;

  let body;
  try {
    body = JSON.parse(await readBody(req, 9 * 1024 * 1024));
  } catch (e) {
    return send(res, e.status === 413 ? 413 : 400, {
      error: e.status === 413 ? 'Фото или запрос слишком большие' : 'Некорректный JSON',
    });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const image =
    typeof body.image === 'string' && body.image
      ? body.image.replace(/^data:image\/[\w+.-]+;base64,/, '')
      : '';

  if (!query && !image) {
    return send(res, 400, { error: 'Введите текстовый запрос или приложите фото' });
  }
  if (query.length > 300) {
    return send(res, 400, { error: 'Запрос слишком длинный (максимум 300 символов)' });
  }

  let parsed = query ? parseQuery(query, { movies: MOVIES, brands: BRANDS }) : emptyParsed('');
  let photo_used = false;

  if (image) {
    if (!AI_ENABLED) {
      return send(res, 503, {
        error:
          'Разбор фото выключен (AI_ENABLED=false). Включите AI_ENABLED=true в .env, установите Ollama и модель с зрением (например qwen3-vl:2b), затем перезапустите сервер. Текстовый поиск без фото работает и так.',
        ai_enabled: false,
      });
    }
    const movieObj = parsed.movie
      ? MOVIES.find((m) => m.title === parsed.movie.title) || null
      : findMovieLegacy(query);
    try {
      const analysis = await analyze(query, image, movieObj);
      parsed = mergeVisionIntoParsed(parsed, analysis);
      photo_used = true;
    } catch (e) {
      console.warn('Фотоанализ не удался:', e.message);
      let msg = `Разбор фото не удался: ${e.message}`;
      if (e.name === 'TimeoutError') {
        msg = `Модель не ответила за ${Math.round(OLLAMA_TIMEOUT_MS / 1000)} с. Попробуйте меньшее фото или проверьте Ollama.`;
      } else if (/fetch failed|ECONNREFUSED/i.test(e.message + (e.cause ? e.cause.message : ''))) {
        msg =
          'Ollama не запущена. Установите Ollama, выполните ollama pull qwen3-vl:2b, запустите Ollama и повторите.';
      }
      // Честно: не подменяем неудачный анализ «успехом»
      return send(res, 502, {
        error: msg,
        photo_used: false,
        note: NOTE,
      });
    }
  }

  if (!parsed.search_phrase) {
    return send(res, 422, {
      error: 'Не удалось собрать поисковую фразу',
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
      note: NOTE,
    });
  }

  const [linksResult] = await providers.runEnabled({ parsed, sources: SOURCES });
  const sources = (linksResult && linksResult.items) || [];

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
    sources,
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

function buildPrompt(query, movie, hasImage) {
  const lines = [
    'You help people find clothing to buy. Build a search profile from the request.',
    hasImage ? 'A photo of the desired item is attached: look at it carefully.' : '',
    query ? `Customer request (Russian): """${query}"""` : 'There is no text request, use only the photo.',
    movie ? `The customer means the outfit from the movie "${movie.title}": ${movie.description}.` : '',
    'Return ONLY one JSON object with these keys:',
    'category, color, material, style, fit, size, max_price_rub (number or null), visible_brand, keywords (array of 3-6 short Russian words), search_phrase.',
    'search_phrase is a short Russian query for an online store, 2-6 words, for example "кожаная куртка чёрная мужская".',
    'Rules: write values in Russian. Never invent a brand, size or price: use null if it is not in the request or clearly visible in the photo.',
  ];
  return lines.filter(Boolean).join('\n');
}

async function ollamaChat(body) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Ollama ${r.status}: ${text.slice(0, 200)}`), { status: r.status });
  return JSON.parse(text);
}

async function analyze(query, imageB64, movie) {
  const message = { role: 'user', content: buildPrompt(query, movie, !!imageB64) };
  if (imageB64) message.images = [imageB64];
  const base = {
    model: MODEL,
    messages: [message],
    stream: false,
    format: 'json',
    keep_alive: '30m',
    options: { temperature: 0.2, num_predict: 500 },
  };
  let data;
  try {
    data = await ollamaChat({ ...base, think: false });
  } catch (e) {
    if (e.status === 400) data = await ollamaChat(base);
    else throw e;
  }
  const raw = data && data.message && data.message.content;
  const parsed = parseJsonLoose(raw);
  if (!parsed) throw new Error('Модель вернула ответ не в формате JSON');
  const kw = Array.isArray(parsed.keywords) ? parsed.keywords.map(str).filter(Boolean).slice(0, 6) : [];
  const price = Number(parsed.max_price_rub);
  return {
    category: str(parsed.category),
    color: str(parsed.color),
    material: str(parsed.material),
    style: str(parsed.style),
    fit: str(parsed.fit),
    size: str(parsed.size),
    max_price_rub: Number.isFinite(price) && price > 0 ? price : null,
    visible_brand: str(parsed.visible_brand),
    keywords: kw,
    search_phrase: str(parsed.search_phrase),
  };
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
    console.warn('Анализ не удался:', e.message);
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
  const payload = {
    ok: true,
    ai_enabled: AI_ENABLED,
    web_search: providers.websearch.enabled
      ? TAVILY_KEY
        ? 'tavily'
        : OLLAMA_KEY
          ? 'ollama'
          : null
      : null,
    providers: providers.listProviders(),
  };

  if (!AI_ENABLED) {
    // Не дергаем Ollama, если AI выключен — health не должен «падать»
    payload.ollama = null;
    payload.model = null;
    payload.model_installed = null;
    payload.message = 'AI выключен. Работает текстовый поиск /api/search.';
    return send(res, 200, payload);
  }

  let ollama = false;
  let models = [];
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      ollama = true;
      models = ((await r.json()).models || []).map((m) => m.name);
    }
  } catch (_) { /* недоступна */ }
  payload.ollama = ollama;
  payload.model = MODEL;
  payload.model_installed = models.includes(MODEL);
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
  'env.txt',
  'package.json',
  'package-lock.json',
  'movies.json',
  'node_modules',
  'data',
  'lib',
  'providers',
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
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(full).pipe(res);
  });
}

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
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'Внутренняя ошибка сервера' });
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`iSearch запущен: http://localhost:${PORT}`);
    console.log(`AI_ENABLED=${AI_ENABLED} | основной API: POST /api/search`);
    console.log(`Провайдеры: ${providers.listProviders().map((p) => `${p.id}:${p.enabled ? 'on' : 'off'}`).join(', ')}`);
  });
