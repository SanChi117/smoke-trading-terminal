# TREND_PULLBACK_RECLAIM_R1

## Purpose

This is a new primary-entry research track opened after `TREND_BREAK_RETEST_EDGE_R1` was rejected.

The only component carried forward is the objectively measured **1D+4H EMA trend context**. It is carried as a contextual variable because the prior frozen replay showed a small persistent 1 ATR favorable-first bias across DISCOVERY, VALIDATION and OOS. No breakout/retest rule is reused.

The new hypothesis is simple:

> In an already aligned 1D/4H trend, a 1H pullback to a pre-known moving-average support/resistance level may offer better directional geometry than entering after a range breakout. Confirmation may either help or hurt; therefore TOUCH and RECLAIM are tested separately before results are visible.

No Level Flow, FVG/QFVG, order block, reaction score, discretionary zone, or production regime gate is used.

## Fixed context

At the close of each completed 1H candle:

### LONG

- last closed 1D close > EMA200(1D);
- EMA50(1D) > EMA200(1D);
- last closed 4H close > EMA50(4H);
- EMA50(4H) > EMA200(4H).

### SHORT

Exact inverse.

## Fixed local trend

All pullback levels are frozen from the **previous completed 1H candle**.

LONG local alignment:

- EMA20(1H) > EMA50(1H);
- previous 1H close > EMA50(1H).

SHORT is the exact inverse.

This prevents an EMA level moving during the touch candle from being used as a hindsight entry level.

## Fixed entry matrix

Two depths are tested independently: EMA20 and EMA50.

### EMA20_TOUCH

LONG:

- 1D+4H LONG context;
- local LONG alignment on the previous 1H candle;
- current 1H candle trades through the **previous candle's EMA20**;
- resting entry price is that frozen EMA20 value.

SHORT is inverse.

To avoid using the unknown post-touch path inside the same 1H candle, outcome measurement begins with the next 1H candle. Entry price remains the pre-known EMA level.

### EMA20_RECLAIM

The same EMA20 touch event, plus:

- LONG touch candle closes above the frozen EMA20 and closes bullish;
- SHORT touch candle closes below the frozen EMA20 and closes bearish.

Execution is next 1H open.

### EMA50_TOUCH / EMA50_RECLAIM

Exact same rules using the previous completed candle's EMA50.

### Cooldown

Each EMA depth/side **touch family** has a fixed 12-hour cooldown after an accepted touch event. TOUCH and RECLAIM at the same depth share the identical base touch-event stream; this preserves a causal matched comparison instead of allowing confirmation to change which touches enter the sample.

## Fixed chronology

Exactly the same chronology as the prior independent research track, but with new entry rules frozen before this result:

- DISCOVERY: 2022-01-01 through 2024-12-31;
- VALIDATION: 2025-01-01 through 2025-12-31;
- OOS: 2026-01-01 through 2026-07-31 23:00 UTC.

No thresholds may be changed after aggregate results are visible.

## Fixed universe

BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT, ADAUSDT, SOLUSDT, DOGEUSDT, LINKUSDT, AVAXUSDT, DOTUSDT, LTCUSDT, ATOMUSDT, AAVEUSDT, NEARUSDT, INJUSDT, OPUSDT, ARBUSDT, APTUSDT, SUIUSDT, SEIUSDT, TAOUSDT, ONDOUSDT, TONUSDT, FETUSDT, WIFUSDT.

No symbol replacement after results.

## Outcomes

No strategy SL/TP optimization in R1.

For every entry:

- signed return at 6h / 12h / 24h / 48h;
- MFE and MAE over those horizons;
- normalized by ATR(4H) known at entry;
- symmetric favorable-vs-adverse first-hit at 0.5 / 1.0 / 1.5 ATR(4H) within 48h;
- same-candle double barrier hit is `ambiguous`.

## Predeclared multiple-candidate control

Four entry candidates are evaluated (`EMA20_TOUCH`, `EMA20_RECLAIM`, `EMA50_TOUCH`, `EMA50_RECLAIM`). To reduce false discovery from choosing the best of four after the fact, candidate confidence is evaluated with a **98.75% Wilson interval** (Bonferroni family-wise alpha 5% across four routes).

## Candidate gate

A route can become `CANDIDATE_FOR_EXECUTION_BACKTEST` only if all are true:

- all-sample N >= 500;
- at least 10 symbols have >= 10 route events;
- 98.75% Wilson lower bound for 1 ATR favorable-first rate > 50%;
- median 24h signed return > 0;
- DISCOVERY favorable-first > 50%;
- VALIDATION favorable-first > 50%;
- OOS favorable-first > 50%;
- no split median 24h signed return < 0;
- route favorable-first rate is at least +2.0 percentage points above the contemporaneous `TREND_CONTEXT` aggregate baseline over the full sample.

For RECLAIM routes, two additional matched-event requirements apply:

- on the exact same touch events that qualify for reclaim, RECLAIM favorable-first must exceed TOUCH by >= +2.0 percentage points;
- matched median 24h signed-return delta must be >= 0 ATR(4H).

A TOUCH route does not need the matched confirmation requirement because it is the base entry for that EMA depth.

Passing this R1 opens only a separate execution backtest with costs and structural risk. It does not authorize PAPER.

## Stop rule

If no route passes:

- do not change EMA periods, cooldown or candle definitions on these same results;
- do not add breakout/retest, Level Flow, FVG or QFVG rescue filters;
- do not optimize exits to convert a failed directional route into apparent profitability;
- archive R1 and move to a genuinely different primary mechanism.
