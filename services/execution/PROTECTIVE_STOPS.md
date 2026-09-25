# Protective stop lifecycle

`maintainProtectiveStop` accepts an immutable plan, a registered position, a complete fresh account snapshot, a `StopStore` and a `StopGateway`. It is a source-level service, not a live worker or CLI. Development tests inject a fake transport. Do not activate it by merely adding API keys.

Plans explicitly allow `PLACE_STOP` and, for replacement, `REPLACE_STOP`; the same action in forbiddenActions always wins. Expiration of an entry plan does not revoke protection of an existing position. The snapshot must prove one-way isolated AUTO exposure with exact side/quantity; this first adapter conservatively refuses snapshots containing other positions. Trigger prices cannot cross the current mark or loosen either the initial stop or its predecessor.

The database reserves immutable intent before network I/O. A submission claim is never automatically reused, including after a crash before send. A lost response is resolved with exact client ID lookup. A missing result is uncertainty, not permission to resend. New stop POST acknowledgement is followed by GET verification. Only then can the registered predecessor be canceled; a cancel claim is also single-use. Exact CANCELED lookup completes replacement. Triggered or finished conditional state does not prove a filled child order.

Every attempt pauses entries. Success never resumes AUTO. Research provenance cannot be changed and cannot claim transport actions. Account/position heads prevent competing replacements and bind symbols; retirement and multi-position coordination are deliberately pending. Conservative unresolved states require subsequent read-only evidence or explicit future audited repair, not ID substitution.

The SQLite tables `protective_stops`, `protective_stop_heads` and `protective_stop_events` share the runtime database and are included by whole-database online backup. Only use backups through the existing backup script. Remaining integration gates include exchange filter precision, user-data streams and fills, trusted credential ownership, full position lifecycle and VPS acceptance.
