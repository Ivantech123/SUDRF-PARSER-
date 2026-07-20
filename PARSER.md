# Парсер без веба и аналитики

**Автор:** Андреев Иван · связь: [https://t.me/IBlog_Ivan](https://t.me/IBlog_Ivan)

Этот репозиторий можно использовать **только как парсер** ГАС «Правосудие»: без UI (`web/`), без RAG, без кабинета/OAuth и без аналитических MCP-инструментов. Ниже — что считать ядром и минимальные команды запуска.

Подробная статья и блок-схемы: **[README.md — Как работает парсер](README.md#как-работает-парсер)**.


## Что входит в «ядро парсера»

| Слой | Путь | Назначение |
|------|------|------------|
| HTTP Tier 1 | `src/sudrf/http.ts`, `parsers.ts` | Расписание заседаний и (где возможно) поиск без браузера |
| Browser Tier 2 | `src/sudrf/scraper.ts`, `captcha.ts` | Расширенный поиск с капчей (Playwright + ddddocr) |
| Карточка дела | `src/sudrf/case-parser.ts` | Участники, движение, тексты актов |
| Фасад | `src/sudrf/index.ts` (`SudrfClient`) | Единый API: schedule / search / getCaseDetails |
| Каталог | `src/cases/` | `cases-store.json` — накопление карточек |
| Планировщики | `src/parser/scheduler.ts`, `tier2-scheduler.ts` | Автосбор Tier 1 / Tier 2 |
| Go worker | `parser-worker/` | Быстрый concurrent сбор расписаний → тот же каталог |

**Не обязательно для парсинга:** `web/`, `src/analytics/`, `src/rag/`, `src/auth/` (кабинет/OAuth), фронтовые docs API.

Регион задаётся только через env (`PARSER_REGION`, `DISPLAY_REGION`) — в коде нет зашитого субъекта РФ.

## Методология парсинга

### Tier 1 — расписание (без капчи)

1. URL вида  
   `/{subdomain}.sudrf.ru/modules.php?name=sud_delo&srv_num=1&H_date=DD.MM.YYYY`
2. Ответ — HTML в Windows-1251 → декод (`iconv-lite`).
3. Таблица `#tablcont`: номер дела, время, зал, судья, стороны из `<br>`-ячеек.
4. Антибот (Qrator/WebKnight) → ошибка/пустой docket; для карточек возможен откат на браузер.

Подходит для **текущих** заседаний и пополнения каталога «что назначено». Не покрывает всю историю дел.

### Tier 2 — расширенный поиск (капча)

1. Форма `name_op=sf`, submit → `name_op=sr` / результаты `name_op=r`.
2. Капча: PNG data-URI (иногда с пробелами в префиксе) → OCR (`ResidentDdddocrSolver`) → опционально 2Captcha.
3. Фильтры нормализуются в поля категории (`g2_`, `u2_`, …) через `buildSearchParams`.
4. Выдача **постраничная** (`page=2..N`, ~25 строк/страница): после одной капчи страницы листаются в той же сессии браузера.
5. Карточки из выдачи пишутся в каталог; обогащение (`getCaseDetails`) — отдельным HTTP/браузерным проходом.

Категории (`delo_id`): гражданские `5`, уголовные `4`, КоАП `1540006`, КАС `1540005`, апелляция `41`, …

### Карточка дела

- `cont1` — реквизиты; у апелляций номер часто только в шапке акта («Дело №…»).
- `cont3` / `cont4` — движение / участники: первая строка таблицы — заголовок секции, колонки со **второй** строки.
- Имя акта — regex по типу (РЕШЕНИЕ / ОПРЕДЕЛЕНИЕ / …), не резать по `\. ` (ломается на «г. …»).

### Массовый сбор (тактика)

1. Discovery (Tier 2 + пагинация) → много карточек быстро.  
2. Enrich (Tier 1 HTTP по `caseUrl`) — фоном.  
3. Параллель по **судам** (не по страницам одного запроса).  
4. Progress/resume по ключу `court|delo|dateFrom|dateTo`.  
5. Регион/список судов — через `PARSER_REGION` / `COURTS` / аргументы скриптов.

## Запуск «только парсер»

### A. MCP stdio (локальный клиент) — без HTTP-кабинета

```bash
npm install
npx playwright install chromium
pip install ddddocr pillow
npm run build

# stdio по умолчанию — без MCP_TRANSPORT=http
node dist/index.js
```

Отключить автосбор:

```bash
AUTO_PARSER=0 node dist/index.js
```

### B. Автосбор каталога без веба

```bash
MCP_TRANSPORT=http
MCP_PORT=8080
MCP_BIND=127.0.0.1
AUTO_PARSER=1
AUTO_TIER2=1
PARSER_REGION=77          # код субъекта РФ или оставь пустым / задай суды явно
# PARSER_TIER2_COURTS=mosgorsud,butyrsky--msk
SUDRF_HEADLESS=1
```

Каталог: `SUDRF_CASES_PATH` (по умолчанию `./cases-store.json`).

### C. Go Tier-1 worker + Node enrich

```bash
npx tsx scripts/export_courts_json.ts
cd parser-worker && go build -o sudrf-parser-worker .
PARSER_REGION=77 ./sudrf-parser-worker
```

В Node:

```bash
PARSER_WORKER_URL=http://127.0.0.1:8090
AUTO_PARSER=1
```

### D. Программный вызов без сервера

Поддомен суда бери с sudrf.ru (адрес вида `*.sudrf.ru`).

```ts
import { SudrfClient } from "./dist/sudrf/index.js";

const client = new SudrfClient({ headless: true });
const court = "mosgorsud"; // пример: подставь нужный subdomain
const schedule = await client.getHearingSchedule(court, "20.07.2026");
const found = await client.searchCases(court, 5, {
  entryDateFrom: "01.01.2023",
  entryDateTo: "31.12.2023",
});
const card = await client.getCaseDetails(court, found.results[0]!.caseUrl!);
await client.close();
```

## Что сознательно отключить

| Переменная / действие | Эффект |
|----------------------|--------|
| не ставить `MCP_TRANSPORT=http` | нет веб-кабинета и статики |
| не деплоить `web/` | нет UI |
| `AUTO_PARSER=0` | нет фоновых планировщиков |
| не вызывать RAG tools | нет индексного поиска по текстам |
| игнорировать `src/analytics/` | нет coverage/ETA в продукте |

Ядро остаётся: **SudrfClient + catalog + (опционально) scheduler/worker**.

## Лицензия

См. [LICENSE](LICENSE): бесплатно в любых объёмах; при прибыли **с парсера как продукта** — 10% от чистой прибыли правообладателю.

**Автор:** Андреев Иван · **Telegram:** [https://t.me/IBlog_Ivan](https://t.me/IBlog_Ivan)

