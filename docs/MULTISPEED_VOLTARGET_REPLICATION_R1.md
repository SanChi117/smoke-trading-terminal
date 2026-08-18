# MULTISPEED_VOLTARGET_REPLICATION_R1

## Purpose

Known-period external architecture replication only. This study cannot claim OOS or authorize PAPER because the 2026 trend-following weakness is already known.

The external architecture is taken from the published crypto trend-following framework by Zarattini, Pagani and Barbon and is consistent with the broader managed-futures practice of diversifying trend speeds and normalizing risk by volatility.

The goal is to decompose two architectural mechanisms without tuning them to our results:

1. multi-speed Donchian ensemble;
2. volatility-targeted exposure with a turnover threshold.

## Fixed universe

Use the union of the two prior fixed 25-symbol research universes, 50 Binance USDT-M futures symbols total. No post-result replacement.

BTCUSDT, ETHUSDT, BNBUSDT, XRPUSDT, ADAUSDT, SOLUSDT, DOGEUSDT, LINKUSDT, AVAXUSDT, DOTUSDT, LTCUSDT, ATOMUSDT, AAVEUSDT, NEARUSDT, INJUSDT, OPUSDT, ARBUSDT, APTUSDT, SUIUSDT, SEIUSDT, TAOUSDT, ONDOUSDT, TONUSDT, FETUSDT, WIFUSDT,
BCHUSDT, TRXUSDT, XLMUSDT, ETCUSDT, FILUSDT, UNIUSDT, ICPUSDT, ALGOUSDT, VETUSDT, RUNEUSDT, GALAUSDT, SANDUSDT, MANAUSDT, CRVUSDT, CHZUSDT, LDOUSDT, DYDXUSDT, IMXUSDT, STXUSDT, COMPUSDT, SNXUSDT, ZECUSDT, KAVAUSDT, XTZUSDT, ENJUSDT.

A symbol becomes eligible only after it has at least 360 prior daily closes and a valid 90-day volatility estimate.

## External rules frozen before results

### Donchian speeds

Nine daily close-based lookbacks:

`5, 10, 20, 30, 60, 90, 150, 250, 360` calendar/daily bars.

For each speed N:

- upper channel = maximum of the previous N completed daily closes;
- lower channel = minimum of the previous N completed daily closes;
- midpoint = `(upper + lower) / 2`;
- while flat, enter long when today's completed close exceeds the pre-known upper channel;
- initial trailing stop = the pre-known midpoint at entry;
- while long, trailing stop may only rise: `max(previous stop, current pre-known midpoint)`;
- exit when today's completed close is below the active trailing stop.

All position changes determined at daily close t apply to the next daily return t→t+1. This prevents same-close lookahead.

### Volatility targeting

- underlying volatility = standard deviation of the previous 90 daily close-to-close returns;
- annualization = `sqrt(365)`;
- target annualized volatility = 25%;
- active model target weight = `min(0.25 / annualizedVol90, 2.0)`;
- inactive model weight = 0;
- leverage cap = 2x per sub-model.

### Ensemble

Combo exposure is the arithmetic mean of the nine sub-model weights.

### 20% rebalance threshold

For the threshold profile, signal transitions (flat→long or long→flat) are always executed immediately at the next return interval.

If a sub-model's signal state is unchanged, a volatility-driven weight adjustment is made only when the relative target-weight drift exceeds 20% versus its currently implemented weight. This isolates the turnover-control function from the trend signal itself.

## Fixed profiles

### SINGLE60_1X

One 60-day Donchian sub-model, binary 0/1 exposure, no volatility sizing. This is a single-speed daily reference.

### COMBO9_1X

Nine Donchian signals; each active model contributes weight 1 and inactive model 0; portfolio exposure is the mean. This isolates speed diversification.

### COMBO9_VOL25

Nine-model ensemble with the exact 25%/90-day/2x volatility targeting, rebalanced every day.

### COMBO9_VOL25_RB20

Same as COMBO9_VOL25 but with the fixed 20% volatility-driven rebalance threshold.

## Costs

To stay consistent with the terminal research rather than copy an exchange assumption:

- commission: 5 bps per unit of one-way notional turnover;
- adverse execution/slippage allowance: 3 bps per unit of one-way notional turnover;
- BASE_COSTS = 8 bps × absolute exposure change;
- FUNDING_STRESS = BASE_COSTS plus 3 bps per day × positive implemented exposure, equivalent to the prior +1 bp per 8 hours stress model.

No spread rebate or favorable fill is assumed.

## Portfolio construction

Two views are reported:

1. per-symbol strategy return stream;
2. equal-weight portfolio across all currently eligible symbols in the fixed 50-symbol universe.

No liquidity ranking, performance ranking, symbol deletion or post-result rotation is allowed in R1. This deliberately isolates signal/risk architecture from universe selection.

## Chronology

Descriptive known-period splits:

- EARLY: 2022-01-01 through 2024-12-31;
- Y2025: 2025-01-01 through 2025-12-31;
- Y2026_KNOWN: 2026-01-01 through 2026-07-31.

Evaluation data may continue through 2026-08-17 only to complete the final daily interval; no new evaluation split is created.

## Metrics

For every profile under BASE_COSTS and FUNDING_STRESS:

- cumulative return;
- CAGR;
- annualized volatility;
- Sharpe ratio with zero risk-free rate;
- maximum drawdown;
- average daily return;
- average gross exposure;
- one-way turnover;
- EARLY / Y2025 / Y2026_KNOWN return, vol, Sharpe and drawdown;
- per-symbol cumulative return and positive-symbol ratio.

## Predeclared architecture interpretation

A profile is `EXTERNAL_ARCHITECTURE_SUPPORTED` only if all are true under BASE_COSTS:

- portfolio cumulative return > 0;
- portfolio Sharpe >= 0.75;
- EARLY cumulative return > 0 and Sharpe > 0;
- Y2025 cumulative return > 0 and Sharpe > 0;
- Y2026_KNOWN cumulative return >= 0 and Sharpe >= 0;
- maximum drawdown is no worse than -35%;
- at least 60% of eligible symbols have positive cumulative strategy return;
- FUNDING_STRESS cumulative return > 0;
- FUNDING_STRESS Y2026_KNOWN cumulative return >= 0.

Additionally, to support the specific architectural mechanism:

- `COMBO9_1X` must have Y2026_KNOWN Sharpe at least as high as `SINGLE60_1X` to support speed diversification;
- `COMBO9_VOL25` or `COMBO9_VOL25_RB20` must have maximum drawdown no worse than COMBO9_1X and Y2026_KNOWN return no worse than COMBO9_1X to support volatility normalization;
- `COMBO9_VOL25_RB20` must reduce turnover versus COMBO9_VOL25 without lowering overall Sharpe by more than 0.10 to support the rebalance threshold.

Passing is mechanistic replication only, not strategy validation.

## Stop rule

After results are visible:

- do not alter the nine lookbacks;
- do not alter 25% target, 90-day volatility window, 2x cap or 20% threshold;
- do not pick a subset of speeds;
- do not add Quattro/Apex/EMA gates to rescue the result;
- do not select winning symbols;
- do not call this OOS.

Any supported architecture must be frozen for later prospective validation before PAPER promotion.
