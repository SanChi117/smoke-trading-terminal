# Smoke Trading Terminal — Research Roadmap

Freeze date: 2026-08-27
Scope: research only. Production, PAPER, site and real orders are untouched.

## Goal
Find at least one crypto trading mechanism that survives causal historical testing, realistic costs/funding, chronological validation, and a frozen prospective/OOS holdout. If none survives, stop and conclude that no tested mechanism is ready for PAPER.

## Current finalists

### A. HIGHVOL cross-sectional reversal
Status: KNOWN-PERIOD SUPPORTED, PROSPECTIVE COLLECTING.
Known-period actual-funding result: +51.19% cumulative, Sharpe 0.541, MDD -31.14%; 2025 positive; 2026 known marginally positive.
Prospective PR: #68.
Maturity: >=112 prospective daily rows AND >=16 prospective Friday formations.
Prospective pass gate: cumulative >0, Sharpe >=0.50, MDD >=-0.35, funding coverage >=99%.

### B. Low-volatility cross-section
Status: KNOWN-PERIOD INTERESTING_NOT_PROVEN, PROSPECTIVE COLLECTING.
Known-period base result: +25.48% cumulative; all chronological segments positive; 2026 known +12.56%, but overall Sharpe/MDD missed the known-period support gate.
Prospective PR: #73.
Maturity: >=180 prospective daily rows AND >=6 prospective month-end formations.
Prospective pass gate: BASE cumulative >0, Sharpe >=0.50, MDD >=-0.30, funding coverage >=99%, DOUBLE_COST cumulative >0.

## Discovery backlog — finite
No endless factor mining. From this freeze only ONE final independent discovery class may be added if it can be reproduced causally from Binance data without tuning:
1. Spot–perpetual basis convergence / premium dislocation, distinct from funding carry.
If the required synchronized spot/perp history cannot be obtained reproducibly, skip it rather than substitute another factor.

No more variants/tuning of trend, reversal, low-vol, funding carry, cointegration, anchoring, skewness, illiquidity, past-alpha, MAX, short reversal, order-flow, market beta or downside beta after their R1 result.

## Rejected families
Trend/Donchian/regime variants; Level Flow directional diagnostics; funding carry; cointegration stat-arb; 52-week anchoring; skewness; illiquidity; past alpha; MAX momentum; daily short reversal; market beta; downside beta. Order-flow imbalance had strong historical aggregate performance but failed the frozen 2026 chronological gate and is rejected without rescue tuning.

## Stage sequence from now on
1. Keep PR #68 and #73 frozen and technically healthy. Engineering/data-integrity fixes only.
2. Optionally run ONE final basis-convergence R1 if causal synchronized spot/perp data are reproducible.
3. Stop discovery after that test regardless of result.
4. Collect prospective/OOS data for finalists to their predeclared maturity thresholds.
5. When mature, apply the frozen prospective gates without parameter changes.
6. If at least one finalist passes: run final execution/PAPER-readiness audit (signal causality, turnover, costs, funding, data gaps, accounting, operational failure modes).
7. Only after that audit may a separate PAPER implementation be proposed. Real-money authorization is never implied.
8. If all finalists fail prospective gates: close the research cycle with verdict NO_SUPPORTED_STRATEGY and do not manufacture a strategy by tuning rejected ideas.

## Definition of DONE
The research phase ends in exactly one of two states:

### DONE_A — PAPER_CANDIDATE_READY
At least one frozen strategy passes prospective/OOS and the final execution/PAPER-readiness audit. Deliverables: exact immutable strategy specification, evidence report, risk envelope, PAPER harness and monitoring plan.

### DONE_B — NO_SUPPORTED_STRATEGY
All frozen finalists fail prospective/OOS or execution audit. Deliverable: consolidated negative-results report and explicit stop; no more factor mining unless a genuinely new data source/mechanism is introduced in a future research program.

## Current position
We are now near the end of discovery, not at the beginning. The main remaining work is prospective validation of HIGHVOL reversal and low-volatility, not repeated invention of new indicators.
