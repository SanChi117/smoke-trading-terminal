# SKEWNESS_RISK_R1

Status: research-only independent cross-sectional mechanism test. Production, PAPER and site behavior are untouched.

## Question
Can lower realized skewness / asymmetry risk predict higher subsequent crypto returns after realistic costs and actual Binance funding?

## External rationale
Published 2024 cryptocurrency research reports a negative cross-sectional relationship between asymmetry/skewness risk and future cryptocurrency returns. This R1 uses a simple realized-return skewness proxy and deliberately avoids ML, interactions, momentum filters, market-state filters and post-result optimization.

## Frozen universe and data
- fixed 50-symbol Binance USDT-M candidate pool used by prior terminal research;
- Binance Vision USD-M 1d klines and monthly fundingRate archives;
- report period 2022-01-01 through 2026-07-31;
- chronology EARLY < 2025-01-01; Y2025; Y2026_KNOWN;
- symbol age >=365 calendar days at formation;
- trailing 30d median futures quote volume >= $2m;
- minimum 10 eligible symbols.

## Signal and formation
At each calendar month-end close:
1. Use the prior 60 daily close-to-close log returns ending at formation.
2. Compute sample realized skewness as mean((r-mean(r))^3) / sample_std(r)^3.
3. Rank eligible symbols ascending by realizedSkew60.
4. Long the lowest-skewness quintile and short the highest-skewness quintile.
5. Each sleeve has gross 0.5; total portfolio gross 1.0.
6. Hold until the next month-end rebalance.

No threshold, lookback, quantile, weighting, universe, cost or funding rule may be changed after the first result.

## Economics
- Daily PnL uses next-day USD-M close-to-close returns.
- Actual Binance funding is applied to signed perpetual positions: funding_pnl = -position_weight * funding_rate.
- No leverage beyond gross 1.0 and no collateral yield.

## Costs
- BASE_COSTS: 8 bp per unit of 0.5 * sum(abs(delta weight)) turnover.
- DOUBLE_COSTS: 16 bp under the same turnover convention.

## Predeclared support gate
`SKEWNESS_RISK_SUPPORTED_R1` requires BASE_COSTS:
- overall cumulative return > 0;
- overall Sharpe >= 0.75;
- max drawdown >= -0.30;
- EARLY cumulative return > 0 and Sharpe > 0;
- Y2025 cumulative return >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative return >= 0 and Sharpe >= 0;
- funding coverage >= 0.99;
- >=40 active month-end formations;
- median eligible universe >=20;
- DOUBLE_COSTS overall cumulative return >0;
- DOUBLE_COSTS Y2026_KNOWN cumulative return >=0.

If BASE_COSTS is positive in every chronological segment and overall but misses one quality/stress threshold, verdict is `SKEWNESS_RISK_INTERESTING_NOT_PROVEN`.
Otherwise verdict is `SKEWNESS_RISK_REJECT_R1`.

A pass is known-period evidence only and is not PAPER eligibility. Any pass requires separately frozen prospective/OOS validation.

## Stop rule
After results are visible, do not alter 60d skewness, monthly rebalance, quintiles, liquidity/age gates, costs, funding treatment, universe, chronology or support thresholds. No rescue tuning from R1 results is allowed.
