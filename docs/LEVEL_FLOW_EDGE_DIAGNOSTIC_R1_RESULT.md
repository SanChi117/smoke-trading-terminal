# LEVEL_FLOW_EDGE_DIAGNOSTIC_R1 — RESULT

## Final status

**REJECTED / ARCHIVED.**

Predeclared aggregate verdict: `NO_DIRECTIONAL_EDGE_PROVEN`.

This result does **not** prove that discretionary HTF structure/zone reading is useless. It shows that the exact algorithmic formalization preserved as `ORIGINAL_LEVEL_FLOW_V3` did not demonstrate a stable directional edge under the frozen diagnostic protocol.

## Execution integrity

- Diagnostic workflow: `level-flow-edge-diagnostic`, run #1, **SUCCESS**.
- Workflow run id: `32138161776`.
- Aggregate artifact digest: `sha256:7682656b74b34258c9b60a8d67e43fe69d343f991585ae50523d29bba3db9c64`.
- `level-flow-ci`: **SUCCESS**.
- `terminal-ci`: **SUCCESS**.
- Production/PAPER strategy files were not changed.
- The diagnostic used the frozen original V3 analyzer and dependency blob IDs documented in `LEVEL_FLOW_EDGE_DIAGNOSTIC_R1.md`.

## Sample

- Fixed period: 540 days ending `2026-07-31T23:55:00Z`.
- Requested symbols: 24.
- Valid symbols: 23.
- Insufficient history: `PEPEUSDT`; it was not replaced after results were known.
- Total 15m causal evaluations: **1,192,320**.
- Frozen zone-touch opportunities: **1,218**.

## Aggregate matrix

| Method | N | 1 ATR favorable-first | Wilson 95% lower bound | Median 24h return, ATR4H | A / B / C favorable-first | Matched delta vs TOUCH | Verdict |
|---|---:|---:|---:|---:|---|---:|---|
| CONTEXT | 5,595 | 50.6% | 49.2% | +0.0099 | 48.1% / 50.8% / 52.1% | — | NOT_PROVEN |
| TOUCH | 1,218 | 45.8% | 42.8% | +0.1220 | 42.1% / 46.1% / 48.5% | — | NOT_PROVEN |
| SWEEP_RECLAIM | 243 | 43.7% | 37.2% | +0.1221 | 27.9% / 47.9% / 51.9% | +14.08 pp | NOT_PROVEN |
| BOS | 556 | 50.1% | 45.6% | -0.0658 | 34.1% / 59.5% / 53.9% | -24.89 pp | NOT_PROVEN |
| BREAK_RETEST | 422 | 48.8% | 43.6% | -0.0701 | 32.4% / 57.6% / 53.2% | -26.38 pp | NOT_PROVEN |
| V3_15M_CONFIRM_CONTROL | 751 | 45.5% | 41.7% | +0.0358 | 34.8% / 49.8% / 50.7% | -8.74 pp | NOT_PROVEN |

Promising discovery routes: **none**.

## Matched-event interpretation

`SWEEP_RECLAIM` is the only route that improves materially versus TOUCH on the exact same subset of events: 43.66% favorable-first versus 29.58% for TOUCH, a +14.08 percentage-point difference, with median 24h return improvement of +0.2265 ATR4H.

That relative improvement is **not sufficient evidence of an edge** because:

- absolute favorable-first remains below 50%;
- the Wilson lower bound is only 37.2%;
- block A collapses to 27.9%;
- only one of three chronological blocks is above 50%;
- the predeclared route criterion explicitly rejects this pattern.

`BOS` and `BREAK_RETEST` improve in later blocks but collapse in block A, have negative median 24h returns, and underperform TOUCH materially on matched events. This is consistent with regime sensitivity rather than a robust trigger edge.

The original V3 15m confirmation also fails to repair the problem.

## Scientific interpretation

### 1. Context

The original 1W/1D context is near coin-flip on the primary symmetric 1 ATR test. The point estimate is 50.6%, but the 95% Wilson lower bound is below 50%, and chronological block A is below 50%. Therefore broad directional context is **not proven**.

### 2. Zone selection

The preselected 1D/4H V3 zones are weaker on the same directional test: 45.8% favorable-first overall, with all three chronological blocks below 50%. Therefore the exact V3 zone-selection/timing logic does **not** provide the missing directional edge.

The positive median 24h signed return at TOUCH does not override the frozen criteria after results are seen; doing so would be post-hoc reinterpretation.

### 3. Entry replacement

No tested entry mechanism satisfies the predeclared discovery criteria. The hypothesis **“the market view is already good and only the entry trigger needs replacement” is not supported by this diagnostic**.

## Stop-rule decision

Per the protocol frozen before results:

- do not create V3.1/V4 rescue variants from this result;
- do not retune thresholds on these same 540 days;
- do not promote any route to PAPER;
- archive this branch and PR unmerged;
- preserve V3 as historical/reference logic only.

The next research track must be a genuinely separate baseline whose primary edge mechanism does not assume that Level Flow context or zones are already profitable. HTF structure/zones may remain as explanatory metadata or later independent A/B variables, but not as an assumed mandatory gate.
