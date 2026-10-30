# VishFind

Поиск редкой и винтажной одежды по тексту и (опционально) фото.  
Сайт **не магазин**: сам ничего не продаёт, цены/наличие/подлинность **не проверяет** и **не обещает**.  
Результат — разбор критериев и **ссылки** на поиск сторонних площадок; при наличии ключей возможны live-предложения eBay, иначе демо-слой.

Прежнее рабочее имя в коде/ключах: **iSearch** (оставлено в части `localStorage`/описаниях для совместимости; пользовательское имя — VishFind).

**Дата актуализации:** 28 октября 2026.

---

## Стек (факт)

| Параметр | Значение |
|----------|----------|
| Runtime | Node.js **≥ 18** (локально проверено: v24.x) |
| Зависимости npm | **нет** (`package.json` без `dependencies`) |
| Запуск | `npm start` → `node server.js` |
| Сборка фронта | **нет** (статика HTML/CSS/JS) |
| Frontend | `index.html`, `about.html`, `contacts.html`, `css/`, `js/`, `images/`, `fonts/` |
| Backend | один процесс `server.js` + `lib/`, `providers/`, `data/` |
| Порт по умолчанию | `PORT=3000`, `HOST=0.0.0.0` |
| Локальный рабочий прогон | часто `HOST=127.0.0.1`, `PORT=3103` (не меняет дефолт в `.env.example`) |

---

## Быстрый старт

```powershell
cd C:\AI\ai-demo
copy .env.example .env
npm start
```

Откройте http://localhost:3000 (или ваш `PORT`).

Проверки:

```powershell
curl http://127.0.0.1:3000/api/health
curl -X POST http://127.0.0.1:3000/api/search -H "Content-Type: application/json" -d "{\"query\":\"чёрная куртка\"}"
```

Тесты: `npm test` (`node --test`).

---

## Переменные окружения

Шаблон: `.env.example`. Рабочий `.env` **не** коммитится и **не** кладётся в архивы/документы.

| Переменная | Dev-дефолт | Prod-дефолт | Назначение |
|------------|------------|-------------|------------|
| `NODE_ENV` | `development` | `production` | ветки config |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | платформа / `0.0.0.0` | HTTP bind |
| `AI_ENABLED` | `true` | **`false`** | фото + локальная Ollama |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | — | vision |
| `OLLAMA_MODEL` | `qwen3-vl:4b-instruct` | — | точный тег модели |
| `OLLAMA_TIMEOUT_SEC` / `PHOTO_TIMEOUT_SEC` | `90` | — | таймауты |
| `PHOTO_PIPELINE` | `schema` | — | `schema` / `twopass` / `auto` |
| `PHOTO_CONCURRENCY` | `1` | — | очередь фото |
| `WEB_SEARCH_ENABLED` | `false` | `false` | ollama.com web_search (нужен ключ) |
| `OLLAMA_WEB_FETCH` | `false` | `false` | опциональный web_fetch |
| `TRUST_PROXY` | `false` | `true` | IP за прокси |
| `LOG_LEVEL` | `debug` | `warn` | логи |
| `RATE_LIMIT_*` | 20 / 60 с | то же | лимит `/api/search`, `/api/find` |
| `EBAY_*` | пусто | пусто | опциональные live-offers |

**Раздельно:** vision через локальную Ollama ≠ внешний `web_search` на ollama.com. Ключ `OLLAMA_API_KEY` сам по себе web_search **не** включает.

---

## API

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/health` | статус без секретов и без внешних вызовов |
| `POST` | `/api/search` | основной поиск (текст; фото если `AI_ENABLED`) |
| `POST` | `/api/find` | устаревший путь; при выключенном AI — отказ |

Лимит тела: ~64 КБ без AI, до ~9 МБ с AI. Rate limit в памяти процесса.

---

## Поиск (кратко)

1. UI: текст ≤300, чипсы критериев, опционально фото.  
2. `POST /api/search` → `parse-query` → `mergeCriteria` → `selectSources` → сборка URL (`providers/links.js`, **без HTTP к магазинам**).  
3. Ответ: `sources`, предупреждения, `offers` (live eBay или demo).  
4. Опционально: web_search / web_fetch / html_product — только при явных флагах и политике реестра.

Подробности: `docs/FACTUAL_SITE_REPORT.md` (генерируется `scripts/build-factual-report.js`).

---

## ИИ

| Механизм | Сейчас |
|----------|--------|
| Vision (фото → критерии) | локальная Ollama, модель **`qwen3-vl:4b-instruct`**, concurrency 1 |
| Текстовый поиск | **без** модели |
| `web_search` | выключен по умолчанию; отдельный платный/квотируемый API |
| Production | `AI_ENABLED=false` — фото недоступно без внешнего inference |

Домашний ПК **не** считать постоянным production-сервером по умолчанию.

---

## Интерфейс

- Страницы: `/`, `/about.html`, `/contacts.html`
- Темы: `localStorage` ключ `vishfind-theme` (миграция с `isearch-theme`)
- История / избранное: только в браузере (`vishfind-history`, `vishfind-saved`)
- Логотип шапки: `images/logo-vishfind-light.png`, `images/logo-vishfind-dark.png`
- Favicon: `images/favicon.svg` — фирменный знак (лупа+галочка), без слова VishFind; геометрия из `images/logo-preview/vishfind-vectorized-clean.svg`

### Заставка (факт на 28.10.2026)

**Подключена к страницам:** `js/welcome-scene-data.js` + `js/welcome-splash.js` (не `js/logo-intro.js` — тот файл есть, но **не** подключён в HTML).

| Свойство | Статус |
|----------|--------|
| Источники SVGator | `svgator-work/light-document.json`, `dark-document.json` (платный SVG-экспорт не использовался) |
| Холст / длительность | 1200×680, ~4300 мс, один проход |
| Показ | один раз за сессию (`sessionStorage` `vishfind:welcome:seen:v1`) |
| Escape / reduced-motion / аварийный таймаут / снятие оверлея | реализованы в коде |
| Replay | `?welcome=replay` |
| Шрифт приветствия | Manrope; тексты: «Добро пожаловать в VishFind» / «Найдите то, что ищете» |
| Цвета | `#1D1D1D`, `#F5F5F5`, `#85C633` |
| Плавность прорисовки | **открытый вопрос** (нужна более плавная; геометрия исходника не должна меняться ради анимации) |
| «Полностью принята / финализирована» | **не утверждать** без отдельной приёмки владельца |

Черновики сравнения знака: `images/logo-preview/` (в т.ч. ручная коррекция) — **не** заменяют рабочие PNG шапки, пока не приняты.

---

## Документы

| Файл | Роль |
|------|------|
| `ПРОЕКТ-СВОДКА.md` | полный итог / снимок состояния |
| `ПРОЕКТ-ИНСТРУКЦИЯ.txt` | развёрнутая инструкция / handoff |
| `docs/FACTUAL_SITE_REPORT.md` | фактический отчёт (скрипт) |
| `docs/LEGAL_REVIEW_FACTS.md` | факты для юриста (не заключение) |
| `HOSTING_AI_BRIEF_RU.txt` | бриф другому ИИ по хостингу |
| `HOSTING_PROVIDER_REQUEST_RU.txt` | письмо в поддержку провайдера |
| `AMVERA_DEPLOYMENT.md` | заметки по Amvera (исторический профиль) |

---

## Хостинг (требования владельца, не оферта)

- Российские сервисы; бюджет **до 1000 ₽/мес** на сайт  
- Ориентир нагрузки: **20–50 тыс. пользовательских поисков/мес** (не путать с запросами статики)  
- Нужен **Node.js backend**, GitHub, автодеплой, HTTPS, server env, исходящие к нужным API  
- ИИ: (1) сайт + внешний inference API **или** (2) vision на инфраструктуре провайдера — **отдельный** расчёт; не обещать GPU+модель в 1000 ₽  

См. `HOSTING_*_RU.txt`. Публикация сайта **не** утверждается этим README.

---

## Безопасность (кратко)

Секреты только в env платформы / локальном `.env`. CSP и служебные пути закрыты в `server.js`. Фото не пишется на диск сервером как постоянное хранилище пользовательских альбомов. История/избранное — в браузере. Перед публикацией: контакты-заглушки, политика данных, выбор хостинга, решение по AI.
