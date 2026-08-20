# LOW_VOLATILITY_R1

Status: research-only independent cross-sectional mechanism test. Production, PAPER and site behavior are untouched.

## Question
Can the recently documented cryptocurrency low-volatility premium survive realistic Binance USD-M costs and actual funding in the terminal's fixed research universe?

## External rationale
Pyo & Jang (Finance Research Letters, 2026, DOI 10.1016/j.frl.2026.109851) report that lower-realized-volatility cryptocurrencies outperform higher-volatility cryptocurrencies in recent Binance data, with the strongest spread around 2–3 month formation windows and 1-month holding horizons. This R1 freezes one simple replication before results.

## Frozen universe/data
- fixed 50-symbol Binance USDT-M research pool;
- Binance Vision 1d USD-M klines and monthly fundingRate archives;
- report 2022-01-01 through 2026-07-31;
- EARLY < 2025-01-01, Y2025, Y2026_KNOWN;
- >=365 calendar days of history;
- 30d median futures quote volume >= $2m;
- at least 10 eligible symbols at formation.

## Signal and portfolio
At each calendar month-end after the completed daily close:
1. Compute 60-day realized volatility from the preceding 60 daily log returns, annualized by sqrt(365).
2. Sort eligible symbols ascending by realized volatility.
3. Long the lowest-volatility quintile and short the highest-volatility quintile.
4. Equal-weight within sleeves: +0.5 gross long, -0.5 gross short, total gross 1.0.
5. Hold until the next calendar month-end rebalance.
6. Daily PnL uses next-day close-to-close returns, so no same-close execution benefit is used.
7. Apply actual Binance funding to every signed perpetual position: funding_pnl = -weight * funding_rate.

No momentum, trend, BTC, market-regime, size, carry or reversal filter is allowed.

## Costs
- BASE_COSTS: 8 bp per unit of one-way portfolio turnover using 0.5 * sum(abs(delta weight));
- DOUBLE_COSTS: 16 bp under the same convention.

## Predeclared support gate
`LOW_VOLATILITY_SUPPORTED_R1` requires BASE_COSTS:
- overall cumulative return > 0;
- Sharpe >= 0.75;
- max drawdown >= -0.30;
- EARLY cumulative return > 0 and Sharpe > 0;
- Y2025 cumulative return >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative return >= 0 and Sharpe >= 0;
- actual-funding coverage >= 0.99;
- >=40 active month-end formations;
- median eligible symbols >=20;
- DOUBLE_COSTS overall cumulative return > 0;
- DOUBLE_COSTS Y2026_KNOWN cumulative return >=0.

If BASE_COSTS is profitable in every chronological segment but misses one quality/stress threshold, verdict is `LOW_VOLATILITY_INTERESTING_NOT_PROVEN`. Otherwise `LOW_VOLATILITY_REJECT_R1`.

A pass is known-period evidence only and requires a separately frozen prospective/OOS test before PAPER.

## Stop rule
After results are visible, do not change the 60-day formation window, monthly holding horizon, quintiles, weights, universe, liquidity/age gates, costs, funding treatment, chronology or support thresholds. No rescue tuning.