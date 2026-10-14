# SMOKE Trading OS — автономный PAPER-сервис (планируемый перенос)

**Срез:** 2026-10-14. **Не production-release.** Серверный образ создан, но не размещён на Railway, сканирование стратегии и торговля не включены. AppDeploy v47 остаётся работающей UI-тестовой средой.

## Назначение компонентов

| Компонент | Что делает | Когда выполняется | Чего НЕ делает |
|---|---|---|---|
| `deployment/portable-paper/server.mjs` | Самостоятельный Node HTTP-сервис, PostgreSQL health и защищённое read-only состояние | При запуске контейнера, без браузера | Не сканирует рынок; не открывает/закрывает реальных и PAPER сделок самостоятельно |
| `core/paper/portable-paper-runtime.ts` | Чистый управляющий слой: закрытая 15m для входа, закрытая 1m для сопровождения; фиксированная V5 | Пока запускается только через unit/integration тесты | Не читает Binance самостоятельно; не зависит от UI; не вызывает ордера |
| `core/paper/postgres-paper-store.ts` | Постоянный журнал с атомарной ревизией и разделением `ledger_key` | При вызове независимого runtime/адаптера | Не принимает устаревшие транзакции как успешные |
| `deployment/postgres/0001_paper_state.sql` | Таблица и ограничения журнала | Однократно до сервиса | Не запускает торговую механику |
| `core/market/binance-usdm-egress.ts` | Проверяет регион через публичные Binance USD-M `time`, `bookTicker`, две последние закрытые 1m свечи | По команде `market-egress-probe.mjs` из будущего выбранного региона | Не ставит ордера; не обходит HTTP 451; не доказывает доступность всех 5 TF |
| `deployment/portable-paper/Dockerfile` | Упаковка Node-сервиса с `pg` | При CI build или будущей миграции | Не публикует в Railway автоматически |

## Контракт запуска и доступ

Для запуска нужен PostgreSQL 16 с заранее применённой миграцией `deployment/postgres/0001_paper_state.sql`. Переменные окружения, секреты **не добавляются в git**:

| Переменная | Значение |
|---|---|
| `SMOKE_PAPER_DATABASE_URL` | Строка подключения к назначенной PostgreSQL через секрет платформы |
| `SMOKE_PAPER_LEDGER_KEY` | Изолированное имя журнала, например `paper_staging` |
| `SMOKE_PAPER_READ_TOKEN` | Секрет для `/status` и `/journal/:symbol`, длина не менее 32 символов |
| `SMOKE_PAPER_HOST` | `127.0.0.1` по умолчанию; `0.0.0.0` только если установлен сильный token и защищён периметр |
| `PORT` или `SMOKE_PAPER_PORT` | HTTP порт, по умолчанию 8097 |
| `SMOKE_PAPER_SCAN_ENABLED` | **Нельзя ставить true/1** до подключения и проверки server-side feed: сервис откажется запускаться |

API только GET:
- `GET /health` — краткий DB connectivity probe; при недоступной DB ответ 503, не сообщает секреты; не означает, что торговый сканер работает.
- `GET /status` — требует `Authorization: Bearer <SMOKE_PAPER_READ_TOKEN>`; сводка и ревизии **только выбранного** `ledger_key`.
- `GET /journal/BTCUSDT` — требует тот же bearer; полный PAPER state одной монеты. Чужие записи не читаются по произвольному ключу из URL.
- POST/PUT/DELETE — всегда 405. Нет live order API.

Без token доступны лишь минимальная `/health`, остальные запросы 401. На публичном интерфейсе без token сервер откажется стартовать. Злоумышленная или повреждённая запись `executionAuthorized:true` приводит к 503 на выдаче, а не к фальшивому здоровому журналу.

## Запуск контейнера — пока только тестовая среда

```bash
docker build -f deployment/portable-paper/Dockerfile -t smoke-portable-paper:staging .
# Секреты передаются только через managed secrets платформы;
# не указывать их в Dockerfile, терминальных командах или репозитории.
```

CI `portable-paper-standalone-http-qa` запускает отдельный PostgreSQL 16, в тесте временно устанавливает `pg` и проверяет два сценария из isolated DB: чтение с auth, 405 на записи, изоляцию, остановку процесса и повторный запуск, целостность журнала, отказ при corrupt state. Реальная пользовательская база ни разу не подключалась. Docker build подтверждается только если соответствующий job SUCCESS на точной версии.

Проба Binance после размещения в **нужном** регионе выполняется **внутри того же хостинга**:

```bash
node --experimental-strip-types deployment/portable-paper/market-egress-probe.mjs
```

Если результат `ok:false`, `HTTP_451` или `NETWORK_OR_TIMEOUT`, сканирование **остаётся выключенным**. Probe не делает попыток использовать прокси или обход геоограничений. Если `ok:true`, это лишь минимальная проверка USD-M public feed; перед включением PAPER нужны все TF, непрерывность, 1m coverage, restart и история реальных V5 READY.

## Следующие обязательные критерии выпуска

- [x] Неподвижная V5, PAPER-only, нет API реальных ордеров.
- [x] Портативный контракт исполнения с DB CAS и тестовыми READY→OPEN→CLOSE/STOP/HALT.
- [x] Read-only автономный Node API, подтверждённая перезагрузка и повторное чтение из реальной тестовой PostgreSQL.
- [x] Подготовлена только **средство** проверки Binance USD-M egress; тесты на synthetic fixture.
- [ ] Подтверждён Docker build на финальном коммите (проверять CI).
- [ ] Создан и испытан worker scheduler с проверенным публичным USD-M feed, минутным сопровождением открытых PAPER позиций и 15m V5; запрещать ордера.
- [ ] Подтверждены Binance USD-M HTTP 200 в выбранной разрешённой реальной облачной среде и непрерывность 5 TF + 1m.
- [ ] Надёжная схема восстановления Postgres `pg_dump` → `pg_restore`, ежедневные backup и alarms на пропуски/задержки.
- [x] Зафиксирован отдельный `deployment/portable-paper/package-lock.json` (npm lockfileVersion 3; `pg@8.16.3` и транзитивные зависимости), а CI и Dockerfile переключены на `npm ci`. До production всё ещё нужны контрольные green image-build и software supply-chain audit.
- [ ] Сверка исходников UI AppDeploy v47 ↔ GitHub (Vite vs Next/Vinext), обратный план, обновление read-only UI с новым API.
- [ ] Изоляция тестовой и рабочей PostgreSQL, хранение секретов в platform secrets, надёжные probes и наблюдаемость, 24/7 soak.
- [ ] Только после вышеперечисленного — управляемый Railway cutover. Не включать реальные ордера.

**Принцип:** каждый блок только после реального теста, сомнения и записи в `PROJECT_STATUS.md`; никакой synthetic test не считается market-ready.
