# VPS deployment: verified development scope

The available server processes are a **read-only challenger observer** and a separate
Telegram worker. They are not a complete live trading service. AUTO-LIVE remains locked;
adding credentials or changing an environment flag does not complete live acceptance.
The earlier guide's instruction to enable live after Docker startup was premature.

## Install and verify

Use a Linux host with Node >=22.13, UTC clock synchronization, outbound HTTPS to the
public data source and enough persistent disk for the SQLite WAL journal. Check out the
reviewed release from this existing repository. Current changes are in draft PR #87;
main has not been updated because the previous default-branch update was rejected.

From the repository root:

```sh
npm run install:ci
npm test
npm run lint
npm run typecheck:runtime
npm run test:python
```

`npm test` includes the production UI build and runtime regression tests. The focused
runtime typecheck excludes AppDeploy's injected SDK and legacy UI/Cloudflare type errors;
it is not a claim that the repository-wide `tsc --noEmit` passes.

## Read-only observation

```sh
node --experimental-strip-types scripts/run-observation-server.mjs /var/lib/smoke-observe/ledger.sqlite BTCUSDT,ETHUSDT --once
```

Omit `--once` for serial cycles every 30 seconds after the previous cycle completes.
Up to 10 symbols are allowed. No trading credentials are needed. Data comes directly
from the fixed Binance Futures origin, with bounded requests and no alternate-origin
fallback. HTTP denial/rate limits produce persisted SAFE_MODE. Verify source availability
on the chosen host; the AppDeploy server previously returned HTTP 451.

The journal stores measured source evidence, Macro, opinions, conflicts, arbitration,
freshness and runtime health. Research heuristics remain `measured-challenger/1` and
cannot promote themselves to a live plan. The process has no execution gateway.

## Service setup

Create the dedicated `smoke` system user and install the reviewed checkout and dependencies
at `/opt/smoke-trading-terminal`. Copy `deployment/observation.env.example` to
`/etc/smoke/observe.env` with mode 0600. Set `SMOKE_OBSERVE_SYMBOLS`. Install the
`deployment/smoke-observation.service.example` unit as `smoke-observation.service`, then
reload systemd and start it. Its `StateDirectory` creates the persistent journal directory.
The service runs without root privileges and writes only in `/var/lib/smoke-observe`.
These service files have not yet been exercised on an actual VPS.

## Optional Telegram worker

Use one bot per journal. Configure `TELEGRAM_BOT_TOKEN`, numeric
`TELEGRAM_AUTHORIZED_CHAT_ID` and comma-separated `TELEGRAM_AUTHORIZED_USER_IDS` in the
server-only environment file. The worker uses authenticated long polling; an existing
webhook must be removed by the owner before using this mode. Do not run two pollers.

```sh
node --experimental-strip-types scripts/run-telegram-worker.mjs /var/lib/smoke-observe/ledger.sqlite --once
```

This command contacts Telegram and delivers queued notifications. Omit `--once` to run
continuously, or install `smoke-telegram.service.example`. Development tests use fake
transport only; no messages were sent during implementation.

Commands and replies are audited atomically. Only allowed chat + user pairs can change
entry pause. Entries default to paused. `/pause_auto_entries` affects new entry
reservation, including its database transaction, while Guardian exits remain independent.
The read-only worker deliberately rejects resume because the live safety runtime is not
connected. Read commands report disconnected account data honestly.

Outbox retry honors rate-limit delay and uses leases; delivery is at-least-once, so a
network timeout after remote acceptance may duplicate a notification. It cannot duplicate
a trading order. Notification outages do not call or authorize execution.

## Backup and recovery

```sh
node scripts/backup-runtime.mjs /var/lib/smoke-observe/ledger.sqlite /path/to/new-backup.sqlite
```

This uses online SQLite backup and reopens the copy for integrity checking. Keep backups
outside the VPS with appropriate access controls. To restore, stop both workers, restore
the verified copy to the journal path, remove old destination WAL/SHM files while all
connections are stopped, restore file ownership, and restart in observation mode.
Do not copy only a live database file while ignoring its WAL.

Entry and Guardian exit recovery use the exact same bounded read-only reconciliation
service. With isolated AUTO credentials, the Guardian variant is:

```sh
node --experimental-strip-types scripts/reconcile-execution.mjs EXISTING_LEDGER.sqlite '' guardian
```

This performs private read requests but does not submit/cancel. Do not infer live readiness
from `RECONCILED_BATCH`. Partial/uncertain exits remain locked against resubmission;
residual-position and protection reconciliation still require completion.

## Live deployment remains pending

Existing Docker/PostgreSQL artifacts describe the target architecture; these SQLite
runtime journals have not been migrated to that normalized production ledger. Remaining
acceptance includes trusted account/position streams, protective-order acknowledgements,
conditional adapters and slippage guards, raw fast-feed Guardian classification,
fees/PnL attribution, hosted authenticated journal/browser acceptance and VPS verification.
Do not start the 14-day AUTO-LIVE policy before those gates are implemented and verified.
