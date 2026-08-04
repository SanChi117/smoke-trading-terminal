# Smoke Trading Terminal

Веб-терминал, сканер, воспроизводимый бэктест и SQLite paper-журнал для финального исследовательского baseline `TAGGED_MTF_NO_DIRECTION_BLOCK_V1 / HYBRID v2`.

> Только research и paper trading. В проекте нет клиента биржевого аккаунта, API-ключей и методов размещения реальных ордеров.

## Что уже работает

- браузерный терминал с watchlist, 15m-графиком, 1D/4H-контекстом и объяснимым решением;
- сканер одних и тех же правил по разным классам монет;
- Python-ядро: public OHLCV → MTF features → candidates → risk plans → frozen filters → conservative exits;
- учёт комиссии и проскальзывания;
- ограничение до двух одновременных позиций и одной позиции на символ;
- SQLite paper-журнал, CSV export и kill-switch;
- хронологические фолды и отчёты по монетам/классам;
- API для интерфейса и paper-операций;
- автоматическая safety-проверка, запрещающая появление live-order surface.

Интерфейс контрольной версии: <https://smoke-terminal.kriptabuchcko117.chatgpt.site>

## Финальный baseline

| Правило | Значение |
|---|---|
| Контекст | 1D / 4H |
| Вход | 15m |
| Разрешённые модели | `pullback`, `ignition` |
| Direction context | `down` |
| Минимальный confidence | `43` |
| Минимальный volume ratio | `0.70` |
| Block | high volatility, high sweep reject, bear rejection |
| 5m | telemetry, не gate |
| Live | заблокирован |

## Свежая проверка 04.08.2026

Период: `04.07.2026 10:45` — `04.08.2026 16:30 UTC`.

- 9 монет из 8 классов;
- 27 000 свечей 15m;
- 58 прошедших стратегический фильтр сигналов;
- 25 исполнимых сделок после portfolio capacity gate;
- winrate 40%;
- PF 0.7092;
- результат −1.5485% при риске 0.5% на сделку;
- max drawdown 3.2261%;
- 0 из 4 хронологических фолдов положительные;
- решение: `BLOCK_LIVE`.

Это не отменяет более ранний research baseline, но не подтверждает его на свежем коротком окне. Правильный следующий этап — paper-review, а не реальная торговля. Полный отчёт: [docs/FRESH_VALIDATION_2026-08-04.md](docs/FRESH_VALIDATION_2026-08-04.md).

## Запуск без Docker

Требования: Python 3.11+ и Node.js 22.13+.

```bash
python -m pip install -e .
npm ci
```

Загрузить public data и выполнить бэктест по стандартным классам:

```bash
python scripts/run_terminal_backtest.py --limit 3000 --out-dir runtime --risk-pct 0.5
```

Запустить API:

```bash
python scripts/run_terminal_api.py --host 127.0.0.1 --port 8095
```

В другом окне запустить интерфейс:

```bash
NEXT_PUBLIC_TERMINAL_API_BASE=http://127.0.0.1:8095 npm run dev
```

## Проверки

```bash
python -m unittest discover -s tests -v
python scripts/validate_terminal_safety.py
python -m strategy_lab.paper_mode_smoke_test
npm run build
```

## Основные API

| Method | Endpoint | Назначение |
|---|---|---|
| GET | `/api/health` | Режим и доступность API |
| GET | `/api/snapshot` | Сканер, графики, отчёт и paper status |
| POST | `/api/backtest/refresh` | Обновить public data и отчёт |
| GET | `/api/paper/status` | Gate и kill-switch |
| GET | `/api/paper/trades` | Paper-журнал |
| GET | `/api/paper/export.csv` | CSV export |
| POST | `/api/paper/open` | Только виртуальная запись в SQLite |
| POST | `/api/paper/close` | Только виртуальное закрытие |

Write endpoints можно защитить переменной `SMOKE_TERMINAL_SECRET`; клиент передаёт её в `X-Smoke-Secret`. Никогда не добавляйте биржевые ключи в этот проект.

## Структура

```text
app/                         веб-интерфейс
backend/server.py            local/VPS paper API
strategy_lab/terminal_engine.py  frozen baseline + backtest
strategy_lab/paper_store.py  SQLite journal и kill-switch
strategy_lab/                исходное исследовательское ядро
scripts/run_terminal_*.py    команды запуска
tests/                       unit и API tests
docs/                        решения, источники и validation report
deployment/                  systemd templates
```

## Paper gate

Live нельзя обсуждать до выполнения обоих условий:

1. минимум 100 закрытых paper-сделок;
2. минимум 30 календарных дней наблюдения.

Даже после прохождения gate требуется отдельное решение. Текущий код не разблокирует live автоматически.
