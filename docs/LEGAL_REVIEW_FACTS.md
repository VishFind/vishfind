# VishFind — фактический пакет для правовой оценки

> **Статус документа:** технический пакет фактов по текущей реализации. **Не** является юридическим заключением, пользовательским соглашением, политикой конфиденциальности или заявлением о соответствии закону.
>
> Назначение: передать юристу самостоятельное описание фактической модели работы сервиса. Местонахождение владельца **не** определяется. Значения секретов API **не** включаются.

---

## 1. Шапка и границы достоверности

| Поле | Значение |
|------|----------|
| Название продукта (UI) | VishFind |
| Имя в `package.json` | `isearch-demo` (описание всё ещё упоминает «iSearch») — **расхождение именования**, см. §12 |
| Версия пакета | `1.0.0` |
| Дата сборки этого файла | 2026-10-27 |
| Git commit (HEAD) | `1ffd6f3` (2026-10-26 21:01:53 +0300) |
| Ветка | `main` (## main...origin/main [ahead 1]) |
| Незакоммиченные изменения | **Да.** Срез отражает **рабочее дерево** (изменённые и untracked файлы: реестры, политика, UI, docs, тесты), а не только закоммиченный HEAD. |
| Режим публикации | В рамках сборки документа **публичный продакшен-запуск и deploy не выполнялись**. Наблюдался локальный процесс `NODE_ENV=development` на loopback (см. §16). Конфигурация Amvera описана как подготовленная, не как подтверждённый текущий прод. |

### 1.1. Исходники

- **Код:** `server.js`, `lib/config.js`, `lib/parse-query.js`, `lib/criteria-model.js`, `lib/source-registry.js`, `lib/source-policy.js`, `lib/marketplace-capabilities.js`, `lib/ollama-web.js`, `lib/product-html.js`, `lib/offers.js`, `lib/logger.js`, `lib/rate-limit.js`, `providers/links.js`, `providers/ebay.js`, `js/search.js`, `js/criteria-panel.js`, `js/saved-items.js`, `index.html`, `about.html`, `contacts.html`, `css/site.css`, `amvera.yml`
- **Данные:** `data/source-registry.json` (53), `data/sources.json` (24), `data/brand-registry.json` (79), `data/brands.json`, `data/marketplace-fixtures.json`
- **Документы:** `docs/FACTUAL_SITE_REPORT.md`, `docs/DATA_FLOW_SUMMARY.md`, `docs/CURSOR_HANDOFF.md` (§22–25), `PROJECT_SPECIFICATION.md`, `AMVERA_DEPLOYMENT.md`
- **Целевые проверки (ранее, без нового полного прогона):** `test/web-search-opt-in.test.js`, `test/result-actions.test.js`, `test/web-policy-guards.test.js`, `test/source-policy.test.js`, `test/select-sources-groups.test.js`, live `GET /api/health` / `POST /api/search` на loopback (2026-10-27)

### 1.2. Метки достоверности

| Метка | Смысл |
|-------|--------|
| **Код** | Установлено чтением актуального кода/реестра |
| **Проверка** | Подтверждено целевой проверкой/тестом |
| **Внешний источник** | Заявлено сайтом третьей стороны / сохранено при аудите |
| **Не установлено** | В проекте нет достаточных данных |
| **Решение владельца** | Нужен явный выбор владельца продукта |
| **Правовая оценка** | Вопрос к юристу; инженерный вывод не делается |

### 1.3. Расхождения документов с кодом (важно)

1. **Веб-поиск opt-in.** Актуально по **коду** (`server.js`, `js/search.js`, handoff §25, `DATA_FLOW_SUMMARY.md`): Ollama `web_search` только при `WEB_SEARCH_ENABLED`+ключ **и** `body.web_search === true` **и** бренд **и** политика доменов. В `docs/FACTUAL_SITE_REPORT.md` и `scripts/build-factual-report.js` ещё встречаются формулировки «автоматически при поиске … web_search» / «при бренде и WEB_SEARCH» **без** пользовательского переключателя — **устарело**. Для оценки брать код.
2. **eBay `api_products=documented_allowed`.** В реестре стоит `documented_allowed`, но письменный договор/разрешение в репозитории **не установлено**. Наличие API в коде ≠ автоматически доказанное правовое основание. См. §6.4. Код в этой задаче не менялся.
3. **Именование.** UI/доки — VishFind; `package.json` — `isearch-demo` / iSearch.

---

## 2. Краткое описание продукта

| Вопрос | Факт | Метка |
|--------|------|-------|
| Назначение | Разбор запроса на критерии и подготовка **переходов** к поиску на сторонних сайтах (редкая/винтажная/архивная одежда) | Код |
| Действия пользователя | Текст, чипсы критериев, опционально галочка интернет-дополнения, опционально фото (если AI), клик по ссылкам, локальные история/избранное | Код |
| Действия приложения | Parse → merge → selectSources → сборка URL; опционально внешний web_search; опционально eBay/HTML при allow | Код |
| Результат для пользователя | Карточки переходов («Подходящие сайты»), «Что передано», опционально web_results; live-товары — только при активной интеграции | Код |
| Оплата за товары через сервис | **Не принимает** оплату за товары площадок | Код |
| Кто продаёт | Сторонний сайт после перехода пользователя | Код |
| Обычный результат | **Переход** (search / каталог), не подтверждённый товар с ценой | Код + Проверка |
| Конкретный товар | Сейчас: eBay Browse при ключах; HTML — только `documented_allowed` (**0** записей); `products_connected=0` | Код |

### 2.1. Наблюдаемый локальный срез `/api/health` (2026-10-27, loopback)

| Функция | Состояние на срезе |
|---------|-------------------|
| Текстовый поиск + links | вкл |
| `web_search.enabled` | true (ключ configured; значение не раскрывается) |
| Пользовательский переключатель | default off |
| `ai_enabled` | false |
| eBay configured | false |
| HTML product | не идёт (0 documented_allowed) |
| `OLLAMA_WEB_FETCH` | не включается переключателем |

Это снимок **одного локального процесса**, не доказательство продакшен-конфигурации Amvera.

### 2.2. Реализовано, но неактивно без настроек

| Функция | Условие |
|---------|---------|
| Фото / vision | `AI_ENABLED=true` + Ollama |
| Web Search | env + ключ + user `web_search:true` |
| Web Fetch | `OLLAMA_WEB_FETCH=true` + policy |
| eBay товары | client id/secret |
| HTML-карточки | `html_product_fetch=documented_allowed` |
| Live FX | не подключён (`fx.provider=none`) |

Планы из документации не выдаются за действующие функции.

---

## 3. Полная цепочка поиска

### 3.1. Схема

```
ввод текста / чипсы
  → POST /api/search { query, attributes?, clear_attributes?, image?, web_search? }
  → rate limit (память процесса)
  → parseQuery
  → mergeCriteria (приоритет ручных / clear)
  → selectSources (status, outbound, own_brand/brand, группы, тройка Ozon→WB→ЯМ)
  → adapters + providers/links (сборка URL; HTTP к магазинам не выполняется)
  → [опционально] ollama enrichBrandSearch (только user+server+brand+policy)
  → фильтр web_results (+ re-filter кэша); без raw fallback
  → [опционально] eBay / HTML product при allow
  → JSON → UI (переходы, «Что передано», disclaimer)
```

### 3.2. Сценарии

| Сценарий | Поведение |
|----------|-----------|
| Обычный текст | §3.1 без Ollama; `web_search.reason=user_opt_out` |
| Текст + интернет-дополнение | Клиент шлёт `web_search:true`; возможен вызов Ollama; блок «Уточнение из интернета» |
| Фото при AI вкл. | `image` → локальная Ollama vision → merge; **не** в payload Cloud web_search |
| Фото при AI выкл. | Кнопка скрыта; image → 503 |
| История / избранное | Только браузерный `localStorage`; на `/api/search` сами по себе не уходят |

### 3.3. Локально / сервер / внешнее

| Этап | Браузер | Свой сервер | Внешняя сеть |
|------|---------|-------------|--------------|
| UI, история, избранное, тема | да | нет | нет |
| parse / select / links | нет | да | нет |
| Клик по ссылке магазина | да | нет | да |
| Фото vision | upload | → OLLAMA_URL | обычно localhost |
| web_search | нет | да | ollama.com |
| web_fetch | нет | да (если env) | ollama.com + страница |
| eBay | нет | да (если ключи) | API eBay |
| HTML GET | нет | да (если allow) | сайт источника |

### 3.4. Авто vs явное

- **Авто при «Искать»:** parse → select → links.
- **Явно:** галочка веб-поиска; фото; открытие ссылки; «Новый запрос»; избранное.
- **Не автоматически:** массовый scrape, HTML без allow, web_fetch без env, CAPTCHA-обход, заказы, оплата.

---

## 4. Функции и ограничения

| Функция | Состояние | Что делает | Данные | Ограничения |
|---------|-----------|------------|--------|-------------|
| Текстовый разбор | вкл | Правила → критерии + phrase | query ≤300 | Не облачный LLM для текста |
| Бренды и алиасы | вкл | Сопоставление реестров | brand-registry / brands | Нет алиаса → пустой бренд |
| Цена словами | частично | in_query «… рублей» | budget* RUB | ≠RUB без FX |
| Размеры | вкл | parse + чипы | size(s) | Передача — по caps площадки |
| Мультивыбор | вкл | несколько значений | maxMulti default 8 | config |
| Группировка | вкл | группы 1–4 + UI-фильтр | display_group | фильтр без нового API |
| Поисковые ссылки | вкл | сборка URL | шаблоны | без HTTP к магазину |
| Цены в URL | частично | native где verified | price params | иначе in_query / нет |
| Ollama Web Search | частично | URL-кандидаты | query string | opt-in + policy |
| Web Fetch | выкл по умолч. | чтение страницы | URL | отдельный env |
| HTML-сбор | выкл | карточки HTML | HTML | 0 documented_allowed |
| eBay API | выкл без ключей | live offers | Browse API | ключи + circuit |
| Фото | зависит от env | vision → критерии | image | AI_ENABLED |
| История | вкл браузер | прошлые запросы | localStorage | не на сервер |
| Избранное | вкл браузер | сохранённое | localStorage | не на сервер |
| Копирование | вкл | clipboard фразы | search_phrase_used | — |
| Новый запрос | вкл | сброс UI/поиска | — | не чистит историю/тему |
| Реклама | демо | `#ad-placement` | нет сети | не выдача поиска |

---

## 5. Все источники

Источник истины: `data/source-registry.json`. URL-адаптеры: `data/sources.json`. Паспорта фильтров: `lib/marketplace-capabilities.js`.

### 5.1. Количества

| Показатель | Число |
|------------|-------|
| Всего записей | **53** |
| `search_link` (активные) | **24** |
| `identity_checked` | **5** |
| `candidate` | **20** |
| `temporarily_limited` | **4** |
| `products_connected` | **0** |
| own_brand всего / active search_link | 12 / 11 |
| outbound restricted | 1 (the_cultt) |
| html `documented_allowed` | **0** |
| api_products `documented_allowed` | **1** (ebay) |
| Адаптеров в sources.json | 24 |
| Брендов в brand-registry | 79 |

### 5.2. Списки по статусу

- **Активные (`search_link`):** nike_com, adidas_com, zara_official, lamoda_ru, wildberries, ozon, yandex_market, avito, ebay, brandshop, peak_concept, lime_store, maag, tsum_collect, spin4spin, befree, sela, zarina, love_republic, gloria_jeans, gate31, krakatau, ostin, storeez_12
- **Кандидаты:** the_north_face, hm_com, massimo_dutti, goldapple_ru, youla, farfetch, ssense, endclothing, mrporter, netaporter, asos, stockx, goat, aliexpress, taobao, poizon, revolve, shopbop, bergdorf, shu
- **Identity checked:** uniqlo_com, levi_com, puma_com, newbalance_com, tsum_ru
- **Ограниченные / исключённые (`temporarily_limited`):** vestiaire, oskelly, the_cultt, luxxy

### 5.3. Полная таблица

Пустое поле policy в JSON отображено как `basis_unset` (**≠** «разрешено»). Не смешивать: идентичность домена ≠ HTTP-доступность ≠ подтверждённая передача фильтра ≠ условия использования.

| id | name | domain | type | region | status | own | url_template | outbound | web_search_display | web_fetch | html | snippet | price | image | api |
|----|------|--------|------|--------|--------|-----|--------------|----------|-------------------|-----------|------|---------|-------|-------|-----|
| nike_com | Nike | www.nike.com | brand_official | INTL | search_link |  | https://www.nike.com/w?q={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| adidas_com | adidas | www.adidas.com | brand_official | INTL | search_link |  | https://www.adidas.com/search?q={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| zara_official | Zara | www.zara.com | brand_official | RU | search_link |  | https://www.zara.com/ru/ru/search?searchTerm={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| uniqlo_com | Uniqlo | www.uniqlo.com | brand_official | INTL | identity_checked |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| levi_com | Levi's | www.levi.com | brand_official | INTL | identity_checked |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| the_north_face | The North Face | www.thenorthface.com | brand_official | INTL | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| puma_com | PUMA | www.puma.com | brand_official | INTL | identity_checked |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| newbalance_com | New Balance | www.newbalance.com | brand_official | INTL | identity_checked |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| hm_com | H&M | www2.hm.com | brand_official | INTL | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| massimo_dutti | Massimo Dutti | www.massimodutti.com | brand_official | INTL | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| lamoda_ru | Lamoda | www.lamoda.ru | reseller | RU | search_link |  | https://www.lamoda.ru/catalogsearch/result/?q={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| tsum_ru | ЦУМ | www.tsum.ru | reseller | RU | identity_checked |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| goldapple_ru | Золотое Яблоко | goldapple.ru | reseller | RU | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| wildberries | Wildberries | www.wildberries.ru | mass_marketplace | RU | search_link |  | https://www.wildberries.ru/catalog/0/search.aspx?search={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| ozon | Ozon | www.ozon.ru | mass_marketplace | RU | search_link |  | https://www.ozon.ru/search/?text={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| yandex_market | Яндекс Маркет | market.yandex.ru | mass_marketplace | RU | search_link |  | https://market.yandex.ru/search?text={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| avito | Авито | www.avito.ru | classifieds | RU | search_link |  | https://www.avito.ru/all?q={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| youla | Юла | youla.ru | classifieds | RU | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| ebay | eBay | www.ebay.com | reseller | US | search_link |  | https://www.ebay.com/sch/i.html?_nkw={q} | basis_unset | basis_unset | basis_unset | temporarily_disabled | basis_unset | basis_unset | basis_unset | documented_allowed |
| vestiaire | Vestiaire Collective | www.vestiairecollective.com | reseller | EU | temporarily_limited |  | https://www.vestiairecollective.com/search/?q={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| farfetch | Farfetch | www.farfetch.com | reseller | INTL | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| ssense | SSENSE | www.ssense.com | reseller | CA | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| endclothing | END. | www.endclothing.com | reseller | UK | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| mrporter | MR PORTER | www.mrporter.com | reseller | UK | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| netaporter | NET-A-PORTER | www.net-a-porter.com | reseller | UK | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| asos | ASOS | www.asos.com | reseller | UK | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| stockx | StockX | stockx.com | reseller | US | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| goat | GOAT | www.goat.com | reseller | US | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| aliexpress | AliExpress | www.aliexpress.com | chinese_marketplace | CN | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| taobao | Taobao | world.taobao.com | chinese_marketplace | CN | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| poizon | POIZON / Dewu | www.poizon.com | chinese_marketplace | CN | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| revolve | REVOLVE | www.revolve.com | reseller | US | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| shopbop | Shopbop | www.shopbop.com | reseller | US | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| bergdorf | Bergdorf Goodman | www.bergdorfgoodman.com | reseller | US | candidate |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| brandshop | BRANDSHOP | brandshop.ru | reseller | RU | search_link |  | https://brandshop.ru/search/?q={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| peak_concept | Peak Concept | peakstore.ru | reseller | RU | search_link |  | https://peakstore.ru/catalog/?q={q} | basis_unset | basis_unset | temporarily_disabled | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| lime_store | LIMÉ | limestore.com | brand_official | RU | search_link | yes | https://limestore.com/ru_ru/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| maag | MAAG | maag-fashion.com | brand_official | RU | search_link | yes | https://maag-fashion.com/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| oskelly | OSKELLY | oskelly.ru | reseller | RU | temporarily_limited |  | https://oskelly.ru/search/?q={q} | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| the_cultt | THE CULTT | thecultt.com | reseller | RU | temporarily_limited |  | https://thecultt.com/ | restricted | restricted | restricted | restricted | restricted | restricted | restricted | basis_unset |
| tsum_collect | TSUM Collect | collect.tsum.ru | reseller | RU | search_link |  | https://collect.tsum.ru/women/catalog | basis_unset | basis_unset | restricted | restricted | restricted | restricted | restricted | basis_unset |
| spin4spin | SPIN4SPIN | spin4spin.com | reseller | RU | search_link |  | https://spin4spin.com/catalog | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| luxxy | Luxxy | luxxy.com | reseller | RU | temporarily_limited |  |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| befree | Befree | www.befree.ru | brand_official | RU | search_link | yes | https://befree.ru/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| sela | Sela | www.sela.ru | brand_official | RU | search_link | yes | https://www.sela.ru/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| zarina | Zarina | zarina.ru | brand_official | RU | search_link | yes | https://zarina.ru/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| love_republic | Love Republic | www.loverepublic.ru | brand_official | RU | search_link | yes | https://www.loverepublic.ru/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| gloria_jeans | Gloria Jeans | www.gloria-jeans.ru | brand_official | RU | search_link | yes | https://www.gloria-jeans.ru/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| gate31 | GATE31 | gate31.ru | brand_official | RU | search_link | yes | https://gate31.ru/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| krakatau | Krakatau | krakatau.ru | brand_official | RU | search_link | yes | https://krakatau.ru/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| ostin | O'STIN | www.ostin.com | brand_official | RU | search_link | yes | https://www.ostin.com/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| storeez_12 | 12 STOREEZ | 12storeez.com | brand_official | RU | search_link | yes | https://12storeez.com/ | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |
| shu | SHU |  | brand_official | RU | candidate | yes |  | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset | basis_unset |

### 5.4. Обязательная тройка

`selectSources` добавляет Ozon → Wildberries → Яндекс Маркет в хвост (если не restricted). **Код.**

---

## 6. Условия источников

Новый массовый обход сайтов **не** выполнялся. Неподтверждённые цитаты **не** восстанавливались по памяти.

### 6.1. THE CULTT

| Поле | Значение |
|------|----------|
| URL | https://thecultt.com/legal/usloviya-prodazhi/polzovatelskoe-soglashenie |
| Дата в реестре | 2026-10-27 |
| Дословная `terms_quote` | **отсутствует** (`null`) |
| В `trust_basis` / `blocker` | Пересказ: п.4.6.1 автодоступ/копирование/отслеживание; п.1.2 коммерческое использование контента; п.1.3 размещение ссылок с письменного разрешения |
| Действие приложения | Не в selectSources / outbound / web_results / fetch / HTML |
| Техполитика | caps `restricted`; status `temporarily_limited` |
| Письменное разрешение | **Не установлено** |

### 6.2. TSUM Collect

| Поле | Значение |
|------|----------|
| URL | https://collect.tsum.ru/terms |
| Дата | 2026-10-27 |
| § | 4.6 |
| Цитата | «Владельцу Платформы принадлежат исключительные права на контент, размещенный на Платформе. Запрещается использование контента третьими лицами, включая Частного продавца, без письменного согласия Владельца Платформы.» |
| applies_to | html_product_fetch / republish content — не автоматически к обычному гиперссылочному переходу |
| source_of_quote | сохранённый снимок аудита agent-tools (файл проверки collect.tsum.ru/terms) |
| Действие приложения | Переход на каталог возможен (`search_link`); HTML/images/fetch/snippet restricted |
| Письменное согласие на перепубликацию | **Не установлено** |

### 6.3. Ollama Cloud

| Поле | Значение |
|------|----------|
| Search API | `https://ollama.com/api/web_search` |
| Fetch API | `https://ollama.com/api/web_fetch` |
| Условия как правовой документ | **Не проверены** |
| Обещание отсутствия хранения | **Нет основания** в нашем коде |

### 6.4. eBay

| Поле | Значение |
|------|----------|
| Код | Browse API, `providers/ebay.js` |
| Ключи на локальном health | не configured |
| `api_products` в реестре | `documented_allowed` |
| Договор в репозитории | **Не установлено** |
| Замечание | Метка отражает техническую готовность интеграции, не найденный договор. **Правовая оценка** / **решение владельца** до включения ключей. |

### 6.5. Прочее

Частичные заметки (FAQ BRANDSHOP, Peak Concept, SPIN4SPIN, own-brand оферты) — в `FACTUAL_SITE_REPORT.md` §Л. Полные актуальные ToS всех активных доменов **не установлены**.

### 6.6. Разрешения

| Предоставлено в проекте | Не установлено |
|-------------------------|----------------|
| Тех caps / blockers; 1 цитата TSUM Collect; пересказ пунктов CULTT | Письменные разрешения магазинов; договор eBay; ToS Ollama Cloud; согласия на HTML/перепубликацию |

---

## 7. Политики и техническое исполнение

| Контроль | Файл / функция | Поведение |
|----------|----------------|-----------|
| До выбора | `lib/source-registry.js` → `selectSources` | status, outbound, brand/own_brand, тройка |
| Адаптер | `adaptersForSelection` | skip `verified:false` |
| web filter | `lib/source-policy.js` → `filterWebSearchResults`, `isOutboundRestrictedHost` | restricted / display |
| Повтор filter | `server.js` после enrich; cache re-filter в `ollama-web.js` | |
| Raw fallback | убран из enrich pipeline | |
| Unknown web_fetch | `webFetchAllowedForUrl` | запрет |
| CULTT | outbound restricted + limited | полный блок показа/fetch |
| Ошибка сети/API | logger.warn + warnings | links продолжают работать |

**Проверено** кодом/тестами: opt-in, policy filter, no raw fallback, CULTT host match. **Не доказано** этой сборкой: свежесть внешних ToS; логи Amvera; правовая квалификация гиперссылки.

---

## 8. Ollama и внешний поиск

| Параметр | Факт |
|----------|------|
| UI toggle | default off; disabled без server enabled; не в localStorage |
| Сервер | `WEB_SEARCH_ENABLED=true` + ключ (`lib/config.js`) |
| Ключ без значения | health: configured=true; значение не в документе |
| Ключ сам | не включает |
| Payload | `{ query, max_results }` |
| Query | brand + phrase + `site:`…; sanitize/truncate; не анонимайзер PII |
| Не передаётся | фото, история, избранное, произвольные tech-поля UI |
| Timeout / parallel / cache | 20 с; ≤2; TTL 10 мин; ≤64 |
| UI показ | url; title/snippet по caps; unverified |
| web_search читает страницы? | **Нет** в нашей реализации |
| web_fetch | только `OLLAMA_WEB_FETCH=true` + policy |
| Toggle = согласие? | **Не утверждается** (технический флаг). Правовая оценка. |
| Условия поставщика | не проверены |

---

## 9. Пользовательские данные

| Категория | Откуда | Цель | Обработка | Хранение | Срок | Передача | Удаление | Неизвестно |
|----------|--------|------|-----------|----------|------|----------|----------|------------|
| Поисковый текст | `#q` | parse/links | свой сервер | не профиль; возможен усечённый debug-лог | retention **не задан** | при opt-in — строка в Ollama Cloud | UI / Новый запрос; нет «удалить аккаунт» | логи хостинга |
| Ручные критерии | чипы | merge | сервер | в теле запроса на время обработки | — | нет отдельно | — | — |
| Фото | файл | vision | сервер → локальная Ollama | штатно не на диск | — | **не** в Cloud web_search | clear photo | swap/OS |
| Thumbnail | история | превью | браузер | localStorage | до очистки | нет | очистка storage | квоты |
| История | rememberSearch | UX | браузер | `vishfind-history` | до очистки | нет | UI/storage | — |
| Избранное | save | UX | браузер | Saved API / localStorage | до очистки | нет | UI | — |
| Тема | toggle | UX | браузер | `vishfind-theme` | до очистки | нет | смена/очистка | — |
| IP / rate limit | соединение | антифлуд | сервер `lib/rate-limit.js` | память процесса (ключ=IP) | окно сек. | не внешним API | рестарт процесса | за прокси — X-Forwarded-For при TRUST_PROXY |
| Серверные логи | runtime | диагностика | `lib/logger.js` | stdout процесса / сборщик хоста | **не установлено** на хосте | платформа хостинга | **не установлено** | состав на Amvera |
| Ошибки | exceptions | диагностика | logger | как логи | — | — | — | — |
| Cookies приложения | — | — | — | **не выставляются** кодом приложения | — | — | — | cookie платформы |
| Аналитика | — | — | — | пиксели **не найдены** в HTML/JS | — | — | — | — |

Разделение сред: **браузер** (история/избранное/тема) · **свой сервер** (parse/links/rate/cache) · **локальная Ollama** (фото) · **облачная Ollama** (web_search при opt-in) · **будущий хостинг** (логи/заголовки — не проверены).

Отсутствие аккаунтов **не** означает «данных нет».

---

## 10. Внешние ресурсы и переходы

| Тема | Факт |
|------|------|
| CDN магазинов/шрифтов | сторонние CDN **не** подключены; шрифты локальные `fonts/` |
| Сторонние скрипты | не подключены (self + inline theme) |
| Аналитика | не найдена |
| Cookies приложения | не выставляются кодом |
| Referrer-Policy | `strict-origin-when-cross-origin` (`SECURITY_HEADERS`) |
| CSP | default-src self; connect-src self; img data/blob (см. SECURITY_HEADERS в server.js) |
| Внешние ссылки | `target=_blank` + `rel=noopener noreferrer` |
| Превью/fetch при показе ссылки | **нет** (только сборка URL; fetch отдельно и выкл.) |
| После клика | поведение магазина **вне** контроля VishFind; не описывается как действие приложения |
| Amvera заголовки/логи | **не утверждается** отсутствие доп. логов до проверки |

---

## 11. Публичные тексты и сверка с кодом

| Место | Формулировка (смысл) | Соответствие коду |
|-------|----------------------|-------------------|
| Hero / meta | переходы; цену/наличие/подлинность у продавца | соответствует |
| Пояснение под выдачей | сторонние ссылки; проверяйте у продавца; «Что передано» | соответствует |
| Переключатель | фраза передаётся Ollama для поиска ссылок | соответствует (при server+opt-in) |
| about.html | не каталог; не оплата; не партнёр; не подтверждает подлинность | соответствует |
| contacts.html | переходы; оплату не принимает | соответствует |
| Карточки official | «Не партнёрство VishFind» | соответствует |
| «Официальный магазин/сайт» | ярлык группы/типа источника, не договор партнёрства | соответствует при чтении с note; риск смешения ярлыка и партнёрства — **правовая оценка** формулировок |
| Блок «Как устроен поиск» | «Открывается поиск на маркетплейсах» | **частично:** также own-brand/official/reseller; не только маркетплейсы |
| Реклама | демо-место, не результаты | соответствует |
| Доставка | «смотрите на площадке» | соответствует (сервис доставку не оказывает) |
| package.json iSearch | устаревшее имя | **расхождение** с брендом UI |
| FACTUAL_SITE_REPORT auto web | устарело | **расхождение** с opt-in |

Интерфейс в этой задаче **не** менялся.

---

## 12. Монетизация (факт)

| Механизм | Наличие в коде сейчас |
|----------|------------------------|
| Оплата за товары | нет |
| Подписка | нет |
| Реальные рекламные сети | нет (демо-блок UI) |
| Партнёрские/affiliate ссылки | не реализованы как отдельный механизм |
| Платное ранжирование | нет |
| Комиссии сервиса | нет в коде |

Планы монетизации не выдаются за текущую деятельность.

---

## 13. Подготовка к облаку (Amvera) — только факты

Источник: `amvera.yml`, `AMVERA_DEPLOYMENT.md`, `lib/config.js`. **Deploy в этой задаче не выполнялся.**

| Тема | Факт / неизвестно |
|------|-------------------|
| Публичная доступность | при деплое — HTTPS-домен платформы; сейчас не подтверждено |
| `amvera.yml` | `command: npm run start`, `containerPort: "80"`, `persistenceMount: /data` |
| Локальная Ollama | в контейнере **нет** доступа к Ollama разработчика → `AI_ENABLED=false` для облака |
| Секреты | только переменные панели; не в git |
| Типичные env из инструкции | `NODE_ENV=production`, `AI_ENABLED=false`, `WEB_SEARCH_ENABLED=false` (пока не решено иначе), `TRUST_PROXY=true` |
| Логи платформы | состав/срок **не проверены** |
| Регион/тариф | **не устанавливать** без данных владельца |

### 13.1. Закрытый тест на телефоне vs публичный запуск

| | Закрытый тест | Публичный запуск |
|--|---------------|------------------|
| Аудитория | ограниченный круг | любой в интернете |
| Риск индексации/жалоб | ниже, но не ноль при публичном URL | выше |
| Нужны | решение владельца по env, домену, текстам, источникам | + публичные документы по итогам правовой оценки |

---

## 14. Чего не хватает

### А. Сведения от владельца (не запрашиваются автоматически в чате)

1. Правовой статус оператора / реквизиты (если нужны для документов).
2. Публичный контакт.
3. Решение: закрытый тест vs публичный запуск.
4. Решение по `WEB_SEARCH_ENABLED` / ключу Ollama в облаке.
5. Решение по eBay ключам и основанию `documented_allowed`.
6. Письменные разрешения (CULTT и др.) или подтверждённый отказ от источника.
7. Подтверждение актуальности ToS площадок на дату запуска.
8. Политика логов/retention на выбранном хостинге.
9. Нужны ли отдельные публичные документы (оферта/политика) — после оценки юриста.

### Б. Вопросы для юриста (по реализации)

**Источники и ссылки**
- Достаточно ли модели «гиперссылка / переход» без копирования каталога для активных `search_link` с `basis_unset`?
- Как квалифицировать показ CULTT-ссылок при п.1.3 (сейчас технически запрещены)?
- TSUM Collect: каталог-переход при §4.6 про контент — допустим ли текущий режим?

**Интеллектуальные права**
- Использование названий брендов/логотипов в UI (текстом, без чужих CDN-изображений).
- Сниппеты/title из web_search при caps allow.

**Внешние сервисы**
- Передача поисковой фразы в Ollama Cloud при UI-галочке: нужны ли отдельные согласия/уведомления?
- eBay Browse при будущем включении ключей.

**Пользовательские данные**
- Достаточен ли текущий объём (localStorage + сервер без аккаунтов + опциональный Cloud query)?
- Rate-limit по IP и логи хостинга.

**Реклама**
- Демо-блок «Рекламное размещение» до реальной рекламы.

**Публичные документы**
- Какие документы обязательны до публичного запуска (без шаблонов в этом пакете)?
- Нужна ли правка ярлыка «Официальный магазин» во избежание смешения с партнёрством?

---

## 15. Доказательства и проверки

| Что | Дата / примечание | Подтверждает | Не подтверждает |
|-----|-------------------|--------------|-----------------|
| `node --test test/web-search-opt-in.test.js test/result-actions.test.js` | 2026-10-27, 12 pass | наличие opt-in в коде/UI/about; disclaimer | правовую законность |
| Live POST без `web_search` | 2026-10-27 loopback | `user_opt_out`, локальные sources>0 | поведение Ollama Cloud ToS |
| Live POST с `web_search:true` | 2026-10-27 | `user_requested`; CULTT/oskelly не в выдаче | полноту результатов web |
| `test/web-policy-guards.test.js` и др. | ранее в проекте | policy guards | актуальность внешних ToS |
| Полный `npm test` / verify-prod | **не** гонялись в этой сборке | — | полный регресс |

«N pass» ≠ правовая проверка. Mock/static тесты читают исходники; live — только loopback.

---

## 16. Замечания о существенных дефектах / рисках фактов

1. Устаревшее описание auto-web в `FACTUAL_SITE_REPORT.md` / генераторе — риск ошибочной оценки, если читать отчёт вместо кода.
2. `ebay.api_products=documented_allowed` без договора в репозитории — риск переоценки основания.
3. Ярлык «Официальный…» рядом с отказом от партнёрства — потенциальная двусмысленность текстов (**правовая оценка**).
4. Блок «маркетплейсах» в how-секции уже, чем реальная выдача.
5. Именование iSearch в package.json.

Код и конфигурация в рамках этой задачи **не изменялись** (кроме создания настоящего файла и вспомогательного скрипта сборки).

---

*Конец пакета фактов. Документ не завершает правовую проверку.*
