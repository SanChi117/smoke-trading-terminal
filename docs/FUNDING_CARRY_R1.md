# FUNDING_CARRY_R1

Status: research-only independent mechanism test. Production, PAPER and site behavior are untouched.

## Question

Can a simple single-venue delta-neutral Binance funding-carry portfolio produce robust net returns without directional market exposure, leverage, collateral yield, ML, or post-hoc filters?

External motivation is deliberately broad: long-spot / short-perpetual carry is a known structural mechanism, while recent research also warns that complex cross-sectional funding alpha screens can fail after costs. This experiment therefore tests a simple baseline rather than a tuned optimizer.

## Frozen universe

Use the same fixed 50 Binance USDT candidate symbols used by the recent cross-asset research line. A symbol is eligible at a Friday formation only when:
- spot and USD-M perpetual daily data both exist;
- common-history age >= 365 days;
- trailing 30-day median spot quote volume >= USD 2,000,000;
- trailing 30-day median perpetual quote volume >= USD 2,000,000;
- at least 60 historical funding events are present in the trailing 28 calendar days;
- trailing 28-day cumulative funding rate is strictly positive.

No symbol may be added or removed after results are visible.

## Signal and portfolio

Every Friday after the completed UTC daily bar:
1. Compute each eligible symbol's trailing 28-calendar-day cumulative actual Binance USD-M funding rate using only funding events already observed.
2. Rank eligible symbols from highest to lowest cumulative funding.
3. Select the top 20% of eligible symbols, with at least one symbol if the eligible set is non-empty.
4. Hold until the next Friday formation.

For N selected symbols, each pair receives equal capital weight:
- spot leg: +0.5 / N;
- perpetual leg: -0.5 / N.

Total portfolio gross exposure is 1.0 and directional beta is intended to be approximately neutral. There is no leverage, no collateral yield, no spot lending yield, no staking yield and no reinvestment assumption beyond normal compounding of portfolio returns.

## Daily economics

Daily price PnL for a selected symbol is:

`spot_weight * spot_close_to_close_return + perp_weight * perp_close_to_close_return`

Actual funding is applied for all Binance funding events on the next UTC calendar day:

`funding_pnl = -perp_weight * funding_rate`

Thus positive funding pays the short perpetual leg and negative funding charges it.

Daily net return is:

`price_pnl + funding_pnl - transaction_cost`

This explicitly includes basis widening/convergence through the difference between spot and perpetual returns. No synthetic basis assumption is used.

## Costs

Two frozen cost modes are reported:
- BASE_COSTS: 8 bp per unit of one-way absolute leg-weight turnover;
- DOUBLE_COSTS: 16 bp per unit of one-way absolute leg-weight turnover.

Because spot and perpetual legs are separate instruments, turnover is measured across both legs. No parameter changes are allowed after seeing results.

## Chronology

Report:
- EARLY: 2022-01-01 through 2024-12-31;
- Y2025: 2025-01-01 through 2025-12-31;
- Y2026_KNOWN: 2026-01-01 through 2026-07-31.

This is a known-period mechanism test, not untouched OOS.

## Predeclared support gate

`FUNDING_CARRY_MECHANISM_SUPPORTED_R1` requires BASE_COSTS to satisfy all of:
- cumulative return > 0;
- Sharpe >= 0.75;
- max drawdown >= -0.15;
- EARLY cumulative return > 0 and Sharpe > 0;
- Y2025 cumulative return >= 0 and Sharpe >= 0;
- Y2026_KNOWN cumulative return >= 0 and Sharpe >= 0;
- gross-weighted actual funding coverage >= 0.99;
- at least 100 Friday formations;
- median eligible universe >= 10 symbols.

In addition, DOUBLE_COSTS must have:
- overall cumulative return > 0;
- Y2025 cumulative return >= 0;
- Y2026_KNOWN cumulative return >= 0.

If BASE_COSTS remains profitable overall, in 2025 and in 2026 but misses one of the quality/stress gates, verdict is `FUNDING_CARRY_INTERESTING_NOT_PROVEN_R1`.

Otherwise verdict is `FUNDING_CARRY_REJECT_R1`.

## Stop rule

After any result is visible, do not change:
- 28-day signal window;
- Friday formation schedule;
- top-20% selection;
- positive-funding eligibility rule;
- age/liquidity/funding-event thresholds;
- 50/50 spot-perpetual construction;
- universe;
- costs;
- chronology;
- pass thresholds.

No rescue tuning is permitted. A supported result remains known-period evidence only and requires a separately frozen prospective/OOS test before PAPER.