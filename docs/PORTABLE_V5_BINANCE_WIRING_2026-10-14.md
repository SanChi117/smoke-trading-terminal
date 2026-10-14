# SMOKE Trading OS — V5 → USD-M → PAPER server adapter

**Срез:** 2026-10-14, cycle P3. **PAPER only; strategy code unchanged.** Published AppDeploy v47 unchanged; no Railway deployment or live order calls.

## Implemented flow

```text
Host clock (every minute; actual scheduler NOT yet deployed)
  -> gated worker-once.mjs (requires two explicit opt-ins)
  -> read-only public Binance USD-M time + BTC bookTicker + closed 1m preflight
  -> connect PostgreSQL and read ledger namespace
  -> portable-cycle-runner.runOnce() for BTC, ETH, SOL, LINK, SUI
      1. onMinute: monitor EXISTING PAPER position from complete CLOSED 1m
          - forward pagination 900 candles/page, 7-day max, exact timestamps
          - audit first partial entry minute; ambiguous touch => HALT
          - missing/gapped future/HTTP 451 => fail closed, no fabricated exit
          - use durable PostgreSQL CAS
      2. onClosed15m only when signal close is less than 10 min old
          - 1w / 1d / 4h / 15m / 5m Binance public kline queries
          - EXACT as-of closeAt, no future/partial bars, all five frames contiguous
          - validate 24/70/220/120/180 minimum frame bars
          - call unchanged existing analyzeLevelFlow from
            app/lib/level/analysis-qfvg-fs15.ts
          - output only ready/watch/blocked plan with symbol/as-of/risk checks
          - use a FRESH observed public bookTicker bid/ask, not stale old time
          - invoke existing PAPER-only open transition; PostgreSQL CAS
  -> JSON report, no real order interface
```

## Exact files

- `core/paper/portable-v5-adapter.ts`: original `analyzeLevelFlow` reused, never modified or reimplemented; no implicit changes to `ACTIVE_PAPER_STRATEGY_ID='V5_UNMODIFIED'`.
- `core/market/binance-usdm-portable.ts`: exact official hardcoded `https://fapi.binance.com` public GET only, no auth, no proxy fallback; correct Binance `endTime=closeAt-1` and 1m forward pages. Throws explicit errors on corrupt, gapped, partial or stale data.
- `core/paper/portable-paper-runtime.ts`: fixed post-fetch clock to prevent rejecting otherwise valid quotes as coming from the future. Historical stale, risk and PAPER sizing rules are preserved.
- `core/paper/portable-cycle-runner.ts`: separate 1m/15m per-symbol finite pass, avoid stale signal >10m, reject overlapping runs; degraded report when price/data/strategy unavailable rather than falsely reporting a healthy scan.
- `deployment/portable-paper/worker-once.mjs`: explicit opt-in worker. **Does not run by default**; refuses execution unless both `SMOKE_PAPER_WORKER_ENABLED=1` and `SMOKE_PAPER_MARKET_EGRESS_CONFIRMED=1`, then requires a real read-only USD-M egress PASS and configured PostgreSQL. Running this can write **PAPER-only** positions to the named ledger. Do not set flags until the target platform/region has been approved and market-data evidence independently verified. No real order APIs or credentials.
- `deployment/portable-paper/Dockerfile`: includes strategy pure sources and adapter but **default command remains the read-only HTTP server**, not the worker or loop.

## Verification / refutation

- `portable-v5-usdm-fixture-qa` run `38634325250` SUCCESS on code SHA `e5c9966c...`: eight 5TF real-V5 and synthetic USD-M adapter tests; six orchestration tests; eleven baseline PAPER core tests; scoped `--strict` TypeScript all PASS. The test called the **existing V5 source** with generated MTF history. It did NOT use real Binance or prove that real market yields a READY.
- First version of that CI had a test-fixture error: an existing PAPER position was fabricated from a V5 signal older than the engine's 10-minute life, so the simulator correctly rejected it; repaired in `e5c9966c...`, green rerun. This was a test problem, not a production entry rule change.
- First new USD-M adapter suite `38633816362` had 8/8 and base 11/11 PASS but scoped TypeScript TS2352 on an overly broad `Object.fromEntries` cast; corrected to explicit five-frame shape in `f6ad86e9...` and rechecked in the successful `38634325250` run.
- `portable-paper-standalone-http-qa` run `38634471134` SUCCESS, job `116093991257`: real PostgreSQL service 2/2, read-only Binance fixture 8/8, built and booted Docker read-only HTTP server, logged `PORTABLE_PAPER_CONTAINER_SMOKE=PASS`; additionally booted packaged `worker-once.mjs` with no network and no flags, logged `PORTABLE_PAPER_WORKER_DEFAULT_OFF=PASS`. Never connected to owner's database.
- New repeatable fixture tests live under `tests/portable-v5-binance-integration.test.mjs` and `tests/portable-cycle-runner.test.mjs`.
- The operator-required adversarial review found a reporting bug: strategy/feed failure `STRATEGY_DATA_UNAVAILABLE` was being reported as `ok:true` even though the PAPER engine refused any entry. Fixed `core/paper/portable-cycle-runner.ts` to expose `degraded` and return `ok:false` for degraded feed/strategy/HALT while still allowing genuine healthy `NO_V5_READY`.

## Unresolved / no release yet

- GitHub Actions and AppDeploy server earlier returned Binance Futures HTTP 451. **No current real legal Railway regional preflight was conducted here.** Synthetic 200 responses do not change geographic access.
- No cron/24×7 scheduler, no live network endurance, no real V5 signal→PAPER entry→minute stop/TP on actual Binance prices. Worker is finite/manual opt-in and must never silently launch on container startup.
- No production PostgreSQL backup/restore drill, data migration or AppDeploy↔GitHub UI source reconciliation. PR #88 stays DRAFT and existing user journal was never touched.
- The hosted Binance policy and regional permission must be resolved before enabling PAPER. If probe fails 451, refuse and do not route around restrictions.
- Future new entry strategy is not delivered or enabled; only `V5_UNMODIFIED` is active.

**Next:** independent legal-region read-only market egress test, then explicit read-only 5TF historical QA and scheduled PAPER trial on isolated PostgreSQL, with 24-hour failure/restart/backfill checks. Migrate public UI only after release acceptance.
