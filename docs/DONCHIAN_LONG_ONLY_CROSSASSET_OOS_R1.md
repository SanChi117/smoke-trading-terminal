# DONCHIAN_LONG_ONLY_CROSSASSET_OOS_R1

## Purpose

`DONCHIAN_TREND_FOLLOWING_R1` was rejected because its frozen 2025 Validation gate failed, even though the aggregate result was strongly positive. That rejected R1 also exposed a large LONG/SHORT asymmetry: LONG was strongly positive while SHORT was negative.

That asymmetry is hypothesis-generation evidence only. It is **not** proof that deleting shorts makes R1 valid.

This study tests the new hypothesis on an independent cross-asset dataset:

> The exact frozen Donchian/ATR/cost mechanics from R1 may have a transferable LONG-only edge across crypto futures that were not part of the original 25-symbol Donchian R1 universe.

The original 25 Donchian-R1 symbols are completely excluded from the pass/fail dataset here.

## Untouched cross-asset universe

Fixed before seeing any strategy result on these assets:

BCHUSDT, TRXUSDT, XLMUSDT, ETCUSDT, FILUSDT, UNIUSDT, ICPUSDT, ALGOUSDT, VETUSDT, RUNEUSDT, GALAUSDT, SANDUSDT, MANAUSDT, CRVUSDT, CHZUSDT, LDOUSDT, DYDXUSDT, IMXUSDT, STXUSDT, COMPUSDT, SNXUSDT, ZECUSDT, KAVAUSDT, XTZUSDT, ENJUSDT.

No failed/unavailable symbol may be replaced after results are known. A symbol with insufficient Binance Vision USDT-M 4H history is simply marked insufficient.

None of these 25 symbols appeared in the `DONCHIAN_TREND_FOLLOWING_R1` fixed universe.

## Frozen mechanics

All numeric mechanics are copied unchanged from rejected Donchian R1. Only the side universe is changed to LONG-only because that is the new hypothesis being tested on independent assets.

### Timeframe

- 4H completed candles.
- one position maximum per symbol.
- no pyramiding, averaging, partial exits, discretionary overrides or short trades.

### LONG entry

- Donchian entry lookback: **120 completed 4H candles**.
- signal: current completed 4H close > highest high of the previous 120 completed 4H candles.
- execution: next 4H open.
- adverse slippage: **3 bps per side**.

### Initial risk

- Wilder ATR(14) on 4H.
- initial stop: **2.0 ATR(4H)** below modeled entry fill.
- stop is fixed and is never widened.
- 1R is the entry-to-initial-stop price distance before fees.

### Trend exit

- Donchian exit lookback: **60 completed 4H candles**.
- signal: completed 4H close < lowest low of the previous 60 completed 4H candles.
- execution: next 4H open.
- intrabar fixed stop has priority over a later close-based channel exit.
- gap-through stop uses the worse opening price.
- no TP and no time stop.

### Costs

BASE:
- commission **5 bps per side**;
- adverse slippage **3 bps per side**.

FUNDING_STRESS:
- BASE plus an additional adverse **1 bp per 8 holding hours**.

### Evaluation cutoff

- new entries through **2026-07-31 23:59 UTC**;
- exit data through **2026-08-17 23:59 UTC**;
- any remaining position is force-closed at the final 4H close with normal adverse exit slippage and commission and labeled `EVALUATION_CUTOFF`.

## Chronology inside the untouched asset set

Although the entire asset universe is cross-asset OOS relative to Donchian R1, temporal stability is still reported and required:

- EARLY: entries 2022-01-01 through 2024-12-31;
- 2025: entries 2025-01-01 through 2025-12-31;
- 2026_OOS: entries 2026-01-01 through 2026-07-31.

Assets listed later naturally contribute only after their history exists. Missing earlier history is not backfilled or replaced.

## Reported metrics

BASE and FUNDING_STRESS:

- trade count;
- total/average/median net R;
- profit factor;
- win rate;
- average win / average loss / payoff ratio;
- holding time;
- EARLY / 2025 / 2026_OOS breakdown;
- per-symbol metrics;
- positive-symbol ratio;
- deterministic symbol-block bootstrap 95% interval for mean R;
- top positive contributor concentration.

## Frozen pass gate

`CROSSASSET_OOS_CONFIRMED` only if **all** are true in BASE:

- at least **300** closed trades overall;
- at least **15** valid symbols;
- at least **10** symbols have >=10 closed trades;
- total R > 0;
- average R > 0;
- PF >= **1.15**;
- 2025 total R > 0 and PF >1.00;
- 2026_OOS total R > 0 and PF >1.00;
- if EARLY has >=50 trades, EARLY total R >0 and PF >1.00;
- deterministic symbol-block bootstrap 95% lower bound for mean R >0;
- at least **60%** of symbols with >=8 trades have positive total R;
- no single symbol contributes more than **25%** of total positive-R pool.

FUNDING_STRESS additionally requires:

- aggregate total R >0;
- aggregate PF >=1.05;
- 2026_OOS total R >=0.

No minimum win rate is required.

## Interpretation

A pass means the post-R1 LONG-only hypothesis replicated on a genuinely different asset universe without changing the original 120/60/2ATR/cost parameters. It still does **not** authorize PAPER: it opens portfolio/execution robustness and then a prospective PAPER stage.

A fail means the long-side asymmetry observed in the original Donchian R1 did not replicate strongly enough cross-sectionally. The hypothesis is rejected rather than rescued on this dataset.

## Stop rule

After this aggregate result is visible:

- do not replace failed symbols;
- do not change the 120/60 channels, 2ATR stop, costs or funding stress;
- do not add EMA/Level Flow/FVG/QFVG/volume filters;
- do not weaken the gate;
- if failed, close this hypothesis.
