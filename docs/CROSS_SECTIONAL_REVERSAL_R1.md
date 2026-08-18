# CROSS_SECTIONAL_REVERSAL_R1

## Purpose

Research-only replication of an independent crypto strategy class: cross-sectional medium-horizon reversal. This branch does not modify Level Flow, QFVG, terminal production, PAPER, or any existing strategy route.

External hypothesis frozen before our results:

- rank tradable crypto assets by their trailing 8-week return;
- buy recent losers and short recent winners;
- form a new sleeve weekly;
- hold each sleeve for 8 weeks;
- combine the overlapping sleeves in calendar time.

The recent paper `Reversal in Cryptocurrency Returns` reports reversal concentrated at 8- to 10-week formation horizons on Binance USDT pairs and stronger results among higher-volatility assets. This repository test is an independent replication on Binance USDT-M futures, not a reproduction claim.

## Candidate universe

Fixed candidate pool, declared before results:

BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT, ADAUSDT, SOLUSDT, DOGEUSDT, LINKUSDT, AVAXUSDT, DOTUSDT, LTCUSDT, ATOMUSDT, AAVEUSDT, NEARUSDT, INJUSDT, OPUSDT, ARBUSDT, APTUSDT, SUIUSDT, SEIUSDT, TAOUSDT, ONDOUSDT, TONUSDT, FETUSDT, WIFUSDT, BCHUSDT, TRXUSDT, XLMUSDT, ETCUSDT, FILUSDT, UNIUSDT, ICPUSDT, ALGOUSDT, VETUSDT, RUNEUSDT, GALAUSDT, SANDUSDT, MANAUSDT, CRVUSDT, CHZUSDT, LDOUSDT, DYDXUSDT, IMXUSDT, STXUSDT, COMPUSDT, SNXUSDT, ZECUSDT, KAVAUSDT, XTZUSDT, ENJUSDT.

Eligibility at a rebalance date requires:

- at least 365 calendar days since the first available futures daily candle;
- at least 56 completed daily observations before formation-end;
- trailing 30 completed daily candles median quote volume >= $2,000,000;
- valid trailing 56-day return and trailing 56-day realized volatility.

No symbol is added or removed after results based on profitability.

## Formation and rebalance

- Frequency: weekly, using the last completed daily candle with UTC weekday Friday.
- Formation horizon: 56 calendar/daily observations (8 weeks) ending on the rebalance close.
- Formation return: close[t] / close[t-56] - 1.
- No skip week in R1.
- Cross-sectional ranking uses only values known at the completed rebalance close.

## Portfolio construction

At each weekly rebalance:

1. build the eligible cross-section;
2. sort by trailing 8-week return ascending;
3. bottom quintile = LOSERS, top quintile = WINNERS;
4. create one market-neutral sleeve:
   - +50% notional equally across LOSERS;
   - -50% notional equally across WINNERS;
   - sleeve gross = 100%, net = 0%;
5. sleeve is held for exactly 8 weekly holding intervals;
6. active sleeves are equally averaged.

This overlapping implementation prevents one arbitrary weekly start date from dominating the result.

## Profiles

### BASE_LMW_8W

Uses all eligible symbols.

### HIGHVOL_LMW_8W

Before return ranking, retain only symbols whose trailing 56-day annualized realized volatility is at or above the cross-sectional median on that rebalance date. Then form loser and winner quintiles inside that high-volatility subset.

No other filters are permitted in R1.

## Return timing and causality

- ranking is calculated after the completed Friday close;
- resulting sleeve weights apply from that close to subsequent daily close-to-close returns;
- no future close, volume, volatility, delisting date or future eligibility information is used;
- a symbol without the next required daily return contributes no new future observation and is marked unavailable rather than forward-filled.

## Costs

Portfolio costs are charged on actual weight changes:

- 8 bps per unit of one-way portfolio turnover (5 bps commission + 3 bps adverse-execution allowance).

Stress profile:

- BASE_COSTS: 8 bps turnover only;
- FUNDING_STRESS: BASE_COSTS plus 3 bps per day multiplied by gross short exposure and 3 bps per day multiplied by gross long exposure (deliberately conservative symmetric carry stress).

## Chronology

Report separately:

- EARLY: 2022-01-01 through 2024-12-31;
- Y2025: 2025-01-01 through 2025-12-31;
- Y2026_KNOWN: 2026-01-01 through 2026-07-31.

Because the external paper and our prior research already reveal part of 2021-2026 behavior, this experiment is mechanism replication, not untouched OOS.

## Metrics

For BASE_LMW_8W and HIGHVOL_LMW_8W under BASE_COSTS and FUNDING_STRESS:

- cumulative return;
- CAGR;
- annualized volatility;
- Sharpe;
- max drawdown;
- average gross and net exposure;
- one-way turnover;
- number of weekly formations;
- median eligible symbols;
- median loser/winner basket size;
- split metrics for EARLY / Y2025 / Y2026_KNOWN;
- contribution by symbol and by long/short side.

## Predeclared mechanism gate

`REVERSAL_MECHANISM_SUPPORTED` requires at least one of BASE_LMW_8W or HIGHVOL_LMW_8W to satisfy ALL:

- BASE_COSTS cumulative return > 0;
- BASE_COSTS Sharpe >= 0.75;
- BASE_COSTS max drawdown <= 25%;
- EARLY cumulative return > 0 and Sharpe > 0;
- Y2025 cumulative return >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative return >= 0 and Sharpe >= 0;
- FUNDING_STRESS cumulative return > 0;
- FUNDING_STRESS Y2026_KNOWN cumulative return >= 0;
- at least 100 weekly formation events;
- median eligible cross-section >= 15 assets.

If performance is positive but one or more gates fail, verdict is `REVERSAL_INTERESTING_NOT_PROVEN`. If both profiles are non-positive or materially unstable, verdict is `REVERSAL_REJECT_R1`.

## Stop rule

After results, do NOT:

- change 8 weeks to the best-looking horizon;
- change quintiles to terciles/deciles after seeing results;
- add a skip week after seeing results;
- select historically winning symbols;
- tune the volatility cutoff;
- remove bad years;
- reinterpret this known-period replication as OOS.

A supported mechanism must be frozen and then evaluated on a later untouched/prospective interval before PAPER eligibility.
