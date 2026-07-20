# Быстрый старт REST API

Минимальная инструкция для начала работы с sudrf-mcp REST API.

## 1. Получите токен

### Вариант А: Через веб-кабинет (проще)

```bash
# 1. Откройте в браузере
http://your-domain.com/#/cabinet

# 2. Войдите (или попросите админа создать аккаунт)

# 3. В разделе "Ключи доступа" создайте ключ

# 4. Скопируйте токен (показывается один раз!)
```

### Вариант Б: Через CLI (для админов)

```bash
npm run user:add admin@example.com password admin
npm run user:key admin@example.com my-key
# Токен будет выведен в терминал
```

## 2. Сделайте первый запрос

```bash
# Замените YOUR_TOKEN на ваш токен
export TOKEN="your_token_here"

# Получить список категорий дел
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/rest/list_case_categories
```

**Ожидаемый ответ:**
```json
[
  {
    "id": 4,
    "label": "Уголовные дела",
    "name": "CRIMINAL"
  },
  {
    "id": 5,
    "label": "Гражданские дела",
    "name": "CIVIL"
  },
  ...
]
```

## 3. Основные endpoints

### Расписание заседаний (Tier 1, быстро)

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"court":"vs--mor","date":"25.01.2025"}' \
  http://localhost:8080/rest/get_hearing_schedule
```

### Поиск дел (Tier 2, медленнее)

```bash
# Сначала узнайте delo_id нужной категории
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/rest/list_case_categories | jq .

# Затем выполните поиск (например, гражданские дела, delo_id=5)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "court": "vs--mor",
    "delo_id": 5,
    "participantName": "Иванов",
    "entryDateFrom": "01.01.2024",
    "entryDateTo": "31.12.2024"
  }' \
  http://localhost:8080/rest/search_cases
```

### Получить карточку дела

```bash
# case_url берём из результатов search_cases или get_hearing_schedule
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "court": "vs--mor",
    "caseUrl": "/modules.php?name=sud_delo&name_op=case&case_id=155820227",
    "includeDocumentText": true
  }' \
  http://localhost:8080/rest/get_case_details
```

## 4. Полнотекстовый поиск (RAG)

### Проиндексировать дело

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "court": "vs--mor",
    "caseUrl": "/modules.php?name=sud_delo&name_op=case&case_id=155820227"
  }' \
  http://localhost:8080/rest/index_case
```

### Искать по текстам актов

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "срок исковой давности по кредитному договору",
    "limit": 10
  }' \
  http://localhost:8080/rest/search_case_texts
```

## 5. Примеры на других языках

### Python

```python
import requests

TOKEN = "your_token_here"
BASE = "http://localhost:8080/rest"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# Список категорий
categories = requests.get(
    f"{BASE}/list_case_categories",
    headers=HEADERS
).json()

# Расписание заседаний
schedule = requests.post(
    f"{BASE}/get_hearing_schedule",
    json={"court": "vs--mor", "date": "25.01.2025"},
    headers=HEADERS
).json()

print(f"Найдено {schedule['count']} дел")
```

### JavaScript/Node.js

```javascript
const TOKEN = "your_token_here";
const BASE = "http://localhost:8080/rest";

async function getCaseCategories() {
  const res = await fetch(`${BASE}/list_case_categories`, {
    headers: { "Authorization": `Bearer ${TOKEN}` }
  });
  return res.json();
}

async function getHearingSchedule(court, date) {
  const res = await fetch(`${BASE}/get_hearing_schedule`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ court, date })
  });
  return res.json();
}

// Использование
const schedule = await getHearingSchedule("vs--mor", "25.01.2025");
console.log(`Найдено ${schedule.count} дел`);
```

## 6. Частые ошибки

### 401 Unauthorized

```json
{"error": "Unauthorized. Provide a valid Bearer token."}
```

**Решение:** Проверьте токен. Возможно:
- Токен истёк
- Токен был отозван в кабинете
- Неправильный формат заголовка (должен быть `Bearer <token>`)

### 400 Validation error

```json
{"error": "Validation error: court: Required, delo_id: Required"}
```

**Решение:** Не хватает обязательных параметров. Проверьте документацию endpoint.

### 404 Unknown endpoint

```json
{"error": "Unknown endpoint: wrong_name"}
```

**Решение:** Неправильный путь. Все endpoints начинаются с `/rest/`, например `/rest/list_case_categories`.

## 7. Полная документация

- **Веб-страница:** `http://your-domain.com/#/api-docs` (интерактивная, с примерами)
- **Markdown:** [REST_API.md](REST_API.md) (детальное описание всех endpoints)
- **Примеры клиентов:** [examples/](examples/) (TypeScript, Python)

## 8. Smoke-тест

Быстрый тест всех основных endpoints:

```bash
# Установите jq для красивого вывода JSON
# Linux: sudo apt install jq
# macOS: brew install jq
# Windows: https://stedolan.github.io/jq/download/

# Запустите тест
TOKEN=your_token_here ./scripts/test-rest-api.sh
```

Или используйте TypeScript-версию:

```bash
TOKEN=your_token_here npm run test:rest-api
```

## 9. Что дальше?

- Изучите полную документацию: [REST_API.md](REST_API.md)
- Посмотрите примеры клиентов: [examples/](examples/)
- Попробуйте полнотекстовый поиск (RAG): индексируйте несколько дел и ищите по ним
- Для продакшена: настройте OAuth 2.0 (см. README.md)

## Поддержка

**Автор:** Андреев Иван · [https://t.me/IBlog_Ivan](https://t.me/IBlog_Ivan)  
Также можно открыть issue в репозитории проекта.
