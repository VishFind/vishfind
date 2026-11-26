'use strict';

/**
 * Центральная конфигурация VishFind.
 *
 * - Читает .env / env.txt (если файлы есть) и process.env.
 *   Уже заданные переменные окружения (например, платформа хостинга)
 *   НЕ перезаписываются файлами.
 * - Разделяет настройки development и production через NODE_ENV.
 * - Безопасные дефолты: в production фотоанализ выключен, логирование
 *   уровня warn, TRUST_PROXY=true, лимит тела 64 КБ.
 *
 * Никаких секретов в коде: значения ключей берутся только из окружения.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---------- загрузка .env / env.txt (не перезаписывает process.env) ----------
for (const name of ['.env', 'env.txt']) {
  try {
    const text = fs.readFileSync(path.join(ROOT, name), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[2] && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch (_) {
    /* файла нет — нормально */
  }
}

// ---------- вспомогательные парсеры ----------
function bool(v, def) {
  const s = String(v == null ? '' : v).toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return def;
}

function num(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}

function str(v, def) {
  const s = String(v == null ? '' : v).trim();
  return s || def;
}

// ---------- окружение ----------
const NODE_ENV = str(process.env.NODE_ENV, 'development').toLowerCase();
const IS_PROD = NODE_ENV === 'production';

let packageVersion = '0.0.0';
try {
  packageVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || packageVersion;
} catch (_) {
  /* версия не критична */
}

// ---------- конфигурация ----------
const config = {
  env: NODE_ENV,
  isProd: IS_PROD,
  isDev: !IS_PROD,
  version: packageVersion,

  port: num(process.env.PORT, 3000, 1, 65535),
  // На хостинге нельзя слушать только localhost — платформа сканирует 0.0.0.0:PORT.
  host: (() => {
    const h = str(process.env.HOST, '0.0.0.0');
    if (IS_PROD && (h === '127.0.0.1' || h === 'localhost')) return '0.0.0.0';
    return h || '0.0.0.0';
  })(),

  // Фото/ИИ: в production по умолчанию выключено (нет локальной Ollama).
  aiEnabled: bool(process.env.AI_ENABLED, IS_PROD ? false : true),

  // Лимит тела: без фото достаточно малого JSON; с AI — до ~9 МБ (base64).
  bodyLimitSearch: bool(process.env.AI_ENABLED, IS_PROD ? false : true)
    ? 9 * 1024 * 1024
    : 64 * 1024,

  // Прокси: доверять X-Forwarded-For только за платформенным прокси.
  trustProxy: bool(process.env.TRUST_PROXY, IS_PROD ? true : false),

  // Логирование.
  logLevel: str(process.env.LOG_LEVEL, IS_PROD ? 'warn' : 'debug').toLowerCase(),

  // Rate limit (скользящее окно в памяти процесса).
  rateLimit: {
    max: num(process.env.RATE_LIMIT_MAX, 20, 1, 10000),
    windowMs: num(process.env.RATE_LIMIT_WINDOW_SEC, 60, 1, 3600) * 1000,
  },

  // Временный закрытый тест: HTTP Basic Auth на всё приложение.
  // Включается только явным true. Пустой логин или пароль не считаются настройкой.
  basicAuth: {
    enabled: bool(String(process.env.BASIC_AUTH_ENABLED == null ? '' : process.env.BASIC_AUTH_ENABLED).trim(), false),
    user: str(process.env.BASIC_AUTH_USER, ''),
    password: str(process.env.BASIC_AUTH_PASSWORD, ''),
  },

  // Провайдер разбора фото: явный выбор, без авто-failover между ними.
  // ollama — локально; timeweb — Timeweb AI Gateway (платный ключ только на сервере).
  photoProvider: (() => {
    const p = str(process.env.PHOTO_PROVIDER, 'ollama').toLowerCase();
    return p === 'timeweb' ? 'timeweb' : 'ollama';
  })(),

  // Общий бюджет одного разбора фото (все вызовы/повторы). Запас под ответ клиенту
  // при прокси ~120 с: дефолт 105 с.
  photoTotalBudgetMs: num(process.env.PHOTO_TOTAL_BUDGET_SEC, 105, 15, 120) * 1000,

  // Ollama — локальная разработка (AI_ENABLED=true, PHOTO_PROVIDER=ollama).
  ollama: {
    url: str(process.env.OLLAMA_URL, 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: str(process.env.OLLAMA_MODEL, 'qwen3-vl:4b-instruct'),
    timeoutMs: num(process.env.OLLAMA_TIMEOUT_SEC, 90, 1, 600) * 1000,
    // Таймаут одного вызова при разборе фото — не больше 90 с (ещё режется бюджетом).
    photoTimeoutMs: Math.min(num(process.env.PHOTO_TIMEOUT_SEC, 90, 1, 600) * 1000, 90_000),
    // Одновременные разборы фото (по умолчанию 1 — защита от перегрузки Ollama).
    photoConcurrency: num(process.env.PHOTO_CONCURRENCY, 1, 1, 8),
    // schema | twopass | auto
    pipeline: str(process.env.PHOTO_PIPELINE, 'schema').toLowerCase(),
  },

  // Timeweb AI Gateway (PHOTO_PROVIDER=timeweb). Ключ только из env, не в коде.
  timeweb: {
    url: str(
      process.env.TIMEWEB_AI_URL,
      'https://api.timeweb.ai/v1/chat/completions'
    ).replace(/\/$/, ''),
    model: str(process.env.TIMEWEB_AI_MODEL, 'openai/gpt-4o-mini'),
    apiKey: str(process.env.TIMEWEB_AI_API_KEY, ''),
  },

  // Временный one-shot vision: один HTTP к провайдеру, без JSON-retry / strict fallback.
  // Задаётся только process.env при запуске, в постоянный .env не пишем.
  photoOneShot: bool(process.env.PHOTO_ONE_SHOT, false),

  // Персистентный лимит платных HTTP этапа (0 = выкл). Не обнуляется при рестарте.
  paidCall: {
    stage: str(process.env.PAID_CALL_STAGE, ''),
    limit: num(process.env.PAID_CALL_LIMIT, 0, 0, 100),
  },

  // Лимиты критериев (клиент/сервер согласованы через criteria-model).
  criteria: {
    maxMulti: num(process.env.CRITERIA_MAX_MULTI, 8, 1, 20),
    maxQueryLen: num(process.env.CRITERIA_MAX_QUERY_LEN, 300, 50, 2000),
  },

  // Веб-поиск Ollama (ключ только на сервере).
  // Включается только при явном WEB_SEARCH_ENABLED=true и наличии ключа.
  // Наличие ключа само по себе не включает непроверенную функцию.
  webSearch: {
    enabled: (() => {
      const key = str(process.env.OLLAMA_API_KEY, '') || str(process.env.TAVILY_API_KEY, '');
      return bool(process.env.WEB_SEARCH_ENABLED, false) && !!key;
    })(),
    tavilyKey: str(process.env.TAVILY_API_KEY, ''),
    ollamaKey: str(process.env.OLLAMA_API_KEY, ''),
  },

  // eBay Browse API (реальные предложения, опционально).
  ebay: {
    clientId: str(process.env.EBAY_CLIENT_ID, ''),
    clientSecret: str(process.env.EBAY_CLIENT_SECRET, ''),
    marketplace: str(process.env.EBAY_MARKETPLACE, 'EBAY_US'),
    // Circuit breaker: порог последовательных ошибок и пауза.
    circuitThreshold: num(process.env.EBAY_CIRCUIT_THRESHOLD, 3, 1, 100),
    circuitCooldownMs: num(process.env.EBAY_CIRCUIT_COOLDOWN_SEC, 60, 1, 3600) * 1000,
  },

  // Партнёрский каталог только из локальных/зашифрованных Admitad-фидов (data/admitad-feeds).
  // Takprodam API отключён: непроверенные срезы маркетплейсов не используем.
  partnerCatalog: {
    enabled: bool(process.env.PARTNER_CATALOG_ENABLED, false),
    catalogMaxAgeHours: num(process.env.PARTNER_CATALOG_MAX_AGE_HOURS, 720, 1, 24 * 30),
    catalogPath: (() => {
      const configured = str(process.env.PARTNER_CATALOG_PATH, '');
      if (configured) {
        return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
      }
      // Путь только вычисляем — mkdir при старте на /data может подвесить boot на Timeweb.
      const dataRoot = str(process.env.PARTNER_CATALOG_DATA_ROOT, '/data');
      try {
        const fs = require('fs');
        if (fs.existsSync(dataRoot)) {
          return path.join(dataRoot, 'admitad-feeds', 'catalog.json');
        }
      } catch (_) {
        /* нет /data */
      }
      return path.join(ROOT, 'data', 'admitad-feeds', 'catalog.json');
    })(),
  },

  /** @deprecated Takprodam API выключен. Оставлено только чтобы старые тесты/скрипты не падали на require. */
  takprodam: {
    enabled: false,
    apiToken: '',
    sourceId: 24991,
    expectedSourceUrlHost: 'vishfind-vishfind-b98a.twc1.net',
    apiBase: 'https://api.takprodam.ru/v2/publisher',
    catalogMaxAgeHours: 72,
    catalogPath: path.join(ROOT, 'data', 'admitad-feeds', 'catalog.json'),
    assumedCurrency: '',
    assumedCurrencyBasis: '',
  },
};

module.exports = config;