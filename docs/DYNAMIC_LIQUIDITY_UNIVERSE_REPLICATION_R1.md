# DYNAMIC_LIQUIDITY_UNIVERSE_REPLICATION_R1

## Purpose

Known-period mechanism replication only. This study tests the missing universe-construction layer of the published diversified crypto trend-following program while freezing the previously tested trend and risk architecture.

The question is narrow:

> Does dynamic monthly selection of sufficiently liquid/active assets materially improve the same multi-speed volatility-targeted trend program versus holding a fixed broad futures universe?

Because the 2025/2026 weakness is already known, this is not OOS and cannot promote PAPER.

## Fixed candidate universe

The candidate pool is the same fixed 50 Binance USDT-M futures used in `MULTISPEED_VOLTARGET_REPLICATION_R1`. No post-result symbol additions/deletions.

BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT, ADAUSDT, SOLUSDT, DOGEUSDT, LINKUSDT, AVAXUSDT, DOTUSDT, LTCUSDT, ATOMUSDT, AAVEUSDT, NEARUSDT, INJUSDT, OPUSDT, ARBUSDT, APTUSDT, SUIUSDT, SEIUSDT, TAOUSDT, ONDOUSDT, TONUSDT, FETUSDT, WIFUSDT, BCHUSDT, TRXUSDT, XLMUSDT, ETCUSDT, FILUSDT, UNIUSDT, ICPUSDT, ALGOUSDT, VETUSDT, RUNEUSDT, GALAUSDT, SANDUSDT, MANAUSDT, CRVUSDT, CHZUSDT, LDOUSDT, DYDXUSDT, IMXUSDT, STXUSDT, COMPUSDT, SNXUSDT, ZECUSDT, KAVAUSDT, XTZUSDT, ENJUSDT.

This is a mechanism test inside the available Binance-futures pool, not a claim to reproduce the paper's full historical CoinMarketCap universe.

## Frozen trend/risk architecture

Unchanged from R1:

- daily close Donchian speeds: 5/10/20/30/60/90/150/250/360;
- long-only;
- pre-known channel upper/lower from prior N completed closes;
- entry above upper close boundary;
- non-decreasing midpoint trailing stop;
- 90-day realized close-return volatility annualized by sqrt(365);
- 25% annualized volatility target;
- 2x sub-model leverage cap;
- equal average of nine model weights;
- 20% threshold for volatility-only weight changes;
- signal transitions always implemented without threshold delay.

Only the universe layer differs between profiles.

## Published universe rules reproduced

At the end of every calendar month, using only data known through that completed month:

1. asset age must be at least 365 calendar days;
2. asset must not be a wrapped token, stablecoin, or collectible NFT (none of the fixed 50 are classified as such for this experiment);
3. median daily USD trading volume over the preceding 30 completed daily candles must be at least $2,000,000;
4. eligible assets are ranked by that same 30-day median USD trading volume;
5. the top 20 are selected for the following calendar month.

Binance Futures `quote asset volume` is used as the exchange-native USD/USDT trading-volume measure. It is not substituted with current market cap.

### Mid-month activity/liquidity exit

A selected asset is set to zero portfolio weight for the remainder of the current month if, on a completed daily candle:

- trailing 30-day median quote volume falls below $1,000,000; OR
- trailing 30-day median **absolute** close-to-close percentage change falls below 0.5%.

The published text states a median daily price-change threshold; absolute percentage change is the frozen operational interpretation here because the stated purpose is removal of stale/inactive assets. This interpretation is fixed before results.

Removed capital remains cash until the next monthly universe rebalance; it is not redistributed intramonth.

## Profiles

### FIXED50

Control profile. Every model-ready symbol in the fixed 50 receives equal capital; trend exposure then scales that capital by its frozen `COMBO9_VOL25_RB20` signal weight.

### DYNAMIC_TOP20

At each month start, capital is split equally across the previous month-end selected top-20 universe (or all selected names if fewer than 20). Each selected asset then receives its frozen `COMBO9_VOL25_RB20` model exposure. Intramonth removals go to cash.

## Causality

- month M selection uses only data through the last completed day of month M-1;
- model state at daily close t applies to return t→t+1;
- no future volume or price-change data affect current selection;
- monthly selection is fixed until the next month except the predeclared intramonth exit rules.

## Costs

Portfolio-level costs are recomputed from actual portfolio weights so universe changes are charged correctly:

- 8 bps per unit of one-way portfolio notional turnover (5bp commission + 3bp adverse execution allowance);
- funding stress: additional 3 bps/day × positive gross portfolio exposure.

No per-symbol cost stream from prior experiments is reused; this prevents double counting.

## Chronology

Report:

- EARLY: 2022-01-01 through 2024-12-31;
- Y2025: 2025-01-01 through 2025-12-31;
- Y2026_KNOWN: 2026-01-01 through 2026-07-31.

The runner emits pre-2022 feature history so January 2022 selection is causal.

## Metrics

For both profiles under BASE_COSTS and FUNDING_STRESS:

- cumulative return, CAGR, annualized volatility, Sharpe, maximum drawdown;
- average gross exposure and one-way turnover;
- split metrics;
- monthly number of selected/active names;
- selection frequency per symbol;
- contribution per symbol;
- overlap between fixed and dynamic exposures.

## Predeclared interpretation

`DYNAMIC_UNIVERSE_MECHANISM_SUPPORTED` requires all:

- DYNAMIC_TOP20 overall cumulative return > 0;
- overall Sharpe >= 0.75;
- overall Sharpe exceeds FIXED50 by at least +0.15;
- overall maximum drawdown is no worse than FIXED50;
- EARLY cumulative return > 0 and Sharpe > 0;
- Y2025 cumulative return >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative return >= 0 and Sharpe >= 0;
- DYNAMIC_TOP20 Y2025 return >= FIXED50 Y2025 return;
- DYNAMIC_TOP20 Y2026_KNOWN return >= FIXED50 Y2026_KNOWN return;
- FUNDING_STRESS total return > 0;
- FUNDING_STRESS Y2026_KNOWN return >= 0;
- median monthly selected universe size >= 10 names.

If the dynamic profile improves Sharpe/drawdown and recent losses but fails one or more full conditions, it may be labeled `MECHANISM_IMPROVES_BUT_NOT_SOLVES`; this is descriptive only and cannot be promoted.

## Stop rule

After results:

- do not change top-20 to another breadth;
- do not change $2m/$1m liquidity thresholds;
- do not change 365-day age or 0.5% activity threshold;
- do not change the 30-day window;
- do not select only historically winning symbols;
- do not add EMA/Quattro/Apex gates;
- do not call this OOS.

If supported, the exact universe mechanism can be frozen into a later prospective validation. If not, this branch is archived without tuning.
