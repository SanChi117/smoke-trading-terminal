# TREND_PULLBACK_RECLAIM_R1 — RESULT

## Final decision

**REJECT_R1.** No route passed the frozen multi-candidate gate.

Workflow `trend-pullback-reclaim-r1`, run `32140814781`, completed successfully on all 25 fixed symbols. Aggregate artifact digest: `sha256:9cfa003170de33db44063894c59bf7f49e29e045f7b1329d0ad7d8e26052273f`.

Production/PAPER code was not changed.

## Aggregate matrix

| Method | Scope | N | 1 ATR favorable-first | 98.75% Wilson low | Median 24h return ATR4H | Verdict |
|---|---|---:|---:|---:|---:|---|
| TREND_CONTEXT | ALL | 16,423 | 52.4% | 51.4% | -0.0013 | BASELINE |
| TREND_CONTEXT | DISCOVERY | 9,232 | 52.6% | 51.2% | -0.0231 | — |
| TREND_CONTEXT | VALIDATION | 4,313 | 50.0% | 48.1% | -0.0190 | — |
| TREND_CONTEXT | OOS | 2,878 | 55.2% | 52.8% | +0.0359 | — |
| EMA20_TOUCH | ALL | 15,820 | 51.2% | 50.1% | -0.0091 | NOT_PROVEN |
| EMA20_TOUCH | DISCOVERY | 8,946 | 51.0% | 49.7% | -0.0054 | — |
| EMA20_TOUCH | VALIDATION | 4,045 | 48.6% | 46.6% | -0.0341 | — |
| EMA20_TOUCH | OOS | 2,829 | 55.4% | 53.0% | +0.0171 | — |
| EMA20_RECLAIM | ALL | 3,485 | 51.8% | 49.7% | -0.0430 | NOT_PROVEN |
| EMA20_RECLAIM | DISCOVERY | 2,030 | 50.1% | 47.3% | -0.0202 | — |
| EMA20_RECLAIM | VALIDATION | 867 | 51.6% | 47.3% | -0.1592 | — |
| EMA20_RECLAIM | OOS | 588 | 58.1% | 52.9% | +0.0151 | — |
| EMA50_TOUCH | ALL | 10,778 | 50.9% | 49.7% | +0.0626 | NOT_PROVEN |
| EMA50_TOUCH | DISCOVERY | 6,117 | 50.3% | 48.7% | +0.0595 | — |
| EMA50_TOUCH | VALIDATION | 2,732 | 50.6% | 48.1% | +0.0492 | — |
| EMA50_TOUCH | OOS | 1,929 | 53.5% | 50.6% | +0.0798 | — |
| EMA50_RECLAIM | ALL | 1,699 | 47.1% | 44.0% | -0.0425 | NOT_PROVEN |
| EMA50_RECLAIM | DISCOVERY | 1,030 | 46.2% | 42.2% | +0.0082 | — |
| EMA50_RECLAIM | VALIDATION | 425 | 45.5% | 39.4% | -0.1083 | — |
| EMA50_RECLAIM | OOS | 244 | 54.0% | 45.7% | -0.0805 | — |

## Matched confirmation result

On the exact same touch events that later satisfied the reclaim condition:

- EMA20: RECLAIM 51.8% vs TOUCH 64.7% -> **-12.89 percentage points**, median 24h delta **-0.2069 ATR4H**.
- EMA50: RECLAIM 47.1% vs TOUCH 64.8% -> **-17.70 percentage points**, median 24h delta **-0.2790 ATR4H**.

The future reclaim subset is strongly favorable at the original touch price, but that fact is not knowable at touch time. Waiting for the reclaim confirmation gives away the advantage. Therefore it cannot be used as a causal TOUCH filter after seeing the result.

## Interpretation

- EMA20 pullback is regime-dependent and fails Validation.
- EMA50_TOUCH has positive median 24h return in all three splits, but does not clear the adjusted confidence gate and does not improve the TREND_CONTEXT first-hit rate by the required +2 percentage points.
- Both reclaim routes fail and materially degrade matched-event geometry.
- No route advances to execution backtesting.

## Stop-rule action

Do not retune EMA periods/cooldowns, add Level Flow/FVG/QFVG rescue gates, or optimize exits on this sample to reverse R1.

The next research track must use a different primary mechanism. Because symmetric favorable-first diagnostics can reject valid positively skewed trend-following systems, the next track will test a complete Donchian/time-series-momentum strategy directly on net PnL with fixed costs, stop and trend exit rather than require win-rate > 50%.
