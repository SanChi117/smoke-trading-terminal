# COINTEGRATION_STAT_ARB_R1

Status: research-only independent mechanism test. Production, PAPER and site behavior are untouched.

## Question

Can a simple causal cointegration/mean-reversion pairs strategy produce robust net returns on Binance USD-M perpetuals after realistic transaction costs and actual funding?

This is a different mechanism class from trend, medium-horizon cross-sectional reversal and funding carry.

## External rationale

Published cryptocurrency pairs-trading research has repeatedly used cointegration and mean-reverting spreads as a statistical-arbitrage mechanism. This R1 deliberately avoids ML, dynamic hyperparameter optimization and post-result universe tuning.

## Frozen universe and data

- same fixed 50-symbol Binance USDT-M candidate pool used by the preceding research matrix;
- Binance Vision USD-M 1d klines and monthly fundingRate archives;
- report period: 2022-01-01 through 2026-07-31;
- chronology: EARLY < 2025-01-01; Y2025; Y2026_KNOWN;
- symbol must have >=365 calendar days of history at formation;
- 30-day median futures quote volume >= $2m for both legs.

## Formation and pair selection

Every Friday after the completed daily close:

1. Use the trailing 120 daily closes ending on that Friday.
2. For every eligible unordered pair A/B, regress log(A) on [1, log(B)] by ordinary least squares.
3. Reject if hedge beta <=0.
4. Compute residual spread over the same 120 observations.
5. Apply an ADF(0) residual regression: delta spread_t = alpha + phi * spread_{t-1} + error.
6. Require ADF t-stat(phi) <= -3.0.
7. Require absolute current residual z-score >=1.5 using the same trailing residual mean/std.
8. Rank candidates by absolute z-score descending, then by more-negative ADF t-stat.
9. Select at most 5 pairs greedily with no symbol reused in more than one pair that week.

No threshold or ranking parameter may be changed after the first result.

## Trade construction

- Signal is formed at Friday close using only data available at that close.
- Trade applies from the next daily return onward for exactly 7 calendar/daily observations or until the next Friday rebalance, whichever is represented first in the daily series.
- If z > 0: short A, long beta*B.
- If z < 0: long A, short beta*B.
- Normalize absolute leg notionals so each pair has gross exposure 1.0.
- Equal-weight all selected pairs, so portfolio gross exposure is <=1.0.
- No leverage beyond gross 1.0; no collateral yield.
- Actual funding is applied to each signed perpetual leg with funding_pnl = -position_weight * funding_rate.
- Daily price PnL uses close-to-close returns.

## Costs

Two frozen profiles:
- BASE_COSTS: 8 bp per unit of absolute turnover;
- DOUBLE_COSTS: 16 bp per unit of absolute turnover.

Positions are marked to zero and rebuilt at each Friday rebalance. Entry and exit/rebalance turnover are therefore charged explicitly through portfolio-weight turnover.

## Predeclared support gate

`COINTEGRATION_STAT_ARB_SUPPORTED_R1` requires BASE_COSTS to satisfy all of:
- overall cumulative return > 0;
- overall Sharpe >= 0.75;
- overall max drawdown >= -0.20;
- EARLY cumulative return > 0 and Sharpe > 0;
- Y2025 cumulative return >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative return >= 0 and Sharpe >= 0;
- funding coverage >= 0.99;
- >=100 Friday formations with at least one selected pair;
- median selected pairs per active formation >=2;
- DOUBLE_COSTS overall cumulative return > 0;
- DOUBLE_COSTS Y2026_KNOWN cumulative return >=0.

If BASE_COSTS is profitable in every chronological segment but misses one quality/stress threshold, verdict is `COINTEGRATION_STAT_ARB_INTERESTING_NOT_PROVEN`.

Otherwise verdict is `COINTEGRATION_STAT_ARB_REJECT_R1`.

Passing is a known-period mechanism result only and is not PAPER eligibility. A pass requires a separately frozen prospective/OOS validation.

## Stop rule

After results are visible, do not change 120d lookback, ADF threshold, z threshold, max pairs, no-overlap rule, holding/rebalance interval, liquidity gate, costs, funding treatment, universe, chronology or support thresholds. No rescue tuning from R1 results is allowed.
