# ADR 0005 — Runtime integrations remain fail-closed

OpenAI, Binance private trading and Telegram are server-side adapters injected with configuration. Missing secrets never leak to the client and never block independent development. OpenAI falls back to the deterministic arbiter, Binance live submission fails closed, and Telegram queues unsent alerts. AUTO orders use the `smoke-` client-order namespace; reconciliation ignores manual orders.
