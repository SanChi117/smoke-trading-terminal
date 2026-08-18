# Q1D_OB additive execution matrix — frozen research specification

Research/PAPER only. No production/runtime promotion.

Profiles:
- C: frozen V5 baseline.
- Q1D_OB: baseline READY has absolute priority. Only a baseline non-READY episode whose sole blocker is synchronized-target RR below 1.8R may be considered, and only when FROM timeframe is exactly 1D and FROM source is exactly order_block. Entry, structural stop, synchronized HTF target, model/regime logic, costs and managed exits remain unchanged.

The matrix uses the six fixed 60-day windows already used in prior walk-forward research across the same 19-symbol universe.

Predeclared historical pass criteria:
- zero invariant failures;
- at least 4 direct incremental trades distributed across at least 3 fixed windows;
- direct incremental NetR > 0 and direct expectancy > 0;
- aggregate NetR >= frozen baseline C;
- aggregate PF >= baseline PF - 0.10;
- aggregate DD <= min(baseline DD + 1R, baseline DD * 1.15);
- each calibration/validation/test role NetR >= baseline role - 3R and DD <= baseline role + 2R.

A historical pass does not authorize promotion. Untouched OOS is mandatory. No post-hoc threshold tuning is allowed after this matrix result.
