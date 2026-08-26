# DOWNSIDE_BETA_R1

Research-only known-period replication. Production/PAPER/site are untouched.

## Frozen hypothesis
Crypto downside risk literature reports a positive cross-sectional premium for systematic downside exposure. Test whether Binance USD-M coins with higher BTC downside beta outperform lower-downside-beta coins.

## Frozen protocol
- Universe: same fixed 50 Binance USD-M symbols used by adjacent R1 tests; BTCUSDT is benchmark only and excluded from tradable ranking.
- Data: Binance Vision USD-M 1d klines and monthly fundingRate archives.
- Report: 2022-01-01 through 2026-07-31; splits EARLY (<2025), Y2025, Y2026_KNOWN.
- Eligibility: age >=365 calendar days; trailing 30d median quote volume >= $2m; minimum 10 eligible symbols.
- Formation: calendar month-end close.
- Signal: trailing 60 daily close-to-close log returns. Keep only observations where BTC daily log return < 0. Estimate OLS beta of asset returns on BTC returns over those downside observations. Require >=15 downside observations and positive benchmark variance.
- Portfolio: rank downside beta ascending; long highest-beta 20%, short lowest-beta 20%; +0.5/-0.5 gross, total gross 1.0; hold to next month-end.
- PnL: next-day USD-M close-to-close returns plus actual Binance funding, funding_pnl = -weight * funding_rate.
- Costs: BASE 8bp and DOUBLE 16bp on 0.5*sum(abs(delta weight)) turnover.
- No trend, momentum, volatility, sentiment, BTC-regime, interaction, ML, rescue filter or post-result tuning.

## Predeclared support gate
DOWNSIDE_BETA_SUPPORTED_R1 requires BASE overall cumulative >0, Sharpe >=0.75, MDD >=-0.30, EARLY >0 with Sharpe >0, Y2025 >=0 with Sharpe >=0, Y2026_KNOWN >=0 with Sharpe >=0, funding coverage >=0.99, >=40 active formations, median eligible >=20, DOUBLE overall >0 and DOUBLE Y2026_KNOWN >=0.
If all chronological BASE segments are nonnegative and overall positive but quality/stress misses, verdict is DOWNSIDE_BETA_INTERESTING_NOT_PROVEN. Otherwise DOWNSIDE_BETA_REJECT_R1.

Any pass still requires a separately frozen prospective/OOS test before PAPER.