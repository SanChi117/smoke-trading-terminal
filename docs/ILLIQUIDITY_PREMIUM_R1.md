# ILLIQUIDITY_PREMIUM_R1

Status: research-only independent cross-sectional mechanism test. Production, PAPER and site behavior are untouched.

## Question
Can a simple Amihud-style illiquidity signal predict higher subsequent crypto returns after realistic costs and actual Binance funding while excluding the least-tradable tail?

## External rationale
Published cryptocurrency asset-pricing research documents a negative relationship between liquidity and future cryptocurrency returns using the Amihud measure, consistent with an illiquidity premium. More recent cross-sectional work also warns that crypto alpha can be concentrated in small and difficult-to-trade assets. R1 therefore freezes a tradability floor before results and does not relax it after seeing outcomes.

## Frozen universe and data
- fixed 50-symbol Binance USDT-M candidate pool used by prior terminal research;
- Binance Vision USD-M 1d klines and monthly fundingRate archives;
- report period 2022-01-01 through 2026-07-31;
- chronology EARLY < 2025-01-01; Y2025; Y2026_KNOWN;
- symbol age >=365 calendar days at formation;
- trailing 30d median futures quote volume >= $2m;
- minimum 10 eligible symbols.

## Signal and formation
At each month-end completed daily close:
1. Use the trailing 60 daily close-to-close simple returns.
2. For each of those 60 observations compute `abs(return_t) / quoteVolume_t`.
3. Signal `amihud60` is the arithmetic mean of those 60 values.
4. Rank eligible symbols high-to-low by `amihud60`.
5. Long the highest-illiquidity quintile and short the lowest-illiquidity quintile.
6. Each sleeve carries 0.5 gross exposure; total portfolio gross is 1.0.
7. Hold until the next month-end rebalance.

No momentum, volatility, BTC regime, market-cap, price, funding, or trend filter is allowed.

## Costs and funding
- actual Binance funding on every signed perpetual position: `funding_pnl = -position_weight * funding_rate`;
- BASE_COSTS = 8 bp per unit turnover;
- DOUBLE_COSTS = 16 bp per unit turnover;
- turnover = `0.5 * sum(abs(new_weight - old_weight))`;
- no leverage above gross 1.0 and no collateral yield.

## Predeclared support gate
`ILLIQUIDITY_PREMIUM_SUPPORTED_R1` requires BASE_COSTS:
- overall cumulative return >0;
- overall Sharpe >=0.75;
- overall max drawdown >=-0.30;
- EARLY cumulative >0 and Sharpe >0;
- Y2025 cumulative >=0 and Sharpe >=0;
- Y2026_KNOWN cumulative >=0 and Sharpe >=0;
- funding coverage >=0.99;
- >=40 active month-end formations;
- median eligible symbols >=20;
- DOUBLE_COSTS overall cumulative >0;
- DOUBLE_COSTS Y2026_KNOWN cumulative >=0.

If BASE_COSTS is profitable in every chronological segment but misses a quality/stress threshold, verdict is `ILLIQUIDITY_PREMIUM_INTERESTING_NOT_PROVEN`.
Otherwise verdict is `ILLIQUIDITY_PREMIUM_REJECT_R1`.

Any pass remains known-period evidence only and requires a separately frozen prospective/OOS validation before PAPER.

## Stop rule
After first results are visible, do not change lookback, Amihud definition, quintiles, universe, liquidity floor, holding interval, costs, funding treatment, chronology or gate. No rescue tuning from R1 results.