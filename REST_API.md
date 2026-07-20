# REST API Documentation

REST API для доступа к инструментам sudrf-mcp через стандартные HTTP-запросы. Все endpoints зеркалируют MCP-инструменты и используют ту же аутентификацию.

## Аутентификация

Все запросы к `/rest/*` требуют Bearer-токен в заголовке `Authorization`:

```bash
Authorization: Bearer <token>
```

**Поддерживаемые токены:**
- **OAuth access token** (префикс `oat_`) — выдаётся через OAuth-флоу (`/authorize` → `/oauth/token`)
- **Legacy cabinet key** — генерируется в личном кабинете (`/cabinet`)

При неудачной аутентификации вернётся `401 Unauthorized`.

## Base URL

```
http://localhost:8080/rest/
```

В продакшене замените на ваш публичный URL (например, `https://sudrf.example.com/rest/`).

## Endpoints

### 1. Список категорий дел

Получить список всех доступных категорий дел (delo_id) для использования в `search_cases`.

**GET** `/rest/list_case_categories`

**Response 200:**
```json
[
  {
    "id": 4,
    "label": "Уголовные дела",
    "name": "CRIMINAL",
    "vnkod": 0
  },
  {
    "id": 5,
    "label": "Гражданские дела",
    "name": "CIVIL",
    "vnkod": 0
  },
  ...
]
```

**cURL пример:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/rest/list_case_categories
```

---

### 2. Разрешение суда

Определить поддомен суда по названию, региону или vnkod.

**POST** `/rest/resolve_court`

**Request Body:**
```json
{
  "query": "Мордовия"
}
```

**Response 200:**
```json
{
  "subdomain": "vs--mor",
  "name": "Верховный Суд Республики Мордовия",
  "region": "Республика Мордовия",
  "type": "vs",
  "vnkod": "13RS0001",
  "captcha": true,
  "http": true
}
```

**Альтернатива (GET с query params):**
```bash
GET /rest/resolve_court?query=Мордовия
```

**cURL пример:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"Мордовия"}' \
  http://localhost:8080/rest/resolve_court
```

---

### 3. Расписание заседаний

Получить список дел на заседание на указанную дату (Tier 1, без капчи).

**POST** `/rest/get_hearing_schedule`

**Request Body:**
```json
{
  "court": "vs--mor",
  "date": "25.01.2025"
}
```

**Response 200:**
```json
{
  "court": "Верховный Суд Республики Мордовия",
  "date": "25.01.2025",
  "count": 15,
  "items": [
    {
      "caseNumber": "11-90/2024",
      "caseUid": "13RS0001-01-2024-000090-11",
      "parties": "Иванов И.И. vs ООО Компания",
      "category": "Гражданские дела",
      "judge": "Петров П.П.",
      "courtroom": "зал 3",
      "hearingTime": "10:00",
      "hearingDate": "25.01.2025",
      "caseUrl": "/modules.php?name=sud_delo&name_op=case&case_id=155820227"
    }
  ]
}
```

**cURL пример:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"court":"vs--mor","date":"25.01.2025"}' \
  http://localhost:8080/rest/get_hearing_schedule
```

---

### 4. Расширенный поиск дел

Поиск дел по различным критериям (Tier 2, с капчей).

**POST** `/rest/search_cases`

**Request Body:**
```json
{
  "court": "vs--mor",
  "delo_id": 5,
  "caseNumber": "2-1234/2024",
  "participantName": "Иванов",
  "entryDateFrom": "01.01.2024",
  "entryDateTo": "31.12.2024"
}
```

**Обязательные параметры:**
- `court` (string) — поддомен или название суда
- `delo_id` (number) — ID категории из `list_case_categories`

**Опциональные параметры:**
- `caseNumber` (string) — номер дела (например, `2-1234/2024`)
- `uid` (string) — УИД дела (формат: `XXWWXXXX-XX-XXXX-XXXXXX-XX`)
- `participantName` (string) — ФИО или название организации
- `inn` (string) — ИНН
- `kpp` (string) — КПП
- `ogrn` (string) — ОГРН
- `judge` (string) — ФИО судьи
- `entryDateFrom` (string) — дата поступления от (DD.MM.YYYY)
- `entryDateTo` (string) — дата поступления до
- `resultDateFrom` (string) — дата решения от
- `resultDateTo` (string) — дата решения до
- `lawArticle` (string) — статья закона

**Response 200:**
```json
{
  "court": "Верховный Суд Республики Мордовия",
  "category": "Гражданские дела",
  "total": 3,
  "results": [
    {
      "caseNumber": "2-1234/2024",
      "caseUid": "13RS0001-01-2024-001234-02",
      "category": "Иски о взыскании задолженности",
      "plaintiff": "Иванов И.И.",
      "defendant": "ООО Компания",
      "judge": "Петров П.П.",
      "entryDate": "15.03.2024",
      "resultDate": "20.04.2024",
      "status": "Решение вступило в законную силу",
      "caseUrl": "/modules.php?name=sud_delo&name_op=case&case_id=155820227"
    }
  ]
}
```

**cURL пример:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"court":"vs--mor","delo_id":5,"participantName":"Иванов"}' \
  http://localhost:8080/rest/search_cases
```

---

### 5. Детали дела

Получить полную карточку дела со всеми судебными актами (Tier 1).

**POST** `/rest/get_case_details`

**Request Body:**
```json
{
  "court": "vs--mor",
  "caseUrl": "/modules.php?name=sud_delo&name_op=case&case_id=155820227",
  "includeDocumentText": true
}
```

**Параметры:**
- `court` (string) — поддомен или название суда
- `caseUrl` (string) — путь или полный URL карточки дела (из `search_cases` или `get_hearing_schedule`)
- `includeDocumentText` (boolean, optional) — включить полный текст актов (по умолчанию `true`). Установите `false` для получения только метаданных.

**Response 200:**
```json
{
  "caseNumber": "11-90/2024",
  "caseUid": "13RS0001-01-2024-000090-11",
  "category": "Гражданское дело",
  "court": "Верховный Суд Республики Мордовия",
  "plaintiff": "Иванов Иван Иванович",
  "defendant": "ООО Компания",
  "judge": "Петров П.П.",
  "entryDate": "15.03.2024",
  "resultDate": "20.04.2024",
  "status": "Решение вступило в законную силу",
  "firstInstance": {
    "court": "Саранский городской суд",
    "caseNumber": "2-500/2024",
    "judge": "Сидоров С.С."
  },
  "participants": [
    {
      "role": "ИСТЕЦ",
      "name": "Иванов Иван Иванович",
      "inn": "123456789012"
    },
    {
      "role": "ОТВЕТЧИК",
      "name": "ООО Компания",
      "inn": "7701234567",
      "kpp": "770101001",
      "ogrn": "1234567890123"
    }
  ],
  "events": [
    {
      "date": "15.03.2024",
      "time": "10:00",
      "name": "Поступление в суд",
      "result": "Принято к производству"
    }
  ],
  "documents": [
    {
      "docId": "1",
      "name": "АПЕЛЛЯЦИОННОЕ ОПРЕДЕЛЕНИЕ",
      "caseNumber": "11-90/2024",
      "date": "20.04.2024",
      "text": "ВЕРХОВНЫЙ СУД РЕСПУБЛИКИ МОРДОВИЯ\n\nАПЕЛЛЯЦИОННОЕ ОПРЕДЕЛЕНИЕ\n\n...",
      "url": null
    }
  ],
  "caseUrl": "/modules.php?name=sud_delo&name_op=case&case_id=155820227"
}
```

**cURL пример:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"court":"vs--mor","caseUrl":"/modules.php?name=sud_delo&name_op=case&case_id=155820227"}' \
  http://localhost:8080/rest/get_case_details
```

---

### 6. Индексация дела в RAG-корпус

Загрузить карточку дела и добавить тексты судебных актов в локальный поисковый корпус.

**POST** `/rest/index_case`

**Request Body:**
```json
{
  "court": "vs--mor",
  "caseUrl": "/modules.php?name=sud_delo&name_op=case&case_id=155820227",
  "replace": false
}
```

**Параметры:**
- `court` (string) — поддомен или название суда
- `caseUrl` (string) — путь карточки дела
- `replace` (boolean, optional) — переиндексировать, если дело уже есть (по умолчанию `false`)

**Response 200:**
```json
{
  "caseUid": "13RS0001-01-2024-000090-11",
  "caseNumber": "11-90/2024",
  "court": "Верховный Суд Республики Мордовия",
  "chunksAdded": 12,
  "alreadyIndexed": false,
  "corpusSize": 450,
  "corpusCases": 38
}
```

**cURL пример:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"court":"vs--mor","caseUrl":"/modules.php?name=sud_delo&name_op=case&case_id=155820227"}' \
  http://localhost:8080/rest/index_case
```

---

### 7. Поиск по текстам актов

Полнотекстовый поиск по проиндексированным судебным актам (RAG).

**POST** `/rest/search_case_texts`

**Request Body:**
```json
{
  "query": "срок исковой давности по кредитному договору",
  "limit": 10,
  "court": "vs--mor",
  "caseNumber": "11-90/2024"
}
```

**Параметры:**
- `query` (string) — текстовый запрос на русском языке
- `limit` (number, optional) — максимум результатов (по умолчанию 10)
- `court` (string, optional) — фильтр по суду
- `caseNumber` (string, optional) — фильтр по номеру дела

**Response 200:**
```json
{
  "query": "срок исковой давности по кредитному договору",
  "total": 5,
  "corpusSize": 450,
  "corpusCases": 38,
  "hits": [
    {
      "score": 8.4521,
      "caseUid": "13RS0001-01-2024-000090-11",
      "caseNumber": "11-90/2024",
      "court": "Верховный Суд Республики Мордовия",
      "actType": "АПЕЛЛЯЦИОННОЕ ОПРЕДЕЛЕНИЕ",
      "actDate": "20.04.2024",
      "chunkIndex": 3,
      "text": "...Согласно ст. 196 ГК РФ общий срок исковой давности составляет три года. По кредитному договору срок исковой давности начинает течь с момента, когда кредитор узнал или должен был узнать о нарушении своего права..."
    }
  ]
}
```

**cURL пример:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"срок исковой давности","limit":5}' \
  http://localhost:8080/rest/search_case_texts
```

---

### 8. Список проиндексированных дел

Получить список всех дел в RAG-корпусе.

**GET** `/rest/list_indexed_cases`

**Response 200:**
```json
{
  "corpusSize": 450,
  "caseCount": 38,
  "cases": [
    {
      "caseUid": "13RS0001-01-2024-000090-11",
      "caseNumber": "11-90/2024",
      "court": "Верховный Суд Республики Мордовия",
      "chunks": 12
    }
  ]
}
```

**cURL пример:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/rest/list_indexed_cases
```

---

### 9. Удаление дела из корпуса

Удалить дело и все его фрагменты из RAG-корпуса.

**POST** `/rest/remove_case`

**Request Body:**
```json
{
  "caseUid": "13RS0001-01-2024-000090-11"
}
```

**Параметры:**
- `caseUid` (string) — УИД дела для удаления (из `list_indexed_cases` или `search_case_texts`)

**Response 200:**
```json
{
  "caseUid": "13RS0001-01-2024-000090-11",
  "chunksRemoved": 12,
  "corpusSize": 438,
  "corpusCases": 37
}
```

**cURL пример:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"caseUid":"13RS0001-01-2024-000090-11"}' \
  http://localhost:8080/rest/remove_case
```

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| `200` | Успех |
| `400` | Неверный запрос (ошибка валидации, невалидный JSON) |
| `401` | Требуется аутентификация (отсутствует или невалидный токен) |
| `404` | Endpoint не найден |
| `500` | Внутренняя ошибка сервера |

**Пример ошибки валидации:**
```json
{
  "error": "Validation error: court: Required, delo_id: Required"
}
```

**Пример ошибки аутентификации:**
```json
{
  "error": "Unauthorized. Provide a valid Bearer token."
}
```

---

## Получение токена

### Через OAuth 2.0 (рекомендуется)

1. Зарегистрируйте клиент: `POST /register`
2. Получите authorization code: `GET /authorize?client_id=...&redirect_uri=...&code_challenge=...`
3. Обменяйте код на токен: `POST /oauth/token`

Подробности в `README.md` (раздел "Удалённое подключение через OAuth").

### Через веб-кабинет (legacy)

1. Откройте `/cabinet` в браузере
2. Войдите (или попросите админа создать аккаунт)
3. Создайте API-ключ в разделе "API Keys"
4. Используйте ключ как Bearer-токен

---

## Smoke-тест

Простой тест всех endpoints:

```bash
#!/bin/bash
TOKEN="YOUR_TOKEN_HERE"
BASE="http://localhost:8080/rest"

echo "1. List categories..."
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/list_case_categories" | jq .

echo "2. Resolve court..."
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"Мордовия"}' "$BASE/resolve_court" | jq .

echo "3. Get hearing schedule..."
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"court":"vs--mor","date":"25.01.2025"}' "$BASE/get_hearing_schedule" | jq .

echo "4. Search cases..."
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"court":"vs--mor","delo_id":5,"participantName":"Иванов"}' "$BASE/search_cases" | jq .

echo "Done!"
```

---

## Примеры использования

### Python

```python
import requests

TOKEN = "your_token_here"
BASE_URL = "http://localhost:8080/rest"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# Получить расписание
response = requests.post(
    f"{BASE_URL}/get_hearing_schedule",
    json={"court": "vs--mor", "date": "25.01.2025"},
    headers=HEADERS
)
schedule = response.json()
print(f"Найдено {schedule['count']} дел на {schedule['date']}")

# Поиск дел
response = requests.post(
    f"{BASE_URL}/search_cases",
    json={
        "court": "vs--mor",
        "delo_id": 5,
        "participantName": "Иванов",
        "entryDateFrom": "01.01.2024",
        "entryDateTo": "31.12.2024"
    },
    headers=HEADERS
)
results = response.json()
for case in results['results']:
    print(f"{case['caseNumber']} - {case['plaintiff']} vs {case['defendant']}")
```

### JavaScript/Node.js

```javascript
const TOKEN = "your_token_here";
const BASE_URL = "http://localhost:8080/rest";

async function getHearingSchedule(court, date) {
  const response = await fetch(`${BASE_URL}/get_hearing_schedule`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ court, date })
  });
  return response.json();
}

async function searchCases(court, delo_id, filters) {
  const response = await fetch(`${BASE_URL}/search_cases`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ court, delo_id, ...filters })
  });
  return response.json();
}

// Использование
const schedule = await getHearingSchedule("vs--mor", "25.01.2025");
console.log(`Найдено ${schedule.count} дел`);

const cases = await searchCases("vs--mor", 5, { participantName: "Иванов" });
console.log(`Найдено ${cases.total} дел`);
```

---

## Различия с MCP API

REST API полностью зеркалирует MCP-инструменты с следующими отличиями:

| Аспект | MCP | REST API |
|--------|-----|----------|
| **Протокол** | JSON-RPC 2.0 over stdio/SSE | HTTP REST |
| **Аутентификация** | OAuth 2.0 (обязательно для удалённого) | OAuth 2.0 или legacy key |
| **Формат запроса** | `{"jsonrpc":"2.0","method":"tools/call","params":{...}}` | `POST /rest/<tool_name>` с JSON body |
| **Формат ответа** | `{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"..."}]}}` | Прямой JSON |
| **Transport** | Streamable HTTP (stateless) | Standard HTTP |

---

## CORS

Для использования REST API из браузерных приложений добавьте CORS-заголовки в `src/api/routes.ts`:

```typescript
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
```

---

## Rate Limiting

В текущей версии rate limiting отсутствует. Для продакшена рекомендуется добавить:
- Rate limiting per user/token (например, через `express-rate-limit`)
- Request size limits (уже есть в Node.js по умолчанию)
- Timeout на долгие операции (Tier 2 с капчей)

---

## Поддержка

**Автор:** Андреев Иван  
**Telegram:** [https://t.me/IBlog_Ivan](https://t.me/IBlog_Ivan)  
Также можно открыть issue в репозитории проекта.
