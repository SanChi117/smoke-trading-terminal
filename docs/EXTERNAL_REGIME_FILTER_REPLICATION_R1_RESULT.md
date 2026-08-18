# EXTERNAL_REGIME_FILTER_REPLICATION_R1 — RESULT

## Final interpretation

**NO_EXTERNAL_GATE_REPLICATED** under the predeclared mechanism gate.

The study is known-period replication, not OOS. No profile may be promoted from this result.

## Integrity

- Workflow run: `32145648259` — SUCCESS.
- Aggregate artifact digest: `sha256:0b5117b150f41a826615221036be8c6947db6172065942f0922eaf9bf550aeca`.
- 25/25 fixed cross-asset symbols completed successfully.
- Production/PAPER files were not changed.
- External profile definitions were frozen before the replay.

## Net matrix

| Profile | N | Total R | PF | EARLY R / PF | 2025 R / PF | 2026 known R / PF | Positive-symbol ratio | Bootstrap low95 | Retention |
|---|---:|---:|---:|---|---|---|---:|---:|---:|
| BASE | 921 | +476.05 | 1.615 | +388.42 / 1.695 | +138.49 / 2.142 | **-50.86 / 0.457** | 64% | +0.1168 | 100% |
| QUATTRO_CODE | 481 | +355.63 | **1.872** | +207.16 / 1.655 | +150.73 / **3.206** | **-2.26 / 0.901** | 56% | +0.0466 | 52.2% |
| EMA200_SLOPE20 | 293 | +213.19 | 1.839 | +65.42 / 1.315 | +154.04 / 5.584 | -6.28 / 0.503 | 42.9% | -0.1254 | 31.8% |
| APEX_FILTER | 597 | +272.61 | 1.548 | +152.55 / 1.406 | +147.05 / 3.215 | -26.99 / 0.513 | 56% | -0.0614 | 64.8% |

No externally sourced binary gate met all frozen criteria.

## Most important observation

`QUATTRO_CODE` — the actual published behavior `4H breakout close > last closed daily EMA200` — is materially different from the other gates:

- 2026 known loss improves from -50.86R to only -2.26R;
- 2026 PF improves from 0.457 to 0.901;
- overall PF improves from 1.615 to 1.872;
- 2025 improves rather than deteriorates;
- symbol-block bootstrap lower bound remains positive;
- it retains 52.2% of BASE trades.

However, it still fails the frozen requirements because 2026 remains negative/PF<1, the positive-symbol ratio is only 56%, and funding-stress 2026 remains negative.

This is **mechanistic evidence that higher-timeframe price location removes a large share of the bad recent trend-following exposure**, not evidence of a completed regime detector.

## Other external gates

### EMA200_SLOPE20

The daily EMA200 slope rule is too restrictive and less cross-sectionally robust. It retains only 31.8% of trades, has a negative symbol-block bootstrap lower bound, and does not repair 2026.

### APEX_FILTER

The 4H `close > SMA50 > SMA200` plus `volume > 1.5 x SMA20(volume)` filter preserves more trades but leaves a substantial 2026 loss and loses bootstrap/cross-symbol robustness.

## Suppression diagnostic

The external filters do not only remove bad trades. They also remove substantial historical winners, which explains why aggressive binary gating is a weak architectural solution:

- QUATTRO_CODE removes BASE trades totaling +228.25R over the full history, despite removing -63.97R of BASE trades in 2026 known.
- EMA200_SLOPE20 removes +254.52R overall while removing -50.96R in 2026.
- APEX_FILTER removes +408.23R overall while removing -25.79R in 2026.

Therefore the objective should not be to switch the strategy OFF whenever a simple trend condition weakens. A better architecture should **diversify trend speeds and scale exposure/risk continuously**, preserving slower/earlier winners while reducing concentration in a failing speed/regime.

## Research decision

Archive this R1 unmerged. Do not combine these gates post hoc.

Open a separate external-architecture study based on two independently documented principles:

1. multi-speed trend ensemble rather than one Donchian lookback;
2. volatility-based exposure normalization / risk scaling rather than a binary regime switch.

The crypto-specific motivation is the Zarattini/Pagani/Barbon ensemble of multiple Donchian lookbacks with volatility-based sizing; the broader managed-futures motivation is multi-speed trend diversification with volatility scaling.
