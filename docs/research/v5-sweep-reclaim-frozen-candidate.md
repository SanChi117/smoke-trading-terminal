# V5 Sweep-Reclaim Frozen Candidate Dossier

Research/PAPER only. No production/runtime change.

## Frozen candidate

Candidate key: `SR4H_SWING_NEXT5M_OPEN`

A signal is eligible only when all of the following are true using information available no later than the closed 5m reaction candle and the immediately following 5m open:

- frozen V5 HTF context and FROM-zone selection are unchanged;
- 5m reaction type is exactly `sweep_reclaim`;
- FROM timeframe is exactly `4h`;
- FROM source is exactly `swing`;
- entry is the immediately following 5m candle open after the closed sweep-reclaim reaction candle;
- structural stop is not narrowed;
- synchronized HTF target is not pushed farther;
- RR floor remains 1.8R;
- V5 regime/model logic remains frozen;
- the route is additive research only and must not remove or replace any frozen baseline READY trade.

The later production 15m-confirmation result, including whether it would be RR-blocked below 1.8R, is diagnostic-only metadata. It is not an eligibility condition because it is not known at the next-5m-open decision time.

No reaction-score threshold is part of the candidate. The prior diagnostic showed that `score >= 75` did not improve the rescue rate and therefore is not included.

## Source evidence

Source: raw `entryTimingEpisodes` artifacts from PR #44 (`entry-timing-timing-a` and `entry-timing-timing-b`), two fixed 180-day windows across the same 19-symbol universe.

The PR #44 overall result was structure-dominant: only about 1.97% of all RR-blocked episodes were rescued to RR >= 1.8 by moving from the production 15m confirmation close to the next 5m open. `sweep_reclaim` was the localized exception.

For the discovery subset `sweep_reclaim + 4H + swing` among later RR-blocked episodes:

- RR-blocked episodes: 328
- next-5m-open RR >= 1.8: 59
- rescue rate: 17.99%
- window A: 34 / 177 = 19.21%
- window B: 25 / 151 = 16.56%
- long rescued episodes: 20
- short rescued episodes: 39
- symbols represented among rescued episodes: 17 / 19
- largest single-symbol concentration: 9 / 59 = 15.25%
- top-3 symbol concentration: 21 / 59 = 35.59%
- median production RR among rescued episodes: 1.5936R
- median next-5m-open RR among rescued episodes: 1.9771R
- next-5m-open RR range among rescued episodes: 1.8039R to 2.5737R
- median directional confirmation delay: 0.1486R
- median confirmation lag: 10 minutes

Rescued episodes by target timeframe:

- 4H target: 43
- 1D target: 16

Rescued episodes by target source:

- FVG: 29
- range_level: 13
- order_block: 9
- swing: 8

The candidate is therefore not concentrated in one symbol, one side, one 180-day window, or one target family.

## Why this candidate is frozen

This rule is selected from a previously observed localized timing effect, not from a profitability optimization. To avoid repeating the earlier R20D1 failure pattern, the candidate must not be refined after seeing later validation results.

The following post-hoc changes are forbidden before an untouched validation result exists:

- adding a reaction-score cutoff;
- changing 4H to 1D/4H or broadening source beyond `swing`;
- shrinking the structural stop;
- changing target selection;
- lowering the 1.8R floor;
- changing V5 regime gates;
- filtering symbols based on these 59 historical rescues;
- using any future 15m confirmation outcome as an eligibility condition for the next-5m-open route.

## Required next validation

The next valid experiment is a dedicated historical, causal, execution-aware replay of `SR4H_SWING_NEXT5M_OPEN` against frozen baseline C.

Minimum requirements:

1. Baseline READY trades have absolute priority and remain unchanged.
2. The additive route is evaluated only after a closed 5m `sweep_reclaim` reaction.
3. Entry uses the immediately following 5m open; no future candle may influence eligibility.
4. Stop and synchronized target use the same frozen structural formulas and causal data available at the reaction time.
5. RR floor stays 1.8R.
6. Costs, sequencing, cooldown and managed exits must be modeled explicitly.
7. Direct incremental trades must be reported separately from sequencing/cooldown effects.
8. Historical discovery must be followed by untouched OOS before any production consideration.

A historical candidate should not be accepted on one isolated extra trade. Before untouched OOS, require at least 4 direct incremental trades distributed across at least 3 fixed windows, positive direct incremental NetR and expectancy, aggregate NetR >= baseline, PF >= baseline - 0.10, and DD <= min(baseline + 1R, baseline * 1.15).

## Status

`FROZEN_CANDIDATE_READY_FOR_EXECUTION_REPLAY`

No production promotion is authorized by this document.
