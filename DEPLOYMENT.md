# Deployment Guide — VPS с автоматическим парсингом

Полная инструкция по развёртыванию sudrf-mcp на VPS с автоматическим сбором дел из 1000 судов РФ.

## 📋 Предварительные требования

### На VPS (Ubuntu 20.04+)
- Node.js 18+
- Python 3.8+
- Nginx
- PM2
- 4GB RAM минимум
- 50GB+ диск (для RAG-корпуса)

### Локально
- Python 3 с paramiko: `pip install paramiko`
- Node.js 18+
- Собранный проект: `npm run build && cd web && npm run build`

## 🚀 Быстрый деплой

### Вариант А: Автоматический (рекомендуется)

```bash
# 1. Установите зависимости локально
pip install paramiko

# 2. Соберите проект
npm run build
cd web && npm run build && cd ..

# 3. Запустите деплой
python scripts/vps_deploy.py
```

Скрипт автоматически:
- ✅ Загрузит файлы на VPS
- ✅ Установит зависимости
- ✅ Настроит Nginx
- ✅ Запустит PM2
- ✅ Включит автопарсер
- ✅ Создаст админа

### Вариант Б: Ручной

```bash
# 1. SSH подключение
ssh root@31.77.148.90

# 2. Установка Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# 3. Установка PM2
npm install -g pm2

# 4. Установка Python зависимостей
pip3 install ddddocr pillow

# 5. Клонирование/загрузка проекта
mkdir -p /root/sudrf-mcp
# Загрузите файлы через scp/rsync

# 6. Установка зависимостей
cd /root/sudrf-mcp
npm install --production
npx playwright install chromium

# 7. Создание .env
cat > .env << 'EOF'
MCP_TRANSPORT=http
MCP_PORT=8080
MCP_BIND=0.0.0.0
MCP_PUBLIC_URL=http://31.77.148.90:8080/mcp
AUTO_PARSER=1
PARSER_CASES_PER_HOUR=100
PARSER_CONCURRENT_COURTS=5
PARSER_START_DELAY=30000
SUDRF_HEADLESS=1
NODE_ENV=production
EOF

# 8. Запуск с PM2
pm2 start dist/index.js --name sudrf-mcp
pm2 save
pm2 startup

# 9. Настройка Nginx (см. nginx config ниже)
```

## ⚙️ Конфигурация

### Переменные окружения (.env)

```bash
# HTTP сервер
MCP_TRANSPORT=http
MCP_PORT=8080
MCP_BIND=0.0.0.0
MCP_PUBLIC_URL=http://YOUR_DOMAIN/mcp

# Автопарсер (1000 судов)
AUTO_PARSER=1                      # Включить автопарсинг
PARSER_CASES_PER_HOUR=100          # Дел в час на суд
PARSER_CONCURRENT_COURTS=5         # Судов параллельно
PARSER_START_DELAY=30000           # Задержка старта (мс)

# Браузер
SUDRF_HEADLESS=1

# Капча (опционально)
TWOCAPTCHA_KEY=your_key_here       # Резервный решатель

# Хранилища
SUDRF_RAG_PATH=./rag-index.json
SUDRF_AUTH_PATH=./auth-store.json
SUDRF_OAUTH_PATH=./oauth-store.json

# Прод
NODE_ENV=production
```

### Nginx конфигурация

```nginx
server {
    listen 80;
    server_name _;
    client_max_body_size 100M;
    
    # Frontend
    location / {
        root /root/sudrf-mcp/web/dist;
        try_files $uri $uri/ /index.html;
    }
    
    # Backend APIs
    location ~ ^/(mcp|rest|api|authorize|oauth|register|\.well-known)/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
```

Сохраните в `/etc/nginx/sites-available/sudrf-mcp` и включите:

```bash
ln -sf /etc/nginx/sites-available/sudrf-mcp /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 📊 Автоматический парсинг

### Как работает

1. **Выбор судов:** Топ-1000 судов из реестра (2269 всего)
   - Приоритет: ВС, областные суды
   - HTTP-доступные (быстро)
   - Равномерное распределение по регионам

2. **Стратегия парсинга:**
   - Каждый суд: расписание заседаний на сегодня (Tier 1, без капчи)
   - Индексация найденных дел в RAG
   - Throttling: 100 дел/час на суд (36 сек между делами)
   - 5 судов параллельно

3. **Цикл:** Каждый суд парсится раз в 60 минут

4. **Хранение:** Все дела сохраняются в RAG (`rag-index.json`)

### Мониторинг

```bash
# Статус парсера
pm2 logs sudrf-mcp | grep parser-scheduler

# Статистика через API
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/rest/parser_stats

# Просмотр дел
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/rest/list_all_cases
```

### Управление

```bash
# Остановить
pm2 stop sudrf-mcp

# Перезапустить
pm2 restart sudrf-mcp

# Логи
pm2 logs sudrf-mcp

# Фильтр по парсеру
pm2 logs sudrf-mcp --lines 100 | grep '\[parser-scheduler\]'
```

### Ручной запуск парсинга

Через API:

```bash
# Запустить парсинг конкретного суда
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"court":"vs--mor"}' \
  http://localhost:8080/rest/parser_trigger
```

Или через веб-интерфейс: `/#/cases` → кнопка "Обновить"

## 📍 Точки доступа

После деплоя доступны по адресу `http://31.77.148.90`:

- **Главная:** `/`
- **Дела:** `/#/cases` — просмотр проиндексированных дел
- **Кабинет:** `/#/cabinet` — управление ключами
- **API Docs:** `/#/api-docs` — документация REST API
- **MCP:** `/mcp` — для Claude/AI клиентов
- **REST API:** `/rest/*` — HTTP endpoints

## 🔑 Первый запуск

### 1. Создать админа

```bash
cd /root/sudrf-mcp
node -e "
const {AuthStore} = require('./dist/auth/store.js');
const store = new AuthStore();
store.setPath('./auth-store.json');
store.addUser('admin@sudrf.local', 'admin123', 'admin');
store.flush();
console.log('Admin created');
"
```

### 2. Войти в кабинет

- Откройте `http://31.77.148.90/#/login`
- Email: `admin@sudrf.local`
- Password: `admin123`

### 3. Создать API ключ

- Перейдите в `/#/cabinet`
- Секция "Ключи доступа"
- Нажмите "Сгенерировать"
- Скопируйте токен (показывается один раз!)

### 4. Просмотр дел

- Откройте `/#/cases`
- Автопарсер начнёт работу через 30 секунд после старта
- Дела появятся в течение 5-10 минут

## 📊 Ожидаемые показатели

### Производительность

- **Скорость парсинга:** 500 дел/час (5 судов × 100 дел/час)
- **Первое наполнение:** ~200 дел за первый час
- **За сутки:** ~12,000 дел
- **За неделю:** ~84,000 дел
- **Steady state:** Постоянное обновление + новые дела

### Ресурсы

- **RAM:** 1-2 GB (Node.js + браузер)
- **CPU:** 20-40% average (5 параллельных парсеров)
- **Диск:** +500MB/день (RAG index растёт)
- **Сеть:** ~100MB/час (HTTP запросы)

### RAG корпус

- **Размер чанка:** ~1200 символов
- **Чанков на дело:** 5-20 (зависит от актов)
- **10,000 дел:** ~100,000 чанков = ~50MB JSON
- **100,000 дел:** ~1,000,000 чанков = ~500MB JSON

## 🔧 Обслуживание

### Обновление кода

```bash
# Локально
npm run build
cd web && npm run build && cd ..
python scripts/vps_deploy.py
```

Или вручную:

```bash
# На VPS
cd /root/sudrf-mcp
git pull  # или загрузите файлы
npm install
pm2 restart sudrf-mcp
```

### Очистка RAG

```bash
# Удалить все дела
rm -f /root/sudrf-mcp/rag-index.json
pm2 restart sudrf-mcp

# Или через API
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"caseUid":"CASE_UID_HERE"}' \
  http://localhost:8080/rest/remove_case
```

### Бэкап

```bash
# Бэкап важных файлов
cd /root/sudrf-mcp
tar -czf backup-$(date +%Y%m%d).tar.gz \
  rag-index.json \
  auth-store.json \
  oauth-store.json \
  .env

# Восстановление
tar -xzf backup-20250105.tar.gz
pm2 restart sudrf-mcp
```

## 🐛 Траблшутинг

### Парсер не запускается

```bash
# Проверьте логи
pm2 logs sudrf-mcp --lines 50

# Проверьте .env
cat /root/sudrf-mcp/.env | grep AUTO_PARSER

# Должно быть AUTO_PARSER=1
```

### Не индексируются дела

```bash
# Проверьте ddddocr
python3 -c "import ddddocr; print('OK')"

# Проверьте Playwright
npx playwright --version

# Переустановите
cd /root/sudrf-mcp
npx playwright install chromium
```

### Нет доступа к веб-интерфейсу

```bash
# Проверьте Nginx
nginx -t
systemctl status nginx

# Проверьте backend
curl http://localhost:8080/rest/list_case_categories

# Проверьте порты
netstat -tlnp | grep :80
netstat -tlnp | grep :8080
```

### Высокая нагрузка

```bash
# Уменьшите параллельность
# В .env:
PARSER_CONCURRENT_COURTS=2

# Или уменьшите rate
PARSER_CASES_PER_HOUR=50

pm2 restart sudrf-mcp
```

## 📞 Поддержка

При проблемах:
1. Проверьте логи: `pm2 logs sudrf-mcp`
2. Проверьте статус: `pm2 status`
3. Проверьте ресурсы: `htop` или `pm2 monit`

---

**Deployment complete!** 🎉

Сервер развёрнут и парсит дела из судов РФ 24/7.

---

**Автор:** Андреев Иван · связь: [https://t.me/IBlog_Ivan](https://t.me/IBlog_Ivan)
