'use strict';

/**
 * Генерация подробного фактического отчёта (не юр. заключение).
 * Запуск: node scripts/build-factual-report.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source-registry.json'), 'utf8'));
const adapters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sources.json'), 'utf8'));
const byAd = Object.fromEntries(adapters.map((a) => [a.id, a]));

const out = [];
function push(...lines) {
  out.push(...lines);
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}
function pol(s, k) {
  const u = s.usage_policy || {};
  if (u[k] != null && u[k] !== '') return String(u[k]);
  if (k === 'web_fetch' && u.ollama_web_fetch) return String(u.ollama_web_fetch);
  return '—';
}
function hasQ(u) {
  return String(u || '').includes('{q}');
}

push('# VishFind — подробный фактический отчёт для правового обсуждения');
push('');
push('**Дата среза:** 2026-10-27  ');
push('**Файл сгенерирован скриптом:** `scripts/build-factual-report.js`  ');
push('**Назначение:** максимально полный фактический снимок поискового сценария для обсуждения с юристом.  ');
push('');
push('> **Важно**');
push('>');
push('> Документ описывает, *как устроены код и конфигурация*, и **не является юридическим заключением**.');
push('> Не используются формулировки «законно / незаконно», «ответственность исключена», «всё разрешено».');
push('> Отсутствие запрета в прочитанном фрагменте ≠ разрешение.');
push('> HTTP 403/401/timeout ≠ правовой запрет.');
push('> Секреты API, cookies пользователей и тексты реальных пользовательских запросов не включены.');
push('> Местонахождение владельца и персональные данные не определяются.');
push('');
push('---');
push('');
push('## 0. Словарь статусов (как в коде)');
push('');
push('| Термин | Смысл в VishFind |');
push('|--------|------------------|');
push('| `search_link` | Может попасть в активную выдачу как переход |');
push('| `products_connected` | Заявлена товарная связка (сейчас 0 записей) |');
push('| `identity_checked` | Идентичность домена сверена; не обязательно активный search |');
push('| `candidate` | Кандидат; не показывается как подключённый магазин |');
push('| `temporarily_limited` | Временно исключён из активной выдачи |');
push('| `documented_allowed` | В `usage_policy`: зафиксированное основание на действие |');
push('| `restricted` | В `usage_policy`: действие отключено политикой кода |');
push('| `basis_unset` | Основание **не установлено** (не равно «можно») |');
push('| `own_brand` | Магазин собственного бренда (не маркетплейс) |');
push('| `display_group` | Группа UI 1–4; отдельно от поля `type` |');
push('| `in_query` | Критерий в тексте запроса, не native URL-фильтр |');
push('| `applied` / native | Подтверждённая подстановка в URL |');
push('');
push('Ключевые модули: `server.js`, `lib/parse-query.js`, `lib/criteria-model.js`, `lib/source-registry.js`, `lib/source-policy.js`, `providers/links.js`, `lib/ollama-web.js`, `lib/product-html.js`, `providers/ebay.js`, `js/search.js`, `data/source-registry.json`, `data/sources.json`.');
push('');
push('---');
push('');
push('## А. Как работает поиск (полная цепочка)');
push('');
push('### А.1. Пошагово');
push('');
push('1. **Браузер — ввод** (`index.html`, `js/search.js`, `js/criteria-panel.js`): текст `#q` (≤300), чипсы, опционально фото.');
push('2. **Клиент → сервер:** `POST /api/search` с JSON `{ query, attributes?, attributes_priority?, clear_attributes?, image? }`.');
push('3. **Сервер** (`server.js`): rate limit в памяти; лимит тела 64 КБ / до ~9 МБ с AI; заголовки `SECURITY_HEADERS` (CSP `default-src \'self\'`, `connect-src \'self\'`, `Cache-Control: no-store`, …).');
push('4. **Парсинг** — `lib/parse-query.js` `parseQuery` (бренды из алиасов реестра).');
push('5. **Слияние критериев** — `lib/criteria-model.js` `mergeCriteria` (ручной приоритет / явный сброс).');
push('6. **Выбор источников** — `lib/source-registry.js` `selectSources`: status + outbound + own_brand/brand gate + неизвестный бренд; группы official → reseller → other → marketplace_tail; лимит optional; обязательные Ozon→WB→Яндекс; official extras без дубля домена.');
push('7. **Адаптеры** — `adaptersForSelection` + `data/sources.json` (`verified:false` отбрасывается).');
push('8. **Ссылки** — `providers/links.js`: **HTTP к магазинам не выполняется**; только сборка URL. Native price / text budget / витрина без `{q}` — см. раздел про цену.');
push('9. **Опционально web** — при бренде и `WEB_SEARCH_ENABLED=true`+ключе: `lib/ollama-web.js` → `https://ollama.com/api/web_search`, filter policy, `web_results`.');
push('10. **Опционально eBay API** — при ключах (`providers/ebay.js`); иначе возможен только search_link.');
push('11. **Опционально HTML product** — только `html_product_fetch=documented_allowed`.');
push('12. **Ответ** — `sources`, `web_results`, `offers.items` (live) vs `offers.demo_items`, предупреждения.');
push('13. **UI** — порядок групп с сервера; «Новый запрос» после списка ссылок; рекламный блок отдельно.');
push('');
push('### А.2. Локально / свой сервер / внешняя сеть');
push('');
push('| Этап | Браузер | Свой сервер | Внешняя сеть |');
push('|------|---------|-------------|--------------|');
push('| UI, история, избранное | да | нет | нет |');
push('| Парсинг, selectSources, сборка URL | нет | да | нет |');
push('| Клик по ссылке магазина | да | нет | да (сайт магазина) |');
push('| Фото → Ollama vision | base64 upload | прокси на OLLAMA_URL | обычно localhost |');
push('| web_search | нет | да | ollama.com |');
push('| web_fetch | нет | да (если env) | ollama.com + страница |');
push('| eBay Browse | нет | да (если ключи) | API eBay |');
push('| HTML GET карточек | нет | да (если allow) | сайт источника |');
push('');
push('### А.3. Автоматически vs по действию');
push('');
push('- **Автоматически при поиске:** parse → select → links; при условиях — web_search.');
push('- **По действию пользователя:** Искать / Фото / открыть ссылку / Новый запрос / избранное.');
push('- **Не делается автоматически:** массовый обход каталогов, HTML restricted, web_fetch при выключенном флаге, обход CAPTCHA, оформление заказов.');
push('');
push('### А.4. Передача цены (актуальная логика)');
push('');
push('| Случай | Поведение | Код |');
push('|--------|-----------|-----|');
push('| Native price подтверждён (Яндекс) | Параметры URL; **без** текстового дубля | `applyPriceFilters` + `price_filter_verified` |');
push('| Native не подтверждён, RUB, шаблон с `{q}` | Текст «до/от/от–до … рублей» в `{q}`; kind `in_query` | `formatBudgetInQuery` / `buildUrl` |');
push('| Витрина без `{q}` | Бюджет **не** передаётся и не заявляется как переданный | `buildUrl` info-note |');
push('| Валюта ≠ RUB, нет конвертации | Рубли **не** подставляются ни в URL, ни словами | `applyPriceFilters` + ветка currency |');
push('| Ручной критерий цены | Берётся итоговая модель после merge; противоречия текста и чипов не дублируются в phrase | `mergeCriteria` + `search_phrase` без цены |');
push('');
push('---');
push('');
push('## Б. Полный перечень записей реестра (' + reg.sources.length + ')');
push('');
push('Источник: `data/source-registry.json`. `region`/`storefront_region` ≠ обязательно `brand_origin`.');
push('');

const groupDefs = [
  ['1. Own-brand (магазины собственного бренда)', (s) => !!s.own_brand],
  ['2. Brand official (не own_brand)', (s) => s.type === 'brand_official' && !s.own_brand],
  ['3. Reseller / vintage', (s) => ['reseller', 'authorized_reseller', 'vintage'].includes(s.type)],
  ['4. Classifieds', (s) => s.type === 'classifieds'],
  ['5. Chinese marketplace', (s) => s.type === 'chinese_marketplace'],
  ['6. Mass marketplace', (s) => s.type === 'mass_marketplace'],
];

for (const [title, fn] of groupDefs) {
  push('### ' + title);
  push('');
  push('| id | Название | Домен | region | status | own | шаблон / kind | Участие |');
  push('|----|----------|-------|--------|--------|-----|---------------|---------|');
  for (const s of reg.sources.filter(fn)) {
    const a = byAd[s.adapter_ref || s.id] || {};
    const url = s.url_template || a.url_template || '';
    const kind = s.link_kind || (hasQ(url) ? 'search_param' : url ? 'entry' : 'none');
    let why = '';
    if (['ozon', 'wildberries', 'yandex_market'].includes(s.id)) {
      why = 'Обязательная последняя тройка';
    } else if (s.connection_status === 'search_link' || s.connection_status === 'products_connected') {
      why = 'Может попасть в selectSources при brand/category/policy gate';
      if (s.own_brand) why += '; own_brand: свой бренд или запрос без бренда';
      if (s.id === 'lamoda_ru') why += '; type=reseller, UI group=other';
    } else if (s.connection_status === 'temporarily_limited') {
      why = 'Исключён: ' + (s.blocker || 'temporarily_limited');
    } else if (s.connection_status === 'candidate') {
      why = 'Кандидат — не как подключённый';
    } else if (s.connection_status === 'identity_checked') {
      why = 'Идентичность; search не обязателен';
    } else why = s.connection_status;
    push(
      '| '
        + [
          s.id,
          esc(s.name),
          esc(s.domain),
          esc(s.region),
          s.connection_status,
          s.own_brand ? 'yes' : '',
          esc((url || '—').slice(0, 70) + ' / ' + kind),
          esc(why),
        ].join(' | ')
        + ' |'
    );
  }
  push('');
}

push('---');
push('');
push('## В. Техническая матрица по каждой записи');
push('');
push('Policy «—» = поле не задано в JSON (в `cap()` часто → `basis_unset`).');
push('');
push(
  '| id | переход | `{q}` | native price | text budget | web_display | web_fetch | HTML | images | API | товары/цены |'
);
push('|----|---------|------|--------------|-------------|-------------|-----------|------|--------|-----|-------------|');

for (const s of reg.sources) {
  const a = byAd[s.adapter_ref || s.id] || {};
  const url = s.url_template || a.url_template || '';
  const active = ['search_link', 'products_connected'].includes(s.connection_status);
  const outb = pol(s, 'outbound_link');
  const transit =
    outb === 'restricted' || s.connection_status === 'temporarily_limited'
      ? 'ограничено'
      : active || url
        ? 'шаблон/вкл'
        : 'не активен';
  const search = hasQ(url) ? 'да' : url ? 'витрина' : 'нет';
  let native = 'нет';
  if (a.price_filter_verified) native = 'да verified';
  else if (a.price_param) native = 'заявлен, не verified';
  let textBud = '—';
  const ccy = a.price_currency || s.currency || 'RUB';
  if (a.price_filter_verified) textBud = 'не дублируем';
  else if (hasQ(url) && ccy === 'RUB') textBud = 'да при бюджете';
  else if (hasQ(url)) textBud = 'нет (не RUB)';
  else if (url) textBud = 'нет (нет {q})';
  let api = 'нет';
  if (s.id === 'ebay' || s.adapter_ref === 'ebay') api = 'Browse API при ключах';
  let goods = 'нет в search_link';
  if (s.product_live === 'policy_disabled') goods = 'HTML policy off';
  if (s.id === 'ebay') goods = 'API при ключах';
  push(
    '| '
      + [
        s.id,
        transit,
        search,
        native,
        textBud,
        pol(s, 'web_search_display'),
        pol(s, 'web_fetch'),
        pol(s, 'html_product_fetch'),
        pol(s, 'images'),
        api,
        goods,
      ]
        .map(esc)
        .join(' | ')
      + ' |'
  );
}

push('');
push('---');
push('');
push('## Г. Происхождение материалов');
push('');
push('| Материал | Откуда |');
push('|----------|--------|');
push('| Названия площадок | Локальные JSON |');
push('| URL поиска/витрины | Шаблоны на сервере; уход по клику пользователя |');
push('| Карточки товаров | Не из search_link; eBay/HTML только при allow |');
push('| Цены | Не проверяются в search_link; YM native; иначе in_query или «на сайте» |');
push('| Наличие | Не проверяется |');
push('| Web title/snippet | Нейтральный title по умолчанию; shop text только documented_allowed |');
push('| Изображения товаров | Не перепубликуем в основном сценарии |');
push('| Логотипы магазинов | Чужие CDN не подключены |');
push('| Демо | `demo_items` отдельно от live `items` |');
push('| Шрифты | Локальные `fonts/` |');
push('');
push('---');
push('');
push('## Д. Условия и основания');
push('');
push('### Д.1. THE CULTT');
push('');
push('- URL: https://thecultt.com/legal/usloviya-prodazhi/polzovatelskoe-soglashenie');
push('- Дата в реестре: 2026-10-27');
push('- В реестре зафиксированы отсылки к п.4.6.1, 1.2, 1.3 (см. `trust_basis` / `blocker`).');
push('- Код: `temporarily_limited`; caps restricted на html/outbound/web/fetch/images/price.');
push('- Письменное разрешение: **не зафиксировано в проекте**.');
push('- Для юридической сверки: открыть актуальный URL условий и сопоставить с полями записи `the_cultt`.');
push('');
push('### Д.2. TSUM Collect');
push('');
push('- URL: https://collect.tsum.ru/terms');
push('- Дата: 2026-10-27');
push('- В `terms_quote` сохранена цитата §4.6 о исключительных правах на контент и запрете использования без согласия.');
push('- `applies_to` в реестре: html_product_fetch / republish — **не автоматически** обычный гиперссылочный переход.');
push('- Код: HTML/images/fetch restricted; outbound `basis_unset`; каталог в выдаче сохранён.');
push('- Письменное согласие на перепубликацию: **не зафиксировано**.');
push('');
push('### Д.3. Прочие');
push('');
push('Массовое чтение conditions всех доменов для этого отчёта **не выполнялось**. Где нет `terms_quote` / `documented_allowed` — основание **не установлено**.');
push('');
push('---');
push('');
push('## Е. Политики и обходы');
push('');
push('| Контроль | Место | Поведение |');
push('|----------|-------|-----------|');
push('| До выбора | `selectSources` | status, outbound, brand/own_brand, unknown brand |');
push('| Адаптер | `adaptersForSelection` | skip verified:false |');
push('| web_fetch | `webFetchAllowedForUrl` | unknown domain запрещён |');
push('| web_search | filter + re-filter cache | без raw fallback |');
push('| Official extras | `server.js` | skip restricted / limited / duplicate domain |');
push('| Демо | offers split | items ≠ demo_items |');
push('');
push('Остаточные архитектурные факты: клик пользователя; устаревание conditions сайта; env может включать web_search; ручной URL вне продукта.');
push('');
push('---');
push('');
push('## Ж. Ollama / eBay');
push('');
push('### Ж.1. Web');
push('');
push('| | |');
push('|--|--|');
push('| Search | `https://ollama.com/api/web_search` |');
push('| Fetch | `https://ollama.com/api/web_fetch` |');
push('| Search on | `WEB_SEARCH_ENABLED=true` + ключ |');
push('| Fetch on | `OLLAMA_WEB_FETCH=true` + documented_allowed |');
push('| Timeout | 20 с |');
push('| Cache | 10 мин, ≤64, in-memory |');
push('| Условия Ollama Cloud | как правовой документ в срезе **не проверялись** |');
push('');
push('### Ж.2. Vision');
push('');
push('| | |');
push('|--|--|');
push('| Flag | `AI_ENABLED` |');
push('| Default URL | `http://127.0.0.1:11434` |');
push('| Model default | `qwen3-vl:4b-instruct` |');
push('| Photo timeout | ≤90 с |');
push('| Concurrency | default 1 |');
push('');
push('### Ж.3. eBay');
push('');
push('Browse API; ключи только server-side; circuit breaker; без ключей — без API-карточек.');
push('');
push('---');
push('');
push('## З. Фото / кнопки');
push('');
push('- `#btn-photo` в строке поиска; видна при `ai_enabled`.');
push('- Выключенный AI: кнопка скрыта; загрузка ≠ успешный разбор.');
push('- «Новый запрос»: после ссылок; abort + searchSeq; не чистит историю/избранное/тему.');
push('');
push('---');
push('');
push('## И. Хранение и внешние связи');
push('');
push('| | |');
push('|--|--|');
push('| History / saved / theme | localStorage |');
push('| User DB | нет |');
push('| Analytics pixels | не найдены |');
push('| Font CDN | нет |');
push('| Tracking cookies | не выставляются приложением |');
push('| Ads | демо `#ad-placement` |');
push('| CSP connect-src | `self` |');
push('');
push('---');
push('');
push('## К. Неподтверждённые вопросы');
push('');
push('1. Актуальные полные тексты условий всех активных доменов.');
push('2. Письменные разрешения CULTT / согласия TSUM.');
push('3. Правовая квалификация гиперссылки vs копирования контента (вне этого отчёта).');
push('4. Условия Ollama Cloud под web_search.');
push('5. Условия eBay при включении ключей.');
push('6. Native price Ozon/WB.');
push('7. Search URL own-brand.');
push('8. Политика логов конкретного хостинга.');
push('9. Трансграничность запросов к ollama.com — факт маршрута есть, оценка нет.');
push('');
push('---');
push('');
push('## Л. Карточки записей с policy / terms / blocker');
push('');

for (const s of reg.sources) {
  if (!s.usage_policy && !s.terms_quote && !s.blocker && s.connection_status === 'candidate') {
    continue;
  }
  if (!s.usage_policy && !s.terms_quote && !s.blocker && s.connection_status === 'identity_checked') {
    continue;
  }
  push('### `' + s.id + '` — ' + s.name);
  push('');
  push(
    '- domain: `'
      + (s.domain || '—')
      + '`; type: `'
      + s.type
      + '`; status: `'
      + s.connection_status
      + '`; checked_at: `'
      + (s.checked_at || '—')
      + '`'
  );
  if (s.own_brand) push('- own_brand: true');
  if (s.blocker) push('- blocker: ' + esc(s.blocker));
  if (s.trust_basis) push('- trust_basis: ' + esc(s.trust_basis));
  if (Array.isArray(s.trust_links) && s.trust_links.length) {
    push('- trust_links: ' + s.trust_links.join(', '));
  }
  if (s.terms_quote) {
    push('- terms_quote.url: ' + s.terms_quote.url);
    push('- terms_quote.section: ' + s.terms_quote.section);
    push('- terms_quote.checked_at: ' + s.terms_quote.checked_at);
    push('- terms_quote.text: «' + esc(s.terms_quote.text) + '»');
    push('- terms_quote.applies_to: ' + esc(s.terms_quote.applies_to));
    if (s.terms_quote.source_of_quote) {
      push('- terms_quote.source_of_quote: ' + esc(s.terms_quote.source_of_quote));
    }
  }
  if (s.usage_policy) {
    const u = s.usage_policy;
    const parts = Object.keys(u)
      .filter((k) => typeof u[k] === 'string')
      .map((k) => k + '=' + u[k]);
    push('- usage_policy: ' + parts.join('; '));
    if (Array.isArray(u.basis_urls)) push('- basis_urls: ' + u.basis_urls.join(', '));
  }
  if (s.product_live_note) push('- product_live_note: ' + esc(s.product_live_note));
  push('');
}

push('---');
push('');
push('## М. Адаптеры `data/sources.json` (кратко)');
push('');
push('| id | verified | price_filter_verified | currency | url_template |');
push('|----|----------|----------------------|----------|--------------|');
for (const a of adapters) {
  push(
    '| '
      + [
        a.id,
        a.verified === true ? 'true' : a.verified === false ? 'false' : '—',
        a.price_filter_verified ? 'true' : 'false',
        a.price_currency || '—',
        esc(String(a.url_template || '').slice(0, 80)),
      ].join(' | ')
      + ' |'
  );
}
push('');
push('---');
push('');
push('*Конец отчёта.*');

const dest = path.join(ROOT, 'docs/FACTUAL_SITE_REPORT.md');
fs.writeFileSync(dest, out.join('\n') + '\n', 'utf8');
console.log('Wrote', dest, 'lines=', out.length, 'bytes=', fs.statSync(dest).size);
