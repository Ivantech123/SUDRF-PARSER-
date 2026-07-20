# REST API Client Examples

Примеры клиентов для работы с sudrf-mcp REST API на разных языках.

## TypeScript/Node.js

**Файл:** `rest-client.ts`

**Установка:**
```bash
# Node.js >= 18 (fetch встроен)
npm install

# Node.js < 18
npm install node-fetch
```

**Использование:**
```bash
# Запустите сервер
MCP_TRANSPORT=http MCP_PORT=8080 npm start

# В другом терминале
TOKEN=your_token_here npx tsx examples/rest-client.ts
```

**Интеграция в проект:**
```typescript
import { SudrfRestClient } from './examples/rest-client.js';

const client = new SudrfRestClient(
  'http://localhost:8080/rest',
  process.env.TOKEN!
);

// Получить расписание
const schedule = await client.getHearingSchedule({
  court: 'vs--mor',
  date: '25.01.2025'
});
console.log(`Найдено ${schedule.count} дел`);

// Поиск дел
const cases = await client.searchCases({
  court: 'vs--mor',
  delo_id: 5, // гражданские дела
  participantName: 'Иванов'
});

// Полнотекстовый поиск
const results = await client.searchCaseTexts({
  query: 'срок исковой давности по кредитному договору',
  limit: 10
});
```

---

## Python

**Файл:** `rest_client.py`

**Установка:**
```bash
pip install requests
```

**Использование:**
```bash
# Запустите сервер
MCP_TRANSPORT=http MCP_PORT=8080 npm start

# В другом терминале
TOKEN=your_token_here python examples/rest_client.py
```

**Интеграция в проект:**
```python
from rest_client import SudrfRestClient

client = SudrfRestClient(
    base_url='http://localhost:8080/rest',
    token=os.getenv('TOKEN')
)

# Получить расписание
schedule = client.get_hearing_schedule(
    court='vs--mor',
    date='25.01.2025'
)
print(f"Найдено {schedule['count']} дел")

# Поиск дел
cases = client.search_cases(
    court='vs--mor',
    delo_id=5,  # гражданские дела
    participant_name='Иванов'
)

# Полнотекстовый поиск
results = client.search_case_texts(
    query='срок исковой давности по кредитному договору',
    limit=10
)
```

---

## Получение токена

### Через веб-кабинет (быстро)

1. Откройте `http://localhost:8080/cabinet`
2. Войдите или попросите админа создать аккаунт
3. Создайте API-ключ в разделе "API Keys"
4. Используйте ключ как `TOKEN`

### Через OAuth 2.0 (для продакшена)

1. Зарегистрируйте OAuth-клиент: `POST /register`
2. Получите authorization code: `GET /authorize`
3. Обменяйте на токен: `POST /oauth/token`

Подробнее в [REST_API.md](../REST_API.md) (раздел "Получение токена").

---

## TypeScript типы

Файл `src/api/types.ts` содержит полные TypeScript-типы для всех request/response объектов:

```typescript
import type {
  CaseCategory,
  CourtEntry,
  HearingScheduleResponse,
  SearchCasesResponse,
  CaseDetailsResponse,
  SearchCaseTextsResponse,
  // ... и другие
} from '../src/api/types.js';
```

Используйте эти типы для type-safe клиентов.

---

## Другие языки

REST API — стандартный HTTP JSON, работает с любым HTTP-клиентом:

### cURL
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"court":"vs--mor","date":"25.01.2025"}' \
  http://localhost:8080/rest/get_hearing_schedule
```

### JavaScript (браузер)
```javascript
const response = await fetch('http://localhost:8080/rest/get_hearing_schedule', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ court: 'vs--mor', date: '25.01.2025' })
});
const schedule = await response.json();
```

### PHP
```php
$ch = curl_init('http://localhost:8080/rest/get_hearing_schedule');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer ' . $token,
    'Content-Type: application/json'
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    'court' => 'vs--mor',
    'date' => '25.01.2025'
]));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = json_decode(curl_exec($ch), true);
curl_close($ch);
```

### Go
```go
import (
    "bytes"
    "encoding/json"
    "net/http"
)

payload := map[string]string{"court": "vs--mor", "date": "25.01.2025"}
body, _ := json.Marshal(payload)
req, _ := http.NewRequest("POST", "http://localhost:8080/rest/get_hearing_schedule", bytes.NewBuffer(body))
req.Header.Set("Authorization", "Bearer "+token)
req.Header.Set("Content-Type", "application/json")
client := &http.Client{}
resp, _ := client.Do(req)
```

---

## Полная документация

Полное описание всех endpoints, параметров и примеров: [REST_API.md](../REST_API.md)
