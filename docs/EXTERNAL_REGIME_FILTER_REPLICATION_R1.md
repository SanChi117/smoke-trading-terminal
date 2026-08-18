# EXTERNAL_REGIME_FILTER_REPLICATION_R1

## Purpose

The prior frozen Donchian studies established a repeatable long-side trend-following edge through 2025, followed by a broad failure in 2026 across an untouched 25-symbol universe. Because 2026 is already known, this study is **not** labeled OOS and cannot promote a strategy.

Instead, it performs an external-specification replication:

> Keep the exact frozen LONG-only 4H Donchian 120/60/2ATR/cost mechanics and test only regime gates copied from independently published automated strategies, without tuning their thresholds to our 2026 failure.

This distinguishes externally motivated mechanisms from an ad-hoc filter invented after seeing the bad period.

## Sources frozen before results

### QUATTRO_CODE

Public `Quattro` research code in `EstebanSP23/crypto_systematic_research` gates BTC long entries using:

- 4H Donchian breakout;
- `4H close > aligned daily EMA200`.

The public README describes a rising EMA200 filter, but the published backtest code actually uses price-above-daily-EMA200. The two are therefore tested separately rather than conflated.

### QUATTRO_DOC / FIVE_EMA

The Quattro README and the independent `5 EMA + 200 EMA Slope Filter` strategy describe:

- daily EMA200 today > daily EMA200 20 days ago.

That exact 20-day slope rule is tested as a separate gate.

### APEX

The public `Apex — Multi-Asset 6-Month-High Breakout` strategy uses at the 4H signal close:

- close > SMA50;
- SMA50 > SMA200;
- volume > 1.5 × 20-bar average volume.

Those values are copied exactly.

## Frozen universe

Use the same 25 cross-asset symbols from the rejected `DONCHIAN_LONG_ONLY_CROSSASSET_OOS_R1` so the effect of each external gate is directly comparable:

BCHUSDT, TRXUSDT, XLMUSDT, ETCUSDT, FILUSDT, UNIUSDT, ICPUSDT, ALGOUSDT, VETUSDT, RUNEUSDT, GALAUSDT, SANDUSDT, MANAUSDT, CRVUSDT, CHZUSDT, LDOUSDT, DYDXUSDT, IMXUSDT, STXUSDT, COMPUSDT, SNXUSDT, ZECUSDT, KAVAUSDT, XTZUSDT, ENJUSDT.

No symbol replacement.

## Frozen base mechanics

All trade mechanics are unchanged from the cross-asset Donchian R1:

- LONG only;
- 4H completed-candle signals;
- entry: close > highest high of previous 120 completed 4H candles;
- execution: next 4H open;
- Wilder ATR(14);
- fixed initial stop: 2.0 ATR below modeled entry fill;
- trend exit: close < lowest low of previous 60 completed 4H candles, next 4H open;
- no TP, no pyramiding, no partials, no averaging;
- stop gap-through modeled adversely;
- commission 5 bps/side;
- adverse slippage 3 bps/side;
- funding-stress scenario: +1 bp per 8 holding hours;
- new entries 2022-01-01 through 2026-07-31;
- exit/evaluation data through 2026-08-17.

## Frozen profiles

Each profile is evaluated independently on the same symbol/history. Profiles are never OR-combined.

### BASE

No extra regime gate.

### QUATTRO_CODE

At the completed 4H breakout signal:

- use only the last fully closed daily candle available at that time;
- require 4H signal close > daily EMA200.

### EMA200_SLOPE20

At the completed 4H breakout signal:

- use only fully closed daily candles;
- require daily EMA200(now) > daily EMA200(20 closed daily candles earlier).

No price-above-EMA condition is added.

### APEX_FILTER

At the completed 4H breakout signal:

- 4H signal close > SMA50(4H);
- SMA50(4H) > SMA200(4H);
- current 4H volume > 1.5 × SMA20(volume).

## Causality

- Daily indicators are aligned only after the corresponding daily candle has closed.
- 4H indicators use the current completed signal candle and prior completed candles only.
- Entry remains next-4H-open.
- No future regime information may cancel a trade after entry; exits remain the frozen Donchian/stop mechanics.

## Chronological reporting

Because 2026 has already been observed, these labels are descriptive, not OOS claims:

- EARLY: 2022-01-01 through 2024-12-31;
- Y2025: 2025-01-01 through 2025-12-31;
- Y2026_KNOWN: 2026-01-01 through 2026-07-31.

## Metrics

For BASE and each external gate, report:

- closed trades;
- total / average / median net R;
- profit factor;
- win rate;
- average win / loss and payoff;
- average holding time;
- EARLY / Y2025 / Y2026_KNOWN breakdown;
- funding-stress results;
- per-symbol R;
- positive-symbol ratio;
- symbol-block bootstrap 95% interval for mean R;
- trade-retention ratio versus BASE.

Also report matched suppression diagnostics:

- number of BASE entry signals rejected by each gate;
- total BASE realized R of the trades that would have been rejected;
- the same rejected-trade R by EARLY / Y2025 / Y2026_KN.

The suppression diagnostic is explanatory only. It cannot redefine the gate after results.

## Predeclared mechanism interpretation

A gate is labeled `EXTERNAL_MECHANISM_SUPPORTED` only if all are true under BASE costs:

- at least 250 closed trades remain;
- at least 15 symbols remain represented;
- total R > 0;
- overall PF >= 1.15;
- EARLY total R > 0 and PF > 1.00;
- Y2025 total R > 0 and PF > 1.00;
- Y2026_KNOWN total R > 0 and PF > 1.00;
- symbol-block bootstrap 95% lower bound for mean R > 0;
- at least 60% of symbols with >=8 retained trades have positive total R;
- trade retention >= 25% of BASE;
- FUNDING_STRESS total R > 0 and PF >= 1.05;
- FUNDING_STRESS Y2026_KN total R >= 0.

Because 2026 is known, a pass means **mechanistic replication only**. It does not authorize PAPER or claim untouched validation.

## Ranking rule

If multiple gates pass, rank them by this fixed lexicographic order:

1. highest Y2026_KN total R;
2. highest overall PF;
3. highest retained trade count.

No weighted score or post-result threshold changes.

## Stop rule

After results are visible:

- do not alter EMA/SMA periods or volume multiplier;
- do not combine passing/near-passing filters into a new composite on this dataset;
- do not delete losing symbols;
- do not weaken the mechanism gate;
- do not call any result OOS;
- any supported mechanism must next be frozen and tested prospectively or on genuinely later data before promotion.

## Deferred second layer

Multi-speed Donchian ensembles and volatility targeting are intentionally excluded from R1 because they change signal architecture and/or portfolio sizing rather than acting as a simple entry gate. They require a separate external-replication study after this gate matrix is complete.
