# VPS deployment guide

Target: Linux VPS, Docker Compose, PostgreSQL, TLS reverse proxy, UTC clock synchronization and outbound HTTPS/WebSocket access.

1. Clone canonical `main`; verify the release SHA and run the complete test suite.
2. Create `.env` outside Git from `.env.example`. Start with AUTO OBSERVE.
3. Create a dedicated Binance AUTO subaccount/key with Futures trade permission, withdrawals disabled and VPS IP allowlisted.
4. Set the OpenAI project key/model and Telegram bot/chat authorization as server-side secrets.
5. Set an explicit AUTO leverage policy. The deterministic 1 USDT observation margin cap remains non-overridable.
6. Set `DATABASE_URL=postgresql://smoke:<password>@postgres:5432/smoke` and a strong `POSTGRES_PASSWORD`, then run `docker compose up -d --build`; expose only the reverse proxy, not PostgreSQL. The migration service applies `db/postgres/0001_smoke_os.sql` before the terminal starts.
7. Verify `/api/os/status`, REST/WS freshness, clock skew, Telegram test alert and exchange reconciliation. Create a backup with `docker compose exec backup /scripts/backup-postgres.sh`, then validate it with `docker compose exec backup /scripts/restore-postgres-check.sh /backups/<file>.dump`.
8. Set `SMOKE_AUTO_ACCOUNT_ISOLATED=true`, choose `SMOKE_AUTO_LEVERAGE`, and enable AUTO-LIVE only after the health center shows credentials, reconciliation and every technical safety check as healthy.

The first 14 AUTO-LIVE days allow unlimited trade count but enforce at most 1 USDT margin per new AUTO trade. Financial PnL/DD/streak stops are observation metrics only; technical SAFE MODE remains mandatory.
