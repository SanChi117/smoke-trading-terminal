# LEVEL_FLOW_EDGE_DIAGNOSTIC_R1

## Status

Research only. This protocol does not change the production/PAPER analyzer, does not place orders, and is not a strategy promotion.

The purpose is to answer one question before any further optimization: **does ORIGINAL_LEVEL_FLOW_V3 contain directional value in its market context and selected HTF zones, and if so which fixed entry mechanism preserves that value best?**

## Frozen source

The diagnostic calls `app/lib/level/analysis-v3.ts` directly. The branch must fail validation if the original V3 behavioral dependencies no longer match these Git blob IDs:

- `app/lib/level/analysis-v3.ts`: `8beca69f3d0b20e2a89e05ccbf16a9d14d593210`
- `app/lib/level/math.ts`: `125f8551a0fa27b093dd9e6ab94a146cd1607319`
- `app/lib/level/structure.ts`: `7f8a18913d0674ab873964c43c18f32236fcf31a`
- `app/lib/level/zones.ts`: `f5ca1bd6a7757b8574d3cbd833abb9b0b077405d`

No V5 regime gate, QFVG route, V6 location experiment, or production RR exception may redefine the diagnostic source.

## Fixed sample

- Period: 540 calendar days ending `2026-07-31T23:55:00Z`.
- The period is split chronologically into three equal diagnostic blocks: A / B / C.
- Market data: Binance Vision USDT-M futures candles.
- Timeframes used by original V3: 1W / 1D / 4H / 15m / 5m.
- Main 19-symbol Level Flow research universe plus five broad/liquid extensions, fixed before results:
  - BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, SUIUSDT, APTUSDT, NEARUSDT, LINKUSDT, AAVEUSDT, ARBUSDT, OPUSDT, DOGEUSDT, TAOUSDT, ONDOUSDT, INJUSDT, SEIUSDT
  - TONUSDT, PEPEUSDT, FETUSDT, WIFUSDT, DOTUSDT

Unavailable or history-insufficient symbols are reported as insufficient; they are not replaced after seeing results.

## Stage 1 — context directional value

When the original V3 context trace is PASS and bias is non-neutral, one causal observation is sampled at most once per 24 hours per symbol.

The observation is scored in the V3 direction. No zone, reaction, SL, TP, RR floor, or later trade outcome is allowed to decide whether the context observation exists.

## Stage 2 — zone directional value

A zone becomes eligible only while:

- original V3 context is PASS;
- original V3 has already selected an active 1D/4H zone;
- the 4H route is `approaching`;
- price has not yet touched the zone in the current 15m observation.

The zone is frozen before contact. Only its first subsequent causal touch is used as the event. The TOUCH reference uses the zone edge known before contact and begins outcome measurement on the next 5m candle, so the touch candle cannot leak its later range into the result.

## Stage 3 — fixed entry matrix on the same zone events

No parameters are chosen after results. Four mechanisms are compared on the same frozen zone-touch events:

1. `TOUCH` — reference entry at the pre-known zone edge; outcome starts next 5m candle.
2. `SWEEP_RECLAIM` — the original V3 sweep/reclaim geometry; execution at the next 5m open.
3. `BOS` — close through a fixed local structure level defined from the last 12 completed 5m candles before touch, directional candle body at least 0.25 ATR(5m); execution at the next 5m open.
4. `BREAK_RETEST` — the same BOS followed by a retest within eight 5m candles, tolerance 0.22 ATR(5m); execution at the next 5m open.

`V3_15M_CONFIRM_CONTROL` is reported as a control route, using the original V3 first 15m confirmation and next-15m-open execution. It is not allowed to rewrite the discovery rules above.

## Outcomes

This stage does **not** optimize SL or TP. It measures direction and geometry only.

For every event/method:

- signed return after 1h / 3h / 6h / 12h / 24h, normalized by ATR(4H);
- MFE and MAE over the same horizons, normalized by ATR(4H);
- symmetric favorable-vs-adverse first-hit tests at 0.5 / 1.0 / 1.5 ATR(4H) within 24h.

If favorable and adverse barriers are both touched inside the same 5m candle, the result is `ambiguous` and excluded from the resolved favorable-rate denominator.

## Predeclared interpretation criteria

### Context edge

`CONTEXT = DIRECTIONAL_EDGE_PRESENT` only if all are true:

- at least 1,500 observations;
- at least 12 symbols have at least five observations;
- lower bound of Wilson 95% interval for 1 ATR favorable-first rate is above 50%;
- median signed 24h return is positive;
- each of blocks A, B and C has a 1 ATR favorable-first rate above 50%.

### Zone edge

`TOUCH = DIRECTIONAL_EDGE_PRESENT` uses the same criteria except minimum sample is 200 zone-touch events.

### Entry route discovery

A post-touch route can be labeled `DISCOVERY_PROMISING` only if all are true:

- at least 80 route executions;
- at least eight symbols have at least five executions;
- lower Wilson 95% bound for 1 ATR favorable-first rate is above 50%;
- median signed 24h return is positive;
- at least two of A/B/C have favorable-first rate above 50%;
- no block with at least 10 observations has favorable-first rate below 45%;
- on matched events, favorable-first rate improves by at least +3 percentage points versus TOUCH.

This is discovery evidence only. It is **not** sufficient for PAPER promotion.

## Final diagnostic interpretations

- `CONTEXT_AND_ZONE_EDGE_PRESENT`: the original market view and its HTF zone selection both show directional value. A fixed entry route may then be frozen for validation.
- `CONTEXT_EDGE_ONLY`: broad direction has value, but current zone selection/timing does not prove value.
- `ZONE_CONDITIONAL_EDGE_PRESENT`: zone events show value even though broad daily context alone does not clear the stricter context test.
- `NO_DIRECTIONAL_EDGE_PROVEN`: changing the trigger alone is not justified; the original Level Flow market-view edge is not proven.

## Stop rule

No thresholds in this protocol may be changed after the aggregate result is visible. If a route is promising, it must be frozen unchanged and evaluated in a separate validation period and then on untouched OOS. If the original directional logic fails, this research branch is closed rather than rescued with additional filters.
