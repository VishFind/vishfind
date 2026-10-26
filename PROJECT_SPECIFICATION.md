# PROJECT_SPECIFICATION.md — Техническая документация VishFind

> Версия документа: 1.0 (после производственной подготовки V1, октябрь 2026).
> Назначение: полное описание проекта для разработчика или ИИ-ассистента без необходимости общаться с владельцем.
> Важно: документ описывает **фактическое текущее состояние кода**. Там, где поведение отличается от ранних демо-версий, это явно помечено.

---

## 1. Общее описание проекта

**VishFind** — AI-поисковик редкой, винтажной и дизайнерской одежды, ориентированный на подростков и молодых людей.

### Пользовательский сценарий

1. **Ввод запроса.** Пользователь описывает вещь словами (например, «чёрная куртка до 15 000, размер M») или загружает фото одежды.
2. **Анализ.** Система разбирает запрос: выделяет тип вещи, цвет, размер, бюджет, бренд. Если загружено фото (локальный AI-режим с Ollama) — распознаёт признаки одежды: тип, подтип, цвет, материал, фасон, детали, читаемый текст, бренд и модель только если они **видны на фото**.
3. **Результат.** Пользователь получает:
   - разобранные критерии вещи (панель «Критерии запроса»);
   - ссылки на поиск похожих вещей на маркетплейсах (Ozon, Wildberries, Яндекс Маркет, Avito, Lamoda, Zara, eBay и др.);
   - предложения: реальные из eBay (если настроены ключи) и честно помеченные демо-примеры.
4. **Будущее.** Сравнение цен, реальные товары и цены с маркетплейсов через официальные API/партнёрские программы, избранное, история поиска (этапы V2–V4 в разделе 8).

### Принципы проекта (нельзя нарушать)

- Стек — **Node.js без npm-зависимостей** (никаких новых пакетов без явного согласования).
- Бюджет разработки 0: бесплатные/официальные API, без платных ключей по умолчанию.
- **Секреты только в переменных окружения** (`.env`/панель хостинга). `.env` не коммитится.
- **Не выдумываем цены, наличие и товары.** Сайт не является магазином; по ссылкам пользователь смотрит цену сам.
- Не скрейпим маркетплейсы — только официальные API и переходы.
- Провал разбора фото **не подменяем фиктивным успехом** (честный `502` и `photo_used:false`).
- Бренд и модель на фото — **только** если логотип/надпись читаются. Не угадывать по силуэту.
- Отказ внешнего сервиса (eBay/Ollama) **не роняет поиск** — работает фолбэк.

---

## 2. Текущий стек

| Слой | Технология | Примечание |
|---|---|---|
| Запуск | **Node.js 18+** (в `package.json` `engines`; на Amvera Node 20) | Без фреймворков: один процесс `server.js` на встроенном `http` |
| Пакетный менеджер | **npm** | Зависимостей нет; `npm install` безопасен и пуст |
| Сервер | [`server.js`](server.js:1) | HTTP-сервер, API, статика, rate limit, security-заголовки |
| Фронтенд | **HTML, CSS, JavaScript** | `index.html`, `about.html`, `contacts.html`, `css/`, `js/` (без сборщика; `css/public.bundle.css` — локальная копия) |
| Разбор текста | [`lib/parse-query.js`](lib/parse-query.js) | Правила + словари `movies.json`, `data/brands.json` |
| Провайдеры | [`providers/`](providers/index.js:1) | `links.js` (ссылки, включён), `websearch.js` (выключен), `ebay.js` (опционально) |
| Предложения | [`lib/offers.js`](lib/offers.js:1) + `data/demo-offers.json` | Демо-каталог с честной пометкой `is_demo` |
| Локальный AI | **Ollama** + vision-модель **`qwen3-vl:4b-instruct`** | Только локальная разработка; в облаке выключен |
| Настройки | [`lib/config.js`](lib/config.js:1) | Центральная конфигурация, разделение dev/prod через `NODE_ENV` |
| Логи | [`lib/logger.js`](lib/logger.js:1) | JSON-строки в stdout, санитизация секретов и персональных данных |
| Тесты | `node --test` (`npm test`) | `test/color-priority.test.js`, `test/ebay.test.js`, `test/offers.test.js`, `test/logger.test.js`, `test/rate-limit.test.js` |
| Git | **Git + GitHub** | Репозиторий `https://github.com/VishFind/vishfind.git`, ветка `main`, локальная папка `C:\AI\ai-demo` |
| Хостинг | **Amvera Cloud** | Демо-версия сайта; конфигурация в [`amvera.yml`](amvera.yml:1) |

---

## 3. Архитектура проекта

### Текстовая схема потока

```
Пользователь
   │  (текст и/или фото)
   ▼
Фронтенд (index.html + js/search.js)
   │  POST /api/search (JSON)
   ▼
server.js (Node.js http)
   ├── rate limit (lib/rate-limit.js) ── настраивается через lib/config.js
   ├── валидация и лимит тела (64 КБ prod / ~9 МБ dev)
   ├── разбор текста правилами (lib/parse-query.js + movies.json + data/brands.json)
   ├── провайдер ссылок (providers/links.js + data/sources.json)
   ├── предложения (lib/offers.js + data/demo-offers.json)
   ├── eBay (providers/ebay.js) — опционально, фолбэк при недоступности
   └── (dev) Ollama vision для фото: qwen3-vl:4b-instruct
        │  POST {OLLAMA_URL}/api/chat, JSON Schema, temperature 0, timeout 90 с
        ▼
Результат: parsed + sources + offers + photo → фронтенд
```

### Роль файлов и папок

| Путь | Роль |
|---|---|
| [`server.js`](server.js:1) | Главный файл: HTTP-сервер, маршруты `/api/health`, `/api/search`, `/api/find`, статика, security-заголовки, защита служебных путей, лимиты, обработчики непойманных ошибок. Экспортирует `mergeVisionIntoParsed`, `applyAttributes` для юнит-тестов. |
| [`package.json`](package.json:1) | Манифест: имя `isearch-demo`, `private`, скрипты `start` (`node server.js`), `test` (`node --test`), `compare-photo`; `engines.node >= 18`. |
| [`amvera.yml`](amvera.yml:1) | Конфигурация деплоя Amvera: среда `nodejs`, npm Node 20, артефакты `*` → `/`, запуск `npm run start`, `persistenceMount: /data`, `containerPort: "80"`, `singleton: true`, `zeroDowntime: false`. Подробнее — в `AMVERA_DEPLOYMENT.md`. |
| [`.env.example`](.env.example:1) | Шаблон переменных окружения (без секретов). Секции Development (Ollama) и Production (публичный деплой). |
| [`index.html`](index.html:1) | Главная страница: поисковая форма, поле `#q`, кнопка «Искать», кнопка «Фото» (`#btn-photo`), блоки результатов. |
| `about.html` | Страница «О проекте». |
| `contacts.html` | Контакты. ВАЖНО: перед публикацией заменить заглушку `YOUR_EMAIL@example.com`. |
| `css/` | `site.css` (основные стили, светлая/тёмная тема), `fonts.css` (подключение шрифтов), `public.bundle.css` (копия стилей). |
| `fonts/` | Локальные woff2-шрифты (Inter, Manrope, Literata). |
| `images/`, `img/` | Логотипы, favicon, общие изображения. `img/` содержит только `.gitkeep` (локальные фото не в Git). |
| `js/` | `search.js` (логика поиска: отправка запроса, обработка результата, рендер карточек, сжатие фото), `main.js`, `theme.js` (тёмная тема, `localStorage isearch-theme`). |
| `lib/` | `config.js` (все настройки), `logger.js` (санитизированные логи), `parse-query.js` (разбор текста), `offers.js` (демо-предложения), `rate-limit.js` (скользящее окно). |
| `providers/` | `index.js` (реестр провайдеров), `links.js` (построение URL площадок), `websearch.js` (выключен), `ebay.js` (Browse API, circuit breaker). |
| `data/` | `brands.json` (словарь брендов), `sources.json` (площадки и шаблоны URL), `demo-offers.json` (демо-каталог). Не отдаются как статика. |
| `movies.json` | Словарь образов из фильмов (для запросов вида «как у героя фильма»). |
| `scripts/` | `compare-photo-pipelines.js` (локальное сравнение schema/twopass), `smoke-public.js` (проверка публичной выкладки: `/.env` → 403, кнопка «Фото» скрыта), `verify-prod.js` (полная проверка production-режима). |
| `test/` | Тесты Node test runner. |
| `plans/` | `vishfind-production-spec.md` — архитектурная спецификация production-версии. |
| `screenshots/` | Скриншоты разных состояний интерфейса. |

### Модуль поиска

1. `js/search.js` отправляет `POST /api/search` с `{ query, image?, attributes?, attributes_priority? }`.
2. `server.js` разбирает текст через `lib/parse-query.js` (правила + `movies.json` + `data/brands.json`), применяет ручные `attributes` (текст пользователя важнее догадок модели).
3. Из полей собирается поисковая фраза (`buildSearchPhrase`).
4. `providers/links.js` строит URL по шаблонам `data/sources.json` (только источники с `verified: true`).
5. `lib/offers.js` подбирает демо-предложения по скору (категория/бренд/цвет/размер, бюджет, наличие).
6. `providers/ebay.js` (если настроен) добавляет реальные предложения первыми.

---

## 4. API

Базовые правила:
- Ответы — JSON (`application/json; charset=utf-8`), всегда с security-заголовками и `Cache-Control: no-store`.
- Rate limit: **20 запросов в минуту на IP** для `/api/search` и `/api/find` (настраивается через `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SEC`). При превышении — `429` + заголовок `Retry-After` + `{error, retry_after_sec}`. `/api/health` и статика **не** лимитируются.
- Определение IP: заголовок `X-Forwarded-For` используется только при `TRUST_PROXY=true` (шаблон для production за прокси Amvera), иначе — `socket.remoteAddress`.
- Лимит тела: production 64 КБ; development с AI — ~9 МБ (base64-фото).

### 4.1. `GET /api/health`

**Назначение:** статус сервиса для мониторинга платформы и фронтенда (фронтенд использует поле `ai_enabled`, чтобы показывать/прятать кнопку «Фото»).

**Вход:** нет.

**Ответ `200`** (пример, текущая версия):

```json
{
  "ok": true,
  "name": "vishfind",
  "version": "1.0.0",
  "env": "production",
  "uptime_sec": 42,
  "timestamp": "2026-10-26T15:00:00.000Z",
  "ai_enabled": false,
  "web_search": null,
  "providers": [
    { "id": "links", "enabled": true },
    { "id": "websearch", "enabled": false }
  ],
  "ebay": {
    "configured": false,
    "circuit_open": false,
    "fails": 0,
    "threshold": 3,
    "last_success_at": null,
    "last_error_at": null,
    "last_check_at": null
  },
  "message": "AI выключен. Работает текстовый поиск /api/search."
}
```

**Поведение:**
- Health **не вызывает** внешние сервисы (Ollama/eBay) — состояние берётся из кэша/счётчиков. Это осознанное решение production-версии: health обязан быть мгновенным и не «падать» из-за внешних сервисов.
- Поля `ollama`, `model`, `modelInstalled`, `aiEnabled` (camelCase) из ранней демо-версии **больше не возвращаются**. Актуальное поле — `ai_enabled` (snake_case).
- Секреты и детали ошибок наружу не попадают (у eBay отдаются только `configured`, `circuit_open`, `fails`, `threshold`, времена).

**При ошибке:** HTTP-сервер должен отвечать `200` при живом процессе (деградация eBay не делает health «красным»).

### 4.2. `POST /api/search` — основной поиск

**Назначение:** разбор запроса (текст и/или фото) → критерии вещи → ссылки на площадки → предложения.

**Вход (JSON-тело, `Content-Type: application/json`):**

```json
{
  "query": "чёрная куртка до 15000 размер M",
  "image": "data:image/jpeg;base64,...",
  "attributes": { "category": "куртка", "color": "чёрный" },
  "attributes_priority": false
}
```

| Поле | Тип | Назначение |
|---|---|---|
| `query` | string, ≤ 300 символов | Текстовое описание вещи |
| `image` | string | Data URI фото (`data:image/jpeg;base64,...`). Сервер срезает префикс, оставляет чистый base64. Только при `AI_ENABLED=true`, иначе — 503 |
| `attributes` | object | Ручные/сохранённые критерии; заполняют **только пустые** поля текста |
| `attributes_priority` | boolean | `true` — поля из `attributes` главнее текста (кнопка «Искать снова») |

**Обязательно** хотя бы одно из: `query`, `image`, `attributes`. Длина `query` > 300 → `400`.

**Поток (text-only, prod):**
1. Rate limit → валидация JSON и полей.
2. `parseQuery(query, { movies, brands })` → `parsed` (budget, size, color, category, brand, movie, rest, search_phrase).
3. Если `search_phrase` пуст → **422** с `{error, parsed, keep_text_input:true}`.
4. `providers.runEnabled` → ссылки на площадки (`sources`).
5. `offersApi.findOffers` (демо-каталог) + eBay (если настроен).
6. Ответ `200`.

**Поток с фото (dev, `AI_ENABLED=true`):**
1. Клиент сжимает фото заранее (длинная сторона ≤ 1024 px, JPEG quality 0.82, форматы jpg/png/webp/gif, исходник ≤ 8 МБ).
2. Сервер вызывает `analyze(query, imageB64, movie)` → Ollama `/api/chat` с JSON Schema, `temperature: 0`, `stream: false`, `think: false`, таймаут 90 секунд.
3. Модель возвращает JSON по схеме (поля ниже).
4. Сервер чистит мусор («не указано», строка `"null"`, догадки бренда), слегка переводит частые английские ярлыки (`jacket`→`куртка`, `red`→`красный`), сливает с `parsed` (текст пользователя побеждает).
5. При неудаче — **502**, `photo_used: false`, `keep_text_input: true`, честное сообщение (без фиктивного разбора).

**Формат JSON-ответа модели (JSON Schema `PHOTO_FORMAT`, поля — snake_case):**

`garment_type`, `subtype`, `color_primary`, `color_extra[]`, `material`, `pattern`, `collar`, `closure`, `pockets`, `length`, `fit`, `hardware_and_details`, `era_or_style`, `visible_text[]`, `brand`, `model_name`, `description`.

Правила для модели: все значения на русском (кроме `visible_text` — дословно), `null` вместо строки `"null"`, `brand`/`model_name` только если читаются на фото, при отсутствии одежды — `garment_type=null` и честное описание. (В интерфейсе и ранних заметках встречаются camelCase-названия `garmentType`, `colorPrimary` и т.п. — в JSON фактически используются snake_case.)

**Ответ `200`:**

```json
{
  "parsed": { "budget": 15000, "size": "M", "color": "чёрный", "category": "куртка", "brand": null, "movie": null, "rest": null, "search_phrase": "чёрный куртка" },
  "photo": null,
  "photo_pipeline": null,
  "sources": [ { "id": "ozon", "name": "Ozon", "url": "https://www.ozon.ru/search/?text=..." } ],
  "offers": {
    "is_demo": true,
    "note": "Предложения: eBay (реальные) + демо-примеры из data/demo-offers.json.",
    "ebay_error": null,
    "items": [ { "id": "...", "source": "eBay", "title": "...", "price": 89.99, "currency": "USD", "is_demo": false }, { "...": "демо-позиции со score" } ]
  },
  "photo_used": false,
  "prices": null,
  "prices_note": "Цены товаров не показываем...",
  "note": "Это переходы на поиск площадок, цены и наличие не проверялись",
  "providers": [ { "id": "links", "enabled": true }, { "id": "websearch", "enabled": false } ]
}
```

**Коды ошибок:**
- `400` — некорректный JSON / пустой запрос / слишком длинный `query` / фото при `AI_ENABLED=false` → `503` (для фото с сообщением);
- `413` — тело больше лимита (с `Connection: close`);
- `422` — не удалось распознать признаки (есть `parsed` и `keep_text_input`);
- `429` — превышен rate limit (+ `Retry-After`);
- `502` — фотоанализ не удался (таймаут/нет одежды/Ollama недоступна), `photo_used: false`;
- `500` — внутренняя ошибка (детали только в лог).

### 4.3. `POST /api/find` — старый путь (Ollama + фото)

**Назначение:** исторический endpoint фотоанализа. Сейчас **выключен** — код сохранён в `server.js`, но по умолчанию отвечает отказом.

**Поведение при `AI_ENABLED=false`:** `503` с сообщением «Анализ через AI сейчас выключен... Используйте POST /api/search», поле `ai_enabled: false`.

**Поведение при `AI_ENABLED=true` (локально):** принимает `{ query, image }`, вызывает тот же `analyze()`, возвращает `analysis`, `movie`, `links`, `results`, `search_provider`, `warnings`, `took_sec`. При ошибке — `502`.

**Rate limit:** тот же, что у `/api/search`.

---

## 5. Локальный AI-режим (Ollama)

- Адрес: `OLLAMA_URL=http://127.0.0.1:11434` (только localhost).
- Модель: **`qwen3-vl:4b-instruct`** (тег с двоеточием; в некоторых заметках ошибочно пишут `qwen3-vl4b-instruct` — правильно именно `qwen3-vl:4b-instruct`).
- Установка: `ollama pull qwen3-vl:4b-instruct` (~3.3 ГБ); проверка: `ollama list`.
- Почему 4b-instruct: 2b без суффикса `-instruct` кладёт ответ в `thinking` с пустым `content`; 8b — впритык для 8 ГБ VRAM (RTX 4060 Ti).
- `PHOTO_PIPELINE=schema` (по умолчанию): `schema` — один проход в JSON Schema; `twopass` — свободное описание → JSON без картинки; `auto` — schema, при скудном результате twopass.
- `PHOTO_TIMEOUT_SEC=90`, `OLLAMA_TIMEOUT_SEC=90` (таймаут одного вызова; фото с клиента ждут до ~100 с).
- Формат запроса к Ollama `/api/chat`:

```json
{
  "model": "qwen3-vl:4b-instruct",
  "messages": [{ "role": "user", "content": "<промпт>", "images": ["<base64>"] }],
  "stream": false,
  "format": "<JSON Schema PHOTO_FORMAT>",
  "think": false,
  "options": { "temperature": 0, "num_predict": 900 },
  "keep_alive": "30m"
}
```

- Требования контракта: `temperature 0`, `stream false`, `think false`, таймаут 90 с, на выходе строгий JSON. При `400` от модели со схемой — фолбэк на `format: "json"`.
- Поведение при недоступности Ollama: честный `502`, `photo_used:false`, сообщение «Ollama не запущена...». Провал **не** подменяется фиктивным успехом.
- `scripts/compare-photo-pipelines.js` сравнивает schema/twopass локально.

### Почему в Amvera AI отключён

- Ollama запущена на компьютере разработчика и слушает `127.0.0.1:11434`.
- **Amvera не имеет доступа к localhost компьютера разработчика** — облачный контейнер изолирован.
- Для работы AI в облаке нужен отдельный VPS с Ollama (с HTTPS и авторизацией) либо облачная vision-модель по API — это отдельные будущие этапы, сейчас не подключены.

---

## 6. Поиск по маркетплейсам

### Текущий режим: `links:on`

- `providers/links.js` строит прямые URL поиска на площадки из шаблонов `data/sources.json`.
- Используются только источники с `verified: true`.
- Поддерживаются: Ozon (`/search/?text={q}`), Wildberries (`/catalog/0/search.aspx?search={q}`), Яндекс Маркет (`/search?text={q}` + фильтр цены `priceto` при бюджете и `price_filter_verified`), Avito, Lamoda, Zara, eBay и др.
- К ссылкам не подставляются выдуманные цены; если фильтр цены непроверен — честная `price_filter_note`.
- Сервер **не** ходит в сеть при построении ссылок.

### Как работает `lib/parse-query.js`

Правила: выделяет бюджет («до 15 000», «тыс/т.р./к»), размер («размер M», «48»), цвет, категорию, бренд (словарь `data/brands.json`), образ из фильма (`movies.json`). Из полей собирается `search_phrase` через `buildSearchPhrase`.

### Будущие интеграции

- **Ozon, Wildberries, Яндекс Маркет, Avito** — партнёрские программы и официальные API (без скрейпинга как основной стратегии).
- **eBay** — уже реализован провайдер `providers/ebay.js` (Browse API, реальные предложения первыми), ожидает ключи.
- **Кэширование цен и товаров** — на этапе V2 (PostgreSQL).
- Правила: не обходить защиту сайтов, не выдумывать наличие/цены, партнёрские соглашения на этапе V4.

---

## 7. Текущий статус проекта

### Работает
- Поиск по тексту с разбором правил (`/api/search`), ссылки на площадки (`links:on`).
- Фронтенд: поиск, тёмная тема, страницы about/contacts, правка критериев, «Искать снова», копирование фразы, `?q=` в адресе.
- Локальный AI по фото через Ollama (кнопка «Фото» видна только при `ai_enabled: true`).
- eBay-провайдер (код, кэш, circuit breaker) — ждёт ключей.
- Производственная подготовка V1: конфиг dev/prod, санитизированные логи, rate limit с `Retry-After`, health без внешних вызовов, защита служебных путей, тесты (38 шт.).

### Отключено / не настроено
- В Amvera: `AI_ENABLED=false`, `WEB_SEARCH_ENABLED=false` (веб-поиск `websearch:off`).
- `/api/find` — выключен (отвечает 503 без AI).
- eBay — без ключей реальные предложения не запрашиваются (фолбэк на демо).

### Не реализовано
- База данных (PostgreSQL) — не подключена.
- Платежи — не подключены.
- Домен — не настроен (используется бесплатный домен Amvera).
- Реальные товары/цены с российских маркетплейсов.
- Аккаунты, история, избранное.

### Известные ограничения
- demo-предложения честно помечены `is_demo: true` и не являются реальными товарами;
- rate limit и circuit breaker живут в памяти одного процесса (один инстанс);
- корректное определение IP зависит от `TRUST_PROXY=true` за прокси Amvera;
- бесплатный тариф Amvera может засыпать после простоя;
- `contacts.html` содержит заглушку `YOUR_EMAIL@example.com`.

---

## 8. План развития

### Этап 1 — Фронтенд и анимации
- hero-блок, зона загрузки фото с drag-and-drop и превью;
- анимация «анализа», скелетоны карточек, плавное появление результатов;
- микроанимации, мобильная адаптивность.

### Этап 2 — Стабилизация локального AI
- проверка Ollama и `/api/health`, обработка ошибок, улучшение промпта и JSON Schema;
- тесты photo pipeline (`scripts/compare-photo-pipelines.js`).

### Этап 3 — Маркетплейсы
- ссылки (уже есть), партнёрские программы, официальные API, кэширование цен и товаров.

### Этап 4 — База данных (PostgreSQL)
- пользователи, история поиска, избранное, кэш, статистика; общий rate limit для нескольких инстансов.

### Этап 5 — Платежи
- ЮKassa / CloudPayments / Robokassa; бесплатные и платные лимиты, подписка.

### Этап 6 — eBay
- ожидание доступа к API;
- провайдер `providers/ebay.js` (готов), поиск, карточки результатов, цены.

---

## 9. Правила безопасности

- **Секреты — только в переменных окружения** (`.env` локально / панель Amvera). Никогда в HTML/JS/Git.
- `.env` не коммитить; сервер отдаёт `403` для `/.env` и служебных путей (`server.js`, `data/`, `lib/`, `providers/`, `test/`, `scripts/` и т.д.).
- API-ключи не вставлять во фронтенд (все внешние вызовы — только с сервера).
- **Не открывать Ollama в интернет** без HTTPS и авторизации — она слушает только `127.0.0.1`.
- Rate limit: 20/мин на IP, `Retry-After`, честное 429.
- Валидация входных данных: JSON, длина `query ≤ 300`, лимит тела (64 КБ prod / ~9 МБ dev), сжатие фото на клиенте (≤1024 px, ≤8 МБ исходник).
- Security-заголовки: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`, CSP (`script-src 'self' 'unsafe-inline'` — нужно из-за инлайн-скрипта темы).
- Логи санитизируются (`lib/logger.js`): секреты, base64-фото, полные IP, email/телефоны маскируются; тело запросов не логируется.
- Не скрейпить сайты; только официальные API.

---

## 10. Команды разработчика

### Установка и запуск
```powershell
cd C:\AI\ai-demo
copy .env.example .env      # создать локальный .env (секреты — в него)
npm install                 # зависимостей нет, команда безопасна
npm start                   # запуск: node server.js → http://localhost:3000
```
или напрямую:
```powershell
node server.js
```

### Тесты
```powershell
npm test                    # node --test — все 38 тестов
```

### Локальный AI (Ollama)
```powershell
ollama list                                  # список моделей
ollama pull qwen3-vl:4b-instruct             # скачать модель (~3.3 ГБ)
# в .env: AI_ENABLED=true, OLLAMA_URL=http://127.0.0.1:11434, PHOTO_PIPELINE=schema
node scripts/compare-photo-pipelines.js      # сравнение pipeline
```

### Проверка локального запуска
- Открыть http://localhost:3000 — главная страница.
- `GET http://localhost:3000/api/health` — JSON со статусом (`ok`, `ai_enabled`, `providers`, `ebay`).
- Ручной запрос:
```powershell
Invoke-RestMethod http://localhost:3000/api/search -Method Post -ContentType 'application/json' -Body '{"query":"чёрная куртка"}'
```

### Проверка production-режима
```powershell
node scripts/smoke-public.js     # BASE=http://127.0.0.1:3001 по умолчанию
node scripts/verify-prod.js      # поднимает сервер с NODE_ENV=production и проверяет всё
```

### Git
```powershell
git status                     # что изменилось
git add .                      # добавить файлы (НЕ добавлять .env — он в .gitignore)
git commit -m "сообщение"      # коммит (делать только с подтверждения владельца)
git push origin main           # публикация в GitHub → триггер сборки Amvera
```

### Быстрый запуск с другим портом (если 3000 занят)
```powershell
$env:PORT='3001'; node server.js
```

---

## 11. Как отдать документы другому ИИ-ассистенту

Этот раздел — для передачи проекта другому разработчику или ИИ-ассистенту (например, Cursor) без общения с владельцем. Два документа в корне репозитория описывают проект целиком: [`PROJECT_SPECIFICATION.md`](PROJECT_SPECIFICATION.md) (этот файл) и [`AMVERA_DEPLOYMENT.md`](AMVERA_DEPLOYMENT.md).

### Промпт-шапка для продолжения работы

Скопируйте и вставьте ассистенту:

````text
Ты работаешь с проектом VishFind — AI-поисковиком редкой, винтажной и
дизайнерской одежды. Код в папке C:\AI\ai-demo (Node.js без npm-зависимостей).

Сначала прочитай ДВА документа:
1. PROJECT_SPECIFICATION.md — полное описание проекта, архитектуры и API.
2. AMVERA_DEPLOYMENT.md — инструкция по деплою и эксплуатации в Amvera.

Правила работы:
- НЕ меняй backend (server.js, lib/, providers/, package.json, amvera.yml)
  без явного подтверждения владельца.
- Сначала предложи план изменений и получи подтверждение.
- Работай небольшими шагами; показывай, какие файлы изменил и как проверить.
- Сохраняй существующие API (/api/health, /api/search, /api/find),
  переменные окружения (NODE_ENV, PORT, HOST, AI_ENABLED, TRUST_PROXY,
  LOG_LEVEL, OLLAMA_*, EBAY_*) и логику (разбор текста правилами, честные
  ошибки, фолбэк при недоступности eBay/Ollama, демо-каталог с is_demo).
- Не добавляй npm-зависимости без согласования.
- Никогда не коммить секреты и .env: секреты только в переменных окружения.
- Факты проекта: модель qwen3-vl:4b-instruct; /api/health отдаёт поля
  ok, name, version, env, ai_enabled, ebay (без ollama/model/modelInstalled);
  поля модели — snake_case (garment_type, color_primary и т.д.).
- После изменений запускай: npm test и npm start.
- Проверяй: http://localhost:3000/api/health и главную страницу
  http://localhost:3000 (поиск, тёмная тема, мобильная вёрстка).
````

### Стартовый промпт для задачи «улучшить фронтенд и анимации»

````text
Задача: улучшить фронтенд VishFind — интерфейс и анимации.

Контекст: сначала прочитай PROJECT_SPECIFICATION.md (разделы «Архитектура»,
«Этап 1 — Фронтенд и анимации») и AMVERA_DEPLOYMENT.md.

Цели (этап 1 дорожной карты):
- hero-блок;
- зона загрузки фото с drag-and-drop и превью;
- анимация «анализа», скелетоны карточек, плавное появление результатов;
- микроанимации, мобильная адаптивность.

Ограничения:
- НЕ меняй логику отправки запросов и контракт API: js/search.js работает
  с POST /api/search; поля ответа: parsed, sources, offers, photo,
  photo_used, prices, note, providers.
- НЕ меняй server.js, lib/, providers/, package.json, amvera.yml.
- Сохраняй идентификаторы элементов DOM, которые использует js/search.js:
  input #q, кнопки #btn-submit и #btn-photo, файл #file-input, контейнеры
  результатов — их менять нельзя.
- Сохраняй тёмную тему (localStorage isearch-theme, js/theme.js), шрифты
  (fonts/, css/fonts.css), страницы about.html и contacts.html.
- Сначала предложи план: файлы, стили, анимации; затем работай мелкими шагами.
- После изменений проверь: desktop и mobile (DevTools), тёмную и светлую
  тему, текстовый поиск (статус 200), /api/health.
- Не добавляй новые npm-зависимости; не коммить без подтверждения владельца.
````

### Короткий чек-лист проверки перед сдачей работы ассистента

1. `npm test` — все тесты зелёные.
2. `npm start` — сервер запускается без ошибок.
3. `http://localhost:3000/api/health` — `ok: true` (и `ai_enabled` по факту среды).
4. Главная страница работает: поиск по тексту возвращает `sources` и `offers`.
5. Секреты не попали в код/логи/репозиторий; `.env` не закоммичен.
6. Изменения описаны: какие файлы, почему, как проверить.
