# SMOKE Level Flow V5 — Paper Observer VPS

The paper observer is a read-only research process. It uses public Binance USDⓈ-M Futures market data and the same V5 decision engine as the terminal. It does not contain exchange account credentials and cannot place real orders.

## Safety contract

- Mode: `PAPER_ONLY`.
- Default paper risk per accepted trade: 1%.
- UTC daily drawdown stop: -2%.
- UTC weekly drawdown stop: -5%.
- Stop admissions after 3 consecutive stop-loss outcomes in the current UTC day.
- Maximum 1 pending paper position per symbol.
- A READY setup blocked by the risk gate is still stored as `skipped_kill_switch` with the exact reason.
- `skipped_kill_switch`, pending, cancelled and expired records do not count toward the 100 closed-trade paper-review threshold.
- Live promotion remains blocked until the separate paper-review gate reaches at least 100 closed virtual trades and 30 calendar days.

## Install on the VPS

From the repository root:

```bash
sudo bash scripts/install-paper-observer-service.sh
```

The installer creates/enables the `smoke-paper-observer` systemd service and a local `.env.paper-observer` file if one does not exist.

Default environment:

```text
PAPER_OBSERVER_PORT=8092
PAPER_SCAN_INTERVAL_MS=300000
PAPER_SCAN_CONCURRENCY=3
```

No Binance API key or account credential is required.

## Verify

```bash
curl http://127.0.0.1:8092/health
curl http://127.0.0.1:8092/status
sudo systemctl status smoke-paper-observer --no-pager
```

`/health` must report `ok: true` and `mode: PAPER_ONLY`.

`/status` reports scan state, per-symbol errors, latest decisions, paper journal totals, paper-review metrics and current risk-gate state.

## Persistence

Current journal:

```text
runtime/paper-observer/journal.json
```

Daily snapshots:

```text
runtime/paper-observer/daily/YYYY-MM-DD.json
```

Writes are atomic. The service saves the journal after every completed scan and on shutdown.

## Operation

The observer scans the configured symbol universe continuously using the current V5 engine. A failure on one symbol does not abort the rest of the scan.

Optional environment overrides:

```text
PAPER_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT
PAPER_SCAN_INTERVAL_MS=300000
PAPER_SCAN_CONCURRENCY=3
PAPER_OBSERVER_PORT=8092
```

The scan interval is clamped to a minimum of 60 seconds.

## Test-only modes

One scan and exit:

```bash
PAPER_OBSERVER_ONCE=1 node --experimental-strip-types scripts/paper-observer-server.mjs
```

Start HTTP endpoints without Binance scans:

```bash
PAPER_OBSERVER_DISABLE_SCAN=1 node --experimental-strip-types scripts/paper-observer-server.mjs
```

The disabled-scan mode exists for CI/smoke testing and should not be used for the 30-day observation run.
