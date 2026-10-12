# MASTER ТЗ v1.0 — SMOKE TRADING OS

Переделка существующего Smoke Trading Terminal в автономный мульти-режимный торговый терминал с AI-арбитром, профессиональным графиком и раздельными контурами ручной/автономной торговли

## 0. ИНСТРУКЦИЯ ДЛЯ ЧАТ-РОБОТА / WORK-АГЕНТА

> **CRITICAL** — ЭТО ТЗ НУЖНО ВЫПОЛНЯТЬ, А НЕ ОБСУЖДАТЬ. НЕ ЗАДАВАТЬ ПОЛЬЗОВАТЕЛЮ УТОЧНЯЮЩИХ ВОПРОСОВ ПО АРХИТЕКТУРЕ, UI, ТЕХНОЛОГИЯМ ИЛИ ПОРЯДКУ РАБОТ. ПРИ НЕОДНОЗНАЧНОСТИ ВЫБИРАТЬ НАИБОЛЕЕ БЕЗОПАСНОЕ, ПРОВЕРЯЕМОЕ И ПОДДЕРЖИВАЕМОЕ РЕШЕНИЕ, ФИКСИРОВАТЬ ЕГО В CHANGELOG/ARCHITECTURE DECISION LOG И ПРОДОЛЖАТЬ ДО ГОТОВОГО РЕЗУЛЬТАТА.

- Не создавать новый торговый терминал, новый основной репозиторий или параллельный продукт. Переделывать существующий `SanChi117/smoke-trading-terminal`, каноническая ветка — `main`.
- В начале работы выполнить `git pull`/fetch актуального `main`, записать исходный SHA в отчёт. Не привязываться к старому SHA, если `main` уже изменился.
- Перед первым структурным рефакторингом создать безопасную точку отката: git tag/backup commit. Все долговременные изменения должны оказаться в `main`; не вести отдельную долгоживущую ветку продукта.
- Не удалять работающие функции без эквивалентной или лучшей замены и теста. Существующие V5/QFVG/level-flow/paper/backtest компоненты считать наследуемыми модулями/источниками, а не причиной переписать всё с нуля.
- Не трогать отдельные репозитории `Smoke-strategy`, `EMBER-Research-Engine`, `telegram-signal-bot` как продукты. Их можно читать и забирать полезные идеи/реализации/тестовые подходы в текущий терминал; изменения в них не требуются.
- Если для конкретного шага нужны недоступные секреты (OpenAI API key, Binance trade key, Telegram bot token), не останавливать проект: реализовать интерфейс, конфигурацию, мок/симулятор, тесты и продолжать все независимые задачи. В конце вывести одну короткую секцию `OWNER ACTION REQUIRED` только с фактически необходимыми действиями.
- Не просить пользователя писать код, редактировать конфиги или вручную вести журналы. Все операции, которые можно автоматизировать, должны быть автоматизированы.
- Не менять боевую логику «по ощущениям». Любая новая версия Brain/Exit/Arbiter — versioned, replay-tested и сравнивается с предыдущей/контролем.
- Цель — законченный функциональный продукт, а не прототип экранов и не набор отдельных скриптов. UI, backend, data layer, AI, execution, ledger, replay, observability и тесты являются одной системой.

## 1. Исходная точка и назначение проекта

Существующий `smoke-trading-terminal` уже содержит основу, которую необходимо сохранить и расширить: Binance Futures market-data client, MTF-логику, графические компоненты, paper journal/observer, backend, backtest/research utilities и тесты. Текущий терминал research/read-only по части live execution; задача этого ТЗ — превратить именно его в SMOKE Trading OS.

SMOKE Trading OS — единый автономный торговый терминал, который одновременно: (1) поддерживает ручную торговлю владельца без вмешательства автоматики; (2) автономно ищет и торгует разные типы рыночных ситуаций специализированными модулями; (3) использует AI как верхний reasoning/arbiter слой; (4) исполняет и защищает сделки детерминированным кодом; (5) хранит полный проверяемый учёт каждой мысли, команды и сделки.

## 2. Неподлежащие обсуждению продуктовые требования

| Требование               | Обязательное поведение                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Текущий терминал         | Переделывать существующий smoke-trading-terminal; новый терминал не создавать.                                                                                         |
| Каноническая ветка       | main. Любые структурные изменения должны сохранять возможность отката и оставлять main рабочим.                                                                        |
| Ручная торговля          | Не останавливать и не ограничивать. Цель владельца $20k остаётся отдельной ручной задачей.                                                                             |
| Автономная торговля      | Итоговый продукт поддерживает AUTO-LIVE, а не только paper.                                                                                                            |
| Первые 14 дней AUTO-LIVE | Максимум 1 USDT маржи на каждую новую авто-сделку; число сделок не ограничивать; не останавливать по PnL/DD/серии убытков.                                             |
| Техническая безопасность | Всегда включена: защита от дублей, stale data, API mismatch, неверного AI-ответа, рассинхронизации ордеров/позиций, аварийный SAFE MODE.                               |
| График                   | Полностью переделать. Текущий график непригоден для полноценной работы. UX ориентировать на привычный профессиональный Binance Futures terminal.                       |
| Интерфейс                | Терминал должен быть насыщен полезными функциями, но управляться через продуманную иерархию, пресеты, hotkeys, hide/show layers, а не превращаться в визуальный мусор. |
| VPS                      | Сейчас не требуется. Система разрабатывается локально/GitHub; должна поставляться готовой к последующему развёртыванию на VPS 24/7.                                    |

## 3. Целевая архитектура — Trading OS

```
MARKET SOURCES
  Binance Futures REST/WebSocket + OI/Funding + optional cross-exchange/context
            │
            ▼
DATA NORMALIZER / MARKET STATE / EVENT BUS / MEMORY
            │
            ▼
MACRO BRAIN: 1M(month) → 1W → 1D
            │
     ┌──────┼────────┬────────┬──────────┐
     ▼      ▼        ▼        ▼          ▼
  PUMP    TREND    RANGE   REVERSAL   CATALYST
  BRAIN   BRAIN    BRAIN   /SQUEEZE    BRAIN
     └──────┴────────┴────────┴──────────┘
            │
            ▼
CONFLICT ENGINE  →  AI ARBITER  →  IMMUTABLE TRADE PLAN
                                      │
                           ┌──────────┴──────────┐
                           ▼                     ▼
                    EXECUTION ENGINE        EXIT GUARDIAN
                           └──────────┬──────────┘
                                      ▼
                                 BINANCE LIVE
                                      │
                                      ▼
                UNIFIED LEDGER / REPLAY / RESEARCH / AUDIT
```

Ключевой принцип: сначала система определяет контекст и механизм рынка, затем выбирает подходящий специализированный тип мышления, затем AI-арбитр принимает конечное решение. Быстрый execution/exit контур не зависит от LLM latency.

## 4. Архитектурные домены репозитория

Внутри существующего репозитория привести код к следующей логической структуре. Имена можно адаптировать под текущий Next/Python стек, но доменные границы обязательны.

```
/apps
  /terminal-ui
  /api
/services
  /market-data
  /orchestrator
  /ai-brain
  /execution
  /exit-guardian
/brains
  /macro
  /pump
  /trend
  /range
  /reversal
  /catalyst
  /arbiter
/core
  /contracts
  /conflicts
  /risk
  /portfolio
  /ledger
  /state
/research
  /replay
  /backtest
  /walk-forward
  /diagnostics
/integrations
  /binance
  /openai
  /bybit-or-other
  /telegram
/tests
```

Не обязательно физически перемещать каждый файл в первый день. Сначала ввести контракты и фасады, затем постепенно мигрировать текущие модули без регрессии.

## 5. Market Data Layer

- Binance USDⓈ-M Futures — основной источник рыночных и торговых данных.
- Свечи минимум: 1M (месяц), 1W, 1D, 4H, 1H, 15m, 5m, 1m. Подминутную реакцию получать не из свечи, а из trades/aggTrades/bookTicker/depth.
- Потоки: klines, aggTrade/trades, bookTicker, depth (ограниченная глубина/частота), mark price, funding, open interest и доступные derivative metrics.
- Каждый datum хранит `exchange_ts`, `receive_ts`, `source`, `symbol`, `freshness_ms`, `sequence` (если доступен).
- Нормализовать символы, интервалы, точность цены/qty и exchange filters. Не позволять UI/brain напрямую ходить в Binance endpoint — только через интеграционный слой.
- Implement reconnect/backoff, gap detection, REST resync после потери WS, health flags `FRESH/DEGRADED/STALE/OFFLINE`.
- Cross-exchange data (Bybit и др.) — optional adapter для подтверждения OI/flow, но отказ внешнего источника не должен ломать Binance execution.

## 6. Market Memory и Event Bus

Терминал должен иметь внутреннюю память состояния рынка, а не каждый раз заново собирать всё из UI. Хранить последние нормализованные данные, рассчитанные features, структурные события, активные watch-кандидаты, решения brains и открытые trade plans.

- Event bus / orchestrator события: `MARKET_TICK`, `BAR_CLOSED`, `STRUCTURE_EVENT`, `CANDIDATE_FOUND`, `BRAIN_OPINION`, `CONFLICT`, `AI_DECISION`, `PLAN_ARMED`, `ORDER_EVENT`, `POSITION_EVENT`, `EXIT_EVENT`, `TECH_ALERT`.
- Все события получают correlation/decision ID, чтобы восстановить полный causal chain.
- Тяжёлые AI-вызовы не запускаются на каждый тик. Быстрый код обнаруживает событие/изменение состояния и только тогда вызывает соответствующий brain/arbiter.

## 7. Macro Brain — обязательный верхний анализ

До глубокого анализа сделки строить macro context в порядке 1M(month) → 1W → 1D. Macro Brain не является тупым фильтром LONG/SHORT; он формирует контекст и вероятностные сценарии.

| TF | Что определять                                                                                                                                |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1M | Положение в многомесячной истории, price discovery/ATH, большой range, bottoming/top formation, макро-экстремумы и крупные ликвидные области. |
| 1W | Главный swing, accumulation/distribution, weekly acceptance/rejection, крупные зоны, тренд/сжатие/перелом.                                    |
| 1D | Текущий режим: trend/range/compression/expansion/breakdown/reclaim; ближайшая структура и пространство для движения.                          |

Macro вывод должен поддерживать формулировки вида `macro bearish, tactical squeeze-long allowed`, а не автоматически запрещать сделку против старшего тренда.

## 8. Специализированные Brains

| Brain              | Задача                                                                                                               | Ключевая особенность                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| PUMP / EXPANSION   | Искать подготовку к вертикальному движению, accumulation/compression, OI reset/rebuild, relative strength, ignition. | Оптимизирован на асимметричные right-tail moves и отдельный exit guardian.   |
| TREND              | Continuation, breakout/retest, pullback в устойчивом тренде.                                                         | Не путать обычное продолжение с vertical pump.                               |
| RANGE / FLAT       | Работа внутри боковика от валидных границ/ликвидности.                                                               | Отключать mean-reversion thesis при подтверждённом acceptance вне диапазона. |
| REVERSAL / SQUEEZE | Flush/reclaim, liquidation reversal, exhaustion, squeeze.                                                            | OI интерпретировать механизм-зависимо, а не `OI up good/OI down bad`.        |
| CATALYST / EVENT   | Внешние события/аномалии/листинги/новости, если подключены источники.                                                | Не обязателен для первой рабочей версии, но контракт заложить.               |

Brains независимы. Они не торгуют напрямую и не меняют позиции. Каждый возвращает стандартизированное мнение/кандидата.

## 9. Единый контракт BRAIN_OPINION

```
{
  "brain": "PUMP",
  "brain_version": "1.x",
  "symbol": "XYZUSDT",
  "side": "LONG|SHORT|NONE",
  "stage": "DISCOVERED|WATCH|ARMED|READY|REJECTED",
  "mechanism": "...",
  "alternative_mechanism": "...",
  "confidence": 0-100,
  "time_horizon": "...",
  "macro_context_id": "...",
  "evidence": [...],
  "counter_evidence": [...],
  "entry_idea": {...},
  "natural_invalidation": {...},
  "preferred_exit_mode": "...",
  "expiry": "...",
  "data_freshness": {...}
}
```

Никакой brain не имеет права скрыть контрдоводы. `counter_evidence` обязателен, чтобы arbiter сравнивал конкурирующие гипотезы, а не только положительные сигналы.

## 10. Conflict Engine — карта конфликтов

Конфликты не должны быть спрятаны только в prompt. Создать формальный Conflict Engine, который выявляет и передаёт AI-арбитру явную карту несовместимостей.

| Конфликт                                        | Правило/ожидаемое поведение                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| PUMP LONG vs bearish HTF                        | Не запрещать автоматически. Проверить squeeze/accumulation/relative strength; изменить горизонт/риск/exit mode, если tactical long валиден. |
| RANGE vs TREND                                  | Внутри принятого диапазона приоритет range. После acceptance + retest вне диапазона range-thesis ослабляется/отключается.                   |
| RANGE vs PUMP                                   | При подтверждённой vertical expansion запретить механический countertrend-short только из-за `верхней границы/перекупленности`.             |
| TREND vs REVERSAL                               | Одна красная свеча не даёт reversal права закрыть trend. Нужен механизм слома/failed reclaim/acceptance.                                    |
| PUMP vs REVERSAL                                | Критический конфликт: continuation vs exhaustion. Передать AI факты; execution не угадывает top.                                            |
| Два brains одной стороны                        | Не открывать две независимые позиции на один и тот же риск-событие. Объединить в одну hypothesis/plan и один risk budget.                   |
| LONG и SHORT одновременно                       | Arbiter выбирает одну гипотезу или NO_TRADE. Авто-система по умолчанию не хеджирует саму себя.                                              |
| Новый авто-сигнал при существующей авто-позиции | Не создавать конфликтующую позицию без explicit add/scale policy в исходном plan.                                                           |
| Авто vs ручная позиция                          | Автоматика не изменяет ручные позиции/ордера. Prefer physical account/subaccount isolation.                                                 |
| AI vs hard risk                                 | Hard safety contract имеет приоритет. Невалидный размер/маржа/order type отклоняется независимо от AI.                                      |
| Fresh vs stale data                             | Stale source исключить или деградировать confidence. Не усреднять слепо свежие и устаревшие данные.                                         |
| Неопределённость                                | NO_TRADE/WATCH — полноценный допустимый исход; не заставлять arbiter выбирать сделку.                                                       |

## 11. AI Brain / Arbiter

OpenAI API используется как reasoning-слой, а не как биржевой execution loop. Реализовать server-side AI Bridge через Responses API/structured outputs/function calling (или актуальный эквивалент на момент реализации). Модель/стоимость не хардкодить: вынести в конфигурацию и capability registry.

- AI получает компактный нормализованный market snapshot, macro context, brain opinions, conflict map, active portfolio state и relevant recent memory — не сырые миллионы тиков.
- AI возвращает строго валидируемый JSON по schema. Любой текст вне schema не является торговой командой.
- AI обязан выдать: `TRADE | WATCH | NO_TRADE`, winning mechanism, rejected hypotheses, exact plan proposal, confidence, key evidence, invalidation thesis, preferred exit mode, what-would-change-mind.
- Schema validator → semantic validator → risk validator. При ошибке: автоматический retry с repair prompt; после лимита — NO_TRADE/technical warning, но не `угадывание` значений.
- Хранить model ID, prompt/spec version, token/latency/cost metrics и decision hash в Ledger.
- LLM не участвует в sub-second exit path. Если AI временно недоступен, существующая позиция продолжает защищаться Execution Engine/Guardian.

## 12. Immutable TradePlan / Plan Compiler

```
TradePlan {
  plan_id, decision_id, symbol, side,
  market_regime, winning_brain, mechanism,
  entry_method, entry_price_or_zone,
  natural_invalidation, initial_stop,
  exit_mode, control_exit_mode,
  margin_cap_usdt, leverage_policy,
  allowed_actions, forbidden_actions,
  expires_at, created_at,
  source_versions, data_snapshot_id
}
```

После принятия план становится immutable. Любое изменение — новый revision/event, а не скрытая перезапись. Это необходимо для аудита и no-hindsight.

## 13. Execution Engine

- Поддержать Binance Futures order lifecycle: submit/ack/fill/partial fill/cancel/reject/retry/reconcile.
- Каждому авто-ордеру уникальный deterministic `clientOrderId`, связанный с `plan_id`, чтобы исключить повторное исполнение после reconnect/retry.
- Использовать exchange filters (tickSize, stepSize, minQty/minNotional), server time sync и pre-trade validation.
- Execution Engine не решает `стоит ли торговать`; он исполняет валидный TradePlan.
- Состояние Binance — источник истины для фактической позиции. Локальная БД должна регулярно reconciliate positions/orders с exchange state.
- Защищённое закрытие — reduceOnly/close semantics там, где применимо. Не допускать превращения exit order в новую противоположную позицию.

## 14. Разделение Manual Desk и Auto Desk

> **CRITICAL** — РАЗВИТИЕ TERMINAL OS НЕ ДОЛЖНО ОСТАНАВЛИВАТЬ ИЛИ МЕШАТЬ РУЧНОЙ ТОРГОВЛЕ. АВТОМАТИКА НЕ ИМЕЕТ ПРАВА ЗАКРЫВАТЬ, ДВИГАТЬ, ХЕДЖИРОВАТЬ ИЛИ ОТМЕНЯТЬ РУЧНЫЕ ПОЗИЦИИ/ОРДЕРА.

- Предпочтительная production-изоляция: отдельный Binance subaccount/API profile для AUTO. UI может объединять обзор, но execution accounts логически/физически раздельны.
- Если используется один аккаунт, маркировать все auto orders clientOrderId/tag и никогда не модифицировать order/position, происхождение которого не подтверждено как AUTO. В one-way mode это всё равно может быть недостаточно — поэтому отдельный auto account/subaccount считать целевым вариантом.
- Manual Desk должен отображать ручные позиции, ордера, PnL и цель владельца; AUTO Desk — свои сделки/модели/статистику. Их PnL и ledgers не смешивать.
- Позже Manual Desk может поддерживать пользовательский ручной order entry из терминала, но это отдельные user-initiated commands, не решения AI.

## 15. AUTO-LIVE observation policy — первые 14 дней

> **WARNING** — Это не отменяет инженерные тесты/replay. После завершения разработки и проверки интеграций боевой режим допускает AUTO-LIVE сразу, без многомесячного paper-gate.

| Параметр                  | Правило                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| MAX_AUTO_MARGIN_PER_TRADE | 1.00 USDT. Жёстко enforce на уровне Execution Engine, а не только в AI prompt.                                                |
| Число сделок              | Без дневного/общего лимита.                                                                                                   |
| PnL/DD stop               | Не останавливать торговлю из-за финансового результата в первые минимум 14 дней.                                              |
| Loss streak stop          | Нет.                                                                                                                          |
| Режим маржи               | Для AUTO целевой режим isolated; cross не использовать для автономного 1-USDT эксперимента.                                   |
| Leverage                  | Сделать явной настройкой Auto Account/Strategy Policy. Не брать значение из ручной торговли и не хардкодить без конфигурации. |
| Технический SAFE MODE     | Всегда активен; может запрещать новые авто-входы при технической целостности, но не из-за обычного PnL.                       |

Execution должен рассчитывать quantity так, чтобы фактическая initial margin/target margin не превышала 1 USDT при выбранном leverage, с учётом exchange filters и округления. Если невозможно соблюсти cap из-за minNotional/stepSize — сделку пропустить с reason `MARGIN_CAP_NOT_FEASIBLE`, а не превышать лимит.

## 16. Technical Safety / SAFE MODE

Разделить Trading Safety и Technical Safety. Первые 14 дней торговые stop-правила по результату отключены, но технические предохранители не отключаются никогда.

- duplicate order protection / idempotency
- stale market data detection
- exchange time desync detection
- invalid/unknown symbol filters
- position/order reconciliation mismatch
- AI schema/semantic rejection
- network/API authentication failures
- unexpected order burst/rate anomaly
- manual-order isolation violation
- database persistence failure
- unhandled exception/restart loop

SAFE MODE sequence: сохранить состояние → защитить/не ухудшать существующие AUTO-позиции согласно заранее разрешённым emergency rules → запретить новые AUTO-входы → Telegram/terminal alert → продолжать попытки восстановить data/exchange state. Никакой Telegram outage не должен влиять на безопасность исполнения.

## 17. Exit subsystem

Exit — отдельный домен и зависит от типа сделки. Не применять один универсальный trailing/TP ко всему рынку.

| Тип              | Базовый exit подход                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------- |
| RANGE            | Structural/fixed target на противоположной ликвидности/границе, если plan так определён. |
| TREND            | Structure/flow runner, time/invalidations, versioned logic.                              |
| PUMP             | CONTROL: fixed 3R (research baseline); CHALLENGER: fast Exit Guardian.                   |
| SQUEEZE/REVERSAL | Mechanism-specific exhaustion / failed continuation logic.                               |

CONTROL 3R — именно benchmark для сравнения, а не автоматически финальное торговое правило для всех стратегий.

## 18. Fast Exit Guardian

Guardian работает на sub-minute data и не ждёт AI. Его задача — различать резкий временный flush/shakeout и истинный слом механизма настолько хорошо, насколько это возможно детерминированным state machine.

```
NORMAL / EXPANSION
      ↓
FAST_FLUSH_DETECTED
      ├── fast reclaim + restored buying/acceptance → RECLAIM → HOLD
      ├── no reclaim + seller acceptance/failed rebound → FAILURE → EXIT
      └── data/execution fault → EMERGENCY_POLICY
```

- Входные данные: aggTrades/trade flow, bookTicker/depth (где устойчиво), price velocity, local reference zones, recent impulse context. OI — вторичный/медленный контекст, не единственный trigger.
- Никакого `exit because -10%` как единственного правила. Падение может быть V-flush.
- Параметры Guardian versioned и тестируются replay на positive/negative cases. Не оптимизировать только на выбранных победителях.
- Guardian не открывает новые directional positions. Его authority — reduce/close уже существующую AUTO-позицию в рамках plan.

## 19. Профессиональный график — полностью переделать

> **CRITICAL** — Текущий график считать неудовлетворительным и не пытаться лишь косметически подкрасить. Сделать production-grade chart experience, по удобству ориентированный на Binance Futures. Пользователь должен иметь возможность реально торговать и анализировать рынок, а не только смотреть свечи.

### 19.1. Обязательные взаимодействия графика

- Свечной график (candlesticks), корректная ширина/масштаб на 1m/5m/15m/1H/4H/1D/1W/1M.
- Плавный zoom колесом, horizontal pan/drag, vertical price scale drag, auto-scale, reset view, fit content, go-to-date, fullscreen.
- Никаких black-screen/blank-state при zoom/pan; устойчивый resize и восстановление после WebSocket reconnect.
- Crosshair + OHLCV tooltip, точная цена/время, magnet/snap для drawing tools.
- Live candle update без перерендера всей истории. Визуально различать open candle/closed candle.
- Клавиатурные hotkeys и контекстное меню для частых действий.
- Сохранение пользовательского layout/таймфрейма/масштаба/видимых слоёв на symbol/workspace.

### 19.2. Chart engine

Провести технический spike по production-grade open-source chart engine (например, TradingView Lightweight Charts/KLineChart или эквивалент) и выбрать решение, которое реально выдерживает нужные interactions, drawings и overlays. Не задавать вопрос пользователю. Решение задокументировать. Не использовать внешне управляемый TradingView widget как единственную основу, если он ограничивает наши собственные overlays/AI plans/order markers.

### 19.3. Слои и индикаторы

- Volume panel; EMA/SMA; VWAP/Anchored VWAP; ATR; RSI; MACD; ADX — как optional layers, не обязательные сигналы.
- Derivatives panels: OI, funding, taker buy/sell, delta/CVD (если корректно рассчитывается), liquidation/event markers при доступности данных.
- Structure overlays: swing/internal structure, BOS/CHoCH, EQH/EQL, FVG, order blocks/zones, MTF highs/lows, premium/discount, support/resistance — все независимо toggleable.
- Trade overlays: Entry, SL, TP, current position, liquidation/estimated liquidation (если данные доступны), realized exits, control 3R vs Guardian path.
- AI overlays: active mechanism, winning brain, invalidation zone, setup stage, conflict flags, short textual label. Не рисовать десятки старых setup одновременно.
- Focus mode: `ACTIVE SETUP ONLY` — скрыть всё, что не относится к текущей идее.

### 19.4. Drawing tools

- Horizontal/vertical line, trend line/ray, rectangle/zone, Fibonacci retracement, brush/arrow, text/note.
- Long/Short Position tool с Entry/SL/TP и автоматическим RR/%/PnL расчётом.
- Редактирование/перетаскивание/lock/delete/undo-redo; сохранение drawings по symbol/workspace.

## 20. UI/UX — Binance-like профессиональный terminal

Не копировать Binance визуально пиксель-в-пиксель; копировать привычную информационную архитектуру и скорость управления.

```
TOP BAR: account / mode / connectivity / AI / exchange / telegram / global PnL
LEFT: symbols / watchlist / scanner / filters / heatmap
CENTER: chart + multi-panel indicators + drawings + setup overlays
RIGHT: trade panel / current AI decision / order ticket / position controls
BOTTOM: positions | open orders | history | ledger | brain decisions | conflicts | alerts | research
```

### 20.1. Scanner / Watchlist

- Search symbol, favorites, custom lists, sector groups.
- Sortable columns: price, 24h%, volume, OI change, funding, ATR/volatility, relative strength, brain/stage, confidence, distance to level, freshness.
- Filters/presets: PUMP, TREND, RANGE, REVERSAL, WATCH, ARMED, READY, manual favorites.
- Rows update efficiently without jumping/reordering unless sort condition truly changes. Pin selected symbol.
- Click candidate → open chart at relevant timeframe/date + highlighted setup/levels + decision trace.

### 20.2. Order/Position panel

- Mode switch clearly: MANUAL / AUTO OBSERVE / AUTO LIVE (permissions govern actual actions).
- Manual ticket: Market/Limit/Stop, side, price, qty/margin, leverage, isolated/cross, TP/SL, reduce-only; user action only.
- AUTO panel: current TradePlan, source brains, margin cap, leverage policy, entry/SL/exit mode, state timeline. User can inspect; production auto can execute without click.
- Positions table: Manual and Auto visibly tagged, separate totals, one-click chart focus, order/plan linkage.

## 21. Unified Ledger — ядро системы

Создать одну нормализованную БД, которая хранит не только PnL, но и причинную цепочку. Google Sheets/CSV могут быть экспортом, но не source of truth.

| Ledger domain      | Что хранить                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Market snapshot    | Relevant candles/features/structure/flow/OI/funding, timestamps, freshness, source versions. |
| Brain opinions     | Каждое мнение, confidence, evidence/counter-evidence, version.                               |
| Conflicts          | Что конфликтовало, факты, resolution.                                                        |
| AI decision        | Model, prompt/spec version, structured output, latency, token/cost, hash.                    |
| Trade plan         | Immutable plan/revisions, risk/margin/leverage/expiry/permissions.                           |
| Orders/fills       | clientOrderId, exchangeOrderId, qty/price, partial fills, rejects, retry/reconcile events.   |
| Costs              | fees, funding, slippage estimate/actual where possible, API cost.                            |
| Outcome            | R/PnL, MFE, MAE, max giveback, exit reason, duration.                                        |
| Control/challenger | Для Pump: фиксированный 3R control vs Guardian outcome на одном market path.                 |
| System events      | Reconnects, stale data, errors, safe mode, deploy/version changes.                           |

## 22. Database / storage конечной версии

- Development/local: можно начать с SQLite для простоты, если текущий стек уже так устроен.
- Production target: PostgreSQL как основная transactional DB. Миграции versioned и воспроизводимы.
- Time-series: сначала PostgreSQL tables/partitioning; TimescaleDB/отдельное TSDB только при доказанной необходимости объёма/скорости.
- Redis — только если реально нужен для locks/cache/event coordination; не source of truth.
- Object storage/файлы — для тяжёлых replay datasets, exports, backups.
- Automatic backups + restore test. Бэкап, который не проверялся восстановлением, не считается готовым.

## 23. Research / Replay / Validation Lab

- Один и тот же signal/brain code должен уметь работать в REPLAY, PAPER и LIVE через адаптеры, чтобы не появлялось три разных логики.
- Replay строго chronological/no-lookahead. Внутри одной свечи при неоднозначности использовать более низкий TF/trade data либо консервативное правило и явно помечать ambiguity.
- Walk-forward/purged validation для новых версий, где применимо.
- Shadow/challenger: новая версия может считать решения параллельно production, но не торговать, пока не будет промотирована.
- Хранить false positives/failed pumps, а не только красивые победители.
- Никакого self-modifying production. Research может предложить vNext, но deploy — versioned release после тестов.

## 24. Использование полезных частей существующих проектов

| Источник               | Что извлечь                                                                                                | Что НЕ делать                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| smoke-trading-terminal | UI shell, Binance data, level-flow/V5/QFVG modules, paper observer, backtests, tests, deployment skeleton. | Не выбрасывать и не заменять новым продуктом.    |
| Smoke-strategy         | Exit diagnostics, pipeline/research patterns, regime/walk-forward идеи.                                    | Не продолжать как отдельный production terminal. |
| EMBER-Research-Engine  | No-lookahead discipline, WFO/validation/risk/reporting patterns.                                           | Не копировать весь проект целиком.               |
| telegram-signal-bot    | Runner исследования 2.5R/3R/4R/5R, исторические эксперименты, полезные validators.                         | Не использовать старый бот как production base.  |

Перед переносом любого кода проверить лицензию/зависимости, тесты и совместимость. Предпочитать перенос идеи/контракта и минимально необходимого кода, а не wholesale copy.

## 25. Telegram

Telegram — secondary control/notification channel. Он не является критическим execution dependency.

- Уведомления: AUTO entry/fill/partial fill/exit, large deviation, SAFE MODE, exchange/API errors, AI degraded, stale market data, deployment/restart.
- Команды после авторизации: `/status`, `/positions`, `/orders`, `/last_decisions`, `/system_health`, `/pause_auto_entries`, `/resume_auto_entries`.
- Команда не должна напрямую обходить risk/execution validation. Все команды проходят auth/audit и event ledger.
- Если Telegram недоступен, trading engine продолжает безопасно работать; событие сохраняется и отправляется после восстановления.

## 26. Observability / Health Center

- Dashboard: Binance REST/WS, market freshness, OpenAI, DB, Telegram, execution, Guardian, last reconcile, clock skew, error rate.
- Structured logs + request/decision IDs. Не логировать секреты/полные API keys.
- Metrics: scan latency, AI latency/cost, orders/rejects, reconnects, missed heartbeats, guardian events, DB write failures.
- Crash-safe supervisor/restart policy для будущего VPS. До VPS — локальный reproducible runner/Docker Compose по возможности.

## 27. Security / secrets

- Никаких секретов в GitHub, localStorage, client-side bundle или logs.
- OpenAI key — только server-side secret/env/secret manager.
- Binance AUTO key — trading permission only; withdrawals disabled. После VPS — IP whitelist.
- Telegram token — server-side secret.
- API endpoints, которые могут изменить позиции/ордера, требуют auth и server-side authorization.
- Implement rate limiting/CSRF/session protections согласно выбранному hosting model.

## 28. Functional completeness — что должно быть в терминале

Терминал должен быть `напичкан`, но не хаотично. Все расширенные функции обязаны быть управляемыми через workspace presets, layer manager и сворачиваемые панели.

- Multiple workspaces/layouts: Trading, Pump, Range, Research, Manual.
- Watchlists/scanner/heatmap; symbol search; favorites.
- Professional chart + drawings + indicators + structure/AI overlays.
- Order ticket + positions/open orders/history.
- Manual vs Auto separation.
- Brain panel: macro, opinions, conflicts, final arbiter decision.
- Alerts center + Telegram status.
- Ledger/audit/replay/backtest/research results.
- Performance dashboards by brain/regime/symbol/side/exit/model.
- Settings: exchange, AI models, cost budget, account policy, margin cap, leverage, modules, layers, notifications.
- Data freshness/source diagnostics visible без открытия devtools.

## 29. API cost / model usage accounting

- Не отправлять весь рынок в мощную модель постоянно. Cheap screen code → event/candidate → specialist/arbiter only when needed.
- Model routing configurable (fast/cheap model for triage, reasoning model for final arbitration). Не привязывать архитектуру к одному конкретному названию модели.
- Хранить tokens/cost/latency per call и cost per trade/decision/day.
- Prompt caching/compact snapshots использовать, когда это реально снижает стоимость без потери контекста.

## 30. Test strategy

Ни один модуль не считается готовым только потому, что `страница открылась`.

| Уровень     | Обязательные проверки                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Contracts, risk/margin calculations, conflict rules, indicator/structure calculations, schema validators, rounding/exchange filters.         |
| Integration | Binance public WS/REST, reconnect/resync, OpenAI mock/real sandbox call, DB writes, Telegram mock, order adapter in test mode.               |
| Replay      | Known pump/reversal/range/trend cases + false positives; no-lookahead.                                                                       |
| UI          | Chart zoom/pan/rescale/fullscreen, 1m/5m/15m density, layer toggles, scanner sort, position navigation, no black screen.                     |
| Execution   | Duplicate submit, retry after timeout, partial fill, reject, reconnect during order, stale data, exchange/local mismatch, reduce-only close. |
| Safety      | AI returns malformed JSON, absurd margin, missing stop, stale snapshot; manual order is present; DB fails; Telegram fails.                   |
| Regression  | Existing paper/backtest/tests remain passing or deliberately replaced with documented equivalent.                                            |

## 31. Acceptance criteria — продукт считается готовым, когда

1. Работает именно существующий `smoke-trading-terminal/main`; новый терминал/репозиторий не создан.
2. График полностью заменён/переработан и пригоден для реальной работы: свечи, zoom/pan, 1m-1M, drawings, overlays, no black screen, setup focus.
3. Market Data Layer получает и нормализует необходимые Binance Futures данные и показывает freshness/health.
4. Macro + Pump + Trend + Range + Reversal brains работают через единый контракт и не исполняют ордера напрямую.
5. Conflict Engine формирует явные конфликты; Arbiter возвращает schema-valid TRADE/WATCH/NO_TRADE.
6. TradePlan versioned/immutable и связывает decision→orders→fills→exit.
7. Execution Engine поддерживает live adapter и не может превысить 1 USDT auto margin cap в observation policy.
8. Manual orders/positions не модифицируются AUTO-контуром.
9. Exit Guardian реализован и имеет replay/control comparison против fixed 3R для Pump cases.
10. Unified Ledger позволяет открыть любую сделку и увидеть: что видел рынок → что сказали brains → конфликт → AI decision → plan → orders/fills → costs → exit → итог.
11. Telegram notifications/control работают, но отказ Telegram не ломает trading engine.
12. Technical SAFE MODE доказан тестами и не зависит от financial PnL stop.
13. Есть REPLAY/PAPER/LIVE adapters одного core logic; новые версии можно shadow-test без silent mutation production.
14. Проект собирается одной документированной командой, тесты проходят, есть runbook для локального запуска и отдельный production/VPS deployment guide.

## 32. Этапы реализации — агент должен идти до конца без повторного согласования

| Этап                             | Результат                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Audit & Backup                | Обновить main, зафиксировать SHA, tag rollback, inventory существующих функций/тестов, ADR target architecture.                                 |
| 1. UI + Chart Foundation         | Новый профессиональный chart engine, Binance-like layout, scanner/watchlist, workspace/layer system. Не ждать AI для завершения этого этапа.    |
| 2. Data + State + Ledger         | Unified market data facade, event IDs, DB schema/migrations, decision/order/system ledgers.                                                     |
| 3. Brains + Macro + Conflicts    | Единые contracts, Macro/Pump/Trend/Range/Reversal adapters, conflict engine, no direct execution.                                               |
| 4. AI Bridge + Arbiter           | Structured AI input/output, validation, retry/fallback, model/cost ledger, decision UI.                                                         |
| 5. Execution + Account Isolation | Binance live adapter, idempotency/reconcile, manual/auto separation, $1 margin cap policy.                                                      |
| 6. Exit Guardian                 | Fast stream, state machine, replay/control comparison, position protection.                                                                     |
| 7. Telegram + Observability      | Alerts/control commands, health center, logs/metrics.                                                                                           |
| 8. Hardening                     | E2E/safety/regression, docs, backup/restore, production config, VPS-ready deployment artifacts.                                                 |
| 9. AUTO-LIVE Observation         | После получения владельцем необходимых ключей: 14-day auto-live policy, unlimited trade count, 1 USDT margin cap, no PnL/DD stop, full metrics. |

После каждого этапа: запустить tests/build, проверить ключевые UI interactions, сделать atomic commit в main с понятным сообщением, обновить `PROJECT_STATUS.md`/handoff. Если этап не проходит — исправлять, а не переходить дальше с красными тестами.

## 33. Правила принятия решений агентом без вопросов

| Ситуация                                                       | Что делать                                                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Есть два разумных технических варианта                         | Выбрать более поддерживаемый/лицензионно безопасный/тестируемый, создать ADR, продолжить.                                                                   |
| Старый код плохой, но рабочий                                  | Сначала обернуть contract/tests, затем заменить инкрементально.                                                                                             |
| Нужен секрет                                                   | Создать placeholder/env schema/mock и продолжить. Не блокировать остальные этапы.                                                                           |
| UI решение не описано пиксельно                                | Ориентироваться на привычную информационную архитектуру Binance Futures и профессиональные trading terminals; приоритет скорость/читабельность/keyboard UX. |
| Новая идея улучшения стратегии                                 | Не внедрять напрямую в production. Добавить как challenger/research version и сравнить.                                                                     |
| Обнаружена несовместимость старой функции с новой архитектурой | Сохранить capability через adapter либо documented migration; не молча удалять.                                                                             |
| Неясно, что важнее: фича или стабильность                      | Стабильность, auditability и сохранность позиций выше декоративной фичи.                                                                                    |

## 34. Финальный deliverable от агента

Агент не должен закончить словами `архитектура готова`. Конечная сдача должна содержать работающий обновлённый терминал в `main`, а также короткий финальный отчёт:

- Starting SHA / Final SHA / список ключевых commits.
- Что изменено в UI/chart/data/brains/AI/execution/guardian/ledger/telegram.
- Какие старые функции сохранены/мигрированы/заменены и почему.
- Команды build/test/run + фактические результаты тестов.
- Список production secrets, которые ещё должен предоставить владелец (только названия, не значения).
- Что уже готово для AUTO-LIVE и что требует только подключения ключей/VPS.
- Known limitations/risks без маскировки.

## 35. OWNER ACTION REQUIRED — только после завершения доступной разработки

Не спрашивать это заранее. Когда код готов и реально дошёл до внешних подключений, владельцу потребуется выполнить только действия, которые нельзя безопасно сделать за него:

1. Создать/подключить OpenAI API project/key и billing; ключ хранить только server-side.
2. Создать Binance AUTO trading API credential / отдельный subaccount (предпочтительно), withdrawals disabled; позже добавить VPS IP whitelist.
3. Создать Telegram bot/token и chat authorization для уведомлений/команд.
4. Выбрать/задать AUTO leverage policy в UI перед первым live order; margin cap 1 USDT остаётся hard limit независимо от leverage.
5. Когда проект готов — приобрести VPS и развернуть production по подготовленному deployment guide.

## 36. Короткая формула проекта

> **INFO** — ОБЩИЕ ГЛАЗА И ПАМЯТЬ → MACRO 1M/1W/1D → СПЕЦИАЛИЗИРОВАННЫЕ BRAINS → CONFLICT ENGINE → AI ARBITER → IMMUTABLE TRADE PLAN → DETERMINISTIC EXECUTION → SPECIALIZED EXIT GUARDIAN → UNIFIED LEDGER → REPLAY/RESEARCH. РУЧНАЯ ТОРГОВЛЯ И AUTO-LIVE СОСУЩЕСТВУЮТ И НЕ ВМЕШИВАЮТСЯ ДРУГ В ДРУГА.