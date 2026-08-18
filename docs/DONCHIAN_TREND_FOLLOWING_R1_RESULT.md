# DONCHIAN_TREND_FOLLOWING_R1 — RESULT

## Final decision

**REJECT_R1** under the frozen gate.

This is a materially different result from the earlier directional diagnostics: the complete strategy is strongly profitable in aggregate, survives cost/funding stress, has broad cross-symbol participation and a positive symbol-block bootstrap interval. It is nevertheless rejected because the predeclared Validation requirement fails.

## Integrity

- Workflow: `donchian-trend-following-r1`, run `32142275579` — SUCCESS.
- Fixed symbols: 25/25 valid.
- Aggregate artifact digest: `sha256:acb0c3f4acb41db934f134afd62c9fc94874f450d2b622baba8f4a850cf7ba9c`.
- Production/PAPER code was not changed.
- Frozen protocol hash check passed before symbol jobs.

## Base result

- Closed trades: **1,689**.
- Total net R: **+544.3277R**.
- Average R/trade: **+0.3223R**.
- Profit factor: **1.4163**.
- Win rate: **20.8%**.
- Payoff ratio: **5.3988**.
- Median trade: **-1.0201R**.
- Positive symbols among symbols with >=8 trades: **72%**.
- Symbol-block bootstrap 95% interval for mean R: **[+0.1407R, +0.5073R]**.

The low win rate is expected for this positively-skewed trend-following family and was not a failure criterion.

## Chronology

| Split | N | Total R | Avg R | PF | Win rate |
|---|---:|---:|---:|---:|---:|
| DISCOVERY 2022-2024 | 1,006 | +599.4514 | +0.5959 | 1.7684 | 20.5% |
| VALIDATION 2025 | 431 | **-74.4452** | **-0.1727** | **0.7798** | 19.5% |
| OOS 2026-01..07 | 252 | +19.3215 | +0.0767 | 1.1020 | 24.2% |

The frozen gate required every split to have positive total R and PF >1.00. Validation fails decisively, so R1 cannot advance as the tested symmetric long/short strategy.

## Directional asymmetry

| Side | N | Total R | Avg R | PF | Win rate | Payoff |
|---|---:|---:|---:|---:|---:|---:|
| LONG | 810 | **+593.1212** | +0.7322 | **1.9115** | 19.1% | 8.0774 |
| SHORT | 879 | **-48.7935** | -0.0555 | **0.9257** | 22.3% | 3.2258 |

This asymmetry is an observed result, not a predeclared filter. Therefore simply deleting SHORT after seeing R1 would be post-hoc optimization and is not allowed as an R1 rescue.

## Funding stress

The conservative stress subtracting 1 bp per 8 holding hours remains profitable overall:

- total: **+438.2704R**;
- PF: **1.3264**;
- OOS: **+3.0336R**, PF **1.0156**;
- Validation remains negative: **-99.4494R**, PF **0.7138**.

Thus transaction/funding stress is not the reason R1 fails. The failure is temporal regime instability concentrated in 2025.

## Concentration

Top positive contributors are not sufficient alone to explain the aggregate result:

- FETUSDT: +80.4781R (12.1% of positive-R pool)
- SOLUSDT: +67.5693R (10.2%)
- ETHUSDT: +59.0389R (8.9%)
- AVAXUSDT: +53.6072R (8.1%)
- INJUSDT: +49.9682R (7.5%)

The positive symbol ratio and symbol-block bootstrap also indicate that aggregate profitability is not a single-coin artifact.

## Frozen gate outcome

All predeclared checks pass except one:

- PASS overall N / OOS N / symbol breadth;
- PASS total and average R;
- PASS overall PF >=1.10;
- PASS DISCOVERY;
- **FAIL VALIDATION positive-R/PF>1 requirement**;
- PASS OOS;
- PASS symbol-block bootstrap lower bound >0;
- PASS positive-symbol ratio;
- PASS funding-stress aggregate gates.

Because the gate was frozen before results, one failed mandatory check means **REJECT_R1**.

## Next research action

The LONG/SHORT asymmetry is strong enough to generate a new hypothesis, but not to rewrite R1.

The next test must therefore be independent: freeze the same Donchian/ATR/cost mechanics as a LONG-only hypothesis and evaluate it primarily on a **new cross-asset universe that was not used anywhere in this Donchian R1**. The original 25 assets may be retained only as hypothesis-generation evidence, not as the pass/fail dataset for the new long-only study.

No R1 threshold, lookback, stop, fee or slippage value is retuned.
