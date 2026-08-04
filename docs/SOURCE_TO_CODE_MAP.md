# Source → code map

Проект создан на основе материалов в переданной папке Google Drive и существующего research-репозитория `SanChi117/Smoke-strategy`.

| Учебный/проектный блок | Формализация в терминале |
|---|---|
| TDA / BIAS & Context | 1D/4H resampling и context alignment в `mtf_feature_builder.py` |
| Entry Model Logic | 15m `pullback` / `ignition` в `setup_generator.py` |
| Liquidity / IDM / Strong High-Low | liquidity/candle states и объяснимые block reasons |
| Premium / Discount / POI | range position, Donchian location и интерфейсные зоны |
| Order Flow | direction context и структурная доставка |
| FROM → TO → HOW | вкладка «Логика» и последовательность context → trigger → risk |
| Risk management | risk cap 1%, costs, capacity gate, conservative exits |
| Smoke decision log | frozen filter `TAGGED_MTF_NO_DIRECTION_BLOCK_V1` |
| Paper-review protocol | SQLite journal, 100 trades + 30 days, kill-switch |

## Что не выдается за формализованное

- визуальная интерпретация POI «на глаз»;
- полный биржевой footprint/CVD без проверенного источника;
- новости как автоматический триггер;
- order book одной биржи как proxy исполнения на другой;
- прибыльность на основании одной монеты или короткого окна.

Эти элементы можно добавлять только как отдельные данные/telemetry с новой контролируемой проверкой.

