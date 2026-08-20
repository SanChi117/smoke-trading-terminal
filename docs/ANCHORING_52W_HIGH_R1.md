# ANCHORING_52W_HIGH_R1

Status: research-only independent mechanism test. Production, PAPER and site behavior are untouched.

## Question

Does the cryptocurrency 52-week-high anchoring effect survive realistic Binance USD-M transaction costs and actual funding in the same fixed research universe, including 2025 and known 2026?

This is a behavioral cross-sectional mechanism, distinct from time-series trend, 8-week loser-minus-winner reversal, funding carry and cointegration stat-arb.

## External rationale

Jia, Simkins, Yan, Zhang and Zhao (Journal of Banking & Finance, 2026) document a significant positive association between nearness to the 52-week high and subsequent cross-sectional cryptocurrency returns, robust to standard return predictors and alternative specifications.

R1 deliberately uses one transparent implementation only. No interaction model, ML, dynamic thresholding or post-result universe tuning is allowed.

## Frozen universe and data

- same fixed 50-symbol Binance USDT-M candidate pool used by the preceding research matrix;
- Binance Vision USD-M 1d klines and monthly fundingRate archives;
- report period: 2022-01-01 through 2026-07-31;
- chronology: EARLY < 2025-01-01; Y2025; Y2026_KNOWN;
- symbol must have >=365 calendar days of futures history at formation;
- 30-day median futures quote volume >= $2m;
- 365 consecutive daily observations ending on formation date are required.

## Signal

Every Friday after the completed UTC daily close:

1. For each eligible symbol compute `high52 = max(daily high)` over the trailing 365 daily observations including that Friday.
2. Compute `nearness52 = close / high52`.
3. Rank eligible symbols by `nearness52` descending.
4. Long the top 20% (nearest to the 52-week high).
5. Short the bottom 20% (farthest from the 52-week high).
6. Each sleeve carries 0.5 gross exposure, equally weighted inside the sleeve; total portfolio gross target = 1.0 and net target = 0.
7. Minimum eligible universe is 10 symbols; otherwise hold cash for that week.

No return, volatility, BTC, EMA, trend, funding, sentiment or regime filter is allowed in R1.

## Execution and holding

- Signal is formed only from data available at Friday close.
- Portfolio weights apply to the next close-to-close daily return onward.
- Hold unchanged until the next Friday rebalance.
- Rebalance directly from prior weights to new weights; no intraperiod reselection.
- Daily price PnL = sum(position_weight * next_daily_return).
- Actual Binance funding is applied to every signed perpetual leg using `funding_pnl = -position_weight * funding_rate` for funding events mapped to the next UTC daily return date.
- No leverage above gross 1.0; no collateral yield.

## Costs

Two frozen profiles:

- BASE_COSTS: 8 bp per unit of portfolio turnover;
- DOUBLE_COSTS: 16 bp per unit of portfolio turnover.

Turnover uses `0.5 * sum(abs(new_weight - old_weight))`, matching the existing cross-sectional research convention in this repository.

## Predeclared support gate

`ANCHORING_52W_HIGH_SUPPORTED_R1` requires BASE_COSTS to satisfy all of:

- overall cumulative return > 0;
- overall Sharpe >= 0.75;
- overall max drawdown >= -0.30;
- EARLY cumulative return > 0 and Sharpe > 0;
- Y2025 cumulative return >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative return >= 0 and Sharpe >= 0;
- gross-weighted actual funding coverage >= 0.99;
- >=150 active Friday formations;
- median eligible universe >=20;
- DOUBLE_COSTS overall cumulative return > 0;
- DOUBLE_COSTS Y2026_KNOWN cumulative return >=0.

If BASE_COSTS is profitable in every chronological segment but misses one quality/stress threshold, verdict is `ANCHORING_52W_HIGH_INTERESTING_NOT_PROVEN`.

Otherwise verdict is `ANCHORING_52W_HIGH_REJECT_R1`.

A pass is a known-period mechanism result only. It is not PAPER eligibility and requires separately frozen prospective/OOS validation.

## Stop rule

After the first result is visible, do not change the 365-day lookback, weekly Friday formation, quintile cut, long/short orientation, liquidity threshold, minimum universe, weighting, costs, funding treatment, universe, chronology or support thresholds. No rescue tuning from R1 results is allowed.
