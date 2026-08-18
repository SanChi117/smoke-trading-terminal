# DONCHIAN_TREND_FOLLOWING_R1

## Purpose

This is a new, independent complete-strategy research track. It does not use Level Flow, FVG/QFVG, order blocks, reaction scoring, EMA pullback/reclaim rules, or the rejected breakout/retest trigger.

The hypothesis is classic positively-skewed trend following:

> A close beyond a sufficiently long 4H Donchian range can enter a persistent trend. The system accepts many small losses and exits winners only when price breaks a shorter opposite Donchian channel. Therefore profitability must be judged on net R/PF and robustness, not on requiring a win rate above 50%.

No parameter may be changed after the first aggregate result is visible.

## Frozen rules

### Timeframe

- Signal and execution timeframe: 4H.
- Only completed 4H candles generate signals.
- One position maximum per symbol.
- No pyramiding, averaging, partial exits, discretionary overrides, or re-entry while a position is open.

### Entry

Donchian entry lookback: **120 completed 4H candles** (approximately 20 days).

- LONG signal: current completed 4H close > highest high of the previous 120 completed 4H candles.
- SHORT signal: current completed 4H close < lowest low of the previous 120 completed 4H candles.
- Execution: next 4H open with adverse modeled slippage.

No higher-timeframe trend filter is used. The breakout itself defines direction.

### Initial risk

- ATR: Wilder ATR(14) on completed 4H candles, known at the signal close.
- Initial stop distance: **2.0 ATR(4H)** from actual modeled entry fill.
- Initial risk unit `1R` = absolute distance from entry fill to initial stop before fees.
- Stop is fixed; it is not widened.

### Trend exit

Donchian exit lookback: **60 completed 4H candles** (approximately 10 days).

- LONG channel exit signal: completed 4H close < lowest low of the previous 60 completed 4H candles.
- SHORT channel exit signal: completed 4H close > highest high of the previous 60 completed 4H candles.
- Channel exit executes at the next 4H open with adverse modeled slippage.
- Intrabar initial stop has priority over a later close-based channel exit signal.
- If price gaps through the stop, fill is modeled at the adverse next/open price rather than the stop price.

There is no TP and no time stop.

## Execution costs

Base scenario is fixed before results:

- commission: **5 bps per side**;
- slippage: **3 bps per side**, always adverse;
- total nominal round-trip friction before price-dependent effects: approximately **16 bps**.

Fees are charged on both entry and exit notional and converted into R using the trade's initial risk distance.

### Funding stress

Funding history is not used to tune the strategy. A separate conservative stress scenario subtracts an additional **1 bp per 8 hours of holding time**, always adverse, from every trade.

The base scenario is the primary result. The funding-stress scenario must remain non-negative at the aggregate level for R1 to advance.

## Fixed chronology

- DISCOVERY: 2022-01-01 through 2024-12-31.
- VALIDATION: 2025-01-01 through 2025-12-31.
- OOS: 2026-01-01 through 2026-07-31 23:59 UTC.

Trades are assigned to a split by entry time. A trade may exit after the split boundary; its full realized result remains attributed to its entry split.

## Fixed universe

BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT, ADAUSDT, SOLUSDT, DOGEUSDT, LINKUSDT, AVAXUSDT, DOTUSDT, LTCUSDT, ATOMUSDT, AAVEUSDT, NEARUSDT, INJUSDT, OPUSDT, ARBUSDT, APTUSDT, SUIUSDT, SEIUSDT, TAOUSDT, ONDOUSDT, TONUSDT, FETUSDT, WIFUSDT.

No post-result symbol replacement is allowed. A symbol without sufficient history is reported as insufficient.

## Reported metrics

For BASE and FUNDING_STRESS:

- trade count;
- total net R;
- average net R;
- median net R;
- profit factor;
- win rate;
- average win / average loss;
- payoff ratio;
- average and median holding time;
- LONG / SHORT breakdown;
- DISCOVERY / VALIDATION / OOS breakdown;
- per-symbol trade count, total R, average R and PF.

The aggregate also calculates a deterministic symbol-block bootstrap 95% interval for mean R by resampling whole symbols rather than individual trades. This reduces false confidence caused by correlated trades inside the same market.

## Predeclared R1 gate

`CANDIDATE_FOR_ROBUSTNESS_R2` only if **all** are true in the BASE scenario:

- at least 300 closed trades overall;
- OOS contains at least 30 closed trades;
- at least 10 symbols have at least 10 closed trades;
- total net R > 0 overall;
- average net R > 0 overall;
- overall PF >= 1.10;
- DISCOVERY total R > 0 and PF > 1.00;
- VALIDATION total R > 0 and PF > 1.00;
- OOS total R > 0 and PF > 1.00;
- deterministic symbol-block bootstrap 95% lower bound for mean R > 0;
- at least 55% of symbols with >= 8 trades have positive total R.

Funding stress additional gate:

- aggregate FUNDING_STRESS total R > 0;
- aggregate FUNDING_STRESS PF >= 1.00.

No minimum win rate is required.

## What a pass means

Passing R1 does **not** authorize PAPER or live money. It opens R2 robustness only, with the R1 parameters frozen. R2 must test parameter neighborhoods without selecting a new optimum, concentration by symbol/year/side, cost stress, execution edge cases, and portfolio concurrency.

## Stop rule

If R1 fails:

- do not change 120/60 lookbacks, 2 ATR stop, costs or slippage on this same result;
- do not add Level Flow, EMA filters, FVG/QFVG, volume filters or rescue gates;
- archive R1 as rejected;
- any subsequent study must be a separately predeclared strategy family.
