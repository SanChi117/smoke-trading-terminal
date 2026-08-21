# PAST_ALPHA_R1

Status: research-only independent cross-sectional mechanism test. Production, PAPER and site behavior are untouched.

## Question
Does BTC-adjusted trailing alpha predict subsequent cross-sectional cryptocurrency returns after realistic costs and actual Binance funding?

## External rationale
Recent cross-sectional cryptocurrency research identifies past alpha as one of the strongest simple predictors alongside price, illiquidity and momentum. R1 deliberately tests a transparent BTC-adjusted alpha proxy rather than ML or interaction models.

## Frozen universe and data
- fixed Binance USDT-M candidate pool used by prior terminal research;
- BTCUSDT is benchmark only and is excluded from tradable ranking;
- Binance Vision USD-M 1d klines and monthly fundingRate archives;
- report period 2022-01-01 through 2026-07-31;
- chronology EARLY < 2025-01-01; Y2025; Y2026_KNOWN;
- symbol age >=365 calendar days at formation;
- trailing 30d median futures quote volume >= $2m;
- minimum 10 eligible tradable symbols.

## Signal and formation
At each month-end after the daily close:
1. Use the trailing 60 one-day log returns for each asset and BTCUSDT over the same dates.
2. Estimate OLS: asset_return = alpha + beta * BTC_return.
3. Signal = daily regression intercept alpha. Ranking is unaffected by annualization, so no scaling is applied.
4. Rank eligible assets descending by alpha.
5. Long top 20%; short bottom 20%.
6. Equal weight within each sleeve: +0.5 gross long and -0.5 gross short; total gross 1.0, net 0.
7. Hold weights unchanged until the next month-end formation.

No momentum filter, EMA, volatility filter, funding filter, sentiment, trend state, BTC regime gate, or post-result rescue rule is allowed.

## Execution and accounting
- formation uses only data available at the month-end close;
- weights apply to the next close-to-close return onward;
- actual Binance funding: funding_pnl = -position_weight * funding_rate;
- BASE_COSTS = 8 bp per portfolio turnover;
- DOUBLE_COSTS = 16 bp;
- turnover = 0.5 * sum(abs(new_weight - old_weight));
- no leverage beyond gross 1.0; no collateral yield.

## Predeclared gate
PAST_ALPHA_SUPPORTED_R1 requires BASE_COSTS:
- overall cumulative return > 0;
- Sharpe >= 0.75;
- max drawdown >= -0.30;
- EARLY cumulative > 0 and Sharpe > 0;
- Y2025 cumulative >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative >= 0 and Sharpe >= 0;
- funding coverage >= 0.99;
- >=40 active month-end formations;
- median eligible >=20;
- DOUBLE_COSTS overall cumulative >0;
- DOUBLE_COSTS Y2026_KNOWN cumulative >=0.

If all three chronology segments are nonnegative and overall is positive but quality/stress gates miss, verdict is PAST_ALPHA_INTERESTING_NOT_PROVEN. Otherwise verdict is PAST_ALPHA_REJECT_R1.

No post-result tuning. A pass is known-period evidence only and requires a separately frozen prospective/OOS validation before PAPER.