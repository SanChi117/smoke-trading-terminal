# MULTISPEED_VOLTARGET_REPLICATION_R1 — RESULT

## Final interpretation

**NO_ARCHITECTURE_FULL_PASS** under the frozen known-period replication gate.

No profile may be promoted directly to PAPER because the 2026 weakness was already known before this external architecture was tested.

## Integrity

- Workflow run: `32146740708` — completed successfully.
- Aggregate artifact digest: `sha256:7feedaf2981223bdf3507f65552fe72f84b824e734aa6098e7d46e859b18ba35`.
- 50/50 fixed symbols valid; none insufficient.
- `terminal-ci`: SUCCESS.
- `level-flow-ci`: SUCCESS.
- Production/PAPER code unchanged.

## Portfolio matrix — BASE_COSTS

| Profile | Total return | CAGR | Vol | Sharpe | Max DD | 2025 return / Sharpe | 2026 known return / Sharpe | Positive symbols |
|---|---:|---:|---:|---:|---:|---|---|---:|
| SINGLE60_1X | +33.52% | 6.51% | 27.20% | 0.369 | -37.54% | -11.91% / -0.555 | -3.54% / -0.606 | 44% |
| COMBO9_1X | +28.89% | 5.69% | 21.25% | 0.367 | -33.71% | -12.50% / -0.748 | -5.51% / -1.058 | 46% |
| COMBO9_VOL25 | +18.14% | 3.70% | 6.27% | 0.611 | **-8.91%** | -2.61% / -0.573 | -1.82% / -1.127 | **78%** |
| COMBO9_VOL25_RB20 | +19.83% | 4.03% | 6.51% | **0.638** | -9.46% | -2.68% / -0.583 | -1.97% / -1.245 | **78%** |

All four profiles fail the full frozen architecture gate because 2025 and 2026 remain negative.

## Component findings

### Multi-speed diversification

**Not supported as a regime repair by itself.**

- SINGLE60 2026 Sharpe: -0.606.
- COMBO9_1X 2026 Sharpe: -1.058.

Nine speeds reduce overall volatility/drawdown modestly but do not preserve directional profitability in the failing periods.

### Volatility targeting

**Supported as a risk-control component, not as an edge source.**

Relative to COMBO9_1X:

- max drawdown improves from -33.71% to -8.91%;
- 2026 loss improves from -5.51% to -1.82%;
- positive-symbol ratio rises from 46% to 78%;
- overall Sharpe rises from 0.367 to 0.611.

It therefore changes the severity and cross-sectional distribution of losses, but it does not make 2025/2026 profitable.

### 20% rebalance threshold

**Supported as a turnover-control component.**

- total one-way turnover: 20.3325 → 19.9793;
- overall Sharpe: 0.611 → 0.638.

The threshold reduces turnover without degrading Sharpe; in this implementation Sharpe improves slightly.

## Funding stress

Funding stress does not reverse the conclusion. Both vol-target profiles remain positive over the full sample but are negative in 2025 and 2026 known.

## Why this is not a replication of the complete published crypto program

This R1 deliberately kept a fixed 50-symbol universe to isolate signal-speed and risk-sizing effects. The published diversified program contains an additional dynamic universe layer:

- monthly eligibility screening;
- minimum listing age;
- minimum trailing liquidity;
- ranking by trailing trading volume;
- selecting a limited top-liquidity portfolio for the following month;
- liquidity/activity exit rules.

Therefore the next study must test that universe mechanism separately while freezing the nine speeds, volatility target, leverage cap and rebalance threshold.

## Research decision

Archive PR unmerged. Preserve two externally supported components as measured mechanisms:

1. volatility targeting materially controls risk;
2. 20% threshold reduces turnover without sacrificing overall risk-adjusted performance.

Do not claim that multi-speed/vol-target alone solves regime detection. Open a separate dynamic-liquidity-universe replication with the published selection rules.
