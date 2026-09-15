export const dynamic = "force-dynamic";

export async function GET() {
  const openaiReady = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_ARBITER_MODEL);
  const binanceReady = Boolean(process.env.BINANCE_AUTO_API_KEY && process.env.BINANCE_AUTO_SECRET_KEY);
  const telegramReady = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_AUTHORIZED_CHAT_ID);
  const leverageReady = Boolean(process.env.SMOKE_AUTO_LEVERAGE);
  const liveRequested = process.env.SMOKE_AUTO_LIVE_ENABLED === "true";
  const accountIsolated = process.env.SMOKE_AUTO_ACCOUNT_ISOLATED === "true";
  const liveEnabled = liveRequested && binanceReady && leverageReady && accountIsolated;
  const serverDatabaseConfigured = Boolean(process.env.DATABASE_URL || process.env.CLOUDFLARE_D1_DATABASE_ID);
  return Response.json({
    service: "SMOKE_TRADING_OS", mode: liveEnabled ? "AUTO_LIVE" : "AUTO_OBSERVE", safeMode: liveRequested && !liveEnabled,
    manualDesk: { isolated: true, automationCanModify: false },
    autoDesk: { liveEnabled, marginCapUsdt: 1, credentialsReady: binanceReady, accountIsolated, leveragePolicyReady: leverageReady },
    modules: { marketData: "READY", macro: "READY", brains: "READY", conflicts: "READY", aiArbiter: openaiReady ? "READY" : "WAITING_SECRET", execution: liveEnabled ? "READY" : "SAFE_LOCKED", guardian: "READY", ledger: serverDatabaseConfigured ? "SERVER_DURABLE" : "LOCAL_DURABLE_SCHEMA", telegram: telegramReady ? "READY" : "WAITING_SECRET", replay: "PAPER_READY" },
    requiredSecrets: ["OPENAI_API_KEY", "BINANCE_AUTO_API_KEY", "BINANCE_AUTO_SECRET_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_AUTHORIZED_CHAT_ID"],
    timestamp: Date.now(),
  }, { headers: { "cache-control": "no-store" } });
}
