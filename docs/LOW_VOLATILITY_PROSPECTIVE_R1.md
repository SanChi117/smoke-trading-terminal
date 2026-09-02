# LOW_VOLATILITY_PROSPECTIVE_R1

Status: prospective research-only validation. Production, PAPER and site behavior are untouched.

## Freeze boundary

- freeze date: 2026-08-21 UTC;
- prospective holdout starts 2026-08-21T00:00:00Z;
- no return beginning before the holdout start counts as prospective;
- pre-holdout data may be used only as causal formation/history input;
- portfolio starts flat at the holdout boundary;
- no position from the known-period LOW_VOLATILITY_R1 test is carried into the holdout.

## Frozen mechanism

Exact economic logic from LOW_VOLATILITY_R1 is preserved:
- fixed 50-symbol Binance USD-M candidate universe;
- 60 daily log-return realized-volatility signal;
- month-end formation/rebalance;
- long lowest-volatility quintile and short highest-volatility quintile;
- +0.5/-0.5 gross sleeves, total gross exposure 1.0;
- >=365 calendar days history at formation;
- 30-day median futures quote volume >= $2m;
- minimum 10 eligible symbols;
- actual Binance funding on signed perpetual positions;
- BASE_COSTS 8bp and DOUBLE_COSTS 16bp using 0.5*sum(abs(delta weight)) turnover;
- no momentum, trend, BTC, regime, funding, dynamic-universe, or rescue filters.

No parameter above may be changed after this freeze.

## Prospective maturity gate

Verdict remains `PROSPECTIVE_COLLECTING` until BOTH are true:
- at least 180 prospective daily rows; and
- at least 6 prospective month-end formations.

## Frozen support gate after maturity

`PROSPECTIVE_SUPPORTS_LOW_VOLATILITY_R1` requires:
- BASE_COSTS cumulative return > 0;
- BASE_COSTS Sharpe >= 0.50;
- BASE_COSTS max drawdown >= -0.30;
- gross-weighted actual-funding coverage >= 0.99;
- DOUBLE_COSTS cumulative return > 0.

If BASE_COSTS cumulative return is positive but one quality/stress threshold misses, verdict is `PROSPECTIVE_LOW_VOL_INTERESTING_NOT_PROVEN`.

Otherwise verdict is `PROSPECTIVE_REJECTS_LOW_VOLATILITY_R1`.

Passing this gate is evidence before considering PAPER. It is not real-money authorization.

## Data-integrity rule

Prospective snapshots may use only fully archived Binance Vision funding months. If the trailing funding month is unavailable/incomplete, the snapshot must stop before that incomplete month rather than treating missing funding as zero.
