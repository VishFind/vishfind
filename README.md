# VishFind

Поиск редкой и винтажной одежды: разбор текстового запроса правилами и переходы на поиск площадок (Ozon, Wildberries, Авито и др.).

**Цены и наличие не проверяются** — мы не парсим магазины и не выдумываем цифры. Смотрите цену после перехода.

Стек: один файл `server.js` на Node.js **без** `npm install` внешних пакетов.

## Требования

- Node.js **18+** (`engines` в `package.json`)

## Быстрый старт

```powershell
copy .env.example .env
npm start
```

Откройте http://localhost:3000

На хостинге платформа сама задаёт `PORT`. Сервер слушает `HOST` (по умолчанию `0.0.0.0`).

## Переменные окружения

Скопируйте `.env.example` → `.env`. Файл `.env` **не** коммитится. Настройки читаются через `lib/config.js`; разделение сред — по `NODE_ENV`.

| Переменная | По умолчанию (dev) | По умолчанию (prod) | Назначение |
|------------|--------------------|---------------------|------------|
| `NODE_ENV` | `development` | `production` | Включает ветки dev/prod |
| `PORT` | `3000` | из платформы | Порт HTTP |
| `HOST` | `0.0.0.0` | `0.0.0.0` | Адрес bind (`127.0.0.1` только локально) |
| `AI_ENABLED` | `true` | **`false`** | Кнопка «Фото» + Ollama. В production выключен по умолчанию |
| `TRUST_PROXY` | `false` | `true` | Доверять `X-Forwarded-For` (rate limit по IP) |
| `LOG_LEVEL` | `debug` | `warn` | `error` / `warn` / `info` / `debug` |
| `RATE_LIMIT_MAX` | `20` | `20` | Максимум запросов с одного IP за окно |
| `RATE_LIMIT_WINDOW_SEC` | `60` | `60` | Окно rate limit, секунды |
| `WEB_SEARCH_ENABLED` | `false` | `false` | Платный веб-поиск (не нужен) |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | — | Только при `AI_ENABLED=true` |
| `OLLAMA_MODEL` | `qwen3-vl:4b-instruct` | — | Vision-модель Ollama |
| `PHOTO_TIMEOUT_SEC` | `90` | — | Таймаут разбора одного фото |
| `PHOTO_PIPELINE` | `schema` | — | `schema` / `twopass` / `auto` |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | пусто | пусто | Реальные предложения eBay (опционально) |
| `EBAY_MARKETPLACE` | `EBAY_US` | `EBAY_US` | Площадка eBay |
| `EBAY_CIRCUIT_THRESHOLD` | `3` | `3` | Порог ошибок до открытия circuit breaker |
| `EBAY_CIRCUIT_COOLDOWN_SEC` | `60` | `60` | Пауза circuit breaker, секунды |

Ключи API — только в `.env`, не во frontend. В production без ключей сервис работает: демо-предложения + ссылки на площадки.

## API

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/health` | Статус без внешних вызовов и без секретов: `name`, `version`, `env`, `uptime_sec`, `ai_enabled`, `providers`, `ebay` |
| `POST` | `/api/search` | `{ "query": "…" }` → разобранные поля + ссылки на площадки + предложения |

Лимит: **20** запросов `/api/search` и `/api/find` с одного IP в минуту (настраивается). При превышении — `429` + заголовок `Retry-After`. Размер тела без AI — до **64 КБ**; с AI — до **~9 МБ** (фото).

## Логирование

Логи — JSON-строки в stdout (`lib/logger.js`). Секреты, base64-фото, полные IP и персональные данные маскируются; тело запроса никогда не логируется. Уровень — `LOG_LEVEL`.

## Структура

```
├── server.js          # HTTP-сервер и API
├── index.html         # Поиск
├── about.html / contacts.html
├── css/ js/ images/ fonts/
├── data/              # brands, sources, demo-offers (не отдаются как статика)
├── lib/               # config, logger, parse-query, rate-limit, offers
├── providers/         # ссылки на площадки, eBay, веб-поиск
├── scripts/           # утилиты сравнения фото (локально)
├── plans/             # архитектурная спецификация
├── .env.example
└── package.json       # npm start
```

## Фото (только локально)

1. Установите [Ollama](https://ollama.com), скачайте модель: `ollama pull qwen3-vl:4b-instruct`
2. В `.env`: `AI_ENABLED=true`
3. Перезапустите `npm start` — появится кнопка «Фото»

На типичном бесплатном Node-хостинге Ollama недоступна: для выкладки поставьте `AI_ENABLED=false` (кнопка «Фото» скроется, текст останется). Локально для полного функционала — `true`.

## Production deployment

### Минимальный набор переменных

| Переменная | Значение | Комментарий |
|------------|----------|-------------|
| `NODE_ENV` | `production` | Включает prod-дефолты |
| `PORT` | задаёт платформа | Не переопределяйте в `.env` |
| `HOST` | `0.0.0.0` | Слушать все интерфейсы |
| `AI_ENABLED` | `false` | Нет локальной Ollama на хостинге |
| `TRUST_PROXY` | `true` | Rate limit по реальному IP за прокси |
| `LOG_LEVEL` | `warn` | Ошибки видны, шума меньше |

Опционально: `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` — реальные предложения eBay; без них работает демо-слой.

### Шаги деплоя (пример: Render Free)

1. Создайте репозиторий (приватный) и запушьте код. **`.env` в репозиторий не попадает** (см. `.gitignore`).
2. На платформе создайте Web Service из репозитория:
   - Build Command: `npm install` (зависимостей нет, команда безопасна) или пусто;
   - Start Command: `npm start`;
   - Node version: 18+.
3. Задайте переменные окружения из таблицы выше (секреты — в защищённом хранилище платформы).
4. Health check платформы: `GET /api/health` — отвечает `200` без внешних вызовов.
5. Проверьте после деплоя:
   - `GET /api/health` → `ok: true`, `env: production`, `ai_enabled: false`;
   - `POST /api/search` с `{ "query": "чёрная куртка" }` → `200` с `sources` и `offers`;
   - `GET /.env` → `403` (служебные пути закрыты).

### Что важно знать

- **Один инстанс:** rate limit и circuit breaker хранятся в памяти процесса. Для первого деплоя одного инстанса достаточно; при масштабировании нужен общий счётчик (этап PostgreSQL).
- **eBay недоступен — сервис работает:** ошибки eBay не роняют поиск, возвращаются демо-предложения и ссылки; после 3 последовательных ошибок circuit breaker на 60 секунд прекращает запросы к eBay.
- **Фото в production выключено** по умолчанию; облачный фотоанализ — отдельный будущий этап.
- **Логи:** JSON-строки в stdout, секреты и персональные данные маскируются.
- **PostgreSQL, аккаунты, облачный фотоанализ, партнёрские каталоги** — следующие этапы (см. `plans/vishfind-production-spec.md`).

## Лицензия

Приватный проект.
