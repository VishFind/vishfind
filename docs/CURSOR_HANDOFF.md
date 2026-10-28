# CURSOR_HANDOFF — 2026-10-27

Отчёт о инженерном этапе: **качество поиска, миграция избранного, готовность к закрытому тестированию**.  
Это не замена `PROJECT_SPECIFICATION.md` / `AMVERA_DEPLOYMENT.md`, а точный diff-отчёт.

## 1. Что было до изменений

- Текстовый разбор в `lib/parse-query.js`, ссылки в `providers/links.js`, демо-offers в `lib/offers.js`.
- Фронт: история, избранное `vishfind-saved`, чипсы, сравнение, статусы фото, liquid glass UI.
- Избранное уже умело сохранять «вещь», но **старые** записи вида «Ozon» / «Wildberries» оставались как есть.
- Клиентская и серверная сортировка offers сравнивали валюты через **выдуманный** курс.
- Повторный поиск мог теоретически пересечься: был только `busy`-guard и `AbortSignal.timeout`, без отмены предыдущего запроса при новом.
- Базовые тесты: **38** (`npm test`), все зелёные до старта этапа.
- Незакоммиченные правки владельца во фронте (`index.html`, `js/search.js`, `css/site.css`, …) **не откатывались**.

## 2. Какие ошибки удалось воспроизвести

| Проблема | Воспроизведение |
|----------|-----------------|
| Бюджет `15к` / `15 тыс` **без** «до» не извлекался; `15к` попадал в `rest`/`search_phrase` | `parseQuery('15к худи')`, `parseQuery('худи 15 тыс')` |
| `\b` после кириллической «к» в JS не даёт границу слова | юнит на `15к` |
| Старое избранное с `title: "Ozon"` без названия вещи | localStorage до миграции |
| Кросс-валютная сортировка/бюджет через выдуманный курс | `CURRENCY_RATE_RUB` в `lib/offers.js` и `PRICE_TO_RUB` во фронте |

## 3. Что исправлено и в каких файлах

### Backend / lib
- `lib/parse-query.js` — надёжный разбор бюджета (`15к`, `15 тыс`, lookbehind вместо `\b` после «к»).
- `lib/offers.js` — бюджет только для RUB; сортировка без кросс-валютной конвертации.
- `providers/links.js` — без изменений логики (поведение подтверждено тестами).

### Frontend
- `js/saved-items.js` (**новый**) — нормализация, идемпотентная миграция, безопасный storage-адаптер, rename.
- `js/search.js` — подключение миграции; AbortController + `searchSeq`; ошибки без декоративной задержки; сортировка offers без курса; scroll-guard при ручном скролле; переименование в UI.
- `index.html` — подключение `js/saved-items.js`.

### Тесты
- `test/parse-query.test.js` — 28 контрольных кейсов.
- `test/links.test.js` — verified, encoding, budget filter.
- `test/attributes-priority.test.js` — приоритет текста vs `attributes_priority`.
- `test/saved-items.test.js` — миграция и отказоустойчивость storage.
- `test/photo-mock.test.js` — mock Ollama (не реальная модель).
- `test/offers.test.js` — обновлён кейс про валюты.

### Документация
- `docs/CURSOR_HANDOFF.md` (этот файл).

## 4. Тесты: добавленные и фактический запуск

```
npm test
ℹ tests 91
ℹ pass 91
ℹ fail 0
```

Также:
- `node scripts/verify-prod.js` — PASS (production-check, AI off).
- Сервер на `:3000` уже был запущен; второй инстанс не поднимался для ручных проверок UI.

## 5. Ollama: mock vs real

### Mock (`test/photo-mock.test.js`)
- Корректный JSON → 200, `photo_used: true`.
- Битый JSON / пустой ответ → 502, без подмены успеха.
- Ollama down → 502.
- Таймаут Ollama → 502, `photo_used: false`.
- `AI_ENABLED=false` → 503.
- Частичные поля допустимы.

### Real smoke (отдельно от `npm test`)
- Модель на машине: `qwen3-vl:4b-instruct` (также есть 2b).
- Файл: `img/test-jacket.jpg`.
- `POST /api/search` с фото, query пустой → **200**, `photo_used: true`, `category: куртка`, `color: красный`, ~2.6 с.
- Качество фразы модели шумное (описание попадает в rest) — **не выдаём это за идеальный каталожный разбор**.

Ручной чек-лист на будущее (не прогонялся сегодня полностью): одна вещь / несколько вещей / плохое освещение / нечитаемая надпись / фото без одежды.

## 6. Что реально не сделано и почему

- Публикация, туннель, деплой Amvera — запрещены задачей.
- Новые npm-зависимости, React, БД, аккаунты — запрещены.
- Скачивание моделей — не требуется (модель уже есть).
- Полный ручной матричный прогон всех визуальных сценариев фото — ограничен одним smoke-файлом.
- Git commit / push — не выполнялись.

## 7. Миграция избранного

- Ключ: `vishfind-saved` (без смены).
- Флаг идемпотентности: `vishfind-saved-migrated-v1`.
- Если есть `query` — название вещи из запроса; площадка → `place`.
- Если есть нормальный `title`/`item` предложения — сохраняется.
- Если восстановить нельзя — «Сохранённая ссылка» / «Сохранённое предложение» + `needs_rename` и кнопка «Переименовать».
- Разные URL не сливаются.
- Повреждённый JSON / неверный тип / quota → понятная ошибка, поиск не ломается; **нет ложного «Сохранено»**.
- Тесты используют `createMemoryStorage`, не реальный localStorage владельца.

При загрузке страницы 2026-10-27 в браузере статус: «Избранное обновлено…»; карточка ссылки стала «Чёрная винтажная куртка · Ozon».

## 8. Оставшиеся ограничения

- Парсер правилами, не NLP: неоднозначности решаются консервативно.
- Числовой размер без слова «размер» не извлекается (`куртка 48` → size null) — намеренно.
- Демо-offers и ссылки — не проверка наличия в магазинах.
- Бюджет в URL только у площадок с `price_filter_verified` (сейчас Яндекс Маркет).
- Фотоанализ зависит от локальной Ollama; на Amvera `AI_ENABLED=false`.
- Поисковая фраза с фото может содержать шум описания модели.

## 9. Изменения поведения API

- **Пути и поля ответа не переименовывались.**
- Семантика offers: рублёвый `budget` больше не отсекает EUR/USD через курс; сортировка не смешивает валюты по курсу.
- Разбор бюджета чуть шире (`15к` / `15 тыс` без «до`) → `parsed.budget` / strip из rest.

## 10. Как повторить проверки

```bash
npm test
node scripts/verify-prod.js
npm start
# http://localhost:3000/api/health
# текстовый поиск; избранное (старые Ozon-записи); повторный клик «Искать»
```

Реальный фото-smoke (опционально, не в `npm test`):

```bash
node -e "/* POST img/test-jacket.jpg на /api/search при AI_ENABLED=true */"
```

## 11. Следующие задачи для SourceCraft

1. Независимый review diff инженерного этапа и UI-итерации (особенно `parse-query`, `offers`, `saved-items`, `search.js`, иерархия `index.html`).
2. Сверка README и `PROJECT_SPECIFICATION.md` с кодом (бюджет без «до», валюты offers, миграция избранного, порядок блоков, панели).
3. Проверка инструкции запуска на Windows (Ollama + `qwen3-vl:4b-instruct` + `.env`).
4. Инструкция закрытого тестирования через **защищённый туннель к Node-приложению**, не напрямую к Ollama; без платной инфраструктуры и без публикации сегодня.

---

## 12. UI-итерация: «Поиск на первом месте» (продолжение того же дня)

Предыдущие разделы 1–11 **сохранены**. Ниже — только иерархия страницы и документация.

### Что изменилось в сценарии

- До поиска нет больших секций избранного/истории/пустых результатов.
- В шапке: «Избранное» (со счётчиком) и «История» → одна sheet-панель (Escape, закрытие, фокус, lock scroll).
- После поиска первыми идут **ссылки**; критерии вторичны; hero компактнее без резкого скачка.
- Подсказки компактны у поиска; примеры до поиска только заполняют строку (без автозапуска поиска из refine-hints).
- «Лучшие предложения» заменены на **«Рекламное размещение»** у подвала (статичные слоты). Демо API (`is_demo: true`) не рисуются как выдача. Реальные `is_demo: false` — блок «Предложения» после ссылок. Сравнение только для реальных.
- AbortController / searchSeq / scroll-guard сохранены; второй автоскролл не добавлялся.

### Изменённые файлы (эта итерация)

- `index.html` — порядок блоков, sheet, кнопки шапки, `#ad-placement`.
- `js/search.js` — панели, порядок рендера, реклама, реальные offers.
- `css/site.css` — sheet, header-tools, hero.is-compact, ad-slots.
- `PROJECT_SPECIFICATION.md` — актуальный UI и статус (история/избранное реализованы локально).
- `AMVERA_DEPLOYMENT.md` — уточнение проверки главной (без утверждений о состоянии облака).
- `docs/CURSOR_HANDOFF.md` — этот раздел.

Backend / API / `amvera.yml` / `.env` **не менялись**.

### Ограничение по демо API

Без смены backend демо-каталог всё ещё может фильтроваться сервером по запросу. UI **не** показывает эти позиции как результаты и **не** подменяет ими рекламные слоты (слоты статичны). Полный несвязанный с запросом рекламный инвентарь — отдельная задача.

### Что проверить SourceCraft по UI

- Порядок блоков до/после поиска на 360 / 768 / 1440.
- Панели: клавиатура, Escape, повтор поиска без двойной истории.
- Рекламный клик → «Здесь могла бы быть ваша реклама»; нет `demo.local` как магазина.
- Темы светлая/тёмная; миграция `vishfind-saved` не сломана.

---

## 13. Критерии поиска и фильтры площадок (продолжение)

См. также §14 — UI чипсов над поиском.

### Реализовано ранее

- Парсер: `budget_min` / `budget_max` (+ совместимый `budget`); запросы `от` / `до` / `от…до` / `15к` / `15 тыс`.
- API: `clear_attributes`, `attributes_priority`.
- Ссылки: карта в `data/sources.json`; Яндекс Маркет — `pricefrom`+`priceto` (**браузер 2026-10-27**).

---

## 14. Чипсы критериев над поиском (2026-10-27)

### Что изменено в чипсах и панелях

- Единственный UI критериев — ряд чипсов **над** строкой поиска (`#quick-chips` + `VishFindCriteria.mount`).
- Большой блок `#user-criteria-wrap` / сетка под строкой **удалены**.
- Чипсы: Тип одежды, Цвет, Размер, Цена, Бренд, Особенности.
- Десктоп: один `role="dialog"` popover (fixed, не раздвигает layout); телефон: нижняя sheet + backdrop + lock scroll.
- Одна панель за раз; повторный клик / Escape / клик вне / «Готово» / «Закрыть» закрывают; фокус возвращается на чип.
- Выбор **не** запускает поиск; Enter в числовых полях не сабмитит форму.
- Подписи чипсов показывают значения («Цвет: чёрный» + swatch, «Цена: от/до/диапазон», …); активный чип — салатовый акцент.
- «Сбросить фильтры» рядом с чипсами только при выбранных значениях; в панели — сброс одного критерия.
- `prefers-reduced-motion` учтён; новых зависимостей нет.

### Модель критериев и приоритет

- Одно состояние в `criteria-panel.js` → `attributes` + `clear_attributes`.
- При любом ручном выборе/сбросе клиент шлёт `attributes_priority: true`.
- Сервер: текст парсится всегда; **непустые** поля `attributes` перекрывают текст; сброс только через `clear_attributes` (пустой attr текст не затирает).
- После ответа чипсы синхронизируются с `parsed` + «липкие» флаги `cleared` из отправленных `clear_attributes`.
- История/избранное: structured `criteria` + `clear_attributes` при повторе, чтобы null не вернулся из текста.

### Какие адаптеры изменены

- `providers/links.js` — `filter_details` для особенностей (`rest`); логика цены без выдуманных verified-фильтров.
- `data/sources.json` — уточнены `filter_capabilities` (`price_min`/`price_max`, `in_query_only` / `manual` / `verified_browser`).
- Новых площадок не добавлялось. Показываются только `verified: true`.

### Фильтры: браузер vs URL-тесты vs вручную

| Что | Статус |
|---|---|
| Яндекс Маркет `pricefrom`+`priceto` | подтверждено открытием ссылки (2026-10-27) |
| Ozon/WB/Avito price URL | **не** подставляем; только генерация базового URL + подпись «вручную» |
| Цвет/размер/бренд/тип/особенности на всех | словами в `search_phrase` + `filter_details` |
| Zara/eBay цена RUB | не поддерживается в URL (валюта) — вручную |
| Vestiaire | не в выдаче (`verified: false`) |

### Браузер (локальный UI)

Проверено на `http://127.0.0.1:3000`:
- чипсы над строкой поиска; панели Цвет/Цена открываются; подписи «Цвет: Чёрный», «Цена: 5 000–15 000 ₽»; «Сбросить фильтры»; «Готово» закрывает и возвращает фокус;
- payload поиска после фикса getters: `attributes.color`, `budget_min`/`budget_max`, `attributes_priority: true`.

Исправление: `criteriaApi.attributes` / `clear_attributes` / `priceError` сделаны **геттерами** (раньше снимок на mount → чипсы не попадали в запрос).

### Внешние витрины в этой сессии

Повторно **не** открывались. Ранее (2026-10-27): Яндекс `pricefrom`+`priceto` подтверждены. Ozon/WB — нет.

E2E на временном `:3101` с актуальным `server.js`: `search_phrase=чёрный бомбер`, Yandex URL с `pricefrom=5000&priceto=15000`.  
Процесс на `:3000` без перезапуска может отдавать старый merge — **перезапустите `npm start`**, чтобы подтянуть `server.js`.

### Ограничения и известные дефекты

- Нет стабильных публичных ID категорий/цветов/брендов — не выдумываем.
- Автопроверка a11y ≠ полный аудит; сделаны aria-expanded/controls, Escape, focus return, sheet focus trap на мобиле, панель снимается с DOM при закрытии.
- Демо-offers backend по-прежнему могут учитывать budget; UI не показывает их как выдачу.

### Проверки (факт)

- Целевые: `attributes-priority` + `links` + `parse-query` → 48 pass.
- `npm test` → **103 pass / 0 fail**.
- `node scripts/verify-prod.js` → все PASS.
- Deploy/cloud не проверялись.

### Файлы этапа (§14)

- `js/criteria-panel.js`, `js/search.js`, `index.html`, `css/site.css`
- `server.js`, `providers/links.js`, `data/sources.json`
- `test/attributes-priority.test.js`
- `PROJECT_SPECIFICATION.md`, этот handoff

---

## 15. Мультивыбор, «Цена от», ядро, адаптеры (2026-10-27)

### Причина бага «Цена от»

1. Ранее `attributes` на клиенте были снимком на mount (уже исправлено геттерами).
2. При нескольких размерах короткие токены `M`/`L` выпадали из `search_phrase` (фильтр rest &lt; 3 символов) — исправлено в `criteria-model`.
3. Раздельный clear `budget_min` раньше мог сбрасывать весь бюджет — исправлено.
4. Живой процесс на `:3000` без перезапуска мог отдавать старый merge — нужен restart.

Цепочка сейчас: поле → state (пусто ≠ 0) → attributes.budget_min → mergeCriteria → links `pricefrom` (Яндекс).

### UI / мультивыбор

- Чипсы: multi для типа/цвета/размера/бренда/особенностей; цена — один диапазон.
- Подпись «Цвет: чёрный +2»; предупреждение при смеси буквенных и числовых размеров.
- Убрана подсказка «не угадываем бренд».

### Ядро

- Новый `lib/criteria-model.js`: normalize / merge / publicCriteria (массивы + одиночные поля).
- История: `criteria_version: 2` + массивы; старые записи читаются как один элемент.

### Адаптеры (честно)

| Площадка | Итог |
|---|---|
| Яндекс | `pricefrom`/`priceto` **подтверждены браузером** (в т.ч. только «от» = 5000 в поле «От») |
| Ozon/WB/Lamoda | цена URL не verified → вручную; описательное — словами |
| Авито | CAPTCHA/IP при проверке → `pmin`/`pmax` **не** включаем в выдачу |
| Zara/eBay | RUB не подставляем |
| Vestiaire | не в выдаче |

### Устойчивость / диагностика

- `PHOTO_CONCURRENCY`, 503 overload; health: `text_search_ok` / `recognition_configured`.
- Tech debug: `?debug=1`.

### Проверки этой итерации (только целевые)

- `node --test test/criteria-model.test.js` → 11 pass
- `attributes-priority` + `links` → pass (ранее в пакете)
- **Не** запускались: полный `npm test`, `verify-prod`, полный UI-обход
- Браузер: Яндекс `pricefrom=5000` → поле «От»=5000; Авито — блок IP

### Отложено до полного регресса

- Полный прогон UI/истории/избранного; мобильная sheet; confirm Avito pmin при доступе.

---

## 16. Пустая строка, примеры, цвет, compat (2026-10-27)

### Причины ошибок

1. **«Заполненное» поле** — длинный placeholder выглядел как value; плюс автоподстановка из `?q=` после `loadHealth`.
2. **Примеры** — сами по себе парсятся; риск путаницы с критериями/ошибками сервиса. Сообщение 422 уточнено (`error_kind`), примеры упрощены и только заполняют поле.
3. **Залипание цвета** — при смене чипа `openPanel` создавал новый dialog/backdrop, не снимая предыдущие (утечка DOM).

### Исправления

- Placeholder: «Напишите название одежды, размер, цену и прочие особенности»; `value=""`; нет автозаполнения из URL.
- Примеры: куртка / чёрная куртка размер M / худи Nike до 15к / бомбер от 5000 до 15000; click → fill + focus, без search; критерии не трогаем.
- Цвет/панели: перед открытием другого чипа — `closePanel` + очистка orphan `.criteria-backdrop` / `#criteria-popover`; то же на mount/destroy.
- Compat: `lib/marketplace-capabilities.js`, fixtures, `npm run marketplace-report`; `disabled_filters` в sources.

### Площадки (без ложного «всё работает»)

Без изменений статусов подтверждения: Яндекс цена — browser; остальные — manual/in_query; Авито цена не инжектится; Vestiaire off (403).

### Точечные проверки

- `test/marketplace-compat.test.js` + `criteria-model` → pass
- `npm run marketplace-report` → 10 fixtures OK, без HTTP
- Полный npm test / verify-prod / полный UI — **не** запускались

### Нужен перезапуск

Да, процесс на `:3000` — перезапустить `npm start`, чтобы подтянуть `server.js` (422/`error_kind`). Статика подтянется после reload.

---

## 17. NLU + примеры + lifecycle + compat (2026-10-27)

### P0: почему примеры давали 422

Клиент в `panelSearchOptions` считал **пустые массивы** `categories:[]`, `colors:[]`… «заполненными» (`!= null`) → всегда слал `attributes_priority: true`. На сервере до `mergeCriteria` это затирало разбор текста → `search_phrase: null` → 422. Живой `:3000` ещё и был со старым `server.js`.

**Исправление:** `hasAttr` только при непустых массивах/скалярах/цене; без выбора — `attributes` не уходят, `attributes_priority: false`. Placeholder: «Напишите название одежды, размер, цену и тд». Примеры (fill-only, проверены API):

- Чёрная кожаная куртка
- Худи оверсайз, размер L, до 7000 ₽
- Джинсы синие, размер 48, от 3000 до 8000 ₽
- Кроссовки Nike или Adidas, размер 42

### Панели цвета

Backdrop только на mobile sheet; на desktop слой в DOM не держим. Смена чипа → `closePanel` → `scrubOrphans`. Закрытие не чистит значения; сброс — отдельно.

### NLU (`lib/parse-query.js`)

Массивы `colors`/`brands`/`sizes`/`categories`/`features` + singular; «или»; «не дороже» / «от 3 до 8 тысяч» (единица на обе границы); отрицания цвета → warning + rest «не …», не положительный фильтр; `\bsize\b` не режет `oversize`. Словари UI/парсера — `criteria-catalog.js`. Корпус: `data/query-corpus.json` (~108), прогон `node scripts/run-query-corpus.js` (не в `npm test`). Целевые: `test/parse-query-nlu.test.js`.

### Площадки

Статусы без ложного upgrade: Яндекс цена — native_filter (ранее browser); Ozon/WB/Lamoda/Zara/eBay — manual/in_query; Авито цена не в URL; Vestiaire off. Повторная внешняя проверка в этой сессии не выполнялась (блокер браузера на внешние URL). `npm run marketplace-report` — согласованность 7/8 + сводка confirmed/manual/unconfirmed.

### Устойчивость

Предупреждения парсера не затираются при `normalize` без attrs. Сервер на `:3000` перезапущен (`node server.js`).

### Точечные проверки (без полного npm test)

- `node --test test/parse-query.test.js test/parse-query-nlu.test.js test/criteria-model.test.js` — pass
- `node scripts/run-query-corpus.js` — 108/108
- `npm run marketplace-report` — 10 fixtures OK
- POST `/api/search` по 4 примерам + «куртка» — 200, sources≥7

### Полный регресс — отдельно

`npm test`, `verify-prod`, матрица UI/viewport, повторный browser confirm фильтров.

---

## 18. Оригиналы, реестр, веб-поиск, валюты (2026-10-27)

### Концепция и ранжирование
Выдача ориентирована на оригинальные вещи и источники с основанием доверия. При бренде: официальный магазин → RU реселлеры → зарубежные → объявления → CN → масс-маркет. Релевантность важнее «статуса» неподходящего товара. Реклама отдельно.

### Реестр
`data/source-registry.json`: **34** записи. Из них search_link (реально строят переходы): ядро Nike/adidas/Zara/Lamoda/eBay/Avito/WB/Ozon/Яндекс и др. Много **candidate** / identity_checked без выдачи как «подключённый магазин». Выбор: `lib/source-registry.js` (лимит 8 на запрос).

### Товары vs ссылки
`result_kind`: `product` (eBay API при ключах) / `search_link` (переходы). Нет цены → «Цена на сайте», не выдумываем.

### Ollama Web
`lib/ollama-web.js`: `web_search` / `web_fetch`, ключ `OLLAMA_API_KEY` только сервер. Включение: `WEB_SEARCH_ENABLED=true` или в development при ключе без явного false. Live: ключ **настроен**, поиск Nike вернул URL nike.com (неподтверждённые ссылки). Текстовый поиск не зависит от веба.

### Валюты / Google
`lib/fx-rates.js`: интерфейс есть, **live выключен**. Блокер: нет документированного Google Finance REST API для серверов (только Sheets `GOOGLEFINANCE`). Без подмены ЦБ/другим источником. Исходный бюджет RUB не переписывается.

### Размеры и цены словами
Панель размера: вкладки «Буквенные» / «Числовые» (выбор другой вкладки не сбрасывается). `lib/ru-amount.js`: «от трёх до восьми тысяч» → 3000–8000, не features.

### Активация веб-поиска
В `.env`: `OLLAMA_API_KEY=…` и `WEB_SEARCH_ENABLED=true` (если сейчас false — веб не включится). Перезапуск `node server.js`. Значение ключа никуда не выводится.

### Точечные проверки
`test/ru-amount.test.js`, `test/source-registry.test.js`, NLU — pass. Live POST Nike / словесная цена — ok. Полный npm test — не запускался.

---

## 19. Бренды ≥50, RU-магазины, ресейл, товары (2026-10-27)

### Бренды
- `data/brand-registry.json`: **73** уникальных (спорт/street/luxury/casual/RU), алиасы в `data/brands.json` (~154).
- Генератор: `scripts/build-brand-registry.js`. Домены только при установленной идентичности; иначе `candidate` / без домена.
- Связи: Jordan↔Nike и др. через `related` → `expandWantedBrands` в выборе источников.

### Четыре магазина
| Источник | Домен | Модель | Подключение | Блокер |
|---|---|---|---|---|
| BRANDSHOP | brandshop.ru | multi-brand reseller | search_link | product GET нестабилен/пустой |
| Peak Concept | peakstore.ru | multi-brand reseller | search_link | прямой GET поиска → 403; парсер peak_like готов |
| LIMÉ | limestore.com (+ lime-shop.com) | own_brand | search_link | `/ru_ru/search` → 404 в проверке |
| MAAG | maag-fashion.com | own_brand | search_link | витрина/search без стабильных карточек |

### Пять ресейл (не «топ-5»)
| Источник | Домен | Доверие | Доставка РФ | Данные | Реализация | Блокер |
|---|---|---|---|---|---|---|
| OSKELLY | oskelly.ru | unverified | unknown | none | temporarily_limited | HTTP 403/504 |
| THE CULTT | thecultt.com | reseller_described | confirmed (заявлено) | products_limited | products_connected | поиск по q нестабилен; витрина главной |
| TSUM Collect | collect.tsum.ru | reseller_described | confirmed (заявлено) | products_limited | products_connected | витрина главной, не полный search |
| SPIN4SPIN | spin4spin.com | reseller_described | confirmed (FAQ) | search_link | search_link | главная иногда timeout |
| Luxxy | luxxy.com / luxxy.ru | unverified | unknown | none | temporarily_limited | 500 / timeout; связь доменов не подтверждена |

### Товарные интеграции
- Реальные карточки+цены: THE CULTT (`/product/…`), TSUM Collect (`/item/ITEM…`) через `lib/product-html.js` (прямой GET).
- При запросе с брендом карточки без совпадения бренда **не** подставляются (витрина ≠ релевантный товар).
- Peak/Brandshop: парсер есть, live product с сервера не объявлен работающим.
- eBay product — по-прежнему только при ключах API.
- `products_connected`: 2 (CULTT, TSUM). `search_link` активных: остальные verified адаптеры + RU shops.

### Выбор / ранжирование
`selectSources`: группы + trust/delivery sort; official_store_entry из brand-registry для Dior/LV/AMIRI/Rick Owens и т.п.; OSKELLY/Luxxy не в активной выдаче.

### Веб / FX
Ключ Ollama настроен; `.env` не меняли. Фактический флаг веба смотрите в логе старта (`websearch:on/off`) — внешний `process.env` может перекрывать файл. FX live off.

### Точечные проверки этой итерации
- `node --test test/source-registry.test.js test/brands-registry.test.js test/product-html.test.js` — pass
- `node scripts/acceptance-spot.js` — Nike/Dior/LV/AMIRI/Rick/Levi’s/словесная цена/LIMÉ/MAAG/Jordan
- Live HTML probe CULTT/TSUM — карточки с ценами извлечены
- Полный `npm test` / verify-prod / browser matrix — **не** запускались

### Перезапуск
Сервер перезапущен после правок. Порт берётся из окружения/`PORT` (в этой сессии процесс слушал **3103**). UI: `http://127.0.0.1:<PORT>/`.

---

## 20. Аудит внешних интеграций / usage_policy (2026-10-27)

### Принцип
Точечное отключение спорного действия; независимые переходы и UI сохранены. Не юр. заключение.

### Ключевые находки и правки
- **THE CULTT** (`polzovatelskoe-soglashenie` 4.6.1 / 1.2 / 1.3): HTML-сбор карточек **и** активные исходящие ссылки → `temporarily_limited` / `usage_policy.restricted`. Ollama fetch не обходит.
- **TSUM Collect** (`collect.tsum.ru/terms` 4.6): перепубликация контента без письменного согласия → HTML product **off**; переход на `/women/catalog` **сохранён** (`outbound_link: basis_unset`).
- **BRANDSHOP / Peak / LIMÉ / MAAG / SPIN4SPIN**: переходы сохранены; product HTML не включаем (`basis_unset` или техблокер). LIMÉ/MAAG — витрина, не 404-search.
- **OSKELLY / Luxxy**: по-прежнему limited (техдоступ / условия не сверены).
- **eBay**: товары только через Browse API при ключах; HTML scrape off.
- **Ollama web**: включается только при явном `WEB_SEARCH_ENABLED=true` + ключ (больше не auto-on от ключа в development).
- Модуль: `lib/source-policy.js`; поля `usage_policy` в `data/source-registry.json`.

### Что сайт умеет после аудита
Текстовый поиск → критерии → ранжированные **search_link** (официальные/RU/ресейл без CULTT) → демо-offers; eBay product при ключах; без серверного HTML-каталога CULTT/TSUM.

---

## 21. Закрытие обходов web/policy (2026-10-27)

- Убран raw `search.results.slice` fallback в `enrichBrandSearch`.
- Убран fallback «все verified:true» в `handleSearch`.
- Кэш web_search/web_fetch повторно фильтруется политикой.
- `web_fetch`: неизвестный домен запрещён; ≠ разрешение web_search.
- CULTT: полный exclude (выбор, official, web_results, fetch); домены через `hostMatchesDomain`.
- TSUM: HTML off; в реестре `terms_quote` п.4.6 с URL и датой; переход basis_unset сохранён.
- `offers.items` = только live; демо → `offers.demo_items`.
- `OLLAMA_WEB_FETCH` по-прежнему не true (fetch в enrich не идёт).
- Тесты: `test/web-policy-guards.test.js` (+ source-policy).

---

## 22. Own-brand отбор, группы выдачи, «Новый запрос» (2026-10-27)

### Почему LIMÉ/MAAG были «везде»
1. При **пустом/нераспознанном бренде** own-brand с `trust_level=official_store` заполняли хвост лимита 8.
2. Клиентская группировка («Российские маркетплейсы») смешивала типы и могла визуально поднимать лишних.
3. Лимит 8 **вытеснял** обязательную тройку Ozon/WB/ЯМ.

### Исправление отбора
- Жёсткий gate для `own_brand` / `brand_official`: чужой или неизвестный бренд → не выбирать.
- Неизвестный латинский токен в `rest` ≠ «бренд отсутствует».
- Без бренда: own-brand только в группе 3, с капом и ротацией (не только LIMÉ/MAAG).
- Лимит на optional; тройка добавляется отдельно и сортируется последней.
- Сервер отдаёт `display_group*`; клиент не пересортировывает маркетплейсы выше ресейла.

### Порядок групп
1. Официальный магазин бренда  
2. Реселлеры и ресейл  
3. Другие места поиска (Авито, Lamoda, own-brand без бренда)  
4. Маркетплейсы: Ozon → Wildberries → Яндекс Маркет  

### Тесты
`node --test test/select-sources-groups.test.js test/new-query-reset.test.js test/source-registry.test.js`

---

## 23. Кнопки + текстовый бюджет + отчёт (2026-10-27)

- «Фото» возвращена в строку поиска; «Новый запрос» вынесена под список ссылок (скрыта до поиска).
- `providers/links.js`: при отсутствии подтверждённого native price и наличии `{q}` + RUB — бюджет в фразу (`до/от/от–до … рублей`), kind `in_query`; Яндекс без текстового дубля; витрина без `{q}` честно без бюджета; не-RUB без авто-рублей.
- Отчёт для правового обсуждения (фактический, не юр. заключение): `docs/FACTUAL_SITE_REPORT.md` (генерация `node scripts/build-factual-report.js`).
- Тесты: `test/links.test.js`, `test/ui-buttons-price.test.js`.

---

## 24. Завершающая итерация UI ссылок (2026-10-27)

### Добавлено (без новых API/парсеров/источников)
- Карточка: «Что передано» (applied / in_query / уточнить / витрина).
- «Скопировать запрос» → `search_phrase_used` (или общий phrase с пометкой); clipboard + fallback выделения.
- Клиентский фильтр групп: Все / Официальные / Ресейл / Другие / Маркетплейсы — **без** нового `/api/search`.
- Подписи: «Подходящие сайты», «Открыть поиск/каталог», «Официальный сайт»; статус «Подготовлено N переходов».

### Не менялось
- Политика CULTT off; HTML/web_fetch off; eBay без ключей; own-brand gate; обязательная тройка; text budget in_query; «Новый запрос» под ссылками; фото зависит от `AI_ENABLED`.

### Спорные правовые решения (не пересматривались)
- CULTT: outbound/html/web restricted до письменного разрешения.
- TSUM Collect: HTML restricted; переход на каталог basis_unset.
- Остальные: `basis_unset` ≠ documented_allowed на копирование материалов.

### Запуск (локально, этот срез)
```
cd c:\AI\ai-demo
set PORT=3103
node server.js
```
UI: `http://127.0.0.1:3103/`  
Факт смотреть в `/api/health`: `ai_enabled`, `web_search`, `ebay.configured`, `source_registry`.

### Включено / выключено (типичный локальный health)
| Функция | Состояние |
|---------|-----------|
| Текстовый поиск + links | вкл |
| WEB_SEARCH | по env (не меняли) |
| OLLAMA_WEB_FETCH | не включать |
| AI фото | по `AI_ENABLED` (часто false → кнопка «Фото» скрыта) |
| eBay товары | выкл без ключей |
| HTML product | не documented_allowed → не идёт |

### Что даёт ссылки vs товары
- **Ссылки:** активные `search_link` из реестра + official entry.
- **Товары/цены в карточках:** только при eBay keys / HTML allow — сейчас обычно нет; search_link ≠ наличие товара.

### Проверки
`node --test test/result-actions.test.js test/links.test.js test/select-sources-groups.test.js` — pass.  
Полный npm test / verify-prod / browser matrix — **не** гонялись.

### Для независимого ревью
1. `js/search.js` — renderSourceCard / renderMarkets / resetCurrentSearch.  
2. `providers/links.js` — buildUrl / search_phrase_used.  
3. `lib/source-registry.js` + `lib/source-policy.js` — отбор и запреты.  
4. `docs/FACTUAL_SITE_REPORT.md` — фактический срез (не юр. вывод).  
5. Не ослаблять CULTT/HTML/fetch без решения владельца.

---

## 25. Прозрачность + opt-in веб-поиска (2026-10-27)

### Добавлено
- Компактное пояснение под результатами (не баннер): сторонние ссылки; цену/наличие/подлинность у продавца; критерии — в «Что передано».
- Переключатель «Дополнить поиск ссылками из интернета» (default off; disabled если сервер `web_search.enabled=false`).
- Сервер вызывает Ollama web_search **только** при `body.web_search === true` ∧ `WEB_SEARCH_ENABLED`+ключ ∧ политика доменов. Ключ сам по себе не включает.
- В Ollama уходит только строка `query` (+ `max_results`); фото/история/избранное не в payload.
- Публичные тексты: `about.html`, `contacts.html`, meta/hero — переходы, без оплаты за товары, без обещаний партнёрства и гарантий подлинности; без «мы ни за что не отвечаем».
- `docs/DATA_FLOW_SUMMARY.md` — фактическая сводка по данным.

### Не менялось
- Ограничения источников, фильтр кэша, нет raw fallback, UI «Что передано» / группы / копирование.
- `OLLAMA_WEB_FETCH` не включается переключателем; HTML-сбор не включается.
- Локальный parse+links работает без веба.

### Проверки (целевые)
`node --test test/web-search-opt-in.test.js test/result-actions.test.js`  
Полный npm test / verify-prod — **не** гонялись. Commit/push/deploy/секреты — **не** трогали.

### Открытые вопросы по данным
См. §6 в `docs/DATA_FLOW_SUMMARY.md` (контакт, условия Ollama Cloud, хранение на хостинге, поведение сайтов после перехода).
