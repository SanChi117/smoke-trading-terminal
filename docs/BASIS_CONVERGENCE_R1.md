# Spot–Perpetual Basis Convergence R1

Research-only final discovery test. Production, PAPER, site and real orders are untouched.

## Hypothesis
When Binance USD-M perpetual futures trade at a positive premium to the same Binance spot asset, constrained arbitrage and the funding mechanism should pull the perpetual price back toward spot. A delta-neutral long-spot / short-perpetual portfolio should capture part of that convergence plus actual funding.

## Frozen data
- Fixed 50-symbol candidate list used by the other cross-sectional R1 tests.
- Binance Vision spot 1d klines + USD-M perpetual 1d klines + actual USD-M fundingRate archives.
- Report window: 2022-01-01 through 2026-07-31.
- Chronology: EARLY (<2025), Y2025, Y2026_KNOWN.

## Eligibility
At each Friday close:
- both spot and perpetual histories exist for >=365 calendar days;
- trailing 30d median quote volume >= $2m on BOTH spot and perpetual;
- current close-to-close basis is finite and strictly positive;
- at least 5 eligible positive-basis symbols.

## Signal and portfolio
- basis_t = perpetual_close_t / spot_close_t - 1.
- Rank eligible symbols from highest to lowest positive basis.
- Select top 20% (minimum 1).
- For each selected symbol: long spot and short its perpetual with equal pair weights.
- Aggregate portfolio gross exposure = 1.0: total spot sleeve +0.5, total perpetual sleeve -0.5.
- Rebalance each Friday after the close and hold until the next Friday rebalance.
- No negative-basis reverse trade because short spot is not assumed available.
- No basis threshold beyond basis > 0; no funding, trend, momentum, volatility, BTC-regime, sentiment or ML filter.

## Economics
- Daily price PnL = spot_weight * spot_return + perp_weight * perp_return.
- Actual funding PnL = -perp_weight * funding_rate for each archived funding event.
- BASE_COSTS = 8 bp per portfolio turnover unit.
- DOUBLE_COSTS = 16 bp.
- turnover = 0.5 * sum(abs(new instrument weight - old instrument weight)) across both spot and perpetual legs.
- No collateral yield, borrow yield or leverage beyond gross 1.0.

## Frozen support gate
`BASIS_CONVERGENCE_SUPPORTED_R1` requires BASE_COSTS:
- overall cumulative return > 0;
- Sharpe >= 0.75;
- max drawdown >= -0.20;
- EARLY cumulative > 0 and Sharpe > 0;
- Y2025 cumulative >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative >= 0 and Sharpe >= 0;
- funding coverage >= 99%;
- >=150 active Friday formations;
- median eligible positive-basis symbols >=5;
- DOUBLE_COSTS overall cumulative > 0;
- DOUBLE_COSTS Y2026_KNOWN cumulative >= 0.

If every chronological segment is nonnegative and overall is positive but the quality/stress gate misses: `BASIS_CONVERGENCE_INTERESTING_NOT_PROVEN`. Otherwise: `BASIS_CONVERGENCE_REJECT_R1`.

## Stop rule
No post-result change to universe, basis definition, positive-basis constraint, top-20% selection, weekly holding period, liquidity floor, costs, funding treatment, chronology or gate. This is the LAST discovery-class R1 in the current roadmap. After its verdict, discovery stops and work moves exclusively to frozen prospective/OOS finalists.
