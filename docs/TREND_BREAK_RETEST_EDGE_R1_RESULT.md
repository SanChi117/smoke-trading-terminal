# TREND_BREAK_RETEST_EDGE_R1 — RESULT

## Final decision

**REJECT_R1.**

The frozen `BREAKOUT_RETEST` hypothesis does not advance to execution backtesting.

This is not a total negative result: the simple 1D+4H trend context shows a small but statistically persistent directional first-hit bias, while both the 1H breakout and especially the confirmed retest fail to convert it into a robust entry under the frozen R1 rules.

## Integrity

- Workflow: `trend-break-retest-edge-r1`, run #1 — **SUCCESS**.
- Workflow run id: `32139460682`.
- Aggregate artifact digest: `sha256:ad1ce960d0f82642704e9a2a98b6f171b0e14c02f13caabbb26c6dc36321804c`.
- 25/25 fixed symbols valid.
- `terminal-ci`: **SUCCESS**.
- `level-flow-ci`: **SUCCESS**.
- Production/PAPER code was not changed.
- Protocol was frozen before results and verified by Git blob hash in CI.

## Sample

- DISCOVERY: 2022-01-01 through 2024-12-31.
- VALIDATION: 2025-01-01 through 2025-12-31.
- OOS: 2026-01-01 through 2026-07-31.
- Breakout events: **9,467**.
- Confirmed retests: **4,333**.

## Aggregate matrix

| Method | Scope | N | 1 ATR favorable-first | Wilson 95% low | Median 24h return ATR4H |
|---|---|---:|---:|---:|---:|
| TREND_CONTEXT | ALL | 16,423 | 52.8% | 52.0% | 0.0000 |
| TREND_CONTEXT | DISCOVERY | 9,232 | 52.6% | 51.5% | -0.0213 |
| TREND_CONTEXT | VALIDATION | 4,313 | 51.8% | 50.3% | -0.0173 |
| TREND_CONTEXT | OOS | 2,878 | 54.9% | 53.0% | +0.0208 |
| BREAKOUT_DIRECT | ALL | 9,467 | 51.3% | 50.2% | -0.1237 |
| BREAKOUT_DIRECT | DISCOVERY | 5,130 | 51.5% | 50.1% | -0.1571 |
| BREAKOUT_DIRECT | VALIDATION | 2,696 | 50.0% | 48.1% | -0.1200 |
| BREAKOUT_DIRECT | OOS | 1,641 | 52.7% | 50.2% | -0.0098 |
| BREAKOUT_RETEST | ALL | 4,333 | 49.4% | 47.9% | -0.1318 |
| BREAKOUT_RETEST | DISCOVERY | 2,316 | 49.6% | 47.5% | -0.1707 |
| BREAKOUT_RETEST | VALIDATION | 1,243 | 47.9% | 45.1% | -0.0997 |
| BREAKOUT_RETEST | OOS | 774 | 51.2% | 47.7% | -0.0358 |

## Matched-event result

On the exact **4,333** breakout events that later produced a confirmed retest:

- `BREAKOUT_RETEST`: 49.4% favorable-first;
- direct next-open entry on those same breakouts: 57.6%;
- retest delta: **-8.25 percentage points**;
- median 24h signed-return delta: **-0.1282 ATR4H**.

Therefore the retest is not merely failing to improve the breakout. Under this exact definition it systematically gives away directional quality and enters after a material part of the favorable move has already occurred or after the breakout has degraded.

## Component interpretation

### Trend context

The objective context — 1D close/EMA200 + EMA50/EMA200 and 4H close/EMA50 + EMA50/EMA200 — has a small 1 ATR favorable-first bias across all three chronological partitions. Its 95% Wilson lower bound remains above 50% in DISCOVERY, VALIDATION and OOS.

That is **directional evidence**, not yet a tradeable strategy. Median 24h signed return is flat overall and slightly negative in DISCOVERY/VALIDATION, so the context alone does not justify PAPER trading.

### Breakout

The 20H close breakout retains only a weak part of the context signal. VALIDATION falls to 50.0%, median 24h return is negative in every split, and the frozen direct-breakout criteria fail.

### Retest

The confirmed retest is worse. It falls below 50% overall and in DISCOVERY/VALIDATION and materially underperforms direct entry on matched events. It is rejected as the primary entry mechanism.

## Stop-rule action

Do not:

- change the 20H lookback, 12H window, ATR tolerances or EMA definitions on these same results;
- add Level Flow/FVG/QFVG rescue gates;
- optimize SL/TP to reverse the failed directional diagnosis;
- promote breakout/retest R1 to PAPER.

The next independent research track may retain the **simple 1D+4H trend context as a measured contextual variable**, but it must test a genuinely different entry mechanism. The most direct next family is trend pullback/reclaim rather than breakout/retest.
