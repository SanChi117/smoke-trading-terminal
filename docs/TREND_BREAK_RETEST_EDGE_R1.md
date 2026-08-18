# TREND_BREAK_RETEST_EDGE_R1

## Purpose

This is a **new, independent research track**. It is not Level Flow V7/V8 and does not assume that any SMOKE/Level Flow context, FVG, order block, QFVG, reaction score, RR exception, or production regime gate contains edge.

The hypothesis is deliberately simple and explainable:

> A market already trending on 1D and 4H may continue after a clean 1H range breakout; waiting for a confirmed retest of the broken level may improve the directional quality of the entry.

The first stage measures directional value only. It does not optimize SL/TP.

## Frozen market logic

### 1D trend

At the moment a completed 1H candle is evaluated:

- LONG context: last closed 1D close > EMA200(1D) and EMA50(1D) > EMA200(1D).
- SHORT context: last closed 1D close < EMA200(1D) and EMA50(1D) < EMA200(1D).
- otherwise: no direction.

### 4H alignment

LONG requires:

- last closed 4H close > EMA50(4H);
- EMA50(4H) > EMA200(4H).

SHORT is the exact inverse.

There are no Level Flow zones or discretionary overrides.

### 1H breakout

Using only completed 1H candles:

- lookback = 20 prior 1H candles;
- LONG breakout: current 1H close > highest high of the previous 20 candles;
- SHORT breakout: current 1H close < lowest low of the previous 20 candles;
- breakout direction must agree with 1D + 4H trend;
- one breakout event per side per symbol every 12 hours maximum, to reduce repeated highly correlated observations.

The broken level is frozen at the pre-breakout 20-hour range edge.

### Direct breakout reference

`BREAKOUT_DIRECT` enters at the **next 1H open** after the breakout candle closes.

### Confirmed retest

A retest may occur during the next 12 completed 1H candles.

LONG retest requires:

- candle low <= breakout level + 0.15 ATR(1H);
- candle close > breakout level;
- candle close > candle open.

SHORT uses the exact inverse.

Before a retest completes, the event is invalidated if a 1H candle closes more than 0.25 ATR(1H) through the broken level in the wrong direction.

`BREAKOUT_RETEST` enters at the **next 1H open** after the qualifying retest candle closes.

No parameter in these rules may be changed after the first aggregate result is visible.

## Outcomes

No strategy SL/TP is optimized in R1.

For each context/breakout/retest observation measure:

- signed return at 6h / 12h / 24h / 48h;
- MFE and MAE over the same horizons;
- all normalized by ATR(4H) known at entry;
- symmetric favorable-vs-adverse first-hit at 0.5 / 1.0 / 1.5 ATR(4H) within 48h.

If both symmetric barriers are touched in the same 1H candle, the barrier result is `ambiguous` and excluded from resolved favorable-rate.

## Fixed chronology

The full research history is partitioned **before results**:

- `DISCOVERY`: 2022-01-01 through 2024-12-31;
- `VALIDATION`: 2025-01-01 through 2025-12-31;
- `OOS`: 2026-01-01 through 2026-07-31 23:00 UTC.

Rules are frozen across all three periods. OOS may not be used to retune this R1. If the route fails, R1 is closed instead of repaired on the same sample.

## Fixed universe

No post-result symbol replacement:

BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT, ADAUSDT, SOLUSDT, DOGEUSDT, LINKUSDT, AVAXUSDT, DOTUSDT, LTCUSDT, ATOMUSDT, AAVEUSDT, NEARUSDT, INJUSDT, OPUSDT, ARBUSDT, APTUSDT, SUIUSDT, SEIUSDT, TAOUSDT, ONDOUSDT, TONUSDT, FETUSDT, WIFUSDT.

Symbols without sufficient history are reported as unavailable for the affected split; they are not replaced.

## Predeclared interpretation

### Trend context

`TREND_CONTEXT` is descriptive support, not a trading signal. It is sampled at most once per 24h per symbol while 1D+4H alignment exists.

### Breakout direct

`BREAKOUT_DIRECT` is considered directionally promising only if:

- all-sample N >= 400;
- at least 10 symbols have >= 10 events;
- all-sample Wilson 95% lower bound for the 1 ATR favorable-first rate is > 50%;
- all-sample median 24h signed return > 0;
- DISCOVERY, VALIDATION and OOS favorable-first rates are each > 50%;
- no split favorable-first rate is < 48%.

### Breakout retest

`BREAKOUT_RETEST` is considered `CANDIDATE_FOR_EXECUTION_BACKTEST` only if all are true:

- all-sample N >= 150;
- at least eight symbols have >= five retest entries;
- all-sample Wilson 95% lower bound for 1 ATR favorable-first rate > 50%;
- all-sample median 24h signed return > 0;
- DISCOVERY, VALIDATION and OOS favorable-first rates are each > 50%;
- no split favorable-first rate is < 48%;
- on the exact same breakout events that later retested, the retest route improves 1 ATR favorable-first rate by at least +3 percentage points versus `BREAKOUT_DIRECT`;
- matched median 24h signed-return delta is >= 0 ATR(4H).

Passing R1 still does **not** authorize PAPER. It only opens R2: a frozen execution backtest with structural stop, transaction costs, one fixed exit model, then separate robustness checks.

## Stop rule

If `BREAKOUT_RETEST` does not pass the frozen criteria:

- do not lower thresholds after seeing the result;
- do not add FVG/OB/QFVG or Level Flow rescue gates;
- do not optimize SL/TP to disguise a directional failure;
- archive R1 and test a genuinely different primary mechanism.
