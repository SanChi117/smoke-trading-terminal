# RESEARCH_MATRIX_R1

Research-only multi-hypothesis matrix. Production, PAPER and site behavior are untouched.

Purpose: test several economically distinct crypto mechanisms in parallel without post-result parameter search. Every hypothesis below is frozen before results and receives its own verdict. A matrix winner is NOT PAPER-eligible; it must be frozen again for prospective/OOS validation.

## Common universe / chronology
- fixed 50 Binance USDT-M symbols used by prior terminal research;
- Binance Vision 1d USD-M klines; spot 1d klines only where required; monthly fundingRate archives;
- known-period returns: 2022-01-01 through 2026-07-30;
- EARLY < 2025-01-01; Y2025; Y2026_KNOWN;
- symbol age >=365 calendar days;
- trailing 30d median futures quote volume >= $2m;
- minimum 10 eligible names at a formation;
- equal-weight long/short quintiles, +0.5/-0.5 gross, total gross 1.0;
- actual Binance funding applied to signed perp weights;
- BASE_COSTS = 8bp and DOUBLE_COSTS = 16bp per 0.5*sum(abs(delta weight)) turnover;
- no market-state filters, BTC filters, rescue tuning or parameter changes after results.

## H1 BASIS_DISLOCATION
Rationale: perpetual-futures literature identifies basis as one of the strongest cross-sectional predictors and shows the signal is strongest at high frequency.
- signal = perpClose / spotClose - 1 at the formation close;
- daily formation/rebalance;
- LONG lowest-basis quintile, SHORT highest-basis quintile;
- spot data is a signal only; PnL is measured on USD-M perpetual returns plus actual funding.

## H2 SHORT_REV_7D
Rationale: short-horizon cross-sectional reversal is behaviorally distinct from the previously tested 8-week reversal horizon.
- signal = 7-calendar-day close-to-close perp return;
- Friday formation/rebalance;
- LONG lowest-return quintile, SHORT highest-return quintile;
- hold until next Friday rebalance.

## H3 FUNDING_EXTREMES
Rationale: extreme funding contains positioning / carry information. This is directional cross-sectional testing, distinct from the rejected delta-neutral spot-perp funding-carry R1.
- signal = sum of actual Binance funding rates over trailing 7 calendar days;
- Friday formation/rebalance;
- LONG most-negative-funding quintile, SHORT most-positive-funding quintile;
- hold until next Friday rebalance.

## Per-hypothesis support gate
SUPPORTED only if BASE_COSTS simultaneously has:
- overall cumulative return > 0;
- overall Sharpe >= 0.75;
- max drawdown >= -0.30;
- EARLY cumulative >0 and Sharpe >0;
- Y2025 cumulative >=0 and Sharpe >=0;
- Y2026_KNOWN cumulative >=0 and Sharpe >=0;
- funding coverage >=0.99;
- median eligible >=20;
- DOUBLE_COSTS overall cumulative >0;
- DOUBLE_COSTS Y2026_KNOWN cumulative >=0.

If all chronology segments are nonnegative and overall is positive but the full quality gate misses: INTERESTING_NOT_PROVEN. Otherwise: REJECT.

## Multiple-testing rule
The matrix is a screening stage, not final evidence. No hypothesis can skip prospective validation because it was the best of the matrix. No cross-hypothesis blending or weighting is allowed after seeing R1 results.