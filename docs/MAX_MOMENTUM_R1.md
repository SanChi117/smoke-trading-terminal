# MAX_MOMENTUM_R1

Status: research-only independent cross-sectional mechanism test. Production, PAPER and site behavior are untouched.

## Question
Does the cryptocurrency MAX momentum effect survive realistic Binance USD-M costs and actual funding?

## External rationale
Published cryptocurrency research reports a positive cross-sectional relation between the maximum daily return over the prior month and subsequent returns. R1 deliberately uses only that simple signal and does not add sentiment, trend, BTC-regime, volatility or liquidity-rescue filters after seeing results.

## Frozen universe and data
- fixed 50-symbol Binance USDT-M candidate pool used by prior terminal research;
- Binance Vision USD-M 1d klines and monthly fundingRate archives;
- report period 2022-01-01 through 2026-07-31;
- chronology EARLY < 2025-01-01; Y2025; Y2026_KNOWN;
- symbol age >=365 calendar days at formation;
- trailing 30d median futures quote volume >= $2m;
- minimum 10 eligible symbols.

## Signal and formation
- formation every Friday after the completed UTC daily close;
- compute 30 one-day close-to-close simple returns ending on formation day;
- MAX30 = maximum of those 30 daily returns;
- rank eligible symbols descending by MAX30;
- long highest 20%; short lowest 20%;
- +0.5 gross long sleeve and -0.5 gross short sleeve, equal weighted inside each sleeve;
- hold until next Friday formation;
- portfolio gross target 1.0; no leverage beyond gross 1.0.

## Execution and costs
- signal uses only completed Friday data; first applied return is formation-close to next daily close;
- actual Binance funding on all signed perpetual positions using funding_pnl = -weight * funding_rate;
- BASE_COSTS = 8bp per unit portfolio turnover;
- DOUBLE_COSTS = 16bp;
- turnover = 0.5 * sum(abs(new_weight - old_weight));
- no collateral yield.

## Frozen verdict gate
MAX_MOMENTUM_SUPPORTED_R1 requires BASE_COSTS:
- cumulative return > 0;
- Sharpe >= 0.75;
- max drawdown >= -0.30;
- EARLY cumulative >0 and Sharpe >0;
- Y2025 cumulative >=0 and Sharpe >=0;
- Y2026_KNOWN cumulative >=0 and Sharpe >=0;
- funding coverage >=0.99;
- >=150 active Friday formations;
- median eligible symbols >=20;
- DOUBLE_COSTS overall cumulative >0;
- DOUBLE_COSTS Y2026_KNOWN cumulative >=0.

If all three chronology segments are profitable and overall is profitable but quality/stress gate misses: MAX_MOMENTUM_INTERESTING_NOT_PROVEN. Otherwise: MAX_MOMENTUM_REJECT_R1.

No parameter rescue or alternative window is allowed after first result. Any supported result remains known-period evidence only and must be frozen separately for prospective/OOS validation before PAPER.