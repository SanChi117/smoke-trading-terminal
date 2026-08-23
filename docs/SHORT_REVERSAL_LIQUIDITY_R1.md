# SHORT_REVERSAL_LIQUIDITY_R1

Status: research-only independent short-horizon liquidity-provision mechanism test. Production, PAPER and site behavior are untouched.

## Question
Does the cryptocurrency short-reversal / liquidity-provision premium survive realistic Binance perpetual costs and actual funding in a liquid tradable universe?

## External rationale
Farag, Luo, Yarovaya and Zieba (Journal of Banking & Finance, 2025) study cryptocurrency liquidity-provision returns using a short-reversal strategy. This R1 deliberately tests the simplest causal one-day cross-sectional reversal without any uncertainty, volatility, sentiment or market-state timing filters.

## Frozen universe and data
- fixed 50-symbol Binance USDT-M candidate pool used by prior terminal research;
- Binance Vision USD-M 1d klines and monthly fundingRate archives;
- report 2022-01-01 through 2026-07-31;
- EARLY < 2025-01-01; Y2025; Y2026_KNOWN;
- age >=365 calendar days;
- trailing 30d median futures quote volume >= $2m;
- minimum 10 eligible symbols.

## Signal / formation
At every completed UTC daily candle:
1. compute the immediately previous close-to-close daily return for every eligible symbol;
2. rank ascending by prior-day return;
3. long bottom 20% (largest prior-day losers);
4. short top 20% (largest prior-day winners);
5. +0.5 gross long sleeve and -0.5 gross short sleeve, equal weight within sleeve;
6. total gross 1.0, net 0;
7. weights apply only to the next daily close-to-close return, then rebalance again.

No overlapping sleeves. No BTC filter. No volatility, funding, trend, momentum, sentiment, liquidity-state or rescue filter is allowed in R1.

## PnL and costs
- daily price PnL from next close-to-close return;
- actual Binance funding on signed perpetual weights;
- turnover = 0.5 * sum(abs(newWeight-oldWeight));
- BASE_COSTS = 8 bp per turnover;
- DOUBLE_COSTS = 16 bp per turnover;
- no leverage beyond gross 1.0; no collateral yield.

## Predeclared support gate
SHORT_REVERSAL_LIQUIDITY_SUPPORTED_R1 only if BASE_COSTS satisfies all:
- overall cumulative return > 0;
- Sharpe >= 0.75;
- max drawdown >= -0.30;
- EARLY cumulative > 0 and Sharpe > 0;
- Y2025 cumulative >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative >= 0 and Sharpe >= 0;
- funding coverage >= 0.99;
- active formations >= 1000;
- median eligible symbols >= 20;
- DOUBLE_COSTS overall cumulative > 0;
- DOUBLE_COSTS Y2026_KNOWN cumulative >= 0.

If every chronology segment is nonnegative and overall is positive but quality/stress gates miss, verdict is SHORT_REVERSAL_LIQUIDITY_INTERESTING_NOT_PROVEN. Otherwise verdict is SHORT_REVERSAL_LIQUIDITY_REJECT_R1.

No post-result tuning. Any supported known-period result must be frozen separately for prospective/OOS validation before PAPER.