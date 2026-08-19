# CROSS_SECTIONAL_REVERSAL_ACTUAL_FUNDING_R1

Status: research-only extension of CROSS_SECTIONAL_REVERSAL_R1. Production and PAPER logic are untouched.

## Question

Does the previously observed HIGHVOL 8-week loser-minus-winner cross-sectional reversal remain viable when the synthetic +3 bp/day funding stress is replaced by actual historical Binance USD-M perpetual funding rates?

This test does not change the strategy, universe, ranking, holding period, volatility split, turnover model, or chronology.

## Frozen strategy

Exactly the already-frozen CROSS_SECTIONAL_REVERSAL_R1 implementation:
- fixed 50-symbol Binance USDT-M candidate pool;
- weekly Friday formation using only information available through the completed daily bar;
- trailing 56-day return ranking;
- long loser quintile / short winner quintile;
- 56-day holding period;
- overlapping weekly sleeves;
- BASE_LMW_8W and HIGHVOL_LMW_8W profiles;
- HIGHVOL means retain assets at or above the cross-sectional median trailing 56-day annualized volatility before ranking;
- market-neutral 50% gross long / 50% gross short sleeve construction;
- 8 bp per unit of one-way portfolio turnover.

## Actual funding model

Historical funding is fetched from Binance USD-M Futures `/fapi/v1/fundingRate` for every symbol, with pagination and no synthetic interpolation.

For each portfolio day, the price return is the close-to-close return already used by R1. Funding events after the entry close and through the next daily close are charged to that day. With daily Binance bars timestamped by opening time, that corresponds to funding timestamps on the next UTC calendar day.

For every funding event:

`funding_pnl = -position_weight * funding_rate`

Therefore:
- positive funding: longs pay, shorts receive;
- negative funding: longs receive, shorts pay.

Daily net return:

`net = gross_price_return - turnover_cost + actual_funding_pnl`

No funding cap, floor, smoothing, average, or substitute stress rate is used.

## Coverage rule

For every active symbol-day we expect historical funding observations. The aggregator records gross-weighted funding coverage.

A result cannot pass if overall weighted funding coverage is below 99%.

## Chronology

Unchanged:
- EARLY: 2022-01-01 through 2024-12-31;
- Y2025: 2025-01-01 through 2025-12-31;
- Y2026_KNOWN: 2026-01-01 through 2026-07-31.

This remains a known-period mechanism test, not untouched OOS.

## Predeclared support gate

`ACTUAL_FUNDING_SUPPORTS_HIGHVOL_REVERSAL_R1` requires HIGHVOL_LMW_8W with actual funding to satisfy all of:
- overall cumulative return > 0;
- overall Sharpe >= 0.50;
- overall max drawdown >= -0.35;
- EARLY cumulative return > 0 and Sharpe > 0;
- Y2025 cumulative return >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative return >= 0 and Sharpe >= 0;
- overall gross-weighted funding coverage >= 0.99.

If HIGHVOL remains profitable in every chronological segment but misses one of the quality thresholds, verdict is `ACTUAL_FUNDING_INTERESTING_NOT_PROVEN`.

Otherwise verdict is `ACTUAL_FUNDING_REJECTS_HIGHVOL_REVERSAL_R1`.

Passing this gate does NOT promote the strategy to PAPER because the period is already known. A pass only justifies a separately preregistered prospective / untouched OOS validation.

## Stop rule

After results are visible, do not change:
- 8-week formation;
- 8-week holding;
- quintile cut;
- HIGHVOL median split;
- universe;
- fees;
- chronology;
- support thresholds;
- funding sign convention;
- funding aggregation timing.

No rescue tuning from the observed funding result is allowed.
