# VishFind — подробный фактический отчёт для правового обсуждения

**Дата среза:** 2026-10-27  
**Файл сгенерирован скриптом:** `scripts/build-factual-report.js`  
**Назначение:** максимально полный фактический снимок поискового сценария для обсуждения с юристом.  

> **Важно**
>
> Документ описывает, *как устроены код и конфигурация*, и **не является юридическим заключением**.
> Не используются формулировки «законно / незаконно», «ответственность исключена», «всё разрешено».
> Отсутствие запрета в прочитанном фрагменте ≠ разрешение.
> HTTP 403/401/timeout ≠ правовой запрет.
> Секреты API, cookies пользователей и тексты реальных пользовательских запросов не включены.
> Местонахождение владельца и персональные данные не определяются.

---

## 0. Словарь статусов (как в коде)

| Термин | Смысл в VishFind |
|--------|------------------|
| `search_link` | Может попасть в активную выдачу как переход |
| `products_connected` | Заявлена товарная связка (сейчас 0 записей) |
| `identity_checked` | Идентичность домена сверена; не обязательно активный search |
| `candidate` | Кандидат; не показывается как подключённый магазин |
| `temporarily_limited` | Временно исключён из активной выдачи |
| `documented_allowed` | В `usage_policy`: зафиксированное основание на действие |
| `restricted` | В `usage_policy`: действие отключено политикой кода |
| `basis_unset` | Основание **не установлено** (не равно «можно») |
| `own_brand` | Магазин собственного бренда (не маркетплейс) |
| `display_group` | Группа UI 1–4; отдельно от поля `type` |
| `in_query` | Критерий в тексте запроса, не native URL-фильтр |
| `applied` / native | Подтверждённая подстановка в URL |

Ключевые модули: `server.js`, `lib/parse-query.js`, `lib/criteria-model.js`, `lib/source-registry.js`, `lib/source-policy.js`, `providers/links.js`, `lib/ollama-web.js`, `lib/product-html.js`, `providers/ebay.js`, `js/search.js`, `data/source-registry.json`, `data/sources.json`.

---

## А. Как работает поиск (полная цепочка)

### А.1. Пошагово

1. **Браузер — ввод** (`index.html`, `js/search.js`, `js/criteria-panel.js`): текст `#q` (≤300), чипсы, опционально фото.
2. **Клиент → сервер:** `POST /api/search` с JSON `{ query, attributes?, attributes_priority?, clear_attributes?, image? }`.
3. **Сервер** (`server.js`): rate limit в памяти; лимит тела 64 КБ / до ~9 МБ с AI; заголовки `SECURITY_HEADERS` (CSP `default-src 'self'`, `connect-src 'self'`, `Cache-Control: no-store`, …).
4. **Парсинг** — `lib/parse-query.js` `parseQuery` (бренды из алиасов реестра).
5. **Слияние критериев** — `lib/criteria-model.js` `mergeCriteria` (ручной приоритет / явный сброс).
6. **Выбор источников** — `lib/source-registry.js` `selectSources`: status + outbound + own_brand/brand gate + неизвестный бренд; группы official → reseller → other → marketplace_tail; лимит optional; обязательные Ozon→WB→Яндекс; official extras без дубля домена.
7. **Адаптеры** — `adaptersForSelection` + `data/sources.json` (`verified:false` отбрасывается).
8. **Ссылки** — `providers/links.js`: **HTTP к магазинам не выполняется**; только сборка URL. Native price / text budget / витрина без `{q}` — см. раздел про цену.
9. **Опционально web** — при бренде и `WEB_SEARCH_ENABLED=true`+ключе: `lib/ollama-web.js` → `https://ollama.com/api/web_search`, filter policy, `web_results`.
10. **Опционально eBay API** — при ключах (`providers/ebay.js`); иначе возможен только search_link.
11. **Опционально HTML product** — только `html_product_fetch=documented_allowed`.
12. **Ответ** — `sources`, `web_results`, `offers.items` (live) vs `offers.demo_items`, предупреждения.
13. **UI** — порядок групп с сервера; «Новый запрос» после списка ссылок; рекламный блок отдельно.

### А.2. Локально / свой сервер / внешняя сеть

| Этап | Браузер | Свой сервер | Внешняя сеть |
|------|---------|-------------|--------------|
| UI, история, избранное | да | нет | нет |
| Парсинг, selectSources, сборка URL | нет | да | нет |
| Клик по ссылке магазина | да | нет | да (сайт магазина) |
| Фото → Ollama vision | base64 upload | прокси на OLLAMA_URL | обычно localhost |
| web_search | нет | да | ollama.com |
| web_fetch | нет | да (если env) | ollama.com + страница |
| eBay Browse | нет | да (если ключи) | API eBay |
| HTML GET карточек | нет | да (если allow) | сайт источника |

### А.3. Автоматически vs по действию

- **Автоматически при поиске:** parse → select → links; при условиях — web_search.
- **По действию пользователя:** Искать / Фото / открыть ссылку / Новый запрос / избранное.
- **Не делается автоматически:** массовый обход каталогов, HTML restricted, web_fetch при выключенном флаге, обход CAPTCHA, оформление заказов.

### А.4. Передача цены (актуальная логика)

| Случай | Поведение | Код |
|--------|-----------|-----|
| Native price подтверждён (Яндекс) | Параметры URL; **без** текстового дубля | `applyPriceFilters` + `price_filter_verified` |
| Native не подтверждён, RUB, шаблон с `{q}` | Текст «до/от/от–до … рублей» в `{q}`; kind `in_query` | `formatBudgetInQuery` / `buildUrl` |
| Витрина без `{q}` | Бюджет **не** передаётся и не заявляется как переданный | `buildUrl` info-note |
| Валюта ≠ RUB, нет конвертации | Рубли **не** подставляются ни в URL, ни словами | `applyPriceFilters` + ветка currency |
| Ручной критерий цены | Берётся итоговая модель после merge; противоречия текста и чипов не дублируются в phrase | `mergeCriteria` + `search_phrase` без цены |

---

## Б. Полный перечень записей реестра (53)

Источник: `data/source-registry.json`. `region`/`storefront_region` ≠ обязательно `brand_origin`.

### 1. Own-brand (магазины собственного бренда)

| id | Название | Домен | region | status | own | шаблон / kind | Участие |
|----|----------|-------|--------|--------|-----|---------------|---------|
| lime_store | LIMÉ | limestore.com | RU | search_link | yes | https://limestore.com/ru_ru/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| maag | MAAG | maag-fashion.com | RU | search_link | yes | https://maag-fashion.com/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| befree | Befree | www.befree.ru | RU | search_link | yes | https://befree.ru/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| sela | Sela | www.sela.ru | RU | search_link | yes | https://www.sela.ru/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| zarina | Zarina | zarina.ru | RU | search_link | yes | https://zarina.ru/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| love_republic | Love Republic | www.loverepublic.ru | RU | search_link | yes | https://www.loverepublic.ru/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| gloria_jeans | Gloria Jeans | www.gloria-jeans.ru | RU | search_link | yes | https://www.gloria-jeans.ru/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| gate31 | GATE31 | gate31.ru | RU | search_link | yes | https://gate31.ru/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| krakatau | Krakatau | krakatau.ru | RU | search_link | yes | https://krakatau.ru/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| ostin | O'STIN | www.ostin.com | RU | search_link | yes | https://www.ostin.com/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| storeez_12 | 12 STOREEZ | 12storeez.com | RU | search_link | yes | https://12storeez.com/ / store_entry | Может попасть в selectSources при brand/category/policy gate; own_brand: свой бренд или запрос без бренда |
| shu | SHU |  | RU | candidate | yes | — / none | Кандидат — не как подключённый |

### 2. Brand official (не own_brand)

| id | Название | Домен | region | status | own | шаблон / kind | Участие |
|----|----------|-------|--------|--------|-----|---------------|---------|
| nike_com | Nike | www.nike.com | INTL | search_link |  | https://www.nike.com/w?q={q} / search_param | Может попасть в selectSources при brand/category/policy gate |
| adidas_com | adidas | www.adidas.com | INTL | search_link |  | https://www.adidas.com/search?q={q} / search_param | Может попасть в selectSources при brand/category/policy gate |
| zara_official | Zara | www.zara.com | RU | search_link |  | https://www.zara.com/ru/ru/search?searchTerm={q} / search_param | Может попасть в selectSources при brand/category/policy gate |
| uniqlo_com | Uniqlo | www.uniqlo.com | INTL | identity_checked |  | — / none | Идентичность; search не обязателен |
| levi_com | Levi's | www.levi.com | INTL | identity_checked |  | — / none | Идентичность; search не обязателен |
| the_north_face | The North Face | www.thenorthface.com | INTL | candidate |  | — / none | Кандидат — не как подключённый |
| puma_com | PUMA | www.puma.com | INTL | identity_checked |  | — / none | Идентичность; search не обязателен |
| newbalance_com | New Balance | www.newbalance.com | INTL | identity_checked |  | — / none | Идентичность; search не обязателен |
| hm_com | H&M | www2.hm.com | INTL | candidate |  | — / none | Кандидат — не как подключённый |
| massimo_dutti | Massimo Dutti | www.massimodutti.com | INTL | candidate |  | — / none | Кандидат — не как подключённый |

### 3. Reseller / vintage

| id | Название | Домен | region | status | own | шаблон / kind | Участие |
|----|----------|-------|--------|--------|-----|---------------|---------|
| lamoda_ru | Lamoda | www.lamoda.ru | RU | search_link |  | https://www.lamoda.ru/catalogsearch/result/?q={q} / search_param | Может попасть в selectSources при brand/category/policy gate; type=reseller, UI group=other |
| tsum_ru | ЦУМ | www.tsum.ru | RU | identity_checked |  | — / none | Идентичность; search не обязателен |
| goldapple_ru | Золотое Яблоко | goldapple.ru | RU | candidate |  | — / none | Кандидат — не как подключённый |
| ebay | eBay | www.ebay.com | US | search_link |  | https://www.ebay.com/sch/i.html?_nkw={q} / search_param | Может попасть в selectSources при brand/category/policy gate |
| vestiaire | Vestiaire Collective | www.vestiairecollective.com | EU | temporarily_limited |  | https://www.vestiairecollective.com/search/?q={q} / search_param | Исключён: temporarily_limited |
| farfetch | Farfetch | www.farfetch.com | INTL | candidate |  | — / none | Кандидат — не как подключённый |
| ssense | SSENSE | www.ssense.com | CA | candidate |  | — / none | Кандидат — не как подключённый |
| endclothing | END. | www.endclothing.com | UK | candidate |  | — / none | Кандидат — не как подключённый |
| mrporter | MR PORTER | www.mrporter.com | UK | candidate |  | — / none | Кандидат — не как подключённый |
| netaporter | NET-A-PORTER | www.net-a-porter.com | UK | candidate |  | — / none | Кандидат — не как подключённый |
| asos | ASOS | www.asos.com | UK | candidate |  | — / none | Кандидат — не как подключённый |
| stockx | StockX | stockx.com | US | candidate |  | — / none | Кандидат — не как подключённый |
| goat | GOAT | www.goat.com | US | candidate |  | — / none | Кандидат — не как подключённый |
| revolve | REVOLVE | www.revolve.com | US | candidate |  | — / none | Кандидат — не как подключённый |
| shopbop | Shopbop | www.shopbop.com | US | candidate |  | — / none | Кандидат — не как подключённый |
| bergdorf | Bergdorf Goodman | www.bergdorfgoodman.com | US | candidate |  | — / none | Кандидат — не как подключённый |
| brandshop | BRANDSHOP | brandshop.ru | RU | search_link |  | https://brandshop.ru/search/?q={q} / search_param | Может попасть в selectSources при brand/category/policy gate |
| peak_concept | Peak Concept | peakstore.ru | RU | search_link |  | https://peakstore.ru/catalog/?q={q} / search_param | Может попасть в selectSources при brand/category/policy gate |
| oskelly | OSKELLY | oskelly.ru | RU | temporarily_limited |  | https://oskelly.ru/search/?q={q} / search_param | Исключён: HTTP 403/504 при автоматической загрузке условий; политика использования не прочитана полностью |
| the_cultt | THE CULTT | thecultt.com | RU | temporarily_limited |  | https://thecultt.com/ / entry | Исключён: Пользовательское соглашение: автодоступ к контенту (4.6.1); размещение ссылок без письменного разрешения (1.3) |
| tsum_collect | TSUM Collect | collect.tsum.ru | RU | search_link |  | https://collect.tsum.ru/women/catalog / entry | Может попасть в selectSources при brand/category/policy gate |
| spin4spin | SPIN4SPIN | spin4spin.com | RU | search_link |  | https://spin4spin.com/catalog / entry | Может попасть в selectSources при brand/category/policy gate |
| luxxy | Luxxy | luxxy.com | RU | temporarily_limited |  | — / none | Исключён: Домены недоступны для сверки условий; связь luxxy.com / luxxy.ru не подтверждена |

### 4. Classifieds

| id | Название | Домен | region | status | own | шаблон / kind | Участие |
|----|----------|-------|--------|--------|-----|---------------|---------|
| avito | Авито | www.avito.ru | RU | search_link |  | https://www.avito.ru/all?q={q} / search_param | Может попасть в selectSources при brand/category/policy gate |
| youla | Юла | youla.ru | RU | candidate |  | — / none | Кандидат — не как подключённый |

### 5. Chinese marketplace

| id | Название | Домен | region | status | own | шаблон / kind | Участие |
|----|----------|-------|--------|--------|-----|---------------|---------|
| aliexpress | AliExpress | www.aliexpress.com | CN | candidate |  | — / none | Кандидат — не как подключённый |
| taobao | Taobao | world.taobao.com | CN | candidate |  | — / none | Кандидат — не как подключённый |
| poizon | POIZON / Dewu | www.poizon.com | CN | candidate |  | — / none | Кандидат — не как подключённый |

### 6. Mass marketplace

| id | Название | Домен | region | status | own | шаблон / kind | Участие |
|----|----------|-------|--------|--------|-----|---------------|---------|
| wildberries | Wildberries | www.wildberries.ru | RU | search_link |  | https://www.wildberries.ru/catalog/0/search.aspx?search={q} / search_param | Обязательная последняя тройка |
| ozon | Ozon | www.ozon.ru | RU | search_link |  | https://www.ozon.ru/search/?text={q} / search_param | Обязательная последняя тройка |
| yandex_market | Яндекс Маркет | market.yandex.ru | RU | search_link |  | https://market.yandex.ru/search?text={q} / search_param | Обязательная последняя тройка |

---

## В. Техническая матрица по каждой записи

Policy «—» = поле не задано в JSON (в `cap()` часто → `basis_unset`).

| id | переход | `{q}` | native price | text budget | web_display | web_fetch | HTML | images | API | товары/цены |
|----|---------|------|--------------|-------------|-------------|-----------|------|--------|-----|-------------|
| nike_com | шаблон/вкл | да | нет | нет (не RUB) | — | — | — | — | нет | нет в search_link |
| adidas_com | шаблон/вкл | да | нет | нет (не RUB) | — | — | — | — | нет | нет в search_link |
| zara_official | шаблон/вкл | да | нет | нет (не RUB) | — | — | — | — | нет | нет в search_link |
| uniqlo_com | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| levi_com | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| the_north_face | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| puma_com | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| newbalance_com | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| hm_com | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| massimo_dutti | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| lamoda_ru | шаблон/вкл | да | нет | да при бюджете | — | — | — | — | нет | нет в search_link |
| tsum_ru | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| goldapple_ru | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| wildberries | шаблон/вкл | да | заявлен, не verified | да при бюджете | — | — | — | — | нет | нет в search_link |
| ozon | шаблон/вкл | да | заявлен, не verified | да при бюджете | — | — | — | — | нет | нет в search_link |
| yandex_market | шаблон/вкл | да | да verified | не дублируем | — | — | — | — | нет | нет в search_link |
| avito | шаблон/вкл | да | заявлен, не verified | да при бюджете | — | — | — | — | нет | нет в search_link |
| youla | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| ebay | шаблон/вкл | да | нет | нет (не RUB) | — | — | temporarily_disabled | basis_unset | Browse API при ключах | API при ключах |
| vestiaire | ограничено | да | нет | нет (не RUB) | — | — | — | — | нет | нет в search_link |
| farfetch | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| ssense | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| endclothing | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| mrporter | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| netaporter | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| asos | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| stockx | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| goat | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| aliexpress | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| taobao | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| poizon | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| revolve | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| shopbop | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| bergdorf | не активен | нет | нет | — | — | — | — | — | нет | нет в search_link |
| brandshop | шаблон/вкл | да | нет | да при бюджете | — | basis_unset | basis_unset | basis_unset | нет | нет в search_link |
| peak_concept | шаблон/вкл | да | нет | да при бюджете | — | temporarily_disabled | basis_unset | basis_unset | нет | нет в search_link |
| lime_store | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| maag | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| oskelly | ограничено | да | нет | да при бюджете | — | — | basis_unset | basis_unset | нет | нет в search_link |
| the_cultt | ограничено | витрина | нет | нет (нет {q}) | restricted | restricted | restricted | restricted | нет | HTML policy off |
| tsum_collect | шаблон/вкл | витрина | нет | нет (нет {q}) | basis_unset | restricted | restricted | restricted | нет | HTML policy off |
| spin4spin | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| luxxy | ограничено | нет | нет | — | — | — | basis_unset | basis_unset | нет | нет в search_link |
| befree | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| sela | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| zarina | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| love_republic | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| gloria_jeans | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| gate31 | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| krakatau | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| ostin | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| storeez_12 | шаблон/вкл | витрина | нет | нет (нет {q}) | — | — | basis_unset | basis_unset | нет | нет в search_link |
| shu | не активен | нет | нет | — | — | — | basis_unset | basis_unset | нет | нет в search_link |

---

## Г. Происхождение материалов

| Материал | Откуда |
|----------|--------|
| Названия площадок | Локальные JSON |
| URL поиска/витрины | Шаблоны на сервере; уход по клику пользователя |
| Карточки товаров | Не из search_link; eBay/HTML только при allow |
| Цены | Не проверяются в search_link; YM native; иначе in_query или «на сайте» |
| Наличие | Не проверяется |
| Web title/snippet | Нейтральный title по умолчанию; shop text только documented_allowed |
| Изображения товаров | Не перепубликуем в основном сценарии |
| Логотипы магазинов | Чужие CDN не подключены |
| Демо | `demo_items` отдельно от live `items` |
| Шрифты | Локальные `fonts/` |

---

## Д. Условия и основания

### Д.1. THE CULTT

- URL: https://thecultt.com/legal/usloviya-prodazhi/polzovatelskoe-soglashenie
- Дата в реестре: 2026-10-27
- В реестре зафиксированы отсылки к п.4.6.1, 1.2, 1.3 (см. `trust_basis` / `blocker`).
- Код: `temporarily_limited`; caps restricted на html/outbound/web/fetch/images/price.
- Письменное разрешение: **не зафиксировано в проекте**.
- Для юридической сверки: открыть актуальный URL условий и сопоставить с полями записи `the_cultt`.

### Д.2. TSUM Collect

- URL: https://collect.tsum.ru/terms
- Дата: 2026-10-27
- В `terms_quote` сохранена цитата §4.6 о исключительных правах на контент и запрете использования без согласия.
- `applies_to` в реестре: html_product_fetch / republish — **не автоматически** обычный гиперссылочный переход.
- Код: HTML/images/fetch restricted; outbound `basis_unset`; каталог в выдаче сохранён.
- Письменное согласие на перепубликацию: **не зафиксировано**.

### Д.3. Прочие

Массовое чтение conditions всех доменов для этого отчёта **не выполнялось**. Где нет `terms_quote` / `documented_allowed` — основание **не установлено**.

---

## Е. Политики и обходы

| Контроль | Место | Поведение |
|----------|-------|-----------|
| До выбора | `selectSources` | status, outbound, brand/own_brand, unknown brand |
| Адаптер | `adaptersForSelection` | skip verified:false |
| web_fetch | `webFetchAllowedForUrl` | unknown domain запрещён |
| web_search | filter + re-filter cache | без raw fallback |
| Official extras | `server.js` | skip restricted / limited / duplicate domain |
| Демо | offers split | items ≠ demo_items |

Остаточные архитектурные факты: клик пользователя; устаревание conditions сайта; env может включать web_search; ручной URL вне продукта.

---

## Ж. Ollama / eBay

### Ж.1. Web

| | |
|--|--|
| Search | `https://ollama.com/api/web_search` |
| Fetch | `https://ollama.com/api/web_fetch` |
| Search on | `WEB_SEARCH_ENABLED=true` + ключ |
| Fetch on | `OLLAMA_WEB_FETCH=true` + documented_allowed |
| Timeout | 20 с |
| Cache | 10 мин, ≤64, in-memory |
| Условия Ollama Cloud | как правовой документ в срезе **не проверялись** |

### Ж.2. Vision

| | |
|--|--|
| Flag | `AI_ENABLED` |
| Default URL | `http://127.0.0.1:11434` |
| Model default | `qwen3-vl:4b-instruct` |
| Photo timeout | ≤90 с |
| Concurrency | default 1 |

### Ж.3. eBay

Browse API; ключи только server-side; circuit breaker; без ключей — без API-карточек.

---

## З. Фото / кнопки

- `#btn-photo` в строке поиска; видна при `ai_enabled`.
- Выключенный AI: кнопка скрыта; загрузка ≠ успешный разбор.
- «Новый запрос»: после ссылок; abort + searchSeq; не чистит историю/избранное/тему.

---

## И. Хранение и внешние связи

| | |
|--|--|
| History / saved / theme | localStorage |
| User DB | нет |
| Analytics pixels | не найдены |
| Font CDN | нет |
| Tracking cookies | не выставляются приложением |
| Ads | демо `#ad-placement` |
| CSP connect-src | `self` |

---

## К. Неподтверждённые вопросы

1. Актуальные полные тексты условий всех активных доменов.
2. Письменные разрешения CULTT / согласия TSUM.
3. Правовая квалификация гиперссылки vs копирования контента (вне этого отчёта).
4. Условия Ollama Cloud под web_search.
5. Условия eBay при включении ключей.
6. Native price Ozon/WB.
7. Search URL own-brand.
8. Политика логов конкретного хостинга.
9. Трансграничность запросов к ollama.com — факт маршрута есть, оценка нет.

---

## Л. Карточки записей с policy / terms / blocker

### `nike_com` — Nike

- domain: `www.nike.com`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Публичный домен бренда Nike; идентичность по общеизвестному официальному сайту.

### `adidas_com` — adidas

- domain: `www.adidas.com`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Публичный домен бренда adidas.

### `zara_official` — Zara

- domain: `www.zara.com`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Официальный домен Zara; витрина /ru/ru.

### `lamoda_ru` — Lamoda

- domain: `www.lamoda.ru`; type: `reseller`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Крупный российский fashion-реселлер; не авторизованный продавец каждого бренда.

### `wildberries` — Wildberries

- domain: `www.wildberries.ru`; type: `mass_marketplace`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Массовый маркетплейс; продавцы независимы.

### `ozon` — Ozon

- domain: `www.ozon.ru`; type: `mass_marketplace`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Массовый маркетплейс.

### `yandex_market` — Яндекс Маркет

- domain: `market.yandex.ru`; type: `mass_marketplace`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Массовый маркетплейс; цена URL подтверждена ранее.

### `avito` — Авито

- domain: `www.avito.ru`; type: `classifieds`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Площадка объявлений; оригинал не гарантирован.

### `ebay` — eBay

- domain: `www.ebay.com`; type: `reseller`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Международная площадка; продавцы независимы. Browse API даёт товары при ключах.
- usage_policy: html_product_fetch=temporarily_disabled; outbound_link=basis_unset; images=basis_unset; api_products=documented_allowed; note=Товары только через eBay Browse API при ключах (не HTML-сбор). HTML scrape не используем.; checked_at=2026-10-27

### `vestiaire` — Vestiaire Collective

- domain: `www.vestiairecollective.com`; type: `reseller`; status: `temporarily_limited`; checked_at: `2026-10-27`
- trust_basis: Реселлер винтажа; HTTP 403 в автопроверке — скрыт из выдачи.

### `brandshop` — BRANDSHOP

- domain: `brandshop.ru`; type: `reseller`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: FAQ brandshop.ru/faq/products_faq/: заявление об оригинальной продукции от брендов/дистрибьюторов; возврат 14 дней. Самозаявление ≠ авторизация каждого бренда.
- trust_links: https://brandshop.ru/, https://brandshop.ru/faq/products_faq/, https://m.brandshop.ru/faq/shipping_faq/
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; ollama_web_fetch=basis_unset; note=Публичные FAQ прочитаны; отдельного разрешения на серверный разбор каталога не найдено.; checked_at=2026-10-27
- product_live_note: HTML product-сбор не включён: основание для автосбора basis_unset; технически поиск нестабилен. Переход search сохранён.

### `peak_concept` — Peak Concept

- domain: `peakstore.ru`; type: `reseller`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Розничный магазин Peak Concept (Москва). Условия доставки РФ/СДЭК на peakstore.ru/help/shipping/. Не авторизованный продавец всех брендов.
- trust_links: https://peakstore.ru/, https://peakstore.ru/help/shipping/, https://peakstore.ru/help/return/
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; ollama_web_fetch=temporarily_disabled; note=Официального API/фида не найдено; web_fetch как обход 403 не используем.; checked_at=2026-10-27
- product_live_note: HTML product отключён: basis_unset + серверный GET 403. Не обходим через Ollama. Переход на catalog/?q= сохранён.

### `lime_store` — LIMÉ

- domain: `limestore.com`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд LIMÉ. Оферта limestore.com/ru_ru/oferta: ООО «Стиль Трейд», домены limestore.com и lime-shop.com, цены в рублях, доставка по РФ. Не реселлер чужих luxury-брендов.
- trust_links: https://limestore.com/, https://lime-shop.com/, https://limestore.com/ru_ru/oferta
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API не подключено.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не ведётся. Ранее /ru_ru/search → 404 — не показываем как рабочий search.

### `maag` — MAAG

- domain: `maag-fashion.com`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд MAAG. buyers/: АО «Новая Мода», магазины РФ, возврат 30 дней. Также продажи через Wildberries (отдельные правила). Не реселлер Dior/LV.
- trust_links: https://maag-fashion.com/, https://maag-fashion.com/buyers/
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand; WB — отдельный канал с другими правилами.; checked_at=2026-10-27
- product_live_note: HTML product не подключён (basis_unset). Переход на главную, без выдуманных карточек.

### `oskelly` — OSKELLY

- domain: `oskelly.ru`; type: `reseller`; status: `temporarily_limited`; checked_at: `2026-10-27`
- blocker: HTTP 403/504 при автоматической загрузке условий; политика использования не прочитана полностью
- trust_basis: Ресейл-площадка (кандидат). Автопроверка: HTTP 403/504 на oskelly.ru и /info/about. Условия и аутентификация не подтверждены в этой среде.
- trust_links: https://oskelly.ru/, https://oskelly.ru/info/about, https://oskelly.ru/info/buyer
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Условия сайта не загружены (техблокер). Не считаем разрешённым.; checked_at=2026-10-27

### `the_cultt` — THE CULTT

- domain: `thecultt.com`; type: `reseller`; status: `temporarily_limited`; checked_at: `2026-10-27`
- blocker: Пользовательское соглашение: автодоступ к контенту (4.6.1); размещение ссылок без письменного разрешения (1.3)
- trust_basis: Ресейл-платформа. Условия: thecultt.com/legal/…/polzovatelskoe-soglashenie — п.4.6.1 запрет автодоступа/копирования/отслеживания контента; п.1.2 коммерческое использование контента; п.1.3 размещение ссылок — с письменного разрешения.
- trust_links: https://thecultt.com/, https://thecultt.com/legal/usloviya-prodazhi/polzovatelskoe-soglashenie, https://thecultt.com/legal/usloviya-prodazhi/publichnaya-oferta-pokupatelya-ooo-kult
- usage_policy: html_product_fetch=restricted; outbound_link=restricted; ordinary_link=restricted; web_search_display=restricted; search_title=restricted; search_snippet=restricted; web_fetch=restricted; ollama_web_fetch=restricted; images=restricted; product_price=restricted; product_image=restricted; note=Исключён из выбора, official entry, web_results, fallback, кэша выдачи, direct/Ollama fetch до письменного разрешения.; checked_at=2026-10-27
- basis_urls: https://thecultt.com/legal/usloviya-prodazhi/polzovatelskoe-soglashenie
- product_live_note: HTML-сбор и выдача карточек/цен отключены по п.4.6.1 соглашения. Ollama web_fetch не используется как обход.

### `tsum_collect` — TSUM Collect

- domain: `collect.tsum.ru`; type: `reseller`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: Ресейл АО «М Коллект» (collect.tsum.ru/terms). Заявлена проверка подлинности; не 100% гарантия каждого лота.
- trust_links: https://collect.tsum.ru/, https://collect.tsum.ru/terms, https://collect.tsum.ru/men/catalog
- terms_quote.url: https://collect.tsum.ru/terms
- terms_quote.section: 4.6
- terms_quote.checked_at: 2026-10-27
- terms_quote.text: «Владельцу Платформы принадлежат исключительные права на контент, размещенный на Платформе. Запрещается использование контента третьими лицами, включая Частного продавца, без письменного согласия Владельца Платформы.»
- terms_quote.applies_to: html_product_fetch / republish content — не автоматически к обычному гиперссылочному переходу
- terms_quote.source_of_quote: сохранённый снимок аудита agent-tools (файл проверки collect.tsum.ru/terms)
- usage_policy: html_product_fetch=restricted; outbound_link=basis_unset; ordinary_link=basis_unset; web_search_display=basis_unset; search_title=basis_unset; search_snippet=restricted; web_fetch=restricted; ollama_web_fetch=restricted; images=restricted; product_price=restricted; product_image=restricted; note=Проверены collect.tsum.ru/terms (не tsum.ru). Цитата 4.6 сохранена в terms_quote. Переход basis_unset ≠ documented_allowed на сбор.; checked_at=2026-10-27
- basis_urls: https://collect.tsum.ru/terms, https://collect.tsum.ru/robots.txt
- product_live_note: HTML-сбор отключён. Обычный переход на каталог отделён от копирования контента.

### `spin4spin` — SPIN4SPIN

- domain: `spin4spin.com`; type: `reseller`; status: `search_link`; checked_at: `2026-10-27`
- trust_basis: FAQ: комиссионная реализация, проверка подлинности экспертами, участник аутентификации Grailed; комиссия до 30%; возврат сайта 10 дней. Не принимает часть масс-маркета. Не безусловная гарантия.
- trust_links: https://spin4spin.com/, https://spin4spin.com/faq, https://spin4spin.com/sales-rules
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=FAQ/sales-rules прочитаны для модели продаж; отдельного API нет.; checked_at=2026-10-27
- product_live_note: HTML product не подключён (basis_unset). Переход без сбора каталога.

### `luxxy` — Luxxy

- domain: `luxxy.com`; type: `reseller`; status: `temporarily_limited`; checked_at: `2026-10-27`
- blocker: Домены недоступны для сверки условий; связь luxxy.com / luxxy.ru не подтверждена
- trust_basis: Автопроверка: luxxy.com → 500; luxxy.ru timeout. Связь доменов и актуальная оферта не подтверждены — условия не переносим между доменами.
- trust_links: https://www.luxxy.com/, https://luxxy.ru/
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Без доступных условий — не активируем.; checked_at=2026-10-27

### `befree` — Befree

- domain: `www.befree.ru`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд Befree (Melon Fashion Group). Витрина befree.ru (200). Search URL как полный фильтр не подтверждён.
- trust_links: https://befree.ru
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API нет.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.

### `sela` — Sela

- domain: `www.sela.ru`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд Sela. Витрина sela.ru (200). Search URL не подтверждён отдельно.
- trust_links: https://sela.ru
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API нет.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.

### `zarina` — Zarina

- domain: `zarina.ru`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд Zarina (Melon Fashion Group). Витрина zarina.ru (200).
- trust_links: https://zarina.ru
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API нет.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.

### `love_republic` — Love Republic

- domain: `www.loverepublic.ru`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд Love Republic. Витрина loverepublic.ru (200).
- trust_links: https://loverepublic.ru
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API нет.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.

### `gloria_jeans` — Gloria Jeans

- domain: `www.gloria-jeans.ru`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд Gloria Jeans. Витрина gloria-jeans.ru (200).
- trust_links: https://gloria-jeans.ru
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API нет.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.

### `gate31` — GATE31

- domain: `gate31.ru`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд GATE31. Витрина gate31.ru (200).
- trust_links: https://gate31.ru
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API нет.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.

### `krakatau` — Krakatau

- domain: `krakatau.ru`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд Krakatau. krakatau.ru (200); krakatauwear.com также отвечает — в выдаче krakatau.ru.
- trust_links: https://krakatau.ru
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API нет.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.

### `ostin` — O'STIN

- domain: `www.ostin.com`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд O'STIN. Автоматический GET вернул 401 — не доказательство запрета; переход без HTML-сбора.
- trust_links: https://ostin.com
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API нет.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.

### `storeez_12` — 12 STOREEZ

- domain: `12storeez.com`; type: `brand_official`; status: `search_link`; checked_at: `2026-10-27`
- own_brand: true
- trust_basis: Собственный бренд 12 STOREEZ. Автоматический доступ 403 — не юр. запрет; витрина без сбора каталога.
- trust_links: https://12storeez.com
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Own-brand витрина; отдельного API нет.; checked_at=2026-10-27
- product_live_note: Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.

### `shu` — SHU

- domain: `—`; type: `brand_official`; status: `candidate`; checked_at: `2026-10-27`
- own_brand: true
- blocker: Таймаут при проверке shu.ru
- trust_basis: Кандидат: shu.ru не ответил в срок проверки; домен/витрина не активированы.
- usage_policy: html_product_fetch=basis_unset; outbound_link=basis_unset; images=basis_unset; note=Не активирован без подтверждённого домена.; checked_at=2026-10-27

---

## М. Адаптеры `data/sources.json` (кратко)

| id | verified | price_filter_verified | currency | url_template |
|----|----------|----------------------|----------|--------------|
| ozon | true | false | RUB | https://www.ozon.ru/search/?text={q} |
| wildberries | true | false | RUB | https://www.wildberries.ru/catalog/0/search.aspx?search={q} |
| yandex_market | true | true | RUB | https://market.yandex.ru/search?text={q} |
| avito | true | false | RUB | https://www.avito.ru/all?q={q} |
| lamoda | true | false | RUB | https://www.lamoda.ru/catalogsearch/result/?q={q} |
| zara | true | false | EUR | https://www.zara.com/ru/ru/search?searchTerm={q} |
| ebay | true | false | USD | https://www.ebay.com/sch/i.html?_nkw={q} |
| vestiaire | false | false | EUR | https://www.vestiairecollective.com/search/?q={q} |
| brandshop | true | false | RUB | https://brandshop.ru/search/?q={q} |
| peak_concept | true | false | RUB | https://peakstore.ru/catalog/?q={q} |
| lime | true | false | RUB | https://limestore.com/ru_ru/ |
| maag | true | false | RUB | https://maag-fashion.com/ |
| the_cultt | false | false | RUB | https://thecultt.com/ |
| tsum_collect | true | false | RUB | https://collect.tsum.ru/women/catalog |
| spin4spin | true | false | RUB | https://spin4spin.com/catalog |
| befree | true | false | RUB | https://befree.ru/ |
| sela | true | false | RUB | https://www.sela.ru/ |
| zarina | true | false | RUB | https://zarina.ru/ |
| love_republic | true | false | RUB | https://www.loverepublic.ru/ |
| gloria_jeans | true | false | RUB | https://www.gloria-jeans.ru/ |
| gate31 | true | false | RUB | https://gate31.ru/ |
| krakatau | true | false | RUB | https://krakatau.ru/ |
| ostin | true | false | RUB | https://www.ostin.com/ |
| storeez_12 | true | false | RUB | https://12storeez.com/ |

---

*Конец отчёта.*
