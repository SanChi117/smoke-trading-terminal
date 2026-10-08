# Read-only fill reconciliation

The accounting store binds an entry or Guardian exit to an already persisted exchange order acknowledgement. A configured isolated AUTO account label is required; it is not independent proof of credential ownership. No arbitrary order can be added through the collector. Triggered protective-stop child orders are not yet supported.

`scripts/reconcile-fills.mjs EXISTING_LEDGER.sqlite CLIENT_ORDER_ID_OR_POSITION_ID [entry|guardian]` imports an order's trades using signed GET calls only. It uses the same AUTO environment variables as the other reconciliation scripts. Development verification uses fake transports only; this command has not been invoked with real credentials.

Each pass starts from trade ID zero, follows exact integer IDs (including IDs above JavaScript's safe-number range when supplied as strings), and imports at most 20 pages of 1,000 rows. Each page commits atomically. After interruption, re-reading is safe because identical records deduplicate; conflicting data never overwrites history. Missing/retained history, changing executions, mismatched quantities and page limits remain unresolved. An order lookup brackets the pass.

`RECORDED_QUANTITY_MATCH` means only that imported quantity equals a stable exchange-reported cumulative quantity. It does not certify full account history, terminal order state, funding, AI costs or all-in PnL. API retention applies; an empty response is never evidence that a historical order had no fills.

Amounts are exact fixed-point decimals with up to 18 decimal places. Commission remains in its actual asset; non-USDT fees make net USDT unavailable rather than silently applying an exchange rate. Funding, unimported fills, AI costs and unrealized PnL are explicitly excluded. These SQLite tables are covered by whole-database backup. Production PostgreSQL and event-stream integration remain pending.
