# ORDER_FLOW_IMBALANCE_R1

Status: research-only independent cross-sectional order-flow mechanism test. Production, PAPER and site behavior are untouched.

## Question
Can persistent taker-buy pressure predict subsequent cross-sectional crypto returns after realistic costs and actual Binance funding?

## External rationale
A 2026 Journal of Financial Markets study reports that world order flow has explanatory and predictive power for the cross-section of cryptocurrency returns. This R1 uses a transparent Binance-native proxy available in daily USD-M klines: taker buy quote volume relative to total quote volume. No ML, market-state filter or post-result tuning is allowed.

## Frozen universe and data
- fixed 50-symbol Binance USDT-M candidate pool used by prior terminal research;
- Binance Vision USD-M 1d klines and monthly fundingRate archives;
- report period 2022-01-01 through 2026-07-31;
- chronology EARLY < 2025-01-01; Y2025; Y2026_KNOWN;
- symbol age >=365 calendar days at formation;
- trailing 30d median futures quote volume >= $2m;
- minimum 10 eligible symbols.

## Frozen signal
For each day define taker-buy imbalance = 2 * taker_buy_quote_volume / quote_volume - 1. Formation signal is the arithmetic mean of the last 20 daily imbalance observations, inclusive of the Friday close.

## Portfolio
- form every Friday after the daily close;
- rank eligible symbols descending by 20d mean imbalance;
- long highest 20%; short lowest 20%;
- each sleeve gross 0.5; total gross 1.0 and net 0;
- weights become active for subsequent close-to-close returns until the next Friday formation;
- no BTC, trend, volatility, momentum, sentiment or regime filter.

## Costs and funding
- actual Binance funding: funding_pnl = -position_weight * funding_rate;
- BASE_COSTS 8bp one-way turnover;
- DOUBLE_COSTS 16bp one-way turnover;
- turnover = 0.5 * sum(abs(new_weight - old_weight)).

## Predeclared verdict
SUPPORTED only if BASE: cumulative >0, Sharpe >=0.75, max drawdown >=-0.30, EARLY positive with Sharpe>0, Y2025 nonnegative with Sharpe>=0, Y2026_KNOWN nonnegative with Sharpe>=0, funding coverage >=0.99, active formations >=150, median eligible >=20; and DOUBLE_COSTS overall cumulative >0 with Y2026_KNOWN >=0.

If all chronological BASE segments are nonnegative and overall cumulative >0 but the full quality/stress gate misses: ORDER_FLOW_IMBALANCE_INTERESTING_NOT_PROVEN. Otherwise: ORDER_FLOW_IMBALANCE_REJECT_R1.

No rescue tuning. Any supported known-period result requires a separately frozen prospective/OOS validation before PAPER consideration.