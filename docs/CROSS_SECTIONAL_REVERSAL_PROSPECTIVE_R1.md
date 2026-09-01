# CROSS_SECTIONAL_REVERSAL_PROSPECTIVE_R1

Status: preregistered prospective validation. Research-only. Production/PAPER execution is untouched.

## Frozen mechanism

This validation inherits the already-supported `HIGHVOL_LMW_8W` mechanism from CROSS_SECTIONAL_REVERSAL_R1 without changing any alpha rule:
- fixed 50-symbol Binance USDT-M candidate pool;
- age >= 365 days;
- 30-day median quote volume >= $2m;
- every Friday after the completed daily bar, rank trailing 56-calendar-day close-to-close return;
- before ranking, retain the high-volatility half: trailing 56-day annualized realized volatility >= the cross-sectional median;
- long bottom 20% of the retained pool and short top 20%;
- each new sleeve is +0.5 gross long / -0.5 gross short;
- hold each sleeve 56 days;
- weekly overlapping sleeves are averaged;
- 8 bp per unit of one-way portfolio turnover;
- actual historical Binance USD-M perpetual funding only;
- funding PnL per event = `-position_weight * funding_rate`.

No EMA, BTC regime, dynamic universe, formation-window change, quintile change, volatility-threshold change, stop, leverage optimization, or rescue filter may be added during this validation.

## Prospective boundary

Decision/freeze date: 2026-08-20.

Prospective holdout starts at the completed daily bar timestamp:

`2026-08-21T00:00:00Z`

No return beginning before this timestamp is counted as prospective. Data through 2026-08-20 may be used only as formation/history input.

Positions/sleeves are NOT carried into the holdout from the prior research backtest. The prospective portfolio starts flat and may create its first sleeve only on or after 2026-08-21.

## Funding-complete snapshots

Binance Vision fundingRate history is monthly. To avoid silently treating missing current-month funding as zero, each snapshot evaluates only rows whose complete next-day funding lies inside the last fully archived funding month.

Therefore a snapshot:
1. identifies the latest complete funding month available to the runner;
2. loads daily prices through that month-end;
3. evaluates portfolio rows only through the prior calendar day, because each row uses next-day close-to-close return and next-day funding;
4. records gross-weighted funding coverage;
5. cannot pass if coverage < 99%.

Partial current-month data is never used for a pass/fail verdict.

## Minimum observation gate

The strategy remains `PROSPECTIVE_COLLECTING` until BOTH are true:
- at least 112 prospective daily portfolio rows;
- at least 16 prospective Friday formations.

This deliberately spans at least two 56-day holding periods and prevents an early favorable month from qualifying the mechanism.

## Frozen verdict gate

After the minimum observation gate is satisfied:

`PROSPECTIVE_SUPPORTS_HIGHVOL_REVERSAL_R1` requires all of:
- cumulative return > 0;
- Sharpe >= 0.50;
- max drawdown >= -0.35;
- gross-weighted actual-funding coverage >= 0.99.

If cumulative return remains positive but one quality threshold fails, verdict is:

`PROSPECTIVE_INTERESTING_NOT_PROVEN`

Otherwise verdict is:

`PROSPECTIVE_REJECTS_HIGHVOL_REVERSAL_R1`

Passing prospective validation still does not automatically authorize real-money trading. It is the evidence gate required before considering PAPER promotion.

## Stop rule

After 2026-08-20, do not change any strategy rule or pass threshold based on prospective results. Engineering fixes are allowed only when they preserve the frozen economic logic and chronology. Any alpha change starts a new named experiment and a new prospective clock.