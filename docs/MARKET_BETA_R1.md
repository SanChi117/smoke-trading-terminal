# MARKET_BETA_R1

Research-only independent cross-sectional risk-factor replication. Production, PAPER and site behavior are untouched.

## Frozen protocol
- Universe: fixed 50 Binance USD-M symbols used by the research matrix; BTCUSDT is benchmark only and excluded from tradable ranking.
- Known-period report: 2022-01-01 through 2026-07-31 UTC.
- Eligibility at formation: age >=365 calendar days, trailing 30d median futures quote volume >= $2m, minimum 10 eligible symbols.
- Formation: calendar month-end close.
- Signal: OLS beta from 60 daily close-to-close log returns, asset_return = alpha + beta * BTC_return.
- Rank beta ascending.
- Long lowest-beta 20%; short highest-beta 20%.
- Equal weight within sleeves, +0.5 / -0.5 gross, total gross 1.0.
- Hold until next month-end.
- Daily PnL: next-day Binance USD-M close-to-close return.
- Funding: actual Binance Vision USD-M funding; signed contribution = -position_weight * funding_rate.
- Costs: BASE 8bp and DOUBLE 16bp applied to 0.5 * sum(abs(delta weight)) turnover.
- Chronology: EARLY (<2025), Y2025, Y2026_KNOWN.
- No trend, momentum, volatility, sentiment, BTC regime, liquidity interaction, ML or rescue filters.
- No post-result lookback, quantile, weighting, universe, cost or threshold tuning.

## Predeclared verdict
MARKET_BETA_SUPPORTED_R1 requires BASE overall cumulative >0, Sharpe >=0.75, max drawdown >=-0.30, EARLY positive with Sharpe>0, Y2025 nonnegative with Sharpe>=0, Y2026_KNOWN nonnegative with Sharpe>=0, funding coverage >=0.99, >=40 active formations, median eligible >=20, DOUBLE overall positive and DOUBLE Y2026_KNOWN nonnegative.

If BASE overall and all chronological segments are positive but one or more quality/stress gates miss: MARKET_BETA_INTERESTING_NOT_PROVEN. Otherwise: MARKET_BETA_REJECT_R1.

Any pass still requires separately frozen prospective/OOS validation before PAPER.