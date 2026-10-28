'use strict';

/**
 * Сборка docs/LEGAL_REVIEW_FACTS.md из актуального кода и реестров.
 * Не юридическое заключение. Не печатает секреты.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'LEGAL_REVIEW_FACTS.md');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadJson(rel) {
  return JSON.parse(read(rel));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function pol(src, key) {
  const p = (src && src.usage_policy) || {};
  let v = p[key];
  if ((v == null || v === '') && key === 'web_fetch') v = p.ollama_web_fetch;
  if ((v == null || v === '') && key === 'ordinary_link') v = p.outbound_link;
  if (v == null || v === '') return 'basis_unset';
  return String(v);
}

function gitInfo() {
  const info = {
    commit: 'не установлено',
    commitDate: '',
    branch: '',
    dirty: true,
    ahead: '',
  };
  try {
    info.commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    info.commitDate = execSync('git log -1 --format=%ci', { cwd: ROOT, encoding: 'utf8' }).trim();
    info.branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    const st = execSync('git status -sb', { cwd: ROOT, encoding: 'utf8' }).trim();
    info.dirty = !st.includes('##') || st.split('\n').length > 1 || / M |^\?\?|ahead/m.test(st);
    info.statusBrief = st.split('\n')[0];
  } catch (_) {
    /* git недоступен */
  }
  return info;
}

function buildSourcesTable(sources) {
  const rows = [
    '| id | name | domain | type | region | status | own | url_template | outbound | web_search_display | web_fetch | html | snippet | price | image | api |',
    '|----|------|--------|------|--------|--------|-----|--------------|----------|-------------------|-----------|------|---------|-------|-------|-----|',
  ];
  for (const s of sources) {
    rows.push(
      '| '
        + [
          s.id,
          esc(s.name).slice(0, 40),
          esc(s.domain),
          esc(s.type),
          esc(s.region),
          esc(s.connection_status),
          s.own_brand ? 'yes' : '',
          esc((s.url_template || '').slice(0, 70)),
          pol(s, 'outbound_link'),
          pol(s, 'web_search_display'),
          pol(s, 'web_fetch'),
          pol(s, 'html_product_fetch'),
          pol(s, 'search_snippet'),
          pol(s, 'product_price'),
          pol(s, 'product_image'),
          pol(s, 'api_products'),
        ].join(' | ')
        + ' |'
    );
  }
  return rows.join('\n');
}

function countBy(sources, key) {
  const out = {};
  for (const s of sources) {
    const k = s[key] || 'unset';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function main() {
  const pkg = loadJson('package.json');
  const reg = loadJson('data/source-registry.json');
  const sources = reg.sources || [];
  const brands = loadJson('data/brand-registry.json');
  const brandList = brands.brands || brands;
  const adapters = loadJson('data/sources.json');
  const git = gitInfo();
  const buildDate = '2026-10-27';

  const byStatus = countBy(sources, 'connection_status');
  const ownBrand = sources.filter((s) => s.own_brand);
  const ownActive = ownBrand.filter((s) => s.connection_status === 'search_link');
  const outboundRestricted = sources.filter((s) => pol(s, 'outbound_link') === 'restricted');
  const htmlAllow = sources.filter((s) => pol(s, 'html_product_fetch') === 'documented_allowed');
  const apiAllow = sources.filter((s) => pol(s, 'api_products') === 'documented_allowed');
  const limited = sources.filter((s) => s.connection_status === 'temporarily_limited');

  const tsum = sources.find((s) => s.id === 'tsum_collect');
  const cultt = sources.find((s) => s.id === 'the_cultt');
  const ebay = sources.find((s) => s.id === 'ebay');

  const lines = [];
  const p = (s = '') => lines.push(s);

  p('# VishFind — фактический пакет для правовой оценки');
  p('');
  p('> **Статус документа:** технический пакет фактов по текущей реализации. **Не** является юридическим заключением, пользовательским соглашением, политикой конфиденциальности или заявлением о соответствии закону.');
  p('>');
  p('> Назначение: передать юристу самостоятельное описание фактической модели работы сервиса. Местонахождение владельца **не** определяется. Значения секретов API **не** включаются.');
  p('');
  p('---');
  p('');
  p('## 1. Шапка и границы достоверности');
  p('');
  p('| Поле | Значение |');
  p('|------|----------|');
  p('| Название продукта (UI) | VishFind |');
  p('| Имя в `package.json` | `' + pkg.name + '` (описание всё ещё упоминает «iSearch») — **расхождение именования**, см. §12 |');
  p('| Версия пакета | `' + (pkg.version || '') + '` |');
  p('| Дата сборки этого файла | ' + buildDate + ' |');
  p('| Git commit (HEAD) | `' + git.commit + '` (' + git.commitDate + ') |');
  p('| Ветка | `' + git.branch + '` (' + (git.statusBrief || 'status н/д') + ') |');
  p('| Незакоммиченные изменения | **Да.** Срез отражает **рабочее дерево** (изменённые и untracked файлы: реестры, политика, UI, docs, тесты), а не только закоммиченный HEAD. |');
  p('| Режим публикации | В рамках сборки документа **публичный продакшен-запуск и deploy не выполнялись**. Наблюдался локальный процесс `NODE_ENV=development` на loopback (см. §16). Конфигурация Amvera описана как подготовленная, не как подтверждённый текущий прод. |');
  p('');
  p('### 1.1. Исходники');
  p('');
  p('- **Код:** `server.js`, `lib/config.js`, `lib/parse-query.js`, `lib/criteria-model.js`, `lib/source-registry.js`, `lib/source-policy.js`, `lib/marketplace-capabilities.js`, `lib/ollama-web.js`, `lib/product-html.js`, `lib/offers.js`, `lib/logger.js`, `lib/rate-limit.js`, `providers/links.js`, `providers/ebay.js`, `js/search.js`, `js/criteria-panel.js`, `js/saved-items.js`, `index.html`, `about.html`, `contacts.html`, `css/site.css`, `amvera.yml`');
  p('- **Данные:** `data/source-registry.json` (' + sources.length + '), `data/sources.json` (' + adapters.length + '), `data/brand-registry.json` (' + (Array.isArray(brandList) ? brandList.length : '?') + '), `data/brands.json`, `data/marketplace-fixtures.json`');
  p('- **Документы:** `docs/FACTUAL_SITE_REPORT.md`, `docs/DATA_FLOW_SUMMARY.md`, `docs/CURSOR_HANDOFF.md` (§22–25), `PROJECT_SPECIFICATION.md`, `AMVERA_DEPLOYMENT.md`');
  p('- **Целевые проверки (ранее, без нового полного прогона):** `test/web-search-opt-in.test.js`, `test/result-actions.test.js`, `test/web-policy-guards.test.js`, `test/source-policy.test.js`, `test/select-sources-groups.test.js`, live `GET /api/health` / `POST /api/search` на loopback (2026-10-27)');
  p('');
  p('### 1.2. Метки достоверности');
  p('');
  p('| Метка | Смысл |');
  p('|-------|--------|');
  p('| **Код** | Установлено чтением актуального кода/реестра |');
  p('| **Проверка** | Подтверждено целевой проверкой/тестом |');
  p('| **Внешний источник** | Заявлено сайтом третьей стороны / сохранено при аудите |');
  p('| **Не установлено** | В проекте нет достаточных данных |');
  p('| **Решение владельца** | Нужен явный выбор владельца продукта |');
  p('| **Правовая оценка** | Вопрос к юристу; инженерный вывод не делается |');
  p('');
  p('### 1.3. Расхождения документов с кодом (важно)');
  p('');
  p('1. **Веб-поиск opt-in.** Актуально по **коду** (`server.js`, `js/search.js`, handoff §25, `DATA_FLOW_SUMMARY.md`): Ollama `web_search` только при `WEB_SEARCH_ENABLED`+ключ **и** `body.web_search === true` **и** бренд **и** политика доменов. В `docs/FACTUAL_SITE_REPORT.md` и `scripts/build-factual-report.js` ещё встречаются формулировки «автоматически при поиске … web_search» / «при бренде и WEB_SEARCH» **без** пользовательского переключателя — **устарело**. Для оценки брать код.');
  p('2. **eBay `api_products=documented_allowed`.** В реестре стоит `documented_allowed`, но письменный договор/разрешение в репозитории **не установлено**. Наличие API в коде ≠ автоматически доказанное правовое основание. См. §6.4. Код в этой задаче не менялся.');
  p('3. **Именование.** UI/доки — VishFind; `package.json` — `isearch-demo` / iSearch.');
  p('');
  p('---');
  p('');
  p('## 2. Краткое описание продукта');
  p('');
  p('| Вопрос | Факт | Метка |');
  p('|--------|------|-------|');
  p('| Назначение | Разбор запроса на критерии и подготовка **переходов** к поиску на сторонних сайтах (редкая/винтажная/архивная одежда) | Код |');
  p('| Действия пользователя | Текст, чипсы критериев, опционально галочка интернет-дополнения, опционально фото (если AI), клик по ссылкам, локальные история/избранное | Код |');
  p('| Действия приложения | Parse → merge → selectSources → сборка URL; опционально внешний web_search; опционально eBay/HTML при allow | Код |');
  p('| Результат для пользователя | Карточки переходов («Подходящие сайты»), «Что передано», опционально web_results; live-товары — только при активной интеграции | Код |');
  p('| Оплата за товары через сервис | **Не принимает** оплату за товары площадок | Код |');
  p('| Кто продаёт | Сторонний сайт после перехода пользователя | Код |');
  p('| Обычный результат | **Переход** (search / каталог), не подтверждённый товар с ценой | Код + Проверка |');
  p('| Конкретный товар | Сейчас: eBay Browse при ключах; HTML — только `documented_allowed` (**0** записей); `products_connected=0` | Код |');
  p('');
  p('### 2.1. Наблюдаемый локальный срез `/api/health` (2026-10-27, loopback)');
  p('');
  p('| Функция | Состояние на срезе |');
  p('|---------|-------------------|');
  p('| Текстовый поиск + links | вкл |');
  p('| `web_search.enabled` | true (ключ configured; значение не раскрывается) |');
  p('| Пользовательский переключатель | default off |');
  p('| `ai_enabled` | false |');
  p('| eBay configured | false |');
  p('| HTML product | не идёт (0 documented_allowed) |');
  p('| `OLLAMA_WEB_FETCH` | не включается переключателем |');
  p('');
  p('Это снимок **одного локального процесса**, не доказательство продакшен-конфигурации Amvera.');
  p('');
  p('### 2.2. Реализовано, но неактивно без настроек');
  p('');
  p('| Функция | Условие |');
  p('|---------|---------|');
  p('| Фото / vision | `AI_ENABLED=true` + Ollama |');
  p('| Web Search | env + ключ + user `web_search:true` |');
  p('| Web Fetch | `OLLAMA_WEB_FETCH=true` + policy |');
  p('| eBay товары | client id/secret |');
  p('| HTML-карточки | `html_product_fetch=documented_allowed` |');
  p('| Live FX | не подключён (`fx.provider=none`) |');
  p('');
  p('Планы из документации не выдаются за действующие функции.');
  p('');
  p('---');
  p('');
  p('## 3. Полная цепочка поиска');
  p('');
  p('### 3.1. Схема');
  p('');
  p('```');
  p('ввод текста / чипсы');
  p('  → POST /api/search { query, attributes?, clear_attributes?, image?, web_search? }');
  p('  → rate limit (память процесса)');
  p('  → parseQuery');
  p('  → mergeCriteria (приоритет ручных / clear)');
  p('  → selectSources (status, outbound, own_brand/brand, группы, тройка Ozon→WB→ЯМ)');
  p('  → adapters + providers/links (сборка URL; HTTP к магазинам не выполняется)');
  p('  → [опционально] ollama enrichBrandSearch (только user+server+brand+policy)');
  p('  → фильтр web_results (+ re-filter кэша); без raw fallback');
  p('  → [опционально] eBay / HTML product при allow');
  p('  → JSON → UI (переходы, «Что передано», disclaimer)');
  p('```');
  p('');
  p('### 3.2. Сценарии');
  p('');
  p('| Сценарий | Поведение |');
  p('|----------|-----------|');
  p('| Обычный текст | §3.1 без Ollama; `web_search.reason=user_opt_out` |');
  p('| Текст + интернет-дополнение | Клиент шлёт `web_search:true`; возможен вызов Ollama; блок «Уточнение из интернета» |');
  p('| Фото при AI вкл. | `image` → локальная Ollama vision → merge; **не** в payload Cloud web_search |');
  p('| Фото при AI выкл. | Кнопка скрыта; image → 503 |');
  p('| История / избранное | Только браузерный `localStorage`; на `/api/search` сами по себе не уходят |');
  p('');
  p('### 3.3. Локально / сервер / внешнее');
  p('');
  p('| Этап | Браузер | Свой сервер | Внешняя сеть |');
  p('|------|---------|-------------|--------------|');
  p('| UI, история, избранное, тема | да | нет | нет |');
  p('| parse / select / links | нет | да | нет |');
  p('| Клик по ссылке магазина | да | нет | да |');
  p('| Фото vision | upload | → OLLAMA_URL | обычно localhost |');
  p('| web_search | нет | да | ollama.com |');
  p('| web_fetch | нет | да (если env) | ollama.com + страница |');
  p('| eBay | нет | да (если ключи) | API eBay |');
  p('| HTML GET | нет | да (если allow) | сайт источника |');
  p('');
  p('### 3.4. Авто vs явное');
  p('');
  p('- **Авто при «Искать»:** parse → select → links.');
  p('- **Явно:** галочка веб-поиска; фото; открытие ссылки; «Новый запрос»; избранное.');
  p('- **Не автоматически:** массовый scrape, HTML без allow, web_fetch без env, CAPTCHA-обход, заказы, оплата.');
  p('');
  p('---');
  p('');
  p('## 4. Функции и ограничения');
  p('');
  p('| Функция | Состояние | Что делает | Данные | Ограничения |');
  p('|---------|-----------|------------|--------|-------------|');
  p('| Текстовый разбор | вкл | Правила → критерии + phrase | query ≤300 | Не облачный LLM для текста |');
  p('| Бренды и алиасы | вкл | Сопоставление реестров | brand-registry / brands | Нет алиаса → пустой бренд |');
  p('| Цена словами | частично | in_query «… рублей» | budget* RUB | ≠RUB без FX |');
  p('| Размеры | вкл | parse + чипы | size(s) | Передача — по caps площадки |');
  p('| Мультивыбор | вкл | несколько значений | maxMulti default 8 | config |');
  p('| Группировка | вкл | группы 1–4 + UI-фильтр | display_group | фильтр без нового API |');
  p('| Поисковые ссылки | вкл | сборка URL | шаблоны | без HTTP к магазину |');
  p('| Цены в URL | частично | native где verified | price params | иначе in_query / нет |');
  p('| Ollama Web Search | частично | URL-кандидаты | query string | opt-in + policy |');
  p('| Web Fetch | выкл по умолч. | чтение страницы | URL | отдельный env |');
  p('| HTML-сбор | выкл | карточки HTML | HTML | 0 documented_allowed |');
  p('| eBay API | выкл без ключей | live offers | Browse API | ключи + circuit |');
  p('| Фото | зависит от env | vision → критерии | image | AI_ENABLED |');
  p('| История | вкл браузер | прошлые запросы | localStorage | не на сервер |');
  p('| Избранное | вкл браузер | сохранённое | localStorage | не на сервер |');
  p('| Копирование | вкл | clipboard фразы | search_phrase_used | — |');
  p('| Новый запрос | вкл | сброс UI/поиска | — | не чистит историю/тему |');
  p('| Реклама | демо | `#ad-placement` | нет сети | не выдача поиска |');
  p('');
  p('---');
  p('');
  p('## 5. Все источники');
  p('');
  p('Источник истины: `data/source-registry.json`. URL-адаптеры: `data/sources.json`. Паспорта фильтров: `lib/marketplace-capabilities.js`.');
  p('');
  p('### 5.1. Количества');
  p('');
  p('| Показатель | Число |');
  p('|------------|-------|');
  p('| Всего записей | **' + sources.length + '** |');
  p('| `search_link` (активные) | **' + (byStatus.search_link || 0) + '** |');
  p('| `identity_checked` | **' + (byStatus.identity_checked || 0) + '** |');
  p('| `candidate` | **' + (byStatus.candidate || 0) + '** |');
  p('| `temporarily_limited` | **' + (byStatus.temporarily_limited || 0) + '** |');
  p('| `products_connected` | **' + (byStatus.products_connected || 0) + '** |');
  p('| own_brand всего / active search_link | ' + ownBrand.length + ' / ' + ownActive.length + ' |');
  p('| outbound restricted | ' + outboundRestricted.length + ' (' + outboundRestricted.map((s) => s.id).join(', ') + ') |');
  p('| html `documented_allowed` | **' + htmlAllow.length + '** |');
  p('| api_products `documented_allowed` | **' + apiAllow.length + '** (' + apiAllow.map((s) => s.id).join(', ') + ') |');
  p('| Адаптеров в sources.json | ' + adapters.length + ' |');
  p('| Брендов в brand-registry | ' + (Array.isArray(brandList) ? brandList.length : '?') + ' |');
  p('');
  p('### 5.2. Списки по статусу');
  p('');
  p('- **Активные (`search_link`):** ' + sources.filter((s) => s.connection_status === 'search_link').map((s) => s.id).join(', '));
  p('- **Кандидаты:** ' + sources.filter((s) => s.connection_status === 'candidate').map((s) => s.id).join(', '));
  p('- **Identity checked:** ' + sources.filter((s) => s.connection_status === 'identity_checked').map((s) => s.id).join(', '));
  p('- **Ограниченные / исключённые (`temporarily_limited`):** ' + limited.map((s) => s.id).join(', '));
  p('');
  p('### 5.3. Полная таблица');
  p('');
  p('Пустое поле policy в JSON отображено как `basis_unset` (**≠** «разрешено»). Не смешивать: идентичность домена ≠ HTTP-доступность ≠ подтверждённая передача фильтра ≠ условия использования.');
  p('');
  p(buildSourcesTable(sources));
  p('');
  p('### 5.4. Обязательная тройка');
  p('');
  p('`selectSources` добавляет Ozon → Wildberries → Яндекс Маркет в хвост (если не restricted). **Код.**');
  p('');
  p('---');
  p('');
  p('## 6. Условия источников');
  p('');
  p('Новый массовый обход сайтов **не** выполнялся. Неподтверждённые цитаты **не** восстанавливались по памяти.');
  p('');
  p('### 6.1. THE CULTT');
  p('');
  p('| Поле | Значение |');
  p('|------|----------|');
  p('| URL | https://thecultt.com/legal/usloviya-prodazhi/polzovatelskoe-soglashenie |');
  p('| Дата в реестре | ' + ((cultt && cultt.usage_policy && cultt.usage_policy.checked_at) || 'н/д') + ' |');
  p('| Дословная `terms_quote` | **отсутствует** (`null`) |');
  p('| В `trust_basis` / `blocker` | Пересказ: п.4.6.1 автодоступ/копирование/отслеживание; п.1.2 коммерческое использование контента; п.1.3 размещение ссылок с письменного разрешения |');
  p('| Действие приложения | Не в selectSources / outbound / web_results / fetch / HTML |');
  p('| Техполитика | caps `restricted`; status `temporarily_limited` |');
  p('| Письменное разрешение | **Не установлено** |');
  p('');
  p('### 6.2. TSUM Collect');
  p('');
  if (tsum && tsum.terms_quote) {
    p('| Поле | Значение |');
    p('|------|----------|');
    p('| URL | ' + tsum.terms_quote.url + ' |');
    p('| Дата | ' + tsum.terms_quote.checked_at + ' |');
    p('| § | ' + tsum.terms_quote.section + ' |');
    p('| Цитата | «' + tsum.terms_quote.text + '» |');
    p('| applies_to | ' + tsum.terms_quote.applies_to + ' |');
    p('| source_of_quote | ' + tsum.terms_quote.source_of_quote + ' |');
    p('| Действие приложения | Переход на каталог возможен (`search_link`); HTML/images/fetch/snippet restricted |');
    p('| Письменное согласие на перепубликацию | **Не установлено** |');
  }
  p('');
  p('### 6.3. Ollama Cloud');
  p('');
  p('| Поле | Значение |');
  p('|------|----------|');
  p('| Search API | `https://ollama.com/api/web_search` |');
  p('| Fetch API | `https://ollama.com/api/web_fetch` |');
  p('| Условия как правовой документ | **Не проверены** |');
  p('| Обещание отсутствия хранения | **Нет основания** в нашем коде |');
  p('');
  p('### 6.4. eBay');
  p('');
  p('| Поле | Значение |');
  p('|------|----------|');
  p('| Код | Browse API, `providers/ebay.js` |');
  p('| Ключи на локальном health | не configured |');
  p('| `api_products` в реестре | `' + (ebay ? pol(ebay, 'api_products') : '') + '` |');
  p('| Договор в репозитории | **Не установлено** |');
  p('| Замечание | Метка отражает техническую готовность интеграции, не найденный договор. **Правовая оценка** / **решение владельца** до включения ключей. |');
  p('');
  p('### 6.5. Прочее');
  p('');
  p('Частичные заметки (FAQ BRANDSHOP, Peak Concept, SPIN4SPIN, own-brand оферты) — в `FACTUAL_SITE_REPORT.md` §Л. Полные актуальные ToS всех активных доменов **не установлены**.');
  p('');
  p('### 6.6. Разрешения');
  p('');
  p('| Предоставлено в проекте | Не установлено |');
  p('|-------------------------|----------------|');
  p('| Тех caps / blockers; 1 цитата TSUM Collect; пересказ пунктов CULTT | Письменные разрешения магазинов; договор eBay; ToS Ollama Cloud; согласия на HTML/перепубликацию |');
  p('');
  p('---');
  p('');
  p('## 7. Политики и техническое исполнение');
  p('');
  p('| Контроль | Файл / функция | Поведение |');
  p('|----------|----------------|-----------|');
  p('| До выбора | `lib/source-registry.js` → `selectSources` | status, outbound, brand/own_brand, тройка |');
  p('| Адаптер | `adaptersForSelection` | skip `verified:false` |');
  p('| web filter | `lib/source-policy.js` → `filterWebSearchResults`, `isOutboundRestrictedHost` | restricted / display |');
  p('| Повтор filter | `server.js` после enrich; cache re-filter в `ollama-web.js` | |');
  p('| Raw fallback | убран из enrich pipeline | |');
  p('| Unknown web_fetch | `webFetchAllowedForUrl` | запрет |');
  p('| CULTT | outbound restricted + limited | полный блок показа/fetch |');
  p('| Ошибка сети/API | logger.warn + warnings | links продолжают работать |');
  p('');
  p('**Проверено** кодом/тестами: opt-in, policy filter, no raw fallback, CULTT host match. **Не доказано** этой сборкой: свежесть внешних ToS; логи Amvera; правовая квалификация гиперссылки.');
  p('');
  p('---');
  p('');
  p('## 8. Ollama и внешний поиск');
  p('');
  p('| Параметр | Факт |');
  p('|----------|------|');
  p('| UI toggle | default off; disabled без server enabled; не в localStorage |');
  p('| Сервер | `WEB_SEARCH_ENABLED=true` + ключ (`lib/config.js`) |');
  p('| Ключ без значения | health: configured=true; значение не в документе |');
  p('| Ключ сам | не включает |');
  p('| Payload | `{ query, max_results }` |');
  p('| Query | brand + phrase + `site:`…; sanitize/truncate; не анонимайзер PII |');
  p('| Не передаётся | фото, история, избранное, произвольные tech-поля UI |');
  p('| Timeout / parallel / cache | 20 с; ≤2; TTL 10 мин; ≤64 |');
  p('| UI показ | url; title/snippet по caps; unverified |');
  p('| web_search читает страницы? | **Нет** в нашей реализации |');
  p('| web_fetch | только `OLLAMA_WEB_FETCH=true` + policy |');
  p('| Toggle = согласие? | **Не утверждается** (технический флаг). Правовая оценка. |');
  p('| Условия поставщика | не проверены |');
  p('');
  p('---');
  p('');
  p('## 9. Пользовательские данные');
  p('');
  p('| Категория | Откуда | Цель | Обработка | Хранение | Срок | Передача | Удаление | Неизвестно |');
  p('|----------|--------|------|-----------|----------|------|----------|----------|------------|');
  p('| Поисковый текст | `#q` | parse/links | свой сервер | не профиль; возможен усечённый debug-лог | retention **не задан** | при opt-in — строка в Ollama Cloud | UI / Новый запрос; нет «удалить аккаунт» | логи хостинга |');
  p('| Ручные критерии | чипы | merge | сервер | в теле запроса на время обработки | — | нет отдельно | — | — |');
  p('| Фото | файл | vision | сервер → локальная Ollama | штатно не на диск | — | **не** в Cloud web_search | clear photo | swap/OS |');
  p('| Thumbnail | история | превью | браузер | localStorage | до очистки | нет | очистка storage | квоты |');
  p('| История | rememberSearch | UX | браузер | `vishfind-history` | до очистки | нет | UI/storage | — |');
  p('| Избранное | save | UX | браузер | Saved API / localStorage | до очистки | нет | UI | — |');
  p('| Тема | toggle | UX | браузер | `vishfind-theme` | до очистки | нет | смена/очистка | — |');
  p('| IP / rate limit | соединение | антифлуд | сервер `lib/rate-limit.js` | память процесса (ключ=IP) | окно сек. | не внешним API | рестарт процесса | за прокси — X-Forwarded-For при TRUST_PROXY |');
  p('| Серверные логи | runtime | диагностика | `lib/logger.js` | stdout процесса / сборщик хоста | **не установлено** на хосте | платформа хостинга | **не установлено** | состав на Amvera |');
  p('| Ошибки | exceptions | диагностика | logger | как логи | — | — | — | — |');
  p('| Cookies приложения | — | — | — | **не выставляются** кодом приложения | — | — | — | cookie платформы |');
  p('| Аналитика | — | — | — | пиксели **не найдены** в HTML/JS | — | — | — | — |');
  p('');
  p('Разделение сред: **браузер** (история/избранное/тема) · **свой сервер** (parse/links/rate/cache) · **локальная Ollama** (фото) · **облачная Ollama** (web_search при opt-in) · **будущий хостинг** (логи/заголовки — не проверены).');
  p('');
  p('Отсутствие аккаунтов **не** означает «данных нет».');
  p('');
  p('---');
  p('');
  p('## 10. Внешние ресурсы и переходы');
  p('');
  p('| Тема | Факт |');
  p('|------|------|');
  p('| CDN магазинов/шрифтов | сторонние CDN **не** подключены; шрифты локальные `fonts/` |');
  p('| Сторонние скрипты | не подключены (self + inline theme) |');
  p('| Аналитика | не найдена |');
  p('| Cookies приложения | не выставляются кодом |');
  p('| Referrer-Policy | `strict-origin-when-cross-origin` (`SECURITY_HEADERS`) |');
  p('| CSP | default-src self; connect-src self; img data/blob (см. SECURITY_HEADERS в server.js) |');
  p('| Внешние ссылки | `target=_blank` + `rel=noopener noreferrer` |');
  p('| Превью/fetch при показе ссылки | **нет** (только сборка URL; fetch отдельно и выкл.) |');
  p('| После клика | поведение магазина **вне** контроля VishFind; не описывается как действие приложения |');
  p('| Amvera заголовки/логи | **не утверждается** отсутствие доп. логов до проверки |');
  p('');
  p('---');
  p('');
  p('## 11. Публичные тексты и сверка с кодом');
  p('');
  p('| Место | Формулировка (смысл) | Соответствие коду |');
  p('|-------|----------------------|-------------------|');
  p('| Hero / meta | переходы; цену/наличие/подлинность у продавца | соответствует |');
  p('| Пояснение под выдачей | сторонние ссылки; проверяйте у продавца; «Что передано» | соответствует |');
  p('| Переключатель | фраза передаётся Ollama для поиска ссылок | соответствует (при server+opt-in) |');
  p('| about.html | не каталог; не оплата; не партнёр; не подтверждает подлинность | соответствует |');
  p('| contacts.html | переходы; оплату не принимает | соответствует |');
  p('| Карточки official | «Не партнёрство VishFind» | соответствует |');
  p('| «Официальный магазин/сайт» | ярлык группы/типа источника, не договор партнёрства | соответствует при чтении с note; риск смешения ярлыка и партнёрства — **правовая оценка** формулировок |');
  p('| Блок «Как устроен поиск» | «Открывается поиск на маркетплейсах» | **частично:** также own-brand/official/reseller; не только маркетплейсы |');
  p('| Реклама | демо-место, не результаты | соответствует |');
  p('| Доставка | «смотрите на площадке» | соответствует (сервис доставку не оказывает) |');
  p('| package.json iSearch | устаревшее имя | **расхождение** с брендом UI |');
  p('| FACTUAL_SITE_REPORT auto web | устарело | **расхождение** с opt-in |');
  p('');
  p('Интерфейс в этой задаче **не** менялся.');
  p('');
  p('---');
  p('');
  p('## 12. Монетизация (факт)');
  p('');
  p('| Механизм | Наличие в коде сейчас |');
  p('|----------|------------------------|');
  p('| Оплата за товары | нет |');
  p('| Подписка | нет |');
  p('| Реальные рекламные сети | нет (демо-блок UI) |');
  p('| Партнёрские/affiliate ссылки | не реализованы как отдельный механизм |');
  p('| Платное ранжирование | нет |');
  p('| Комиссии сервиса | нет в коде |');
  p('');
  p('Планы монетизации не выдаются за текущую деятельность.');
  p('');
  p('---');
  p('');
  p('## 13. Подготовка к облаку (Amvera) — только факты');
  p('');
  p('Источник: `amvera.yml`, `AMVERA_DEPLOYMENT.md`, `lib/config.js`. **Deploy в этой задаче не выполнялся.**');
  p('');
  p('| Тема | Факт / неизвестно |');
  p('|------|-------------------|');
  p('| Публичная доступность | при деплое — HTTPS-домен платформы; сейчас не подтверждено |');
  p('| `amvera.yml` | `command: npm run start`, `containerPort: "80"`, `persistenceMount: /data` |');
  p('| Локальная Ollama | в контейнере **нет** доступа к Ollama разработчика → `AI_ENABLED=false` для облака |');
  p('| Секреты | только переменные панели; не в git |');
  p('| Типичные env из инструкции | `NODE_ENV=production`, `AI_ENABLED=false`, `WEB_SEARCH_ENABLED=false` (пока не решено иначе), `TRUST_PROXY=true` |');
  p('| Логи платформы | состав/срок **не проверены** |');
  p('| Регион/тариф | **не устанавливать** без данных владельца |');
  p('');
  p('### 13.1. Закрытый тест на телефоне vs публичный запуск');
  p('');
  p('| | Закрытый тест | Публичный запуск |');
  p('|--|---------------|------------------|');
  p('| Аудитория | ограниченный круг | любой в интернете |');
  p('| Риск индексации/жалоб | ниже, но не ноль при публичном URL | выше |');
  p('| Нужны | решение владельца по env, домену, текстам, источникам | + публичные документы по итогам правовой оценки |');
  p('');
  p('---');
  p('');
  p('## 14. Чего не хватает');
  p('');
  p('### А. Сведения от владельца (не запрашиваются автоматически в чате)');
  p('');
  p('1. Правовой статус оператора / реквизиты (если нужны для документов).');
  p('2. Публичный контакт.');
  p('3. Решение: закрытый тест vs публичный запуск.');
  p('4. Решение по `WEB_SEARCH_ENABLED` / ключу Ollama в облаке.');
  p('5. Решение по eBay ключам и основанию `documented_allowed`.');
  p('6. Письменные разрешения (CULTT и др.) или подтверждённый отказ от источника.');
  p('7. Подтверждение актуальности ToS площадок на дату запуска.');
  p('8. Политика логов/retention на выбранном хостинге.');
  p('9. Нужны ли отдельные публичные документы (оферта/политика) — после оценки юриста.');
  p('');
  p('### Б. Вопросы для юриста (по реализации)');
  p('');
  p('**Источники и ссылки**');
  p('- Достаточно ли модели «гиперссылка / переход» без копирования каталога для активных `search_link` с `basis_unset`?');
  p('- Как квалифицировать показ CULTT-ссылок при п.1.3 (сейчас технически запрещены)?');
  p('- TSUM Collect: каталог-переход при §4.6 про контент — допустим ли текущий режим?');
  p('');
  p('**Интеллектуальные права**');
  p('- Использование названий брендов/логотипов в UI (текстом, без чужих CDN-изображений).');
  p('- Сниппеты/title из web_search при caps allow.');
  p('');
  p('**Внешние сервисы**');
  p('- Передача поисковой фразы в Ollama Cloud при UI-галочке: нужны ли отдельные согласия/уведомления?');
  p('- eBay Browse при будущем включении ключей.');
  p('');
  p('**Пользовательские данные**');
  p('- Достаточен ли текущий объём (localStorage + сервер без аккаунтов + опциональный Cloud query)?');
  p('- Rate-limit по IP и логи хостинга.');
  p('');
  p('**Реклама**');
  p('- Демо-блок «Рекламное размещение» до реальной рекламы.');
  p('');
  p('**Публичные документы**');
  p('- Какие документы обязательны до публичного запуска (без шаблонов в этом пакете)?');
  p('- Нужна ли правка ярлыка «Официальный магазин» во избежание смешения с партнёрством?');
  p('');
  p('---');
  p('');
  p('## 15. Доказательства и проверки');
  p('');
  p('| Что | Дата / примечание | Подтверждает | Не подтверждает |');
  p('|-----|-------------------|--------------|-----------------|');
  p('| `node --test test/web-search-opt-in.test.js test/result-actions.test.js` | 2026-10-27, 12 pass | наличие opt-in в коде/UI/about; disclaimer | правовую законность |');
  p('| Live POST без `web_search` | 2026-10-27 loopback | `user_opt_out`, локальные sources>0 | поведение Ollama Cloud ToS |');
  p('| Live POST с `web_search:true` | 2026-10-27 | `user_requested`; CULTT/oskelly не в выдаче | полноту результатов web |');
  p('| `test/web-policy-guards.test.js` и др. | ранее в проекте | policy guards | актуальность внешних ToS |');
  p('| Полный `npm test` / verify-prod | **не** гонялись в этой сборке | — | полный регресс |');
  p('');
  p('«N pass» ≠ правовая проверка. Mock/static тесты читают исходники; live — только loopback.');
  p('');
  p('---');
  p('');
  p('## 16. Замечания о существенных дефектах / рисках фактов');
  p('');
  p('1. Устаревшее описание auto-web в `FACTUAL_SITE_REPORT.md` / генераторе — риск ошибочной оценки, если читать отчёт вместо кода.');
  p('2. `ebay.api_products=documented_allowed` без договора в репозитории — риск переоценки основания.');
  p('3. Ярлык «Официальный…» рядом с отказом от партнёрства — потенциальная двусмысленность текстов (**правовая оценка**).');
  p('4. Блок «маркетплейсах» в how-секции уже, чем реальная выдача.');
  p('5. Именование iSearch в package.json.');
  p('');
  p('Код и конфигурация в рамках этой задачи **не изменялись** (кроме создания настоящего файла и вспомогательного скрипта сборки).');
  p('');
  p('---');
  p('');
  p('*Конец пакета фактов. Документ не завершает правовую проверку.*');
  p('');

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('Wrote', OUT, 'lines=', lines.length, 'bytes=', Buffer.byteLength(lines.join('\n'), 'utf8'));
}

main();
