# DONCHIAN_LONG_ONLY_CROSSASSET_OOS_R1 — RESULT

## Final decision

**REJECT_HYPOTHESIS** under the frozen cross-asset OOS gate.

The post-hoc LONG/SHORT asymmetry discovered in `DONCHIAN_TREND_FOLLOWING_R1` was tested correctly here: the exact same 120/60/2ATR/cost mechanics were frozen and the LONG-only hypothesis was evaluated on 25 completely different Binance USDT-M futures symbols that were absent from the original Donchian R1 universe.

The hypothesis is strongly profitable in aggregate history but fails decisively in the most recent 2026 OOS segment. Therefore it is not robust enough for promotion.

## Integrity

- Workflow: `donchian-long-only-crossasset-oos-r1`, run `32143098624` — SUCCESS.
- 25/25 predeclared untouched symbols valid; no replacements.
- Aggregate artifact digest: `sha256:1bb242826b0e693b30f572a717f02e93a0040964899b0b735cb9b7c98956109f`.
- Frozen protocol hash validation passed before the symbol matrix.
- Original Donchian mechanics were unchanged apart from the separately predeclared LONG-only hypothesis.
- Production/PAPER code was not modified.

## Base result

- Closed trades: **921**.
- Total net R: **+476.0496R**.
- Average R/trade: **+0.5169R**.
- Profit factor: **1.6152**.
- Win rate: **15.3%**.
- Payoff ratio: **8.9349**.
- Positive-symbol ratio: **64%**.
- Symbol-block bootstrap 95% interval for mean R: **[+0.1190R, +0.9769R]**.

These aggregate numbers are strong but cannot override the frozen temporal/OOS requirements.

## Temporal result

| Period | N | Total R | Avg R | PF | Win rate |
|---|---:|---:|---:|---:|---:|
| EARLY 2022-2024 | 666 | +388.4155R | +0.5832R | 1.6950 | 15.9% |
| 2025 | 149 | +138.4892R | +0.9295R | 2.1422 | 16.1% |
| 2026 OOS Jan-Jul | 106 | **-50.8551R** | **-0.4798R** | **0.4574** | **10.4%** |

The new untouched asset universe therefore confirms that the LONG-only mechanism was genuinely strong through 2025, but it did **not** survive the 2026 regime.

## Breadth of the 2026 failure

The 2026 OOS failure is broad, not a single-symbol accident:

- **20 of 25** untouched symbols have negative 2026 OOS total R;
- only **5 of 25** are positive in 2026 OOS;
- several symbols record only stop losses in the segment;
- the aggregate 2026 PF is only **0.4574**.

This makes a post-hoc symbol exclusion invalid and unlikely to solve the underlying regime problem.

## Funding stress

The conservative funding-stress scenario remains profitable on the whole history but also fails the current regime:

- ALL: **+424.5008R**, PF **1.5354**;
- EARLY: +351.6163R, PF 1.6152;
- 2025: +129.8317R, PF 2.0378;
- 2026 OOS: **-56.9471R**, PF **0.4083**.

Thus financing assumptions are not the root cause. The failure is already present in price-path performance.

## Concentration

The frozen concentration gate also narrowly fails:

- ZECUSDT contributes **25.2%** of the positive-R pool versus a maximum allowed 25%;
- XLMUSDT contributes 18.4%;
- RUNEUSDT 9.0%;
- ALGOUSDT 6.7%;
- TRXUSDT 6.4%.

This is a secondary failure. The decisive failure is the broad negative 2026 OOS regime.

## Frozen gate outcome

PASS:

- sample size;
- valid-symbol count;
- trade-count breadth;
- aggregate total/average R;
- aggregate PF >= 1.15;
- 2025 positive/PF > 1;
- EARLY positive/PF > 1;
- symbol-block bootstrap lower bound > 0;
- >=60% positive eligible symbols;
- funding-stress aggregate R/PF.

FAIL:

- **2026 OOS positive/PF > 1**;
- **top positive contributor <=25%** (25.2% observed);
- **funding-stress 2026 OOS non-negative**.

Because the rules were frozen before results, the final decision is **REJECT_HYPOTHESIS**.

## Research conclusion

The strongest finding from the entire rebuilt research chain is now precise:

1. exact algorithmic `ORIGINAL_LEVEL_FLOW_V3` does not demonstrate stable directional edge;
2. simple 1D/4H trend context contains only a small directional signal, and the tested breakout/retest and EMA pullback/reclaim entries do not convert it robustly;
3. classic Donchian trend following does create a real positively-skewed aggregate PnL distribution across many crypto assets;
4. however, both the symmetric and independently replicated LONG-only versions are temporally regime-dependent;
5. LONG-only replication is strong through 2025 but broadly fails across untouched assets in 2026.

Therefore no tested strategy is eligible for PAPER promotion under the predeclared rules.

## Stop-rule action

Do not:

- remove the 20 losing 2026 symbols after seeing them;
- weaken the OOS or concentration gates;
- change 120/60 channels, 2ATR stop, costs or funding assumptions on this sample;
- add a 2026 regime filter and then claim it was independently validated on the same 2026 data;
- merge this research PR into production/PAPER.

Any next strategy family or regime filter must be predeclared and validated on genuinely new future data or another untouched evidence source. The current result is archived as a failed but informative hypothesis, not rescued.