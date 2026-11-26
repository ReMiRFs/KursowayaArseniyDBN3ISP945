# Статистика заказов интернет-магазина

Курсовая работа по теме № 9. React SPA показывает количество заказов, выручку и средний чек за период. PostgreSQL рассчитывает ряды и показатели, Go проверяет доступ и возвращает JSON, а браузер рисует три графика через Canvas 2D.

Аналитик просматривает статистику и меняет период. Администратор дополнительно ведёт заказы и справочник каналов продаж. Отменённые заказы остаются в истории. Канал можно удалить, пока к нему не привязан заказ.

## Локальный запуск

Нужны PowerShell 7, Go 1.25+, Node.js 22.12+ с npm и работающий PostgreSQL 18. Проверьте, что `psql` и `createdb` доступны в `PATH`. Команды выполняются из корня проекта.

### База данных

Укажите свой порт и роль PostgreSQL. В примере используется роль `postgres`. Пароль этой роли вводится один раз в переменную текущего терминала.

~~~powershell
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '5432'
$env:PGUSER = 'postgres'
$env:PGDATABASE = 'orderstats_course'
$env:PGPASSWORD = Read-Host 'Пароль роли PostgreSQL' -MaskInput

createdb --maintenance-db=postgres --template=template0 --encoding=UTF8 $env:PGDATABASE
if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать учебную базу' }
psql -X -v ON_ERROR_STOP=1 -f .\db\migrate.psql
if ($LASTEXITCODE -ne 0) { throw 'Не удалось применить миграцию' }

try {
    Push-Location .\server
    try {
        $env:ORDERS_DEMO_ADMIN_HASH = Read-Host 'Учебный пароль администратора' -MaskInput | go run ./cmd/demo-hash
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать хеш администратора' }
        $env:ORDERS_DEMO_ANALYST_HASH = Read-Host 'Учебный пароль аналитика' -MaskInput | go run ./cmd/demo-hash
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать хеш аналитика' }
    } finally {
        Pop-Location
    }
    psql -X -v ON_ERROR_STOP=1 -f .\db\seed\demo.psql
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось загрузить учебные данные' }
} finally {
    Remove-Item Env:ORDERS_DEMO_ADMIN_HASH, Env:ORDERS_DEMO_ANALYST_HASH -ErrorAction SilentlyContinue
}
~~~

Учебные пароли должны содержать 12–72 байта. Аккаунты — `admin@example.test` и `analyst@example.test`. Миграцию и наполнение можно запускать повторно. Оно сохраняет уже существующий статус заказа и пароли. Для повторения сценария с исходными значениями используйте новую учебную базу.

### Собранное приложение

В том же терминале выполните команды сборки и запуска.

~~~powershell
npm --prefix client ci
if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости клиента' }
npm --prefix client run build
if ($LASTEXITCODE -ne 0) { throw 'Не удалось собрать клиент' }

$env:ORDERS_STATIC_DIR = 'client/dist'
$env:ORDERS_ORIGIN = 'http://127.0.0.1:8080'
go -C server build -o ../orderstats.exe ./cmd/orderstats
if ($LASTEXITCODE -ne 0) { throw 'Не удалось собрать сервер' }
.\orderstats.exe
~~~

Откройте [127.0.0.1:8080](http://127.0.0.1:8080/). Доступность сервера и БД можно проверить по `/healthz`. После остановки сервера очистите пароль из текущего терминала командой `Remove-Item Env:PGPASSWORD`.

Для разработки запустите `.\orderstats.exe` из корня проекта с `ORDERS_ORIGIN=http://127.0.0.1:5173` и без `ORDERS_STATIC_DIR`. Во втором терминале запустите `npm --prefix client run dev`. Vite перенаправляет `/api` на `127.0.0.1:8080`.

| Параметр | Значение |
| --- | --- |
| `DATABASE_URL` | Альтернатива группе `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD` для Go. |
| `ORDERS_ADDR` | Адрес прослушивания Go, по умолчанию `127.0.0.1:8080`. |
| `ORDERS_ORIGIN` | Адрес приложения в браузере, включая схему и порт. По умолчанию `http://127.0.0.1:8080`. |
| `ORDERS_STATIC_DIR` | Папка собранной SPA. При пустом значении Go обслуживает только API и проверку доступности. |
| `ORDERS_STATISTICS_SQL` | Путь к запросу сводки, по умолчанию `db/queries/statistics.sql` относительно каталога запуска. |

## Демонстрационный сценарий

1. Войдите как администратор. Выберите период **16–24 ноября 2026 года** и нажмите «Применить».
2. Убедитесь, что показаны **3 заказа**, выручка **2 000 ₽**, средний чек **2 000 ₽**.
3. В списке заказов найдите **Z-104**, установите «Завершён» и сохраните. Вернитесь к статистике. Период сохранится, выручка станет **3 000 ₽**, средний чек — **1 500 ₽**, число заказов останется равным **3**.
4. Раскройте «Значения» под недельной выручкой. Во второй неделе отобразится **1 000 ₽**. Под аналитиком доступна та же сводка, а управление заказами и каналами закрыто.

## Проверки

Команды выполняются из корня проекта. Для проверок, меняющих заказы, нужна отдельная учебная база с исходными данными и запущенное приложение.

~~~powershell
go -C server test ./...
go -C server vet ./...
npm --prefix client test
npm --prefix client run build

$statisticsSql = Get-Content -Raw -LiteralPath .\db\queries\statistics.sql
psql -X -v ON_ERROR_STOP=1 -c "PREPARE course_statistics(date,date) AS $statisticsSql" -f .\db\tests\stage2.psql
~~~

Для проверки API в отдельном терминале задайте адрес приложения и учебные пароли.

~~~powershell
$env:ORDERS_BASE_URL = 'http://127.0.0.1:8080'
$env:ORDERS_ADMIN_PASSWORD = Read-Host 'Учебный пароль администратора' -MaskInput
$env:ORDERS_ANALYST_PASSWORD = Read-Host 'Учебный пароль аналитика' -MaskInput
node .\tests\api\stage4.mjs
~~~

Браузерному сценарию нужен Playwright и установленный Chromium или Chrome. Если Playwright установлен отдельно от репозитория, укажите в `ORDERS_PLAYWRIGHT_PATH` путь к его каталогу внутри `node_modules`. Для проверки в установленном Chrome укажите `ORDERS_CHROMIUM_PATH` с абсолютным путём к исполняемому файлу. Скрипт принимает каталог для новых снимков.

~~~powershell
node .\tests\browser\scenario.mjs "$env:TEMP\orderstats-screenshots"
~~~

Для браузерного прогона используйте свою чистую учебную базу. Прогон API создаёт заказ с текущей датой, и если она совпадёт с контрольной датой, показатели изменятся. Браузерный прогон завершает Z-104. Для повторной проверки исходной сводки нужна новая учебная база. Для локального замера загрузите 10 000 синтетических заказов в тестовую БД, указанную в `PGDATABASE`, и запустите измерение.

~~~powershell
psql -X -v ON_ERROR_STOP=1 -f .\db\tests\benchmark.psql
node .\tests\api\bench.mjs
Remove-Item Env:ORDERS_ADMIN_PASSWORD, Env:ORDERS_ANALYST_PASSWORD
~~~

Проверки API и браузера относятся к локальному запуску. Публичный сервер и внешний нагрузочный профиль в этот прогон не входили.

## Код и материалы

- `client/src/` — страницы, запросы и отрисовка Canvas в `charts.jsx`.
- `server/internal/api/` — REST-обработчики, проверка ролей и бизнес-правила.
- `db/` — миграция, учебные данные, агрегирующий SQL, тесты БД.
- [Архитектура приложения](docs/diagrams/architecture.svg) и [ER-диаграмма базы данных](docs/diagrams/er.svg).
- [Описание API в OpenAPI](docs/openapi.yaml) и [прототип экранов](docs/Прототип%20экранов.html).
- [Пояснительная записка](docs/Пояснительная%20записка.docx).
- [Скриншоты работы приложения](docs/screenshots).
