# SMOKE Trading OS: переносимый PAPER-контур, цикл P1

**Дата:** 2026-10-14. **Статус:** реализация контракта и тестового хранилища; ещё **не автономный публичный сервис**.

## Что именно построено

```text
Клиентский график/сканер (AppDeploy v47 остаётся отдельно)
                     ↑ только просмотр; не источник хранения
Будущий read-only API состояния PAPER
                     ↑
Вечный worker (ЕЩЁ НЕТ / NOT WIRED) — закрытая 15m свеча и закрытая 1m
                     ↓
      PortablePaperRuntime
       ├─ strategy.closedCycle()  [V5_UNMODIFIED — pinned]
       ├─ market.observedQuote()  [read-only quote]
       ├─ market.closedMinutes()  [read-only 1m, gap-safe]
       └─ store.read()/compareAndSwap()
                           ↓
          PostgreSQL state (реализован adapter+schema)
```

`core/paper/portable-paper-runtime.ts`: автономный от UI, SDK и места размещения управляющий контракт:
- `onClosed15m(symbol, closeAt)`: разрешает только выровненную **уже закрытую** 15m свечу, выбирает **зафиксированную** `V5_UNMODIFIED`; сломанная стратегия/история возвращает retryable `STRATEGY_DATA_UNAVAILABLE` без поглощения 15m-watermark. Для READY использует наблюдаемую котировку, а не фиктивный вход.
- `onMinute(symbol)`: сопровождение только **существующей** позиции по закрытым 1m свечам без новой 15m оценки; до закрытия первой доступной минуты не делает запросов.
- Обе ветки делегируют учёт комиссий, стопов, отказов, TP/SL и времени старым **неизменённым** чистым функциям `core/paper/paper-pilot-state.ts`, `core/paper/paper-lifecycle.ts`.
- Все операции `PAPER_ONLY` (`executionAuthorized:false`); никакого интерфейса ордеров. Незарегистрированная новая стратегия не активируется заменой зависимости: имя проверяется при запуске.
- Сохранение `read()/compareAndSwap()` — **обязательный** порт с атомарной гарантией, иначе CAS conflict и отказ; результат без подтверждённого commit не выдаётся как записанная сделка.
- Сетевые исключения из закрытых минут конвертируются в диагностический HALT; позиция и PnL не подделываются.

`core/paper/postgres-paper-store.ts` + `deployment/postgres/0001_paper_state.sql`:
- Данные хранятся по составному ключу `(ledger_key, symbol)`, без AppDeploy `localStorage` и браузерного аккаунта.
- Атомарный optimistic compare-and-swap на PostgreSQL, включая первую вставку, через один запрос `UPDATE/INSERT ... WHERE revision=expected`. Адаптер не создаёт схему автоматически, не хранит секреты, не выбирает регион сервера.
- `ledger_key` должен быть уникален для каждого независимого PAPER-пилота. Нельзя переносить несколько аккаунтов в один ключ.
- `read` не подменяет повреждённую строку пустой записью; в случае пропажи/недоступности БД worker обязан остановить запись.

## Какие проверки выполнены / как проверять

- `node --experimental-strip-types --test tests/portable-paper-runtime.test.mjs`: 11 сценариев, только синтетический рынок и in-memory CAS. Проверяет 15m READY/NO READY, настоящий state-machine PAPER OPEN, после mock restart 1m checkpoint/STOP/TARGET, SL-first, разрыв минут, восстановление, ошибки стратегии, ошибочные таймфреймы, коррумпированный журнал, гонку двух worker и отсутствие повторного учёта сделки.
- `node --experimental-strip-types --test tests/postgres-paper-store.integration.mjs` при установленном пакете `pg` и `SMOKE_TEST_PG_URL`: **только** на одноразовом тестовом PostgreSQL. Создаёт схему 0001; проверяет атомарную запись, отклонение stale revision, namespace isolation, новые процессы/экземпляры адаптера и полный OPEN→1m STOP→reopen check. Тест очищает только свои `ci_*` ключи и не должен запускаться с доступом к рабочей базе.
- GitHub workflows: `portable-paper-runtime-qa` и `portable-paper-postgres-qa` автоматически запускаются при изменениях. Конкретные PASS/FAIL и run ID фиксируются в `PROJECT_STATUS.md`.
- `npm test` в прежних общих workflows должен продолжать проходить.
- **Историческое ограничение TS**: `npx tsc --noEmit` по всему legacy Next/Vinext дереву выдаёт существующие ошибки `ProLevelChart/ProfessionalChart/Cloudflare`. Для новых чистых модулей применяется `--strict` с отдельным список файлов; общая проблема не объявляется исправленной.

## НЕ ГОТОВО / блокеры

1. Нет самостоятельного server process 24/7 с валидированным реальным Binance USD-M market-data egress, event scheduler и восстановлением после downtime. Несколько прежних облачных сред получают **HTTP 451**; не включать cron до фактического разрешённого read-only feed probe.
2. Нет интеграции конкретного AppDeploy V5-output в `strategy.closedCycle` и реальной биржевой котировки/закрытых минут в `market`. Тесты выше используют synthetic fixtures; полный реальный V5 READY→OPEN→CLOSE **не доказан**.
3. Нет миграции данных рабочего пользователя, recovery drill через PostgreSQL dump/restore, упакованного Railway deployment, production metrics, алертов, устойчивой API/auth.
4. Работающий UI AppDeploy v47 **не заменён**, оригинальная V5 не изменена. GitHub ветка и AppDeploy исторически разные; не публиковать PR #88 или GitHub main поверх v47 автоматически.
5. Любые real orders запрещены; никогда не подключать trading credentials к этому этапу.

## Следующий цикл

После зелёного PG integration CI: создать изолированный standalone process с API `/health`/`/status`, безопасным запуском `scanDisabled=true`, injectable Binance data adapter, **no-live** health gating и отдельным доказательством восстановления после process restart. Потом проверить разрешённый egress выбранной облачной платформы, не предполагать, что Railway будет доступен по умолчанию. Подключение новой методологии — только после передачи правил пользователем.
