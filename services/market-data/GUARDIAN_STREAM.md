# Continuous Guardian research capture

Run `node --experimental-strip-types scripts/run-guardian-research.mjs context.json research.sqlite NEW_CAPTURE.jsonl` with the same plan/simulated-position context used by `scripts/replay-fast-guardian.mjs`.

This worker is research-only. It uses public USD-M aggregate-trade and book-ticker sockets, has no credentials or execution gateway, and cannot dispatch private orders. Existing Guardian research provenance remains immutable.

Both sockets must open before resetting the classifier and warming up again. Disconnect, malformed messages, sequence/conflict faults, a 10-second open timeout or a 5-second silent stream closes both sockets. Reconnect backs off from 1 to 60 seconds and only resets after stable data. Callbacks from old sockets are ignored. Sampling continues in disconnected state after initial startup so the research journal reflects data failure.

Capture is exclusive-create, with 64 KB incoming frame and 256 MiB session-file limits. Raw events, resets, disconnects and sample times use the existing replay format. Input evidence is flushed before committing each sample decision. Disk/capture, clock or pipeline failure stops the process; it does not silently continue with unrecorded inputs. Start another session explicitly after diagnosing the failure; no automatic file deletion or retention rotation occurs.

The automated tests include identical real-pipeline journal results when replaying a captured synthetic session. Actual market capture, long-duration capacity/retention acceptance, classifier calibration and production promotion remain pending.

Stream definitions: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market and https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public .
